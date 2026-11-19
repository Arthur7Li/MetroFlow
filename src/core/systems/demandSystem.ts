import type { ZoneType } from '../../cities/types';
import { MAX_STATIONS } from '../contracts';
import type { RouteSegmentPathfinder } from '../routing/pathfinder';
import type { AgentStoreSoA } from '../stores/agents';
import type { StationRecord, StationStore } from '../stores/stations';

const GAMMA = 1.8;
const BETA = 0.12;
const C_MIN_MINUTES = 1.0;
const CAR_SPEED_KMH = 42;
const CAR_TORTUOSITY = 1.25;
const BASE_CAR_TERMINAL_MIN = 4.0;
const DOWNTOWN_CAR_PARKING_EXTRA_MIN = 6.0;

export interface DiurnalFactors {
  productionByZone: Record<ZoneType, number>;
  attractionByZone: Record<ZoneType, number>;
  entertainmentAttraction: number;
}

export function getDiurnalMultipliers(simTimeSeconds: number): DiurnalFactors {
  const totalDays = Math.floor(simTimeSeconds / 86_400);
  const dayOfWeek = totalDays % 7; // 0..4 Mon-Fri, 5..6 Sat-Sun
  const isWeekend = dayOfWeek >= 5;
  const hour = (simTimeSeconds % 86_400) / 3600;

  let prod: Record<ZoneType, number>;
  let attr: Record<ZoneType, number>;
  let entAttr: number;

  if (hour >= 6.5 && hour < 9.5) {
    // Morning Peak (06:30–09:30)
    prod = { R: 2.4, C: 0.5, I: 0.4, U: 0.6 };
    attr = { R: 0.4, C: 2.4, I: 2.4, U: 2.4 };
    entAttr = 0.6;
  } else if (hour >= 9.5 && hour < 15.5) {
    // Midday & Off-Peak (09:30–15:30)
    prod = { R: 0.9, C: 0.9, I: 0.8, U: 1.0 };
    attr = { R: 0.8, C: 1.0, I: 0.7, U: 1.0 };
    entAttr = 1.0;
  } else if (hour >= 15.5 && hour < 18.5) {
    // Evening Peak (15:30–18:30)
    prod = { R: 0.7, C: 2.2, I: 2.2, U: 2.2 };
    attr = { R: 2.2, C: 0.9, I: 0.4, U: 0.6 };
    entAttr = 1.4;
  } else if (hour >= 18.5 && hour < 23.0) {
    // Evening Off-Peak (18:30–23:00)
    prod = { R: 0.7, C: 0.7, I: 0.4, U: 0.5 };
    attr = { R: 0.8, C: 0.7, I: 0.3, U: 0.4 };
    entAttr = 1.3;
  } else {
    // Nighttime Lull (23:00–06:30): sparse Industrial & Hospital shift flows
    prod = { R: 0.08, C: 0.05, I: 0.15, U: 0.15 };
    attr = { R: 0.08, C: 0.05, I: 0.15, U: 0.15 };
    entAttr = 0.05;
  }

  if (isWeekend) {
    if ((hour >= 6.5 && hour < 9.5) || (hour >= 15.5 && hour < 18.5)) {
      prod.R *= 0.45;
      prod.C *= 0.45;
      prod.I *= 0.45;
      prod.U *= 0.45;
    }
    if (hour >= 9.5 && hour < 15.5) {
      attr.C *= 1.35;
      entAttr *= 1.35;
    }
  }

  return {
    productionByZone: prod,
    attractionByZone: attr,
    entertainmentAttraction: entAttr,
  };
}

export function computeCarGeneralizedCostMin(
  from: StationRecord,
  to: StationRecord,
  worldUnitsPerKm: number,
): number {
  const euclidKm = Math.hypot(to.x - from.x, to.y - from.y) / worldUnitsPerKm;
  const roadMinutes = ((euclidKm * CAR_TORTUOSITY) / CAR_SPEED_KMH) * 60;
  const parking =
    BASE_CAR_TERMINAL_MIN + (to.zone === 'C' ? DOWNTOWN_CAR_PARKING_EXTRA_MIN : 0);
  return roadMinutes + parking;
}

/**
 * 1Hz time-sliced Singly-Constrained Gravity + Binary Logit Mode Split demand generator.
 */
export class DemandSystem {
  private readonly carCostTable = new Float32Array(MAX_STATIONS * MAX_STATIONS);
  private readonly fractionalCarry = new Float32Array(MAX_STATIONS * MAX_STATIONS);
  private readonly gravityWeights = new Float64Array(MAX_STATIONS);
  readonly originUnmetCarDaily = new Float32Array(MAX_STATIONS);

  private knownStationCount = 0;
  private sliceCursor = 0;
  private worldUnitsPerKm = 100;

  private dailyTotalTripsT = 0;
  private dailyTransitTripsD = 0;

  initCity(stationStore: StationStore, worldUnitsPerKm: number): void {
    this.worldUnitsPerKm = worldUnitsPerKm;
    this.fractionalCarry.fill(0);
    this.originUnmetCarDaily.fill(0);
    this.knownStationCount = 0;
    this.sliceCursor = 0;
    this.dailyTotalTripsT = 0;
    this.dailyTransitTripsD = 0;
    this.syncStationMatrix(stationStore);
  }

  resetDailyCounters(): void {
    this.dailyTotalTripsT = 0;
    this.dailyTransitTripsD = 0;
    this.originUnmetCarDaily.fill(0);
  }

  getOriginUnmetCarSnapshot(stationCount: number): number[] {
    const limit = Math.min(stationCount, MAX_STATIONS);
    const out = new Array<number>(limit);
    for (let i = 0; i < limit; i++) {
      out[i] = Math.round(this.originUnmetCarDaily[i]);
    }
    return out;
  }

