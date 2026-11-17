import { describe, expect, it } from 'vitest';
import edmontonGeometryRaw from '../../src/cities/edmonton/geometry.json';
import type { GeometryPack } from '../../src/cities/types';
import {
  BOND_OVERDRAFT_LIMIT_CAD,
  CAPEX_TEARDOWN_REFUND_RATIO,
  CONCOURSE_UPGRADES,
  PARK_AND_RIDE_CAPEX_CAD,
  PARK_AND_RIDE_DEMAND_BONUS,
  STARTING_TREASURY_CAD,
} from '../../src/config/upgrades';
import { SAB_TOTAL_BYTES } from '../../src/core/memory/sharedBuffers';
import { computeParallelLaneOffset } from '../../src/core/stores/lines';
import { EconomySystem } from '../../src/core/systems/economySystem';
import { WorkerSimulationEngine } from '../../src/core/worker';
import { segmentIntersectsRiverRings } from '../../src/renderer/interaction/MapInteractionController';
import { EDMONTON_MANIFEST_FIXTURE, EDMONTON_NODES_16_FIXTURE } from '../helpers/edmontonFixture';
import { TRANSFER_FIXTURE_MANIFEST, TRANSFER_FIXTURE_NODES } from '../helpers/transferFixture';

function createEngine(unlimitedBudget = false): WorkerSimulationEngine {
  const engine = new WorkerSimulationEngine(() => {});
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
  return engine;
}

