import { TRANSIT_MODES } from '../../config/modes';
import {
  ARC_BASE_FARE_CAD,
  BOND_OVERDRAFT_LIMIT_CAD,
  BOND_WEEKLY_INTEREST_RATE,
  CAPEX_TEARDOWN_REFUND_RATIO,
  CONCOURSE_UPGRADES,
  FEEDER_AI_DAILY_OPEX_CAD,
  LRV_EXTRA_CAR_DAILY_OPEX_CAD,
  PARK_AND_RIDE_DAILY_OPEX_CAD,
  STARTING_TREASURY_CAD,
} from '../../config/upgrades';
import type { TransitLineRecord } from '../stores/lines';
import type { StationRecord } from '../stores/stations';

export interface RolloverResult {
  dayRolledOver: boolean;
  weekRolledOver: boolean;
  opExDeducted: number;
  interestAdded: number;
}

export class EconomySystem {
  private treasuryCad = STARTING_TREASURY_CAD;
  private bondDebtCad = 0;
  private dailyFareRevenueCad = 0;
  private unlimitedBudget = false;
  private lastDayIndex = 0;
  private lastWeekIndex = 0;

  reset(unlimitedBudget = false): void {
    this.treasuryCad = STARTING_TREASURY_CAD;
    this.bondDebtCad = 0;
    this.dailyFareRevenueCad = 0;
    this.unlimitedBudget = unlimitedBudget;
    this.lastDayIndex = 0;
    this.lastWeekIndex = 0;
  }

  getTreasuryCad(): number {
    return this.treasuryCad;
  }

  getBondDebtCad(): number {
    return this.bondDebtCad;
  }

  getDailyFareRevenueCad(): number {
    return this.dailyFareRevenueCad;
  }

  getAvailableBuyingPowerCad(): number {
    if (this.unlimitedBudget) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, this.treasuryCad) + Math.max(0, BOND_OVERDRAFT_LIMIT_CAD - this.bondDebtCad);
  }

  canAfford(amountCad: number): boolean {
    if (this.unlimitedBudget || amountCad <= 0) {
      return true;
    }
    return this.getAvailableBuyingPowerCad() + 1e-6 >= amountCad;
  }

  spendCapEx(amountCad: number): { ok: true } | { ok: false; error: string } {
    if (amountCad <= 0) {
      return { ok: true };
    }
    if (!this.canAfford(amountCad)) {
      return {
        ok: false,
        error: `Insufficient funds ($${Math.round(amountCad).toLocaleString('en-CA')} needed; $${Math.round(this.getAvailableBuyingPowerCad()).toLocaleString('en-CA')} available incl. $25,000 Municipal Bond).`,
      };
    }

    this.treasuryCad -= amountCad;
    if (!this.unlimitedBudget && this.treasuryCad < 0) {
      const shortfall = -this.treasuryCad;
      this.bondDebtCad = Math.round((this.bondDebtCad + shortfall) * 100) / 100;
      this.treasuryCad = 0;
    }
    return { ok: true };
  }

  refundCapEx(originalCapExCad: number): number {
    if (originalCapExCad <= 0) {
      return 0;
    }
    const refund = Math.max(0, Math.round(originalCapExCad * CAPEX_TEARDOWN_REFUND_RATIO));
    this.treasuryCad += refund;
    return refund;
  }

  collectFare(riderCount: number): number {
    if (riderCount <= 0) {
      return 0;
    }
    const fare = riderCount * ARC_BASE_FARE_CAD;
    this.treasuryCad += fare;
    this.dailyFareRevenueCad += fare;
    return fare;
  }

  computeLineDailyOpEx(
    line: Pick<TransitLineRecord, 'mode' | 'consistCars' | 'vehicleIds'>,
  ): number {
    const spec = TRANSIT_MODES[line.mode];
    const perVehicleOpEx =
      spec.dailyOpExPerUnit + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_DAILY_OPEX_CAD;
    return line.vehicleIds.length * perVehicleOpEx;
  }

  computeDailyOpEx(
    lines: readonly Pick<TransitLineRecord, 'mode' | 'consistCars' | 'vehicleIds'>[],
    stations: readonly Pick<StationRecord, 'concourseTier' | 'parkAndRideActive' | 'feederActive'>[],
  ): number {
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      total += this.computeLineDailyOpEx(lines[i]);
    }
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      total += CONCOURSE_UPGRADES[st.concourseTier].dailyOpExCad;
      if (st.parkAndRideActive) {
        total += PARK_AND_RIDE_DAILY_OPEX_CAD;
      }
      if (st.feederActive) {
        total += FEEDER_AI_DAILY_OPEX_CAD;
      }
    }
    return total;
  }

  stepDayAndWeekRollover(
    simTimeSeconds: number,
    lines: readonly Pick<TransitLineRecord, 'mode' | 'consistCars' | 'vehicleIds'>[],
    stations: readonly Pick<StationRecord, 'concourseTier' | 'parkAndRideActive' | 'feederActive'>[],
    dailyTodTaxCad = 0,
  ): RolloverResult {
    const nextDayIndex = Math.floor(simTimeSeconds / 86_400);
    if (nextDayIndex <= this.lastDayIndex) {
      return { dayRolledOver: false, weekRolledOver: false, opExDeducted: 0, interestAdded: 0 };
    }

    const dailyOpEx = this.computeDailyOpEx(lines, stations);
    let totalOpExDeducted = 0;
    let totalInterestAdded = 0;
    let weekRolledOver = false;

    for (let day = this.lastDayIndex + 1; day <= nextDayIndex; day++) {
      this.treasuryCad += dailyTodTaxCad;
      this.treasuryCad -= dailyOpEx;
      totalOpExDeducted += dailyOpEx;

      if (!this.unlimitedBudget && this.treasuryCad < 0) {
        const shortfall = -this.treasuryCad;
        this.bondDebtCad = Math.round((this.bondDebtCad + shortfall) * 100) / 100;
        this.treasuryCad = 0;
      }

      this.dailyFareRevenueCad = 0;

      const nextWeekIndex = Math.floor(day / 7);
      if (nextWeekIndex > this.lastWeekIndex) {
        this.lastWeekIndex = nextWeekIndex;
        weekRolledOver = true;
        if (this.bondDebtCad > 0) {
          const interest = Math.round(this.bondDebtCad * BOND_WEEKLY_INTEREST_RATE * 100) / 100;
          this.bondDebtCad = Math.round((this.bondDebtCad + interest) * 100) / 100;
          totalInterestAdded += interest;
        }
      }
    }

    this.lastDayIndex = nextDayIndex;
    return {
      dayRolledOver: true,
      weekRolledOver,
      opExDeducted: totalOpExDeducted,
      interestAdded: totalInterestAdded,
    };
  }

  repayBond(amountCad: number): number {
    if (amountCad <= 0 || this.bondDebtCad <= 0 || this.treasuryCad <= 0) {
      return 0;
    }
    const pay = Math.min(amountCad, this.treasuryCad, this.bondDebtCad);
    this.treasuryCad -= pay;
    this.bondDebtCad = Math.max(0, Math.round((this.bondDebtCad - pay) * 100) / 100);
    return pay;
  }
}
