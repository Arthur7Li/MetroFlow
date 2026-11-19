import type { TransitModeId } from '../../cities/types';
import { TRANSIT_MODES } from '../../config/modes';
import {
  FEEDER_AI_BASE_BLOCK_CAPTURE,
  FEEDER_AI_DEFAULT_RADIUS_KM,
  FEEDER_AI_MAX_CAPTURE_BONUS,
  FEEDER_AI_NEIGHBOR_CAPTURE_RATIO,
  LRV_EXTRA_CAR_CAPEX_CAD,
  LRV_EXTRA_CAR_DAILY_OPEX_CAD,
} from '../../config/upgrades';
import type { GovernorState } from '../contracts';
import { computeLineRoundTripSec, type TransitLineRecord } from '../stores/lines';
import type { StationStore } from '../stores/stations';
import type { VehicleStoreSoA } from '../stores/vehicles';
import type { EconomySystem } from './economySystem';

const DISPATCH_INTERVAL_SIM_SEC = 60;

export interface LineDispatchMetrics {
  actualHeadwaySec: number;
  targetHeadwaySec: number;
  governorState: GovernorState;
  upgradeRecommended: boolean;
  avgLoadPct: number;
}

function emptyReservePool(): Record<TransitModeId, number> {
  return {
    BUS_LOCAL: 0,
    BRT_ARTICULATED: 0,
    LRT_LOW_FLOOR: 0,
    LRT_HIGH_FLOOR: 0,
    REGIONAL_RAIL: 0,
  };
}

export class DispatchSystem {
  private reservePoolByMode: Record<TransitModeId, number> = emptyReservePool();
  private readonly lowLoadStreaks = new Map<number, number>();
  private readonly metricsByLine = new Map<number, LineDispatchMetrics>();
  private lastDispatchSimSec = 0;

  reset(): void {
    this.reservePoolByMode = emptyReservePool();
    this.lowLoadStreaks.clear();
    this.metricsByLine.clear();
    this.lastDispatchSimSec = 0;
  }

  getTotalReserveCount(): number {
    return (
      this.reservePoolByMode.BUS_LOCAL +
      this.reservePoolByMode.BRT_ARTICULATED +
      this.reservePoolByMode.LRT_LOW_FLOOR +
      this.reservePoolByMode.LRT_HIGH_FLOOR +
      this.reservePoolByMode.REGIONAL_RAIL
    );
  }

  getReservePoolSnapshot(): Record<TransitModeId, number> {
    return { ...this.reservePoolByMode };
  }

  addToReserve(mode: TransitModeId, count = 1): void {
    if (count > 0) {
      this.reservePoolByMode[mode] += count;
    }
  }

  tryPopReserveVehicle(mode: TransitModeId): boolean {
    if (this.reservePoolByMode[mode] <= 0) {
      return false;
    }
    this.reservePoolByMode[mode] -= 1;
    return true;
  }

  clearLineState(lineId: number): void {
    this.lowLoadStreaks.delete(lineId);
    this.metricsByLine.delete(lineId);
  }

  recomputeFeederCatchments(stationStore: StationStore, worldUnitsPerKm: number): void {
    const stations = stationStore.stations;
    for (let i = 0; i < stations.length; i++) {
      const hub = stations[i];
      if (!hub.feederActive) {
        if (hub.feederDemandBonus !== 0) {
          hub.feederDemandBonus = 0;
          stationStore.recomputeStationWeights(hub.stationId);
        }
        continue;
      }

      const radiusWorld = hub.feederRadiusKm * worldUnitsPerKm;
      const radiusSq = radiusWorld * radiusWorld;
      let bonus =
        FEEDER_AI_BASE_BLOCK_CAPTURE * (hub.feederRadiusKm / FEEDER_AI_DEFAULT_RADIUS_KM);

      for (let j = 0; j < stations.length; j++) {
        if (j === i) {
          continue;
        }
        const other = stations[j];
        const dx = other.x - hub.x;
        const dy = other.y - hub.y;
        if (dx * dx + dy * dy <= radiusSq) {
          bonus += other.baseProduction0 * FEEDER_AI_NEIGHBOR_CAPTURE_RATIO;
        }
      }

      hub.feederDemandBonus = Math.min(FEEDER_AI_MAX_CAPTURE_BONUS, Math.round(bonus));
      stationStore.recomputeStationWeights(hub.stationId);
    }
  }

