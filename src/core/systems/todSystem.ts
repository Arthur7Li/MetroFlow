import {
  MAX_TOD_LEVEL,
  PARK_AND_RIDE_MAX_TOD_LEVEL,
  TOD_GROWTH_MIN_WEEKLY_BOARDINGS,
  TOD_LEVEL_THRESHOLDS,
  TOD_TAX_PER_LEVEL_DAILY_CAD,
  TOD_WEEKLY_GROWTH_RATE,
} from '../../config/upgrades';
import type { StationRecord, StationStore } from '../stores/stations';

export interface WeeklyTodStepResult {
  stationsUpzoned: number;
  totalWeightDelta: number;
}

export class TodSystem {
  computeTodLevel(weeklyBoardings: number, parkAndRideActive: boolean): number {
    const maxLevel = parkAndRideActive ? PARK_AND_RIDE_MAX_TOD_LEVEL : MAX_TOD_LEVEL;
    let tier = 0;
    for (let i = TOD_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (weeklyBoardings >= TOD_LEVEL_THRESHOLDS[i]) {
        tier = i;
        break;
      }
    }
    return Math.min(maxLevel, tier);
  }

  computeDailyTodTaxCad(stations: readonly Pick<StationRecord, 'todLevel'>[]): number {
    let total = 0;
    for (let i = 0; i < stations.length; i++) {
      if (stations[i].todLevel > 0) {
        total += stations[i].todLevel * TOD_TAX_PER_LEVEL_DAILY_CAD;
      }
    }
    return total;
  }

  stepWeeklyTod(stationStore: StationStore, growthRateMultiplier = 1.0): WeeklyTodStepResult {
    let stationsUpzoned = 0;
    let totalWeightDelta = 0;

    for (let i = 0; i < stationStore.stations.length; i++) {
      const st = stationStore.stations[i];
      const maxLevel = st.parkAndRideActive ? PARK_AND_RIDE_MAX_TOD_LEVEL : MAX_TOD_LEVEL;
      const tierFromBoardings = this.computeTodLevel(st.weeklyBoardings, st.parkAndRideActive);
      const nextLevel = Math.min(maxLevel, Math.max(st.todLevel, tierFromBoardings));

      if (nextLevel > st.todLevel) {
        st.todLevel = nextLevel;
        stationsUpzoned += 1;
      }

      if (
        st.weeklyBoardings > TOD_GROWTH_MIN_WEEKLY_BOARDINGS &&
        st.todWeight < st.carryingCapacity
      ) {
        const capacityK = Math.max(1, st.carryingCapacity);
        const deltaW =
          TOD_WEEKLY_GROWTH_RATE *
          growthRateMultiplier *
          st.todWeight *
          (1 - st.todWeight / capacityK);
        const clampedNextW = Math.min(capacityK, st.todWeight + Math.max(0, deltaW));
        totalWeightDelta += clampedNextW - st.todWeight;
        st.todWeight = clampedNextW;
        stationStore.recomputeStationWeights(st.stationId);
      }

      st.lastWeekBoardings = st.weeklyBoardings;
      st.weeklyBoardings = 0;
    }

    return { stationsUpzoned, totalWeightDelta };
  }
}