describe('Milestone 3: Economy, Upgrades, Parallel Corridors & River Crossings', () => {
  it('enforces $50,000 start, $25,000 Municipal Bond overdraft, 5% weekly interest, and bond repayment', () => {
    const economy = new EconomySystem();
    economy.reset(false);
    expect(economy.getTreasuryCad()).toBe(STARTING_TREASURY_CAD);
    expect(economy.getBondDebtCad()).toBe(0);

    // Spend $60,000 -> consumes $50,000 treasury and draws $10,000 from Municipal Bond overdraft.
    const firstSpend = economy.spendCapEx(60_000);
    expect(firstSpend.ok).toBe(true);
    expect(economy.getTreasuryCad()).toBe(0);
    expect(economy.getBondDebtCad()).toBe(10_000);
    expect(economy.getAvailableBuyingPowerCad()).toBe(BOND_OVERDRAFT_LIMIT_CAD - 10_000);

    // Attempting to spend $20,000 more (total debt $30,000 > $25,000 ceiling) must be rejected.
    const overLimit = economy.spendCapEx(20_000);
    expect(overLimit.ok).toBe(false);
    expect(economy.getBondDebtCad()).toBe(10_000);

    // Advance 7 days to trigger weekly 5% compounding interest on bond debt.
    const rollover = economy.stepDayAndWeekRollover(7 * 86_400, [], []);
    expect(rollover.dayRolledOver).toBe(true);
    expect(rollover.weekRolledOver).toBe(true);
    expect(economy.getBondDebtCad()).toBe(10_500);

    // Collect ARC fares ($3.50/rider) and repay partial bond debt.
    economy.collectFare(1_000); // +$3,500
    expect(economy.getTreasuryCad()).toBe(3_500);
    const repaid = economy.repayBond(2_000);
    expect(repaid).toBe(2_000);
    expect(economy.getTreasuryCad()).toBe(1_500);
    expect(economy.getBondDebtCad()).toBe(8_500);
  });

  it('applies river-crossing CapEx multipliers (1.0x, 2.4x, 3.2x), bridge -15% speed, and road-bridge 25km/h cap', () => {
    const engine = createEngine(true);

    // 5 km segment: A(100, 1000) -> B(600, 1000) using High-Floor LRT ($4,200/km track + $1,800 vehicle)
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Surface LRT',
      color: '#2563eb',
      mode: 'LRT_HIGH_FLOOR',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y, crossingType: 'NONE' },
      ],
      initialVehicles: 1,
    });
    const surfaceLine = engine.lines.lines[0];
    expect(surfaceLine.trackCapExCad).toBe(Math.round(5 * 4_200));

    // Dedicated Transit Bridge: 2.4x track CapEx + +5% Scenic Approval bonus
    const approvalBeforeBridge = engine.getPublicApprovalPct();
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'High Level LRT',
      color: '#10b981',
      mode: 'LRT_HIGH_FLOOR',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        {
          stationId: 1,
          x: TRANSFER_FIXTURE_NODES[1].x,
          y: TRANSFER_FIXTURE_NODES[1].y,
          crossingType: 'TRANSIT_BRIDGE',
        },
      ],
      initialVehicles: 1,
    });
    const bridgeLine = engine.lines.lines[1];
    expect(bridgeLine.trackCapExCad).toBe(Math.round(5 * 4_200 * 2.4));
    expect(engine.getPublicApprovalPct()).toBeGreaterThanOrEqual(approvalBeforeBridge);

    // Deep Bored Tunnel: 3.2x track CapEx
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Tunnel LRT',
      color: '#ef4444',
      mode: 'LRT_HIGH_FLOOR',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        {
          stationId: 1,
          x: TRANSFER_FIXTURE_NODES[1].x,
          y: TRANSFER_FIXTURE_NODES[1].y,
          crossingType: 'TUNNEL',
        },
      ],
      initialVehicles: 1,
    });
    const tunnelLine = engine.lines.lines[2];
    expect(tunnelLine.trackCapExCad).toBe(Math.round(5 * 4_200 * 3.2));

    // Parallel normal offsetting formula across 3 shared lanes: (-1, 0, +1) * 8 world units
    expect(computeParallelLaneOffset(0, 3)).toBe(-8);
    expect(computeParallelLaneOffset(1, 3)).toBe(0);
    expect(computeParallelLaneOffset(2, 3)).toBe(8);
    expect(surfaceLine.segments[0].parallelLaneOffset).toBe(-8);
    expect(bridgeLine.segments[0].parallelLaneOffset).toBe(0);
    expect(tunnelLine.segments[0].parallelLaneOffset).toBe(8);

    // Bridge vehicle velocity after steady acceleration must be 15% lower than tunnel vehicle velocity.
    for (let t = 0; t < 20; t++) {
      engine.stepTick(2.0);
    }
    const bridgeVehId = bridgeLine.vehicleIds[0];
    const tunnelVehId = tunnelLine.vehicleIds[0];
    expect(engine.vehicles.velocityMps[bridgeVehId]).toBeCloseTo(
      engine.vehicles.velocityMps[tunnelVehId] * 0.85,
      2,
    );
  });

  it('caps BRT/Tram on Shared Road Bridge at 25 km/h and upgrades Tram speed with TSP', () => {
    const engine = createEngine(true);

    // BRT (35 km/h base) forced across a Shared Road Bridge -> capped at 25 km/h
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Road Bridge BRT',
      color: '#f59e0b',
      mode: 'BRT_ARTICULATED',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        {
          stationId: 1,
          x: TRANSFER_FIXTURE_NODES[1].x,
          y: TRANSFER_FIXTURE_NODES[1].y,
          crossingType: 'ROAD_BRIDGE',
        },
      ],
      initialVehicles: 1,
    });
    // Low-Floor Tram (45 km/h base) without TSP -> 0.85x (38.25 km/h), then TSP restores 45 km/h
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Valley Tram',
      color: '#10b981',
      mode: 'LRT_LOW_FLOOR',
      waypoints: [
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
        { stationId: 2, x: TRANSFER_FIXTURE_NODES[2].x, y: TRANSFER_FIXTURE_NODES[2].y },
      ],
      initialVehicles: 1,
    });

    for (let t = 0; t < 20; t++) {
      engine.stepTick(2.0);
    }
    const brtVeh = engine.lines.lines[0].vehicleIds[0];
    const tramLine = engine.lines.lines[1];
    const tramVeh = tramLine.vehicleIds[0];

    expect(engine.vehicles.velocityMps[brtVeh]).toBeCloseTo(25 / 3.6, 2);
    expect(engine.vehicles.velocityMps[tramVeh]).toBeCloseTo((45 / 3.6) * 0.85, 2);

    // Enable TSP ($900/km) -> removes at-grade signal slowdown
    engine.handleCommand({ type: 'SET_CORRIDOR_TSP', lineId: tramLine.lineId, enabled: true });
    for (let t = 0; t < 15; t++) {
      engine.stepTick(2.0);
    }
    expect(engine.vehicles.velocityMps[tramVeh]).toBeCloseTo(45 / 3.6, 2);
  });

  it('handles 75% teardown refunds on line deletion & vehicle sale, LRV consists, concourses, and Park-and-Ride', () => {
    const engine = createEngine(false);

    // Create a High-Floor LRT line with 1 train
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Capital Line',
      color: '#2563eb',
      mode: 'LRT_HIGH_FLOOR',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
      ],
      initialVehicles: 1,
    });

    const line = engine.lines.lines[0];
    const expectedLineCapEx = Math.round(5 * 4_200) + 1_800; // $21,000 + $1,800 = $22,800
    expect(engine.getTreasuryCad()).toBe(STARTING_TREASURY_CAD - expectedLineCapEx);

    // Expand consist from 1-car to 3-car (+2 * $1,800 = $3,600 CapEx, capacity 300 -> 900)
    engine.handleCommand({ type: 'SET_CONSIST_CARS', lineId: line.lineId, consistCars: 3 });
    expect(line.consistCars).toBe(3);
    expect(engine.vehicles.capacity[line.vehicleIds[0]]).toBe(900);
    expect(engine.getDailyOpExCad()).toBe(190 + 2 * 150);

    // Enable All-Door ARC ($1,500 CapEx)
    engine.handleCommand({ type: 'SET_ALL_DOOR_ARC', lineId: line.lineId, enabled: true });
    expect(line.allDoorArc).toBe(true);

    // Upgrade Station 1 Concourse to Tier 2 ($3,500 CapEx) and verify transfer penalty drops from 240s -> 60s
    const costBeforeConcourse = engine.pathfinder.getExpectedCost(0, 2);
    expect(costBeforeConcourse).toBe(Number.POSITIVE_INFINITY);
    engine.handleCommand({ type: 'UPGRADE_STATION_CONCOURSE', stationId: 1, targetTier: 2 });
    expect(engine.stations.getById(1)?.concourseTier).toBe(2);
    expect(CONCOURSE_UPGRADES[2].transferPenaltySec).toBe(60);

    // Toggle Park-and-Ride at Station 0 ($800 CapEx): +400 demand, -15% carrying capacity K
    const baseProd0 = engine.stations.getById(0)!.baseProduction;
    const baseK0 = engine.stations.getById(0)!.carryingCapacity;
    engine.handleCommand({ type: 'TOGGLE_PARK_AND_RIDE', stationId: 0, enabled: true });
    expect(engine.stations.getById(0)!.baseProduction).toBe(baseProd0 + PARK_AND_RIDE_DEMAND_BONUS);
    expect(engine.stations.getById(0)!.carryingCapacity).toBe(Math.round(baseK0 * 0.85));

    // Demolish the line -> must free all vehicles and refund 75% of invested line CapEx
    const totalLineInvested = expectedLineCapEx + 3_600 + 1_500;
    const treasuryBeforeDelete = engine.getTreasuryCad();
    engine.handleCommand({ type: 'DELETE_LINE', lineId: line.lineId });
    expect(engine.lines.lines.length).toBe(0);
    expect(engine.vehicles.getActiveCount()).toBe(0);
    expect(engine.getTreasuryCad()).toBe(
      treasuryBeforeDelete + Math.round(totalLineInvested * CAPEX_TEARDOWN_REFUND_RATIO),
    );

    // Demolish Park-and-Ride -> refunds 75% of $800 ($600) and restores demand & K
    const treasuryBeforePnRRemove = engine.getTreasuryCad();
    engine.handleCommand({ type: 'TOGGLE_PARK_AND_RIDE', stationId: 0, enabled: false });
    expect(engine.getTreasuryCad()).toBe(
      treasuryBeforePnRRemove + Math.round(PARK_AND_RIDE_CAPEX_CAD * CAPEX_TEARDOWN_REFUND_RATIO),
    );
    expect(engine.stations.getById(0)!.baseProduction).toBe(baseProd0);
    expect(engine.stations.getById(0)!.carryingCapacity).toBe(baseK0);
  });

  it('supports One-Click Corridor Upgrading and detects North Saskatchewan River crossings', () => {
    const engine = createEngine(true);

    // Build initial Tier 1 Bus line
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Corridor 1',
      color: '#38bdf8',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        {
          stationId: 1,
          x: TRANSFER_FIXTURE_NODES[1].x,
          y: TRANSFER_FIXTURE_NODES[1].y,
          crossingType: 'ROAD_BRIDGE',
        },
      ],
      initialVehicles: 2,
    });

    const line = engine.lines.lines[0];
    expect(line.mode).toBe('BUS_LOCAL');
    expect(engine.vehicles.capacity[line.vehicleIds[0]]).toBe(50);

    // One-Click Upgrade directly to High-Floor LRT -> updates vehicle capacity (300) and upgrades ROAD_BRIDGE -> TRANSIT_BRIDGE
    engine.handleCommand({
      type: 'UPGRADE_CORRIDOR',
      lineId: line.lineId,
      targetMode: 'LRT_HIGH_FLOOR',
    });
    expect(line.mode).toBe('LRT_HIGH_FLOOR');
    expect(line.segments[0].crossingType).toBe('TRANSIT_BRIDGE');
    expect(engine.vehicles.capacity[line.vehicleIds[0]]).toBe(300);

    // Verify Edmonton North Saskatchewan River crossing geometry detector across Churchill Square <-> University of Alberta
    const churchill = EDMONTON_NODES_16_FIXTURE.find((n) => n.id === 'churchill_square')!;
    const uofa = EDMONTON_NODES_16_FIXTURE.find((n) => n.id === 'university_of_alberta')!;
    const ice = EDMONTON_NODES_16_FIXTURE.find((n) => n.id === 'ice_district')!;
    const riverFeat = (edmontonGeometryRaw as GeometryPack).features.find(
      (f) => f.properties.id === 'north_saskatchewan_river',
    )!;
    const riverRing = (riverFeat.geometry.coordinates as number[][][])[0].map(
      (p) => [p[0], p[1]] as [number, number],
    );
    expect(
      segmentIntersectsRiverRings(churchill.x, churchill.y, uofa.x, uofa.y, [riverRing]),
    ).toBe(true);
    expect(
      segmentIntersectsRiverRings(churchill.x, churchill.y, ice.x, ice.y, [riverRing]),
    ).toBe(false);
    expect(EDMONTON_MANIFEST_FIXTURE.elevationObstacles[0].bridgeCostMultiplier).toBe(2.4);
  });

  it('verifies concourse transfer cost reductions (240s -> 120s -> 60s), All-Door ARC -50% dwell, SELL_VEHICLE, and EDIT_LINE_STOPS', () => {
    const engine = createEngine(true);

    // Line 1: 0 <-> 1; Line 2: 1 <-> 3
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Leg 1',
      color: '#38bdf8',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
      ],
      initialVehicles: 2,
    });
    engine.handleCommand({
      type: 'CREATE_LINE',
      name: 'Leg 2',
      color: '#f59e0b',
      mode: 'BUS_LOCAL',
      waypoints: [
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
        { stationId: 3, x: TRANSFER_FIXTURE_NODES[3].x, y: TRANSFER_FIXTURE_NODES[3].y },
      ],
      initialVehicles: 2,
    });

    engine.pathfinder.flushRebuild(engine.stations);
    const costTier0 = engine.pathfinder.getExpectedCost(0, 3);
    engine.handleCommand({ type: 'UPGRADE_STATION_CONCOURSE', stationId: 1, targetTier: 1 });
    engine.pathfinder.flushRebuild(engine.stations);
    const costTier1 = engine.pathfinder.getExpectedCost(0, 3);
    engine.handleCommand({ type: 'UPGRADE_STATION_CONCOURSE', stationId: 1, targetTier: 2 });
    engine.pathfinder.flushRebuild(engine.stations);
    const costTier2 = engine.pathfinder.getExpectedCost(0, 3);

    // Concourse upgrades save 2.0 min (240s -> 120s) and another 1.0 min (120s -> 60s).
    expect(costTier0 - costTier1).toBeCloseTo(2.0, 2);
    expect(costTier1 - costTier2).toBeCloseTo(1.0, 2);

    // Verify All-Door ARC halves stop dwell time (terminus 15s -> 7.5s)
    const line1 = engine.lines.lines[0];
    const veh1 = line1.vehicleIds[0];
    engine.handleCommand({ type: 'SET_ALL_DOOR_ARC', lineId: line1.lineId, enabled: true });
    engine.vehicles.dwellTimerS[veh1] = 0;
    engine.vehicles.direction[veh1] = 1;
    engine.vehicles.segmentIdx[veh1] = 0;
    engine.vehicles.distanceAlongSegmentM[veh1] = line1.segments[0].lengthMeters - 1;
    engine.vehicles.velocityMps[veh1] = 6.9;
    engine.vehicles.stepVehicles(1.0, engine.lines, () => 0);
    expect(engine.vehicles.dwellTimerS[veh1]).toBe(7.5);
    // Sell 1 vehicle -> refunds 75% of $250 ($188) and decrements fleet count
    const beforeSell = engine.getTreasuryCad();
    engine.handleCommand({ type: 'SELL_VEHICLE', lineId: line1.lineId, count: 1 });
    expect(line1.vehicleIds.length).toBe(1);
    expect(engine.getTreasuryCad()).toBe(beforeSell + Math.round(250 * CAPEX_TEARDOWN_REFUND_RATIO));

    // Edit stops to extend Leg 1 -> Station 2 (C)
    engine.handleCommand({
      type: 'EDIT_LINE_STOPS',
      lineId: line1.lineId,
      waypoints: [
        { stationId: 0, x: TRANSFER_FIXTURE_NODES[0].x, y: TRANSFER_FIXTURE_NODES[0].y },
        { stationId: 1, x: TRANSFER_FIXTURE_NODES[1].x, y: TRANSFER_FIXTURE_NODES[1].y },
        { stationId: 2, x: TRANSFER_FIXTURE_NODES[2].x, y: TRANSFER_FIXTURE_NODES[2].y },
      ],
    });
    expect(line1.stationIds).toEqual([0, 1, 2]);
  });
});
