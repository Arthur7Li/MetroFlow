import { describe, expect, it } from 'vitest';
import { SAB_TOTAL_BYTES } from '../../src/core/memory/sharedBuffers';
import { WorkerSimulationEngine } from '../../src/core/worker';
import { TRANSFER_FIXTURE_MANIFEST, TRANSFER_FIXTURE_NODES } from '../helpers/transferFixture';

describe('WorkerPipeline multi-line transfer & ARC fare integration', () => {
  it('routes A -> D cohorts across a B transfer hub, collects $3.50 ARC fares, and tracks Mode Share %', () => {
    const sab = new SharedArrayBuffer(SAB_TOTAL_BYTES);
    const engine = new WorkerSimulationEngine(() => {});

    engine.handleCommand(
      {
        type: 'INIT_CITY',
        manifest: TRANSFER_FIXTURE_MANIFEST,
        geometry: { type: 'FeatureCollection', features: [] },
        nodes: TRANSFER_FIXTURE_NODES,
        events: [],
        growthSeed: 'SEED_A',
        sharedBuffer: sab,
      },
      false,
    );

    // Line 1: A (0) <-> Hub B (1) <-> C (2)
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Line 1',
      color: '#38bdf8',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
        { stationId: 2, x: TRANSFER_FIXTURE_NODES[2].x, y: TRANSFER_FIXTURE_NODES[2].y },
      ],
      initialVehicles: 2,
    });

    // Line 2: Hub B (1) <-> D (3)
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Line 2',
      color: '#f59e0b',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
        { stationId: 3, x: TRANSFER_FIXTURE_NODES[3].x, y: TRANSFER_FIXTURE_NODES[3].y },
      ],
      initialVehicles: 2,
    });

    const treasuryAfterBuild = engine.getTreasuryCad();

    // Seed explicit transfer cohorts at A (0) destined for D (3).
    const seeded = engine.agents.spawnOrCoalesceAtStation(0, 3, 25, engine.getSimTimeSeconds());
    expect(seeded).toBe(25);
    engine.stations.addWaitingCount(0, 25);

    // Advance 30Hz ticks (4,000 sim sec) so Line 1 picks up at A, transfers at Hub B, and Line 2 delivers to D.
    for (let t = 0; t < 1_000; t++) {
      engine.stepTick(4.0);
    }

    expect(engine.getDailyRidership()).toBeGreaterThanOrEqual(25);
    expect(engine.getDailyFareRevenueCad()).toBeGreaterThanOrEqual(25 * 3.5);
    expect(engine.getTreasuryCad()).toBeGreaterThan(treasuryAfterBuild);
    expect(engine.demand.getModeSharePct()).toBeGreaterThan(0);
  });
});
