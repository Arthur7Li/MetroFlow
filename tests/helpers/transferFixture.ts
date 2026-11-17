import type { CityManifest, CityNodeSeed } from '../../src/cities/types';

export const TRANSFER_FIXTURE_MANIFEST: CityManifest = {
  id: 'transfer_test_city',
  name: 'Transfer Test City',
  region: 'AB',
  currency: 'CAD',
  fareSystemName: 'ARC Card',
  worldBounds: { width: 2000, height: 2000 },
  worldUnitsPerKm: 100,
  startingCamera: { x: 1000, y: 1000, zoom: 1.0 },
  climateProfile: 'PRAIRIE_WINTER_CITY',
  capabilityTraits: {},
  elevationObstacles: [],
  defaultLines: [],
};

/**
 * 4-station fixture:
 * - A (0): Residential origin
 * - B (1): Transfer hub
 * - C (2): Campus destination on Line 1 (A -> B -> C)
 * - D (3): Commercial destination on Line 2 (B -> D)
 */
export const TRANSFER_FIXTURE_NODES: CityNodeSeed[] = [
  {
    id: 'station_a',
    name: 'Station A',
    x: 400,
    y: 1000,
    zone: 'R',
    baseProduction: 4000,
    baseAttraction: 200,
    carryingCapacityK: 8000,
  },
  {
    id: 'station_b',
    name: 'Hub B',
    x: 900,
    y: 1000,
    zone: 'C',
    baseProduction: 800,
    baseAttraction: 1200,
    carryingCapacityK: 8000,
  },
  {
    id: 'station_c',
    name: 'Station C',
    x: 1400,
    y: 1000,
    zone: 'U',
    baseProduction: 400,
    baseAttraction: 1800,
    carryingCapacityK: 8000,
  },
  {
    id: 'station_d',
    name: 'Station D',
    x: 900,
    y: 500,
    zone: 'C',
    baseProduction: 400,
    baseAttraction: 3000,
    carryingCapacityK: 8000,
  },
];