  getModeSharePct(): number {
    if (this.dailyTotalTripsT <= 0) {
      return 0;
    }
    return Math.min(100, (this.dailyTransitTripsD / this.dailyTotalTripsT) * 100);
  }

  getDailyTotalTrips(): number {
    return this.dailyTotalTripsT;
  }

  getDailyTransitTrips(): number {
    return this.dailyTransitTripsD;
  }

  syncStationMatrix(stationStore: StationStore): void {
    const n = stationStore.stations.length;
    if (n === this.knownStationCount) {
      return;
    }
    const stations = stationStore.stations;
    for (let i = 0; i < n; i++) {
      const si = stations[i];
      const rowBase = i * MAX_STATIONS;
      for (let j = 0; j < n; j++) {
        if (i === j) {
          this.carCostTable[rowBase + j] = 0;
          continue;
        }
        if (i >= this.knownStationCount || j >= this.knownStationCount) {
          this.carCostTable[rowBase + j] = computeCarGeneralizedCostMin(
            si,
            stations[j],
            this.worldUnitsPerKm,
          );
        }
      }
    }
    this.knownStationCount = n;
  }

  /**
   * Processes one 30Hz time slice (`ceil(N / 30)` origin stations) covering 1.0 full simulated
   * refresh interval (`dtRealCycleSec` scaled to `dtSimPerFullCycleSec = 30 * dtTickSimSec`).
   */
  stepDemandSlice(
    dtTickSimSeconds: number,
    simTimeSeconds: number,
    stationStore: StationStore,
    pathfinder: RouteSegmentPathfinder,
    agentStore: AgentStoreSoA,
  ): void {
    this.syncStationMatrix(stationStore);
    const n = stationStore.stations.length;
    if (n < 2 || dtTickSimSeconds <= 0) {
      return;
    }

    const originsPerTick = Math.max(1, Math.ceil(n / 30));
    const sliceTicksPerFullRefresh = Math.ceil(n / originsPerTick);
    const simSecondsRepresentedPerOrigin = dtTickSimSeconds * sliceTicksPerFullRefresh;
    const dayFraction = simSecondsRepresentedPerOrigin / 86_400;

    const diurnal = getDiurnalMultipliers(simTimeSeconds);
    const stations = stationStore.stations;

    for (let step = 0; step < originsPerTick; step++) {
      if (this.sliceCursor >= n) {
        this.sliceCursor = 0;
      }
      const origin = this.sliceCursor++;
      this.evaluateOriginDemand(
        origin,
        n,
        dayFraction,
        simTimeSeconds,
        diurnal,
        stations,
        stationStore,
        pathfinder,
        agentStore,
      );
    }
  }

  evaluateOriginDemand(
    origin: number,
    stationCount: number,
    dayFraction: number,
    simTimeSeconds: number,
    diurnal: DiurnalFactors,
    stations: readonly StationRecord[],
    stationStore: StationStore,
    pathfinder: RouteSegmentPathfinder,
    agentStore: AgentStoreSoA,
  ): { totalT: number; transitD: number } {
    const si = stations[origin];
    const production = si.baseProduction * diurnal.productionByZone[si.zone] * dayFraction;
    if (production <= 0) {
      return { totalT: 0, transitD: 0 };
    }

    const rowBase = origin * MAX_STATIONS;
    let weightSum = 0;

    for (let j = 0; j < stationCount; j++) {
      if (j === origin) {
        this.gravityWeights[j] = 0;
        continue;
      }
      const sj = stations[j];
      const attrMult =
        sj.subTag === 'ENTERTAINMENT'
          ? diurnal.entertainmentAttraction
          : diurnal.attractionByZone[sj.zone];
      const attraction = sj.baseAttraction * attrMult;

      const cTransit = pathfinder.getExpectedCost(origin, j);
      const cCar = this.carCostTable[rowBase + j];
      const cEff = Math.max(C_MIN_MINUTES, Math.min(cTransit, cCar));
      const w = attraction * Math.pow(cEff, -GAMMA);
      this.gravityWeights[j] = w;
      weightSum += w;
    }

    if (weightSum <= 0) {
      return { totalT: 0, transitD: 0 };
    }

    let originTotalT = 0;
    let originTransitD = 0;

    for (let j = 0; j < stationCount; j++) {
      if (j === origin) {
        continue;
      }
      const tij = production * (this.gravityWeights[j] / weightSum);
      originTotalT += tij;

      const cTransit = pathfinder.getExpectedCost(origin, j);
      if (!Number.isFinite(cTransit)) {
        continue;
      }

      const cClamped = Math.max(C_MIN_MINUTES, cTransit);
      const cCar = this.carCostTable[rowBase + j];
      const modeShare = 1 / (1 + Math.exp(BETA * (cClamped - cCar)));
      const dij = tij * modeShare;
      originTransitD += dij;

      const idx = rowBase + j;
      const accumulated = this.fractionalCarry[idx] + dij;
      const wholeRiders = Math.floor(accumulated);
      this.fractionalCarry[idx] = accumulated - wholeRiders;

      if (wholeRiders > 0) {
        const added = agentStore.spawnOrCoalesceAtStation(origin, j, wholeRiders, simTimeSeconds);
        if (added > 0) {
          stationStore.addWaitingCount(origin, added);
        }
      }
    }

    this.dailyTotalTripsT += originTotalT;
    this.dailyTransitTripsD += originTransitD;
    this.originUnmetCarDaily[origin] += Math.max(0, originTotalT - originTransitD);
    return { totalT: originTotalT, transitD: originTransitD };
  }
}
