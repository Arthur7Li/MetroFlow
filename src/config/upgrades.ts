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

export const FEEDER_AI_CAPEX_CAD = 2_400;
export const FEEDER_AI_DAILY_OPEX_CAD = 65;
export const FEEDER_AI_DEFAULT_RADIUS_KM = 2.5;
export const FEEDER_AI_BASE_BLOCK_CAPTURE = 450;
export const FEEDER_AI_NEIGHBOR_CAPTURE_RATIO = 0.25;
export const FEEDER_AI_MAX_CAPTURE_BONUS = 1_200;

export const TOD_WEEKLY_GROWTH_RATE = 0.08;
export const TOD_GROWTH_MIN_WEEKLY_BOARDINGS = 1_000;
export const TOD_LEVEL_THRESHOLDS = [0, 500, 2_000, 6_000, 15_000, 30_000] as const;
export const TOD_TAX_PER_LEVEL_DAILY_CAD = 25;
export const PARK_AND_RIDE_MAX_TOD_LEVEL = 4;
export const MAX_TOD_LEVEL = 5;

export interface BlueprintNodeOffset {
  key: string;
  dx: number;
  dy: number;
}

export interface BlueprintCorridorSpec {
  nameSuffix: string;
  color: string;
  mode: TransitModeId;
  nodeKeys: string[];
  allDoorArc?: boolean;
  initialVehicles: number;
}

export interface BlueprintTemplateSpec {
  id: string;
  name: string;
  description: string;
  capExCad: number;
  hubConcourseTier: 0 | 1 | 2;
  enableFeederAi: boolean;
  feederRadiusKm?: number;
  nodes: BlueprintNodeOffset[];
  corridors: BlueprintCorridorSpec[];
}

export const INTERCHANGE_BLUEPRINTS: readonly BlueprintTemplateSpec[] = [
  {
    id: 'cross_hub_lrt',
    name: 'Cross-Platform Transit Centre',
    description:
      'Tier 1 Heated Hub + 2 perpendicular Low-Floor Tram crosstown links (±1.6 km) with 2 trams.',
    capExCad: 4_800,
    hubConcourseTier: 1,
    enableFeederAi: false,
    nodes: [
      { key: 'center', dx: 0, dy: 0 },
      { key: 'west', dx: -160, dy: 0 },
      { key: 'east', dx: 160, dy: 0 },
      { key: 'north', dx: 0, dy: -160 },
      { key: 'south', dx: 0, dy: 160 },
    ],
    corridors: [
      {
        nameSuffix: 'E-W Crosstown',
        color: '#10b981',
        mode: 'LRT_LOW_FLOOR',
        nodeKeys: ['west', 'center', 'east'],
        initialVehicles: 1,
      },
      {
        nameSuffix: 'N-S Crosstown',
        color: '#38bdf8',
        mode: 'LRT_LOW_FLOOR',
        nodeKeys: ['north', 'center', 'south'],
        initialVehicles: 1,
      },
    ],
  },
  {
    id: 'pedway_mega_hub',
    name: 'Downtown Pedway Mega-Concourse',
    description:
      'Tier 2 Pedway Hub (60s transfer) + 4-stop High-Floor LRT distributor with All-Door ARC.',
    capExCad: 8_200,
    hubConcourseTier: 2,
    enableFeederAi: false,
    nodes: [
      { key: 'center', dx: 0, dy: 0 },
      { key: 'nw', dx: -160, dy: -100 },
      { key: 'ne', dx: 160, dy: -100 },
      { key: 'south', dx: 0, dy: 160 },
    ],
    corridors: [
      {
        nameSuffix: 'Pedway Spine LRT',
        color: '#2563eb',
        mode: 'LRT_HIGH_FLOOR',
        nodeKeys: ['nw', 'center', 'ne', 'south'],
        allDoorArc: true,
        initialVehicles: 1,
      },
    ],
  },
  {
    id: 'suburban_feeder_hub',
    name: 'Suburban Hub + Feeder AI',
    description:
      'Tier 1 Heated Centre + 2.5 km Feeder AI catchment zone + Articulated BRT trunk link.',
    capExCad: 4_200,
    hubConcourseTier: 1,
    enableFeederAi: true,
    feederRadiusKm: FEEDER_AI_DEFAULT_RADIUS_KM,
    nodes: [
      { key: 'center', dx: 0, dy: 0 },
      { key: 'spur', dx: 240, dy: 0 },
    ],
    corridors: [
      {
        nameSuffix: 'Feeder Trunk BRT',
        color: '#f59e0b',
        mode: 'BRT_ARTICULATED',
        nodeKeys: ['center', 'spur'],
        initialVehicles: 1,
      },
    ],
  },
];

export function getBlueprintById(id: string): BlueprintTemplateSpec | undefined {
  return INTERCHANGE_BLUEPRINTS.find((bp) => bp.id === id);
}

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
