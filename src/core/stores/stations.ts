import type { CityNodeSeed, ZoneType } from '../../cities/types';
import {
  CONCOURSE_UPGRADES,
  PARK_AND_RIDE_CAPEX_CAD,
  PARK_AND_RIDE_CAPACITY_PENALTY_RATIO,
  PARK_AND_RIDE_DEMAND_BONUS,
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
  baseAttraction: number;
  carryingCapacity0: number;
  carryingCapacity: number;
  todLevel: number;
  concourseTier: 0 | 1 | 2;
  parkAndRideActive: boolean;
  feederActive: boolean;
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
        baseAttraction: s.baseAttraction,
        carryingCapacity0: s.carryingCapacityK,
        carryingCapacity: s.carryingCapacityK,
        todLevel: 0,
        concourseTier: 0,
        parkAndRideActive: false,
        feederActive: false,
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
      baseAttraction: 180,
      carryingCapacity0: 1500,
      carryingCapacity: 1500,
      todLevel: 0,
      concourseTier: 0,
      parkAndRideActive: false,
      feederActive: false,
      waitingCount: 0,
    };
    this.stations.push(created);
    return created;
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
    if (enabled) {
      st.baseProduction = st.baseProduction0 + PARK_AND_RIDE_DEMAND_BONUS;
      st.carryingCapacity = Math.round(
        st.carryingCapacity0 * (1 - PARK_AND_RIDE_CAPACITY_PENALTY_RATIO),
      );
    } else {
      st.baseProduction = st.baseProduction0;
      st.carryingCapacity = st.carryingCapacity0;
    }
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
