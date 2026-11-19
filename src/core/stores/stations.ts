import type { CityNodeSeed, ZoneType } from '../../cities/types';
import {
  CONCOURSE_UPGRADES,
  FEEDER_AI_CAPEX_CAD,
  FEEDER_AI_DEFAULT_RADIUS_KM,
  PARK_AND_RIDE_CAPEX_CAD,
  PARK_AND_RIDE_CAPACITY_PENALTY_RATIO,
  PARK_AND_RIDE_DEMAND_BONUS,
  PARK_AND_RIDE_MAX_TOD_LEVEL,
} from '../../config/upgrades';
import { MAX_STATIONS } from '../contracts';
import type { StationRenderSoA } from '../memory/sharedBuffers';

export interface StationRecord {
  stationId: number;
  seedId?: string;
  name: string;
  x: number;
  y: number;
  zone: ZoneType;
  subTag?: 'ENTERTAINMENT';
  baseProduction0: number;
  baseProduction: number;
  baseAttraction0: number;
  baseAttraction: number;
  carryingCapacity0: number;
  carryingCapacity: number;
  todLevel: number;
  todWeight: number;
  weeklyBoardings: number;
  lastWeekBoardings: number;
  concourseTier: 0 | 1 | 2;
  parkAndRideActive: boolean;
  feederActive: boolean;
  feederRadiusKm: number;
  feederDemandBonus: number;
  waitingCount: number;
}

export class StationStore {
  readonly stations: StationRecord[] = [];
  private customCounter = 1;

  initFromSeeds(seeds: CityNodeSeed[]): void {
    this.stations.length = 0;
    this.customCounter = 1;
    const limit = Math.min(seeds.length, MAX_STATIONS);
    for (let i = 0; i < limit; i++) {
      const s = seeds[i];
      this.stations.push({
        stationId: i,
        seedId: s.id,
        name: s.name,
        x: s.x,
        y: s.y,
        zone: s.zone,
        subTag: s.subTag,
        baseProduction0: s.baseProduction,
        baseProduction: s.baseProduction,
        baseAttraction0: s.baseAttraction,
        baseAttraction: s.baseAttraction,
        carryingCapacity0: s.carryingCapacityK,
        carryingCapacity: s.carryingCapacityK,
        todLevel: 0,
        todWeight: s.baseProduction,
        weeklyBoardings: 0,
        lastWeekBoardings: 0,
        concourseTier: 0,
        parkAndRideActive: false,
        feederActive: false,
        feederRadiusKm: FEEDER_AI_DEFAULT_RADIUS_KM,
        feederDemandBonus: 0,
        waitingCount: 0,
      });
    }
  }

  getById(stationId: number): StationRecord | undefined {
    return this.stations[stationId];
  }

  addWaitingCount(stationId: number, delta: number): void {
    const st = this.stations[stationId];
    if (!st) {
      return;
    }
    st.waitingCount = Math.max(0, st.waitingCount + delta);
  }

