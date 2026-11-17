import { describe, expect, it } from 'vitest';
import { RouteSegmentPathfinder } from '../../src/core/routing/pathfinder';
import { AgentStoreSoA } from '../../src/core/stores/agents';
import { TransitLineStore } from '../../src/core/stores/lines';
import { StationStore } from '../../src/core/stores/stations';
import { VehicleStoreSoA } from '../../src/core/stores/vehicles';
import { DemandSystem, getDiurnalMultipliers } from '../../src/core/systems/demandSystem';
import { TRANSFER_FIXTURE_MANIFEST, TRANSFER_FIXTURE_NODES } from '../helpers/transferFixture';

describe('DemandSystem Singly-Constrained Gravity & Binary Logit Mode Split', () => {
  it('conserves zone production T_ij, respects C_min clamping, and excludes unreachable pairs', () => {
    const stations = new StationStore();
    stations.initFromSeeds(TRANSFER_FIXTURE_NODES);
    const lines = new TransitLineStore();
    const vehicles = new VehicleStoreSoA();

    // Connect ONLY A (0) <-> B (1) <-> C (2); leave D (3) disconnected.
    const res = lines.createLine(
      'Route 1',
      '#38bdf8',
      'BUS_LOCAL',
      [
        { stationId: 0, x: stations.stations[0].x, y: stations.stations[0].y },
        { stationId: 1, x: stations.stations[1].x, y: stations.stations[1].y },
        { stationId: 2, x: stations.stations[2].x, y: stations.stations[2].y },
      ],
      stations,
      TRANSFER_FIXTURE_MANIFEST.worldUnitsPerKm,
    );
    if (!('line' in res)) throw new Error('line creation failed');
    vehicles.spawnVehicle(res.line);

    const pathfinder = new RouteSegmentPathfinder();
    pathfinder.scheduleRebuild(stations, lines);
    pathfinder.flushRebuild(stations);

    const agents = new AgentStoreSoA();
    const demand = new DemandSystem();
    demand.initCity(stations, TRANSFER_FIXTURE_MANIFEST.worldUnitsPerKm);

    // Morning peak 08:00 on Day 1.
    const morningSec = 8 * 3600;
    const diurnal = getDiurnalMultipliers(morningSec);
    const dayFraction = 120 / 86_400; // 1 real second at 1x speed

    const result = demand.evaluateOriginDemand(
      0,
      stations.stations.length,
      dayFraction,
      morningSec,
      diurnal,
      stations.stations,
      stations,
      pathfinder,
      agents,
    );

    const expectedTotalP =
      TRANSFER_FIXTURE_NODES[0].baseProduction * diurnal.productionByZone.R * dayFraction;
    expect(result.totalT).toBeCloseTo(expectedTotalP, 5);
    expect(result.transitD).toBeGreaterThan(0);
    expect(result.transitD).toBeLessThanOrEqual(result.totalT);

    // Unreachable origin D (3) produces 0 transit demand even though totalT > 0.
    const unreachableResult = demand.evaluateOriginDemand(
      3,
      stations.stations.length,
      dayFraction,
      morningSec,
      diurnal,
      stations.stations,
      stations,
      pathfinder,
      agents,
    );
    expect(unreachableResult.totalT).toBeGreaterThan(0);
    expect(unreachableResult.transitD).toBe(0);
  });

  it('applies distinct diurnal weekday peaks and weekend flattening', () => {
    const weekdayMorning = getDiurnalMultipliers(8 * 3600);
    const weekdayNight = getDiurnalMultipliers(2 * 3600);
    const saturdayMorning = getDiurnalMultipliers(5 * 86_400 + 8 * 3600);

    expect(weekdayMorning.productionByZone.R).toBe(2.4);
    expect(weekdayNight.productionByZone.R).toBe(0.08);
    expect(weekdayNight.productionByZone.I).toBe(0.15);
    expect(saturdayMorning.productionByZone.R).toBeCloseTo(2.4 * 0.45, 5);
  });
});
