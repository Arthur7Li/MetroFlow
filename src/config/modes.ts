import type { TransitModeId } from '../cities/types';

export interface TransitModeSpec {
  id: TransitModeId;
  tier: 1 | 2 | 3 | 4 | 5;
  name: string;
  capacityPerUnit: number;
  cruiseSpeedKmh: number;
  trackCapExPerKm: number;
  vehicleCapEx: number;
  dailyOpExPerUnit: number;
  minSafeHeadwaySec: number;
  gradeSeparated: boolean;
  weatherVulnerability: number;
}

export const TRANSIT_MODES: Record<TransitModeId, TransitModeSpec> = {
  BUS_LOCAL: {
    id: 'BUS_LOCAL',
    tier: 1,
    name: 'Local ETS Bus',
    capacityPerUnit: 50,
    cruiseSpeedKmh: 25,
    trackCapExPerKm: 100,
    vehicleCapEx: 250,
    dailyOpExPerUnit: 45,
    minSafeHeadwaySec: 60,
    gradeSeparated: false,
    weatherVulnerability: 1.0,
  },
  BRT_ARTICULATED: {
    id: 'BRT_ARTICULATED',
    tier: 2,
    name: 'Articulated BRT',
    capacityPerUnit: 110,
    cruiseSpeedKmh: 35,
    trackCapExPerKm: 600,
    vehicleCapEx: 550,
    dailyOpExPerUnit: 80,
    minSafeHeadwaySec: 75,
    gradeSeparated: false,
    weatherVulnerability: 0.5,
  },
  LRT_LOW_FLOOR: {
    id: 'LRT_LOW_FLOOR',
    tier: 3,
    name: 'Low-Floor Tram (Valley Line)',
    capacityPerUnit: 200,
    cruiseSpeedKmh: 45,
    trackCapExPerKm: 1800,
    vehicleCapEx: 1100,
    dailyOpExPerUnit: 130,
    minSafeHeadwaySec: 90,
    gradeSeparated: false,
    weatherVulnerability: 0.45,
  },
  LRT_HIGH_FLOOR: {
    id: 'LRT_HIGH_FLOOR',
    tier: 4,
    name: 'High-Floor LRT (Capital Line)',
    capacityPerUnit: 300,
    cruiseSpeedKmh: 65,
    trackCapExPerKm: 4200,
    vehicleCapEx: 1800,
    dailyOpExPerUnit: 190,
    minSafeHeadwaySec: 90,
    gradeSeparated: true,
    weatherVulnerability: 0.0,
  },
  REGIONAL_RAIL: {
    id: 'REGIONAL_RAIL',
    tier: 5,
    name: 'Regional Rail & Automated Metro',
    capacityPerUnit: 500,
    cruiseSpeedKmh: 90,
    trackCapExPerKm: 6500,
    vehicleCapEx: 2800,
    dailyOpExPerUnit: 280,
    minSafeHeadwaySec: 180,
    gradeSeparated: true,
    weatherVulnerability: 0.0,
  },
};

export const MODE_TIER_ORDER: readonly TransitModeId[] = [
  'BUS_LOCAL',
  'BRT_ARTICULATED',
  'LRT_LOW_FLOOR',
  'LRT_HIGH_FLOOR',
  'REGIONAL_RAIL',
];
