import { describe, expect, it } from 'vitest';
import {
  FEEDER_AI_CAPEX_CAD,
  FEEDER_AI_DAILY_OPEX_CAD,
  TOD_TAX_PER_LEVEL_DAILY_CAD,
  TOD_WEEKLY_GROWTH_RATE,
  getBlueprintById,
} from '../../src/config/upgrades';
import type { TelemetrySnapshot } from '../../src/core/contracts';
import { SAB_TOTAL_BYTES } from '../../src/core/memory/sharedBuffers';
import { WorkerSimulationEngine } from '../../src/core/worker';
import { TRANSFER_FIXTURE_MANIFEST, TRANSFER_FIXTURE_NODES } from '../helpers/transferFixture';

function setupEngine(unlimitedBudget = false): {
  engine: WorkerSimulationEngine;
  getLastTelemetry: () => TelemetrySnapshot | null;
} {
  let lastTelemetry: TelemetrySnapshot | null = null;
  const engine = new WorkerSimulationEngine((msg) => {
    if (msg.type === 'TELEMETRY_SYNC') {
      lastTelemetry = msg.telemetry;
    }
  });
  engine.handleCommand(
    {
      type: 'INIT_CITY',
      manifest: TRANSFER_FIXTURE_MANIFEST,
      geometry: { type: 'FeatureCollection', features: [] },
      nodes: TRANSFER_FIXTURE_NODES,
      events: [],
      growthSeed: 'SEED_A',
      sharedBuffer: new SharedArrayBuffer(SAB_TOTAL_BYTES),
      unlimitedBudget,
    },
    false,
  );
  return { engine, getLastTelemetry: () => lastTelemetry };
}

