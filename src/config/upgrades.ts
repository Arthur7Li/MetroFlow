import type { TransitModeId } from '../cities/types';
import type { CrossingType } from '../core/contracts';

export const STARTING_TREASURY_CAD = 50_000;
export const ARC_BASE_FARE_CAD = 3.5;
export const CAPEX_TEARDOWN_REFUND_RATIO = 0.75;
export const BOND_OVERDRAFT_LIMIT_CAD = 25_000;
export const BOND_WEEKLY_INTEREST_RATE = 0.05;

export const ALL_DOOR_ARC_CAPEX_CAD = 1_500;
export const ALL_DOOR_ARC_DWELL_MULT = 0.5;

export const TSP_CAPEX_PER_KM_CAD = 900;
export const TRAM_NO_TSP_SPEED_MULT = 0.85;

export const LRV_EXTRA_CAR_CAPEX_CAD = 1_800;
export const LRV_EXTRA_CAR_DAILY_OPEX_CAD = 150;
export const MAX_LRV_CONSIST_CARS = 4;

export const PARK_AND_RIDE_CAPEX_CAD = 800;
export const PARK_AND_RIDE_DAILY_OPEX_CAD = 15;
export const PARK_AND_RIDE_DEMAND_BONUS = 400;
export const PARK_AND_RIDE_CAPACITY_PENALTY_RATIO = 0.15;

export const ROAD_BRIDGE_SPEED_CAP_KMH = 25;
export const MAX_SCENIC_APPROVAL_BONUS_PCT = 15;

export interface ConcourseUpgradeSpec {
  tier: 0 | 1 | 2;
  label: string;
  capExCad: number;
  dailyOpExCad: number;
  transferPenaltySec: number;
}

export const CONCOURSE_UPGRADES: Record<0 | 1 | 2, ConcourseUpgradeSpec> = {
  0: {
    tier: 0,
    label: 'Curbside Stop',
    capExCad: 0,
    dailyOpExCad: 0,
    transferPenaltySec: 240,
  },
  1: {
    tier: 1,
    label: 'Heated Transit Centre',
    capExCad: 1_200,
    dailyOpExCad: 20,
    transferPenaltySec: 120,
  },
  2: {
    tier: 2,
    label: 'Multi-Modal Pedway Concourse',
    capExCad: 3_500,
    dailyOpExCad: 55,
    transferPenaltySec: 60,
  },
};

export interface RiverCrossingSpec {
  type: CrossingType;
  label: string;
  description: string;
  costMultiplier: number;
  slopeSpeedMult: number;
  maxSpeedKmhCap: number | null;
  weatherImmune: boolean;
  approvalBonusPct: number;
  allowedModes: readonly TransitModeId[];
}

export const RIVER_CROSSING_SPECS: Record<CrossingType, RiverCrossingSpec> = {
  NONE: {
    type: 'NONE',
    label: 'Surface Alignment',
    description: 'Standard corridor alignment without a river gorge crossing.',
    costMultiplier: 1.0,
    slopeSpeedMult: 1.0,
    maxSpeedKmhCap: null,
    weatherImmune: false,
    approvalBonusPct: 0,
    allowedModes: [
      'BUS_LOCAL',
      'BRT_ARTICULATED',
      'LRT_LOW_FLOOR',
      'LRT_HIGH_FLOOR',
      'REGIONAL_RAIL',
    ],
  },
  ROAD_BRIDGE: {
    type: 'ROAD_BRIDGE',
    label: 'Shared Road Bridge',
    description: 'Uses existing arterial river crossing; 1.0x CapEx, capped at 25 km/h mixed traffic.',
    costMultiplier: 1.0,
    slopeSpeedMult: 1.0,
    maxSpeedKmhCap: ROAD_BRIDGE_SPEED_CAP_KMH,
    weatherImmune: false,
    approvalBonusPct: 0,
    allowedModes: ['BUS_LOCAL', 'BRT_ARTICULATED', 'LRT_LOW_FLOOR'],
  },
  TRANSIT_BRIDGE: {
    type: 'TRANSIT_BRIDGE',
    label: 'Dedicated High-Level Transit Bridge',
    description:
      'Grade-separated transit bridge; 2.4x track CapEx, -15% valley grade penalty, +5% Scenic Approval.',
    costMultiplier: 2.4,
    slopeSpeedMult: 0.85,
    maxSpeedKmhCap: null,
    weatherImmune: false,
    approvalBonusPct: 5,
    allowedModes: [
      'BUS_LOCAL',
      'BRT_ARTICULATED',
      'LRT_LOW_FLOOR',
      'LRT_HIGH_FLOOR',
      'REGIONAL_RAIL',
    ],
  },
  TUNNEL: {
    type: 'TUNNEL',
    label: 'Deep Bored Tunnel & Portal',
    description: 'Deep river-valley bore; 3.2x track CapEx, 0% grade penalty, full cruise & weather immunity.',
    costMultiplier: 3.2,
    slopeSpeedMult: 1.0,
    maxSpeedKmhCap: null,
    weatherImmune: true,
    approvalBonusPct: 0,
    allowedModes: ['BRT_ARTICULATED', 'LRT_LOW_FLOOR', 'LRT_HIGH_FLOOR', 'REGIONAL_RAIL'],
  },
};

export function isModeAllowedOnCrossing(mode: TransitModeId, crossing: CrossingType): boolean {
  return RIVER_CROSSING_SPECS[crossing].allowedModes.includes(mode);
}

export function supportsMultiCarConsist(mode: TransitModeId): boolean {
  return mode === 'LRT_HIGH_FLOOR';
}
