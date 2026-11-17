export type TransitModeId =
  | 'BUS_LOCAL'
  | 'BRT_ARTICULATED'
  | 'LRT_LOW_FLOOR'
  | 'LRT_HIGH_FLOOR'
  | 'REGIONAL_RAIL';

export type ClimateProfileId = 'PRAIRIE_WINTER_CITY' | 'MARITIME_RAIN' | 'SNOW_BELT';

export type ObstacleType =
  | 'RIVER_VALLEY_GORGE'
  | 'HARBOR_INLET'
  | 'CANAL_NETWORK'
  | 'MOUNTAIN_RIDGE';

export type ZoneType = 'R' | 'C' | 'I' | 'U';

/** Typed capability flags reserved for Post-MVP city mechanics. */
export interface CityCapabilityTraits {
  requireUnderground?: boolean;
  waterNavigationAllowed?: boolean;
  bikeCatchmentMultiplier?: number;
  throughRunningPairs?: Array<[string, string]>;
  stationRetailRevenueModel?: boolean;
}

export interface ElevationObstacle {
  id: string;
  type: ObstacleType;
  bridgeCostMultiplier: number;
  tunnelCostMultiplier: number;
  bridgeSlopePenalty: number;
}

export interface DefaultLinePreset {
  badge: string;
  name: string;
  color: string;
  mode: TransitModeId;
}

export interface CityManifest {
  id: string;
  name: string;
  region: string;
  currency: string;
  fareSystemName: string;
  worldBounds: { width: number; height: number };
  worldUnitsPerKm: number;
  startingCamera: { x: number; y: number; zoom: number };
  climateProfile: ClimateProfileId;
  capabilityTraits: CityCapabilityTraits;
  elevationObstacles: ElevationObstacle[];
  defaultLines: DefaultLinePreset[];
}

export interface GeometryFeatureProperties {
  id: string;
  name: string;
  kind: 'RIVER' | 'VALLEY' | 'PARK' | 'ARTERIAL';
  roadClass?: 'RING' | 'FREEWAY' | 'ARTERIAL';
}

export interface GeometryFeature {
  type: 'Feature';
  properties: GeometryFeatureProperties;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'LineString'; coordinates: number[][] };
}

export interface GeometryPack {
  type: 'FeatureCollection';
  features: GeometryFeature[];
}

export interface CityNodeSeed {
  id: string;
  name: string;
  x: number;
  y: number;
  zone: ZoneType;
  subTag?: 'ENTERTAINMENT';
  baseProduction: number;
  baseAttraction: number;
  carryingCapacityK: number;
}

export interface EventSchedule {
  id: string;
  label: string;
  type: 'WEATHER' | 'SURGE';
  startDay?: number;
  durationDays: number;
  speedMultiplierBus: number;
  speedMultiplierSurfaceRail: number;
  surgeNodeId?: string;
  surgeFactor?: number;
}