describe('Milestone 4: OCC Auto-Headway, Suburban Feeder AI, Blueprints, Bounded TOD & Heatmaps', () => {
  it('enforces Safe Headway floors and daily OpEx governor caps in Auto-Headway Dispatcher', () => {
    const { engine, getLastTelemetry } = setupEngine(true);

    // 5 km corridor: Station A (0) <-> Station B (1) using Local Bus (floor 60s, OpEx $45/d)
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Bus Trunk',
      color: '#38bdf8',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
      ],
      initialVehicles: 1,
    });

    const line = engine.lines.lines[0];

    // 1. Request impossibly aggressive 20s headway -> clamped at 60s safe headway floor & SAFE_HEADWAY governor
    engine.handleCommand({
      type: 'SET_LINE_POLICY',
      lineId: line.lineId,
      policy: { type: 'TARGET_HEADWAY', headwaySec: 20, maxDailyOpExCad: 5_000 },
    });

    const telemetryAfterFloor = getLastTelemetry()!;
    const summaryFloor = telemetryAfterFloor.lines[0];
    expect(summaryFloor.governorState).toBe('SAFE_HEADWAY');
    expect(summaryFloor.targetHeadwaySec).toBe(60);
    expect(summaryFloor.actualHeadwaySec).toBeGreaterThanOrEqual(60);
    expect(summaryFloor.upgradeRecommended).toBe(true);

    // 2. Restrict OpEx governor cap to $180/d (4 buses * $45/d = $180) -> recalls excess into Central Garage Reserve Pool
    engine.handleCommand({
      type: 'SET_LINE_POLICY',
      lineId: line.lineId,
      policy: { type: 'TARGET_HEADWAY', headwaySec: 120, maxDailyOpExCad: 180 },
    });

    const telemetryAfterOpEx = getLastTelemetry()!;
    const summaryOpEx = telemetryAfterOpEx.lines[0];
    expect(line.vehicleIds.length).toBe(4);
    expect(summaryOpEx.dailyOpExCad).toBe(180);
    expect(summaryOpEx.governorState).toBe('OPEX_CAP');
    expect(telemetryAfterOpEx.reservePoolCount).toBeGreaterThan(0);
    expect(telemetryAfterOpEx.reservePoolByMode.BUS_LOCAL).toBe(telemetryAfterOpEx.reservePoolCount);

    // 3. Relax OpEx cap -> redeploys from Central Garage at $0 CapEx
    const treasuryBeforeRedeploy = engine.getTreasuryCad();
    const reserveBeforeRedeploy = telemetryAfterOpEx.reservePoolCount;
    engine.handleCommand({
      type: 'SET_LINE_POLICY',
      lineId: line.lineId,
      policy: { type: 'TARGET_HEADWAY', headwaySec: 360, maxDailyOpExCad: 2_000 },
    });
    const afterRedeploy = getLastTelemetry()!;
    expect(line.vehicleIds.length).toBe(5);
    expect(afterRedeploy.reservePoolCount).toBe(reserveBeforeRedeploy - 1);
    expect(engine.getTreasuryCad()).toBe(treasuryBeforeRedeploy);
  });

  it('recalls surplus off-peak units on TARGET_LOAD after low-load streaks and captures Feeder AI catchment without TOD K loss', () => {
    const { engine, getLastTelemetry } = setupEngine(false);

    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'South Route',
      color: '#f59e0b',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
      ],
      initialVehicles: 4,
    });
    const line = engine.lines.lines[0];

    // Put on TARGET_LOAD (80%) with 0 onboard/waiting demand across 2+ dispatch intervals (60s each)
    engine.handleCommand({
      type: 'SET_LINE_POLICY',
      lineId: line.lineId,
      policy: { type: 'TARGET_LOAD', targetLoadPct: 80, maxDailyOpExCad: 1_000 },
    });
    // Zero out waiting riders so loadRatio stays < 55% of target across 3 dispatch windows
    for (const st of engine.stations.stations) {
      st.waitingCount = 0;
    }
    for (let i = 0; i < 3; i++) {
      engine.dispatch.stepDispatch(
        engine.getSimTimeSeconds() + (i + 1) * 70,
        engine.lines.lines,
        engine.stations,
        engine.vehicles,
        engine.economy,
        (l, fromReserve) => {
          const v = engine.vehicles.spawnVehicle(l);
          return fromReserve ? v : v;
        },
        (l) => {
          const v = engine.vehicles.sellLastVehicle(l);
          if (v !== -1) engine.dispatch.addToReserve(l.mode, 1);
          return v !== -1;
        },
      );
    }
    expect(line.vehicleIds.length).toBeLessThan(4);
    expect(engine.dispatch.getTotalReserveCount()).toBeGreaterThan(0);

    // Enable Suburban Feeder AI on Station 0 ($2,400 CapEx, $65/d OpEx, 2.5 km radius, 0% TOD carryingCapacity loss)
    const st0Before = { ...engine.stations.getById(0)! };
    const treasuryBeforeFeeder = engine.getTreasuryCad();
    engine.handleCommand({ type: 'SET_FEEDER_ZONE', stationId: 0, enabled: true, radiusKm: 2.5 });

    const st0After = engine.stations.getById(0)!;
    expect(engine.getTreasuryCad()).toBe(treasuryBeforeFeeder - FEEDER_AI_CAPEX_CAD);
    expect(st0After.feederActive).toBe(true);
    expect(st0After.baseProduction).toBeGreaterThan(st0Before.baseProduction);
    expect(st0After.carryingCapacity).toBe(st0Before.carryingCapacity0);
    expect(engine.getDailyOpExCad()).toBeGreaterThanOrEqual(FEEDER_AI_DAILY_OPEX_CAD);
    expect(getLastTelemetry()?.reservePoolCount).toBeGreaterThanOrEqual(0);
  });

  it('converges TOD growth along logistic curve below carryingCapacity K_i and credits +$25/day per TOD level', () => {
    const { engine } = setupEngine(true);

    // Station 1: clean TOD hub (max level 5) vs Station 2: Park-and-Ride Lot (max level 4, -15% K)
    const st1 = engine.stations.getById(1)!;
    engine.handleCommand({ type: 'TOGGLE_PARK_AND_RIDE', stationId: 2, enabled: true });
    const st2 = engine.stations.getById(2)!;
    const k1 = st1.carryingCapacity;
    const k2 = st2.carryingCapacity;
    const w1Initial = st1.todWeight;

    // Simulate 1 week with 35,000 boardings (> 30,000 Tier 5 threshold and > 1,000 growth floor)
    engine.stations.recordBoardings(1, 35_000);
    engine.stations.recordBoardings(2, 35_000);
    const todRes = engine.tod.stepWeeklyTod(engine.stations);

    const expectedDeltaW1 = TOD_WEEKLY_GROWTH_RATE * w1Initial * (1 - w1Initial / k1);
    expect(todRes.stationsUpzoned).toBeGreaterThanOrEqual(2);
    expect(st1.todLevel).toBe(5);
    expect(st2.todLevel).toBe(4); // Consumed 1 TOD slot due to Park-and-Ride
    expect(st1.todWeight).toBeCloseTo(w1Initial + expectedDeltaW1, 3);
    expect(st1.baseProduction).toBe(Math.round(st1.todWeight));

    // Daily TOD tax credits +$25/day * (5 + 4) = $225/day at midnight rollover
    const expectedTax = (5 + 4) * TOD_TAX_PER_LEVEL_DAILY_CAD;
    expect(engine.tod.computeDailyTodTaxCad(engine.stations.stations)).toBe(expectedTax);

    // Run 150 saturated high-boarding weeks -> strictly converges <= carryingCapacity K_i without overflow
    for (let wk = 0; wk < 150; wk++) {
      engine.stations.recordBoardings(1, 35_000);
      engine.stations.recordBoardings(2, 35_000);
      engine.tod.stepWeeklyTod(engine.stations);
    }
    expect(st1.todWeight).toBeLessThanOrEqual(k1);
    expect(st1.todWeight).toBeGreaterThan(k1 * 0.99);
    expect(st2.todWeight).toBeLessThanOrEqual(k2);
  });

  it('stamps Blueprint Interchanges atomically and populates stationUnmetCar heatmap metrics', () => {
    const { engine, getLastTelemetry } = setupEngine(false);

    const bp = getBlueprintById('suburban_feeder_hub')!;
    const treasuryBeforeStamp = engine.getTreasuryCad();

    // Stamp Suburban Hub + Feeder AI near Station 3 (1100, 1500)
    engine.handleCommand({
      type: 'STAMP_BLUEPRINT',
      blueprintId: bp.id,
      centerX: TRANSFER_FIXTURE_NODES[3].x,
      centerY: TRANSFER_FIXTURE_NODES[3].y,
    });

    expect(engine.getTreasuryCad()).toBe(treasuryBeforeStamp - bp.capExCad);
    expect(engine.lines.lines.length).toBe(1);
    expect(engine.lines.lines[0].mode).toBe('BRT_ARTICULATED');
    expect(engine.stations.getById(3)?.concourseTier).toBe(1);
    expect(engine.stations.getById(3)?.feederActive).toBe(true);

    // Step simulation ticks to run 1Hz DemandSystem slice; disconnected stations 0, 1, 2 show positive Unmet Car demand
    for (let t = 0; t < 15; t++) {
      engine.stepTick(4.0);
    }
    const unmetSnapshot = engine.demand.getOriginUnmetCarSnapshot(engine.stations.stations.length);
    expect(unmetSnapshot[0]).toBeGreaterThan(0);

    // Verify TELEMETRY_SYNC carries heatmap metrics cleanly
    engine.handleCommand({ type: 'SET_SPEED', speed: 1 });
    const tel = getLastTelemetry()!;
    expect(tel.stationUnmetCar.length).toBe(engine.stations.stations.length);
    expect(tel.stationUnmetCar[0]).toBeGreaterThan(0);
  });
});
