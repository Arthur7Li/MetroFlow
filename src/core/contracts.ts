import type {
  CityManifest,
  CityNodeSeed,
  EventSchedule,
  GeometryPack,
  TransitModeId,
  ZoneType,
} from '../cities/types';

export const MAX_AGENTS = 100_000;
export const MAX_STATIONS = 512;
export const MAX_VEHICLES = 4_096;
export const ACTIVE_VEHICLE_SOFT_CAP = 2_500;
export const UNREACHABLE_ID = 0xffff;

export const WORKER_TICK_HZ = 30;
export const WORKER_FIXED_DT_REAL_SEC = 1 / WORKER_TICK_HZ;
/** 12 real minutes at 1x speed = 86,400 simulated seconds -> 120 simulated seconds per real second. */
export const SIM_SECONDS_PER_REAL_SECOND = 120;

export type SimSpeed = 0 | 1 | 2 | 4;
export type CrossingType = 'NONE' | 'ROAD_BRIDGE' | 'TRANSIT_BRIDGE' | 'TUNNEL';
export type HeatmapLayerMode = 'NONE' | 'CROWDING' | 'LAND_VALUE' | 'HEADWAYS' | 'UNMET_CAR';
export type GovernorState = 'OK' | 'SAFE_HEADWAY' | 'OPEX_CAP';
export type GrowthSeedId = 'SEED_A' | 'SEED_B' | 'SEED_C';
export type RunOutcome = 'ACTIVE' | 'VICTORY' | 'BANKRUPT' | 'ZERO_APPROVAL';
export type TransportMode = 'SAB' | 'TRANSFERABLE';

export interface RouteWaypointInput {
  stationId?: number;
  x: number;
  y: number;
  crossingType?: CrossingType;
}

export type AutoHeadwayPolicy =
  | { type: 'MANUAL' }
  | { type: 'TARGET_LOAD'; targetLoadPct: number; maxDailyOpExCad: number }
  | { type: 'TARGET_HEADWAY'; headwaySec: number; maxDailyOpExCad: number };

export type InspectorTarget =
  | { kind: 'NONE' }
  | { kind: 'STATION'; stationId: number }
  | { kind: 'LINE'; lineId: number };

export type WorkerCommand =
  | {
      type: 'INIT_CITY';
      manifest: CityManifest;
      geometry: GeometryPack;
      nodes: CityNodeSeed[];
      events: EventSchedule[];
      growthSeed: GrowthSeedId;
      sharedBuffer?: SharedArrayBuffer;
      unlimitedBudget?: boolean;
    }
  | { type: 'SET_SPEED'; speed: SimSpeed }
  | {
      type: 'CREATE_LINE';
      name: string;
      color: string;
      mode: TransitModeId;
      waypoints: RouteWaypointInput[];
      initialVehicles?: number;
    }
  | { type: 'EDIT_LINE_STOPS'; lineId: number; waypoints: RouteWaypointInput[] }
  | { type: 'DELETE_LINE'; lineId: number }
  | { type: 'UPGRADE_CORRIDOR'; lineId: number; targetMode: TransitModeId }
  | { type: 'BUY_VEHICLE'; lineId: number; count?: number }
  | { type: 'SELL_VEHICLE'; lineId: number; count?: number }
  | { type: 'RECALL_VEHICLE_TO_RESERVE'; lineId: number; count?: number }
  | { type: 'SET_CONSIST_CARS'; lineId: number; consistCars: 1 | 2 | 3 | 4 }
  | { type: 'SET_LINE_POLICY'; lineId: number; policy: AutoHeadwayPolicy }
  | { type: 'SET_ALL_DOOR_ARC'; lineId: number; enabled: boolean }
  | { type: 'UPGRADE_STATION_CONCOURSE'; stationId: number; targetTier: 0 | 1 | 2 }
  | { type: 'SET_CORRIDOR_TSP'; lineId: number; enabled: boolean }
  | { type: 'TOGGLE_PARK_AND_RIDE'; stationId: number; enabled: boolean }
  | { type: 'SET_FEEDER_ZONE'; stationId: number; enabled: boolean; radiusKm?: number }
  | { type: 'STAMP_BLUEPRINT'; blueprintId: string; centerX: number; centerY: number }
  | { type: 'SELECT_COUNCIL_POLICY'; policyId: string }
  | { type: 'SELECT_INSPECTOR_TARGET'; target: InspectorTarget }
  | { type: 'REPAY_BOND'; amountCad: number }
  | { type: 'EXPORT_SNAPSHOT'; requestId: string }
  | { type: 'IMPORT_SNAPSHOT'; snapshotBytes: Uint8Array }
  | { type: 'RETURN_SNAPSHOT_BUFFER'; buffer: ArrayBuffer };

