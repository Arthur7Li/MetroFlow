import { describe, expect, it } from 'vitest';
import { UNREACHABLE_ID } from '../../src/core/contracts';
import { RouteSegmentPathfinder } from '../../src/core/routing/pathfinder';
import { TransitLineStore } from '../../src/core/stores/lines';
import { StationStore } from '../../src/core/stores/stations';
import { VehicleStoreSoA } from '../../src/core/stores/vehicles';
import { TRANSFER_FIXTURE_MANIFEST, TRANSFER_FIXTURE_NODES } from '../helpers/transferFixture';

describe('RouteSegmentPathfinder', () => {
  it('computes 2-line transfer tables, unreachable sentinels, and parallel corridor alt routes', () => {
    const stations = new StationStore();
    stations.initFromSeeds(TRANSFER_FIXTURE_NODES);
    const lines = new TransitLineStore();
    const vehicles = new VehicleStoreSoA();

    // Line 1: Station A (0) -> Hub B (1) -> Station C (2)
    const res1 = lines.createLine(
      'Trunk 1',
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
    expect('line' in res1).toBe(true);
    if (!('line' in res1)) return;
    for (let i = 0; i < 4; i++) {
      vehicles.spawnVehicle(res1.line);
    }

    // Line 2: Hub B (1) -> Station D (3)
    const res2 = lines.createLine(
      'Cross 2',
      '#f59e0b',
      'BUS_LOCAL',
      [
        { stationId: 1, x: stations.stations[1].x, y: stations.stations[1].y },
        { stationId: 3, x: stations.stations[3].x, y: stations.stations[3].y },
      ],
      stations,
      TRANSFER_FIXTURE_MANIFEST.worldUnitsPerKm,
    );
    expect('line' in res2).toBe(true);
    if (!('line' in res2)) return;
    vehicles.spawnVehicle(res2.line);

    // Parallel Line 3: Station A (0) -> Hub B (1) with identical mode & fleet (within 10% cost).
    const res3 = lines.createLine(
      'Parallel 3',
      '#10b981',
      'BUS_LOCAL',
      [
        { stationId: 0, x: stations.stations[0].x, y: stations.stations[0].y },
        { stationId: 1, x: stations.stations[1].x, y: stations.stations[1].y },
      ],
      stations,
      TRANSFER_FIXTURE_MANIFEST.worldUnitsPerKm,
    );
    expect('line' in res3).toBe(true);
    if (!('line' in res3)) return;
    vehicles.spawnVehicle(res3.line);
    vehicles.spawnVehicle(res3.line);

    const pathfinder = new RouteSegmentPathfinder();
    // Before rebuild finishes, routes start unreachable.
    expect(pathfinder.getNextLine(0, 3)).toBe(UNREACHABLE_ID);
    expect(pathfinder.getExpectedCost(0, 3)).toBe(Number.POSITIVE_INFINITY);

    pathfinder.scheduleRebuild(stations, lines, 1.0, 1.0, [0, 1, 2, 3]);
    // Test time-sliced step with 2 origins per tick -> 2 ticks for 4 stations.
    expect(pathfinder.stepRebuild(stations, 2)).toBe(false);
    // Front buffer remains intact while back buffer computes.
    expect(pathfinder.getNextLine(0, 3)).toBe(UNREACHABLE_ID);
    expect(pathfinder.stepRebuild(stations, 2)).toBe(true);

    // Route A -> D boards a line serving A -> B, alights at transfer hub B (1), then takes Line 2 (B -> D).
    const firstLineAD = pathfinder.getNextLine(0, 3);
    expect([res1.line.lineId, res3.line.lineId]).toContain(firstLineAD);
    expect(pathfinder.getAlightStation(0, 3)).toBe(1);
    expect(pathfinder.getNextLine(1, 3)).toBe(res2.line.lineId);
    expect(pathfinder.getAlightStation(1, 3)).toBe(3);

    // Parallel line table captures the alternative corridor option between A and B.
    const altLineAB = pathfinder.getAltLine(0, 1);
    expect(altLineAB).not.toBe(UNREACHABLE_ID);
    expect(altLineAB).not.toBe(pathfinder.getNextLine(0, 1));

    // Verify concourse transfer penalty increases A -> D cost compared to A -> C direct ride.
    const costAC = pathfinder.getExpectedCost(0, 2);
    const costAD = pathfinder.getExpectedCost(0, 3);
    expect(Number.isFinite(costAC)).toBe(true);
    expect(costAD).toBeGreaterThan(costAC);
  });
});