  findNearestStation(x: number, y: number, maxRadiusUnits: number): StationRecord | undefined {
    const maxDistSq = maxRadiusUnits * maxRadiusUnits;
    let best: StationRecord | undefined;
    let bestDistSq = maxDistSq;

    for (let i = 0; i < this.stations.length; i++) {
      const st = this.stations[i];
      const dx = st.x - x;
      const dy = st.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        best = st;
      }
    }
    return best;
  }

  resolveOrCreateStation(
    x: number,
    y: number,
    preferredStationId?: number,
    snapRadiusUnits = 25,
  ): StationRecord | undefined {
    if (preferredStationId !== undefined && this.stations[preferredStationId]) {
      return this.stations[preferredStationId];
    }

    const snapped = this.findNearestStation(x, y, snapRadiusUnits);
    if (snapped) {
      return snapped;
    }

    if (this.stations.length >= MAX_STATIONS) {
      return undefined;
    }

    const stationId = this.stations.length;
    const stopNumber = this.customCounter++;
    const created: StationRecord = {
      stationId,
      name: `Stop ${stopNumber}`,
      x,
      y,
      zone: 'R',
      baseProduction0: 250,
      baseProduction: 250,
      baseAttraction0: 180,
      baseAttraction: 180,
      carryingCapacity0: 1500,
      carryingCapacity: 1500,
      todLevel: 0,
      todWeight: 250,
      weeklyBoardings: 0,
      lastWeekBoardings: 0,
      concourseTier: 0,
      parkAndRideActive: false,
      feederActive: false,
      feederRadiusKm: FEEDER_AI_DEFAULT_RADIUS_KM,
      feederDemandBonus: 0,
      waitingCount: 0,
    };
    this.stations.push(created);
    return created;
  }

  recomputeStationWeights(stationId: number): void {
    const st = this.stations[stationId];
    if (!st) {
      return;
    }
    const todScale = st.baseProduction0 > 0 ? st.todWeight / st.baseProduction0 : 1;
    st.baseProduction =
      Math.round(st.todWeight) +
      (st.parkAndRideActive ? PARK_AND_RIDE_DEMAND_BONUS : 0) +
      (st.feederActive ? st.feederDemandBonus : 0);
    st.baseAttraction = Math.max(1, Math.round(st.baseAttraction0 * todScale));
  }

  recordBoardings(stationId: number, count: number): void {
    const st = this.stations[stationId];
    if (!st || count <= 0) {
      return;
    }
    st.weeklyBoardings += count;
  }

  getConcourseTransitionCost(
    stationId: number,
    targetTier: 0 | 1 | 2,
  ): { capExCostCad: number; refundOriginalCad: number } | undefined {
    const st = this.stations[stationId];
    if (!st) {
      return undefined;
    }
    const diff = CONCOURSE_UPGRADES[targetTier].capExCad - CONCOURSE_UPGRADES[st.concourseTier].capExCad;
    return diff >= 0
      ? { capExCostCad: diff, refundOriginalCad: 0 }
      : { capExCostCad: 0, refundOriginalCad: -diff };
  }

  setConcourseTier(stationId: number, targetTier: 0 | 1 | 2): boolean {
    const st = this.stations[stationId];
    if (!st) {
      return false;
    }
    st.concourseTier = targetTier;
    return true;
  }

  getParkAndRideTransitionCost(
    stationId: number,
    enabled: boolean,
  ): { capExCostCad: number; refundOriginalCad: number } | undefined {
    const st = this.stations[stationId];
    if (!st || st.parkAndRideActive === enabled) {
      return st ? { capExCostCad: 0, refundOriginalCad: 0 } : undefined;
    }
    return enabled
      ? { capExCostCad: PARK_AND_RIDE_CAPEX_CAD, refundOriginalCad: 0 }
      : { capExCostCad: 0, refundOriginalCad: PARK_AND_RIDE_CAPEX_CAD };
  }

  setParkAndRideActive(stationId: number, enabled: boolean): boolean {
    const st = this.stations[stationId];
    if (!st) {
      return false;
    }
    st.parkAndRideActive = enabled;
    st.carryingCapacity = enabled
      ? Math.round(st.carryingCapacity0 * (1 - PARK_AND_RIDE_CAPACITY_PENALTY_RATIO))
      : st.carryingCapacity0;
    if (enabled) {
      st.todLevel = Math.min(PARK_AND_RIDE_MAX_TOD_LEVEL, st.todLevel);
      st.todWeight = Math.min(st.carryingCapacity, st.todWeight);
    }
    this.recomputeStationWeights(stationId);
    return true;
  }

  getFeederTransitionCost(
    stationId: number,
    enabled: boolean,
  ): { capExCostCad: number; refundOriginalCad: number } | undefined {
    const st = this.stations[stationId];
    if (!st || st.feederActive === enabled) {
      return st ? { capExCostCad: 0, refundOriginalCad: 0 } : undefined;
    }
    return enabled
      ? { capExCostCad: FEEDER_AI_CAPEX_CAD, refundOriginalCad: 0 }
      : { capExCostCad: 0, refundOriginalCad: FEEDER_AI_CAPEX_CAD };
  }

  setFeederZone(
    stationId: number,
    enabled: boolean,
    radiusKm = FEEDER_AI_DEFAULT_RADIUS_KM,
  ): boolean {
    const st = this.stations[stationId];
    if (!st) {
      return false;
    }
    st.feederActive = enabled;
    st.feederRadiusKm = Math.max(0.5, Math.min(5.0, radiusKm));
    if (!enabled) {
      st.feederDemandBonus = 0;
    }
    this.recomputeStationWeights(stationId);
    return true;
  }

  writeToRenderSlot(target: StationRenderSoA): void {
    const count = this.stations.length;
    for (let i = 0; i < count; i++) {
      const st = this.stations[i];
      target.waitingCount[i] = st.waitingCount;
      target.todLevel[i] = st.todLevel;
      target.concourseTier[i] = st.concourseTier;
      target.parkAndRideFlag[i] = st.parkAndRideActive ? 1 : 0;
      target.feederActiveFlag[i] = st.feederActive ? 1 : 0;
    }
  }
}