export interface TopologyStation {
  stationId: number;
  seedId?: string;
  name: string;
  x: number;
  y: number;
  zone: ZoneType;
  subTag?: 'ENTERTAINMENT';
  concourseTier: 0 | 1 | 2;
  parkAndRideActive: boolean;
  feederActive: boolean;
  feederRadiusKm: number;
  baseProduction: number;
  weeklyBoardings: number;
  todLevel: number;
  todWeight: number;
  carryingCapacity: number;
}

export interface TopologyLineSegment {
  fromStationId: number;
  toStationId: number;
  p0x: number;
  p0y: number;
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  p3x: number;
  p3y: number;
  crossingType: CrossingType;
  parallelLaneOffset: number;
  lengthMeters: number;
}

export interface TopologyLine {
  lineId: number;
  name: string;
  color: string;
  mode: TransitModeId;
  modeTier: 1 | 2 | 3 | 4 | 5;
  consistCars: 1 | 2 | 3 | 4;
  vehicleCount: number;
  segments: TopologyLineSegment[];
}

export interface TopologyFeederZone {
  stationId: number;
  radiusWorldUnits: number;
}

export interface TopologySnapshot {
  topologyVersion: number;
  stations: TopologyStation[];
  lines: TopologyLine[];
  feederZones: TopologyFeederZone[];
}

export interface TelemetryLineSummary {
  lineId: number;
  name: string;
  color: string;
  mode: TransitModeId;
  vehicleCount: number;
  stationCount: number;
  stationIds: number[];
  lengthKm: number;
  allDoorArc: boolean;
  tspEnabled: boolean;
  consistCars: 1 | 2 | 3 | 4;
  totalCapExCad: number;
  dailyOpExCad: number;
  policy: AutoHeadwayPolicy;
  actualHeadwaySec: number;
  targetHeadwaySec: number;
  governorState: GovernorState;
  upgradeRecommended: boolean;
  avgLoadPct: number;
}

export interface TelemetrySnapshot {
  simDay: number;
  simWeek: number;
  simHourMinute: string;
  speed: SimSpeed;
  treasuryCad: number;
  bondDebtCad: number;
  dailyFareRevenueCad: number;
  dailyTodTaxCad: number;
  dailyOpExCad: number;
  dailyRidership: number;
  modeSharePct: number;
  publicApprovalPct: number;
  councilTargetPct: number;
  onProbation: boolean;
  milestoneIndex: number;
  currentAct: 1 | 2 | 3;
  activeWeather: string;
  activeEvents: string[];
  reservePoolCount: number;
  reservePoolByMode: Record<TransitModeId, number>;
  policyDraftPending: boolean;
  runOutcome: RunOutcome;
  activeVehicleCount: number;
  stationUnmetCar: number[];
  lines: TelemetryLineSummary[];
  selectedInspectorData: unknown;
}

export type WorkerOutboundMessage =
  | { type: 'READY'; transportMode: TransportMode }
  | { type: 'TOPOLOGY_SYNC'; topology: TopologySnapshot }
  | { type: 'TELEMETRY_SYNC'; telemetry: TelemetrySnapshot }
  | {
      type: 'TRANSFER_SNAPSHOT';
      tickIndex: number;
      simTimeSeconds: number;
      buffer: ArrayBuffer;
    }
  | { type: 'SNAPSHOT_EXPORTED'; requestId: string; snapshotBytes: Uint8Array }
  | { type: 'ERROR'; message: string };