  computeLineMetrics(
    line: TransitLineRecord,
    stationStore: StationStore,
    vehicles: VehicleStoreSoA,
    weatherBusMult = 1.0,
    weatherRailMult = 1.0,
  ): LineDispatchMetrics {
    const spec = TRANSIT_MODES[line.mode];
    const roundTripSec = computeLineRoundTripSec(line, weatherBusMult, weatherRailMult);
    const fleet = Math.max(1, line.vehicleIds.length);
    const actualHeadwaySec = Math.round(Math.max(spec.minSafeHeadwaySec, roundTripSec / fleet));
    const maxSafeFleet = Math.max(1, Math.floor(roundTripSec / spec.minSafeHeadwaySec));

    let onboard = 0;
    let totalCap = 0;
    for (const vId of line.vehicleIds) {
      onboard += vehicles.onboardCount[vId];
      totalCap += vehicles.capacity[vId];
    }

    let stationWaiting = 0;
    for (const sid of line.stationIds) {
      stationWaiting += stationStore.getById(sid)?.waitingCount ?? 0;
    }

    const perTrainCap = spec.capacityPerUnit * line.consistCars;
    const effectiveDemand = onboard + stationWaiting * 0.35;
    const avgLoadPct =
      totalCap > 0
        ? Math.min(200, Math.round((effectiveDemand / totalCap) * 100))
        : effectiveDemand > 0
          ? 150
          : 0;

    let targetHeadwaySec = actualHeadwaySec;
    let governorState: GovernorState = 'OK';
    let upgradeRecommended = false;

    if (line.policy.type === 'TARGET_HEADWAY') {
      const clampedTarget = Math.max(spec.minSafeHeadwaySec, line.policy.headwaySec);
      targetHeadwaySec = Math.round(clampedTarget);
      const uncappedDesired = Math.max(1, Math.ceil(roundTripSec / clampedTarget));
      const perVehOpEx =
        spec.dailyOpExPerUnit + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_DAILY_OPEX_CAD;
      const maxOpExFleet = Math.max(1, Math.floor(line.policy.maxDailyOpExCad / perVehOpEx));

      if (line.policy.headwaySec < spec.minSafeHeadwaySec || uncappedDesired > maxSafeFleet) {
        governorState = 'SAFE_HEADWAY';
      } else if (uncappedDesired > maxOpExFleet) {
        governorState = 'OPEX_CAP';
      }
      upgradeRecommended =
        governorState === 'SAFE_HEADWAY' || (governorState === 'OPEX_CAP' && avgLoadPct >= 80);
    } else if (line.policy.type === 'TARGET_LOAD') {
      const perVehOpEx =
        spec.dailyOpExPerUnit + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_DAILY_OPEX_CAD;
      const maxOpExFleet = Math.max(1, Math.floor(line.policy.maxDailyOpExCad / perVehOpEx));
      const governedMax = Math.min(maxSafeFleet, maxOpExFleet);
      const targetFleetEst = Math.max(
        1,
        Math.ceil((onboard + stationWaiting * 0.35) / Math.max(1, perTrainCap * (line.policy.targetLoadPct / 100))),
      );
      if (fleet >= governedMax && avgLoadPct > line.policy.targetLoadPct + 8) {
        governorState = maxOpExFleet < maxSafeFleet ? 'OPEX_CAP' : 'SAFE_HEADWAY';
        upgradeRecommended = true;
      } else if (targetFleetEst > governedMax) {
        governorState = maxOpExFleet < maxSafeFleet ? 'OPEX_CAP' : 'SAFE_HEADWAY';
        upgradeRecommended = avgLoadPct >= 80;
      }
      targetHeadwaySec = Math.round(Math.max(spec.minSafeHeadwaySec, roundTripSec / Math.min(governedMax, targetFleetEst)));
    } else if (fleet >= maxSafeFleet && avgLoadPct >= 95) {
      upgradeRecommended = true;
    }

    const metrics: LineDispatchMetrics = {
      actualHeadwaySec,
      targetHeadwaySec,
      governorState,
      upgradeRecommended,
      avgLoadPct,
    };
    this.metricsByLine.set(line.lineId, metrics);
    return metrics;
  }

  getMetrics(lineId: number): LineDispatchMetrics | undefined {
    return this.metricsByLine.get(lineId);
  }

