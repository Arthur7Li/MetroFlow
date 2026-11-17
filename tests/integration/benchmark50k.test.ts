import { describe, expect, it } from 'vitest';
import type { CityManifest, CityNodeSeed } from '../../src/cities/types';
import { MAX_STATIONS } from '../../src/core/contracts';
import { SAB_TOTAL_BYTES, SharedSnapshotReader } from '../../src/core/memory/sharedBuffers';
import { WorkerSimulationEngine } from '../../src/core/worker';

function build512StationGrid(): { manifest: CityManifest; nodes: CityNodeSeed[] } {
  const manifest: CityManifest = {
    id: 'bench_512',
    name: 'Benchmark Metro',
    region: 'Bench',
    currency: 'CAD',
    fareSystemName: 'ARC Card',
    worldBounds: { width: 4000, height: 3200 },
    worldUnitsPerKm: 100,
    startingCamera: { x: 2000, y: 1600, zoom: 0.5 },
    climateProfile: 'PRAIRIE_WINTER_CITY',
    capabilityTraits: {},
    elevationObstacles: [],
    defaultLines: [],
  };

  const zones: Array<'R' | 'C' | 'I' | 'U'> = ['R', 'C', 'I', 'U'];
  const nodes: CityNodeSeed[] = [];
  for (let i = 0; i < MAX_STATIONS; i++) {
    const col = i % 32;
    const row = Math.floor(i / 32);
    nodes.push({
      id: `node_${i}`,
      name: `Station ${i}`,
      x: 150 + col * 120,
      y: 150 + row * 180,
      zone: zones[i % zones.length],
      baseProduction: 220,
      baseAttraction: 220,
      carryingCapacityK: 5000,
    });
  }
  return { manifest, nodes };
}

describe('Milestone 2 Scale Benchmark: 2,500 vehicles & 100,000 daily riders', () => {
  it('executes 30Hz ticks under < 4.0ms median budget with zero dropped cohorts or torn snapshots', () => {
    const { manifest, nodes } = build512StationGrid();
    const sab = new SharedArrayBuffer(SAB_TOTAL_BYTES);
    const reader = new SharedSnapshotReader(sab);
    const engine = new WorkerSimulationEngine(() => {});

    engine.handleCommand(
      {
        type: 'INIT_CITY',
        manifest,
        geometry: { type: 'FeatureCollection', features: [] },
        nodes,
        events: [],
        growthSeed: 'SEED_A',
        sharedBuffer: sab,
      },
      false,
    );

    // Create 50 intersecting lines (each spanning 11 stations with 50 vehicles -> 2,500 active vehicles).
    for (let l = 0; l < 50; l++) {
      const start = (l * 10) % MAX_STATIONS;
      const waypoints = [];
      for (let k = 0; k < 11; k++) {
        const sid = (start + k) % MAX_STATIONS;
        waypoints.push({ stationId: sid, x: nodes[sid].x, y: nodes[sid].y });
      }
      engine.handleCommand({
        type: 'CREATE_LINE',
        name: `Bench Line ${l + 1}`,
        color: '#38bdf8',
        mode: 'LRT_HIGH_FLOOR',
        waypoints,
        initialVehicles: 50,
      });
    }

    expect(engine.vehicles.getActiveCount()).toBe(2_500);

    // Finish initial shadow Dijkstra matrix across all 512 stations before steady-state tick benchmark.
    engine.pathfinder.flushRebuild(engine.stations);

    // Inject 100,000 weighted riders across station origin-destination pairs.
    for (let i = 0; i < 20_000; i++) {
      const origin = i % MAX_STATIONS;
      const dest = (origin + 5 + (i % 15)) % MAX_STATIONS;
      const added = engine.agents.spawnOrCoalesceAtStation(origin, dest, 5, engine.getSimTimeSeconds());
      if (added > 0) {
        engine.stations.addWaitingCount(origin, added);
      }
    }

    // Warm up JIT for 15 ticks, then benchmark 120 consecutive 30Hz ticks.
    for (let w = 0; w < 15; w++) {
      engine.stepTick(4.0);
    }

    const durationsMs: number[] = [];
    let prevTickIndex = reader.readLatest().tickIndex;

    for (let t = 0; t < 120; t++) {
      const elapsed = engine.stepTick(4.0);
      durationsMs.push(elapsed);

      const snap = reader.readLatest();
      expect(snap.tickIndex).toBe(prevTickIndex + 1);
      prevTickIndex = snap.tickIndex;
      expect(snap.vehicleCount).toBe(2_500);
    }

    durationsMs.sort((a, b) => a - b);
    const medianMs = durationsMs[Math.floor(durationsMs.length / 2)];
    console.info(
      `[Benchmark 2,500 vehicles / 100k riders] median=${medianMs.toFixed(3)}ms, p95=${durationsMs[Math.floor(durationsMs.length * 0.95)].toFixed(3)}ms`,
    );

    expect(medianMs).toBeLessThan(4.0);
    expect(engine.agents.getOverflowCount()).toBe(0);
    expect(engine.getDailyRidership()).toBeGreaterThan(0);
  });
});