  evaluateLine(
    line: TransitLineRecord,
    stationStore: StationStore,
    vehicles: VehicleStoreSoA,
    economy: EconomySystem,
    onSpawnVehicle: (line: TransitLineRecord, fromReserve: boolean) => number,
    onRecallVehicle: (line: TransitLineRecord) => boolean,
    weatherBusMult = 1.0,
    weatherRailMult = 1.0,
  ): { changed: boolean; metrics: LineDispatchMetrics } {
    const metrics = this.computeLineMetrics(
      line,
      stationStore,
      vehicles,
      weatherBusMult,
      weatherRailMult,
    );
    const policy = line.policy;
    if (policy.type === 'MANUAL' || line.segments.length === 0) {
      this.lowLoadStreaks.delete(line.lineId);
      return { changed: false, metrics };
    }

    const spec = TRANSIT_MODES[line.mode];
    const roundTripSec = computeLineRoundTripSec(line, weatherBusMult, weatherRailMult);
    const maxSafeFleet = Math.max(1, Math.floor(roundTripSec / spec.minSafeHeadwaySec));
    const perVehOpEx =
      spec.dailyOpExPerUnit + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_DAILY_OPEX_CAD;
    const maxOpExFleet = Math.max(1, Math.floor(policy.maxDailyOpExCad / perVehOpEx));
    const governedMaxFleet = Math.min(maxSafeFleet, maxOpExFleet);
    const perVehCapEx =
      spec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;

    let changed = false;

    const tryAcquireAndSpawn = (): boolean => {
      if (this.tryPopReserveVehicle(line.mode)) {
        const vId = onSpawnVehicle(line, true);
        if (vId !== -1) {
          changed = true;
          return true;
        }
        this.addToReserve(line.mode, 1);
        return false;
      }
      if (!economy.canAfford(perVehCapEx)) {
        return false;
      }
      const vId = onSpawnVehicle(line, false);
      if (vId !== -1) {
        economy.spendCapEx(perVehCapEx);
        line.investedCapExCad += perVehCapEx;
        changed = true;
        return true;
      }
      return false;
    };

    if (policy.type === 'TARGET_HEADWAY') {
      const clampedHeadway = Math.max(spec.minSafeHeadwaySec, policy.headwaySec);
      const uncappedDesired = Math.max(1, Math.ceil(roundTripSec / clampedHeadway));
      const targetFleet = Math.min(governedMaxFleet, uncappedDesired);

      while (line.vehicleIds.length < targetFleet) {
        if (!tryAcquireAndSpawn()) {
          break;
        }
      }
      while (line.vehicleIds.length > targetFleet && line.vehicleIds.length > 1) {
        if (!onRecallVehicle(line)) {
          break;
        }
        changed = true;
      }
    } else if (policy.type === 'TARGET_LOAD') {
      const targetPct = Math.max(25, Math.min(95, policy.targetLoadPct));

      // Enforce governor cap if fleet exceeds OpEx or safe headway ceilings.
      while (line.vehicleIds.length > governedMaxFleet && line.vehicleIds.length > 1) {
        if (!onRecallVehicle(line)) {
          break;
        }
        changed = true;
      }

      if (metrics.avgLoadPct > targetPct + 8 && line.vehicleIds.length < governedMaxFleet) {
        this.lowLoadStreaks.set(line.lineId, 0);
        tryAcquireAndSpawn();
      } else if (metrics.avgLoadPct < targetPct * 0.55 && line.vehicleIds.length > 1) {
        const nextStreak = (this.lowLoadStreaks.get(line.lineId) ?? 0) + 1;
        if (nextStreak >= 2) {
          if (onRecallVehicle(line)) {
            changed = true;
          }
          this.lowLoadStreaks.set(line.lineId, 0);
        } else {
          this.lowLoadStreaks.set(line.lineId, nextStreak);
        }
      } else {
        this.lowLoadStreaks.set(line.lineId, 0);
      }
    }

    const updated = this.computeLineMetrics(
      line,
      stationStore,
      vehicles,
      weatherBusMult,
      weatherRailMult,
    );
    return { changed, metrics: updated };
  }

  stepDispatch(
    simTimeSeconds: number,
    lines: readonly TransitLineRecord[],
    stationStore: StationStore,
    vehicles: VehicleStoreSoA,
    economy: EconomySystem,
    onSpawnVehicle: (line: TransitLineRecord, fromReserve: boolean) => number,
    onRecallVehicle: (line: TransitLineRecord) => boolean,
    weatherBusMult = 1.0,
    weatherRailMult = 1.0,
  ): boolean {
    if (simTimeSeconds - this.lastDispatchSimSec < DISPATCH_INTERVAL_SIM_SEC) {
      return false;
    }
    this.lastDispatchSimSec = simTimeSeconds;

    let anyChanged = false;
    for (let i = 0; i < lines.length; i++) {
      const res = this.evaluateLine(
        lines[i],
        stationStore,
        vehicles,
        economy,
        onSpawnVehicle,
        onRecallVehicle,
        weatherBusMult,
        weatherRailMult,
      );
      if (res.changed) {
        anyChanged = true;
      }
    }
    return anyChanged;
  }
}
