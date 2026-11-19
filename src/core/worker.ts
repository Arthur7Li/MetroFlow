import type { CityManifest } from '../cities/types';
import { TRANSIT_MODES } from '../config/modes';
import {
  ALL_DOOR_ARC_CAPEX_CAD,
  CAPEX_TEARDOWN_REFUND_RATIO,
  FEEDER_AI_DEFAULT_RADIUS_KM,
  LRV_EXTRA_CAR_CAPEX_CAD,
  MAX_LRV_CONSIST_CARS,
  MAX_SCENIC_APPROVAL_BONUS_PCT,
  TSP_CAPEX_PER_KM_CAD,
  getBlueprintById,
  supportsMultiCarConsist,
} from '../config/upgrades';
import {
  SIM_SECONDS_PER_REAL_SECOND,
  UNREACHABLE_ID,
  WORKER_FIXED_DT_REAL_SEC,
  type InspectorTarget,
  type RouteWaypointInput,
  type SimSpeed,
  type TelemetrySnapshot,
  type TopologySnapshot,
  type TransportMode,
  type WorkerCommand,
  type WorkerOutboundMessage,
} from './contracts';
import {
  SharedSnapshotWriter,
  TransferableSnapshotWriter,
  type SnapshotWriteMetadata,
} from './memory/sharedBuffers';
import { RouteSegmentPathfinder } from './routing/pathfinder';
import { AgentStoreSoA } from './stores/agents';
import {
  TransitLineStore,
  extractRiverRings,
  segmentIntersectsRiverRings,
  type PolygonRing,
  type TransitLineRecord,
} from './stores/lines';
import { StationStore } from './stores/stations';
import { VehicleStoreSoA } from './stores/vehicles';
import { DemandSystem } from './systems/demandSystem';
import { DispatchSystem } from './systems/dispatchSystem';
import { EconomySystem } from './systems/economySystem';
import { TodSystem } from './systems/todSystem';

const INITIAL_HOUR_SECONDS = 6 * 3600 + 30 * 60; // Start campaign day at 06:30 Morning Peak.
const PATIENCE_CEILING_MIN = 12.0;

/**
 * Core 30Hz simulation engine shared between Web Worker execution and synchronous integration tests.
 */
export class WorkerSimulationEngine {
  private manifest: CityManifest | null = null;
  readonly stations = new StationStore();
  readonly lines = new TransitLineStore();
  readonly vehicles = new VehicleStoreSoA();
  readonly agents = new AgentStoreSoA();
  readonly pathfinder = new RouteSegmentPathfinder();
  readonly demand = new DemandSystem();
  readonly economy = new EconomySystem();
  readonly dispatch = new DispatchSystem();
  readonly tod = new TodSystem();
  private riverRings: PolygonRing[] = [];

  private sabWriter: SharedSnapshotWriter | null = null;
  private transferableWriter: TransferableSnapshotWriter | null = null;
  private transportMode: TransportMode = 'TRANSFERABLE';

  private speed: SimSpeed = 1;
  private tickIndex = 0;
  private simTimeSeconds = INITIAL_HOUR_SECONDS;

  private dailyRidership = 0;
  private dailyCompletedWaitMinSum = 0;
  private dailyCompletedRiderCount = 0;
  private publicApprovalPct = 75;
  private inspectorTarget: InspectorTarget = { kind: 'NONE' };

  private lastTickWallMs = 0;
  private accumulatorRealSec = 0;
  private lastTelemetryWallMs = 0;
  private timerId: ReturnType<typeof setInterval> | null = null;

  private readonly postOutbound: (msg: WorkerOutboundMessage, transfer?: Transferable[]) => void;

  constructor(postOutbound?: (msg: WorkerOutboundMessage, transfer?: Transferable[]) => void) {
    this.postOutbound =
      postOutbound ??
      ((msg, transfer) => {
        const workerScope = self as unknown as {
          postMessage(message: unknown, transfer?: Transferable[]): void;
        };
        if (transfer && transfer.length > 0) {
          workerScope.postMessage(msg, transfer);
        } else {
          workerScope.postMessage(msg);
        }
      });
  }

  getSimTimeSeconds(): number {
    return this.simTimeSeconds;
  }

  getTreasuryCad(): number {
    return this.economy.getTreasuryCad();
  }

  getBondDebtCad(): number {
    return this.economy.getBondDebtCad();
  }

  getDailyRidership(): number {
    return this.dailyRidership;
  }

  getDailyFareRevenueCad(): number {
    return this.economy.getDailyFareRevenueCad();
  }

  getDailyOpExCad(): number {
    return this.economy.computeDailyOpEx(this.lines.lines, this.stations.stations);
  }

  getPublicApprovalPct(): number {
    return this.publicApprovalPct;
  }

  handleCommand(cmd: WorkerCommand, startWorkerLoop = true): void {
    switch (cmd.type) {
      case 'INIT_CITY': {
        this.manifest = cmd.manifest;
        this.riverRings = extractRiverRings(cmd.geometry);
        this.stations.initFromSeeds(cmd.nodes);
        this.lines.reset();
        this.vehicles.reset();
        this.agents.reset();
        this.economy.reset(Boolean(cmd.unlimitedBudget));
        this.dispatch.reset();
        this.demand.initCity(this.stations, cmd.manifest.worldUnitsPerKm);
        this.simTimeSeconds = INITIAL_HOUR_SECONDS;
        this.tickIndex = 0;
        this.speed = 1;
        this.dailyRidership = 0;
        this.dailyCompletedWaitMinSum = 0;
        this.dailyCompletedRiderCount = 0;
        this.publicApprovalPct = 75;
        this.inspectorTarget = { kind: 'NONE' };

        if (cmd.sharedBuffer) {
          this.sabWriter = new SharedSnapshotWriter(cmd.sharedBuffer);
          this.transferableWriter = null;
          this.transportMode = 'SAB';
        } else {
          this.sabWriter = null;
          this.transferableWriter = new TransferableSnapshotWriter();
          this.transportMode = 'TRANSFERABLE';
        }

        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        this.postOutbound({ type: 'READY', transportMode: this.transportMode });
        if (startWorkerLoop) {
          this.startLoop();
        }
        break;
      }

      case 'SET_SPEED':
        this.speed = cmd.speed;
        this.emitTelemetry();
        break;

      case 'CREATE_LINE': {
        if (!this.manifest) {
          return;
        }
        const created = this.lines.createLine(
          cmd.name,
          cmd.color,
          cmd.mode,
          cmd.waypoints,
          this.stations,
          this.manifest.worldUnitsPerKm,
        );
        if ('error' in created) {
          this.postOutbound({ type: 'ERROR', message: created.error });
          return;
        }

        const initialVehicles = Math.max(0, cmd.initialVehicles ?? 1);
        const spec = TRANSIT_MODES[cmd.mode];
        const totalInitialCapEx = created.trackCapExCad + initialVehicles * spec.vehicleCapEx;
        const spend = this.economy.spendCapEx(totalInitialCapEx);
        if (!spend.ok) {
          this.lines.deleteLine(
            created.line.lineId,
            this.stations,
            this.manifest.worldUnitsPerKm,
          );
          this.postOutbound({ type: 'ERROR', message: spend.error });
          return;
        }

        this.demand.syncStationMatrix(this.stations);
        const spawnedIds: number[] = [];
        for (let i = 0; i < initialVehicles; i++) {
          const vId = this.vehicles.spawnVehicle(created.line);
          if (vId !== -1) {
            spawnedIds.push(vId);
          }
        }
        // Refund any unspawned vehicle CapEx if ACTIVE_VEHICLE_SOFT_CAP was reached.
        if (spawnedIds.length < initialVehicles) {
          const unspentVehCapEx = (initialVehicles - spawnedIds.length) * spec.vehicleCapEx;
          this.economy.refundCapEx(unspentVehCapEx / CAPEX_TEARDOWN_REFUND_RATIO);
        }
        created.line.investedCapExCad =
          created.trackCapExCad + spawnedIds.length * spec.vehicleCapEx;

        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, created.line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);

        for (const vId of spawnedIds) {
          const segIdx = this.vehicles.segmentIdx[vId];
          const seg = created.line.segments[segIdx];
          const startStationId =
            this.vehicles.direction[vId] >= 0 ? seg.fromStationId : seg.toStationId;
          this.processStationStop(vId, startStationId, created.line);
        }

        this.recomputePublicApproval();
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'DELETE_LINE': {
        if (!this.manifest) {
          return;
        }
        const line = this.lines.getById(cmd.lineId);
        if (!line) {
          return;
        }
        for (const vId of line.vehicleIds) {
          this.evacuateVehiclePassengers(vId, line);
        }
        this.vehicles.removeAllVehiclesForLine(line);
        this.economy.refundCapEx(line.investedCapExCad);
        this.dispatch.clearLineState(cmd.lineId);
        this.lines.deleteLine(cmd.lineId, this.stations, this.manifest.worldUnitsPerKm);

        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.recomputePublicApproval();
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'UPGRADE_CORRIDOR': {
        if (!this.manifest) {
          return;
        }
        const preview = this.lines.previewUpgradeCorridor(cmd.lineId, cmd.targetMode);
        if ('error' in preview) {
          this.postOutbound({ type: 'ERROR', message: preview.error });
          return;
        }

        const line = preview.line;
        const oldSpec = TRANSIT_MODES[line.mode];
        const newSpec = TRANSIT_MODES[cmd.targetMode];
        const oldPerVehCapEx =
          oldSpec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;
        const trackDeltaCad = Math.max(
          0,
          preview.newTrackCapExCad - Math.round(preview.oldTrackCapExCad * CAPEX_TEARDOWN_REFUND_RATIO),
        );
        const vehicleDeltaCad =
          line.vehicleIds.length *
          Math.max(
            0,
            newSpec.vehicleCapEx - Math.round(oldPerVehCapEx * CAPEX_TEARDOWN_REFUND_RATIO),
          );
        const totalDelta = trackDeltaCad + vehicleDeltaCad;

        const spend = this.economy.spendCapEx(totalDelta);
        if (!spend.ok) {
          this.postOutbound({ type: 'ERROR', message: spend.error });
          return;
        }

        this.lines.applyUpgradeCorridor(
          line,
          cmd.targetMode,
          preview.newTrackCapExCad,
          preview.upgradedCrossings,
          this.stations,
          this.manifest.worldUnitsPerKm,
        );
        line.investedCapExCad += totalDelta;
        this.vehicles.syncLineFleetSpec(line);
        this.vehicles.clampVehiclesAfterStopEdit(line);

        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.recomputePublicApproval();
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'EDIT_LINE_STOPS': {
        if (!this.manifest) {
          return;
        }
        const res = this.lines.editLineStops(
          cmd.lineId,
          cmd.waypoints,
          this.stations,
          this.manifest.worldUnitsPerKm,
          (deltaCad) =>
            this.economy.canAfford(deltaCad)
              ? { ok: true }
              : { ok: false, error: 'Insufficient Treasury/Bond Overdraft to extend corridor.' },
        );
        if ('error' in res) {
          this.postOutbound({ type: 'ERROR', message: res.error });
          return;
        }

        const trackDelta = res.newTrackCapExCad - res.oldTrackCapExCad;
        if (trackDelta > 0) {
          this.economy.spendCapEx(trackDelta);
          res.line.investedCapExCad += trackDelta;
        } else if (trackDelta < 0) {
          this.economy.refundCapEx(-trackDelta);
          res.line.investedCapExCad = Math.max(0, res.line.investedCapExCad + trackDelta);
        }

        this.demand.syncStationMatrix(this.stations);
        this.vehicles.clampVehiclesAfterStopEdit(res.line);
        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, res.line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.recomputePublicApproval();
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'BUY_VEHICLE': {
        const line = this.lines.getById(cmd.lineId);
        if (!line) {
          return;
        }
        const count = Math.max(1, cmd.count ?? 1);
        const spec = TRANSIT_MODES[line.mode];
        const perVehicleCapEx =
          spec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;

        const reserveCount = this.dispatch.getReservePoolSnapshot()[line.mode];
        const paidNeeded = Math.max(0, count - reserveCount);
        if (paidNeeded > 0 && !this.economy.canAfford(paidNeeded * perVehicleCapEx)) {
          this.postOutbound({
            type: 'ERROR',
            message: `Insufficient funds for ${paidNeeded}x ${spec.name} unit ($${(paidNeeded * perVehicleCapEx).toLocaleString('en-CA')} CAD).`,
          });
          return;
        }

        const spawnedIds: number[] = [];
        for (let i = 0; i < count; i++) {
          const fromReserve = this.dispatch.tryPopReserveVehicle(line.mode);
          const vId = this.spawnVehicleWithStopCheck(line, fromReserve);
          if (vId !== -1) {
            if (!fromReserve) {
              this.economy.spendCapEx(perVehicleCapEx);
              line.investedCapExCad += perVehicleCapEx;
            }
            spawnedIds.push(vId);
          } else if (fromReserve) {
            this.dispatch.addToReserve(line.mode, 1);
          }
        }
        if (spawnedIds.length > 0) {
          if (this.pathfinder.checkSignificantShift(this.lines, 1.0, 1.0)) {
            this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
          }
          this.publishSnapshot(0);
          this.emitTopology();
          this.emitTelemetry();
        }
        break;
      }

      case 'RECALL_VEHICLE_TO_RESERVE': {
        const line = this.lines.getById(cmd.lineId);
        if (!line || line.vehicleIds.length <= 1) {
          return;
        }
        const count = Math.max(1, Math.min(line.vehicleIds.length - 1, cmd.count ?? 1));
        let recalled = 0;
        for (let i = 0; i < count; i++) {
          if (this.recallLineVehicleToReserve(line)) {
            recalled += 1;
          }
        }
        if (recalled > 0) {
          if (this.pathfinder.checkSignificantShift(this.lines, 1.0, 1.0)) {
            this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
          }
          this.publishSnapshot(0);
          this.emitTopology();
          this.emitTelemetry();
        }
        break;
      }

      case 'SET_LINE_POLICY': {
        const line = this.lines.getById(cmd.lineId);
        if (!line) {
          return;
        }
        line.policy = cmd.policy;
        const evalRes = this.dispatch.evaluateLine(
          line,
          this.stations,
          this.vehicles,
          this.economy,
          (l, fromReserve) => this.spawnVehicleWithStopCheck(l, fromReserve),
          (l) => this.recallLineVehicleToReserve(l),
        );
        if (evalRes.changed) {
          this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
          this.pathfinder.stepRebuild(this.stations, 32);
          this.publishSnapshot(0);
          this.emitTopology();
        }
        this.emitTelemetry();
        break;
      }

      case 'SELL_VEHICLE': {
        const line = this.lines.getById(cmd.lineId);
        if (!line || line.vehicleIds.length === 0) {
          return;
        }
        const count = Math.max(1, Math.min(line.vehicleIds.length, cmd.count ?? 1));
        const spec = TRANSIT_MODES[line.mode];
        const perVehicleCapEx =
          spec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;

        let soldCount = 0;
        for (let i = 0; i < count; i++) {
          const vId = this.vehicles.sellLastVehicle(line);
          if (vId !== -1) {
            this.evacuateVehiclePassengers(vId, line);
            soldCount += 1;
          }
        }
        if (soldCount > 0) {
          const originalCost = soldCount * perVehicleCapEx;
          this.economy.refundCapEx(originalCost);
          line.investedCapExCad = Math.max(0, line.investedCapExCad - originalCost);

          if (line.vehicleIds.length === 0 || this.pathfinder.checkSignificantShift(this.lines, 1.0, 1.0)) {
            this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
          }
          this.publishSnapshot(0);
          this.emitTopology();
          this.emitTelemetry();
        }
        break;
      }

      case 'SET_CONSIST_CARS': {
        const line = this.lines.getById(cmd.lineId);
        if (!line) {
          return;
        }
        if (!supportsMultiCarConsist(line.mode)) {
          this.postOutbound({
            type: 'ERROR',
            message: `${TRANSIT_MODES[line.mode].name} does not support multi-car LRV consists.`,
          });
          return;
        }
        const targetCars = Math.max(1, Math.min(MAX_LRV_CONSIST_CARS, cmd.consistCars)) as
          | 1
          | 2
          | 3
          | 4;
        if (targetCars === line.consistCars) {
          return;
        }

        const diffCars = targetCars - line.consistCars;
        const capExAmount = line.vehicleIds.length * Math.abs(diffCars) * LRV_EXTRA_CAR_CAPEX_CAD;

        if (diffCars > 0) {
          const spend = this.economy.spendCapEx(capExAmount);
          if (!spend.ok) {
            this.postOutbound({ type: 'ERROR', message: spend.error });
            return;
          }
          line.investedCapExCad += capExAmount;
        } else {
          this.economy.refundCapEx(capExAmount);
          line.investedCapExCad = Math.max(0, line.investedCapExCad - capExAmount);
        }

        line.consistCars = targetCars;
        this.vehicles.syncLineFleetSpec(line);
        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'SET_ALL_DOOR_ARC': {
        const line = this.lines.getById(cmd.lineId);
        if (!line || line.allDoorArc === cmd.enabled) {
          return;
        }
        if (cmd.enabled) {
          const spend = this.economy.spendCapEx(ALL_DOOR_ARC_CAPEX_CAD);
          if (!spend.ok) {
            this.postOutbound({ type: 'ERROR', message: spend.error });
            return;
          }
          line.investedCapExCad += ALL_DOOR_ARC_CAPEX_CAD;
        } else {
          this.economy.refundCapEx(ALL_DOOR_ARC_CAPEX_CAD);
          line.investedCapExCad = Math.max(0, line.investedCapExCad - ALL_DOOR_ARC_CAPEX_CAD);
        }
        line.allDoorArc = cmd.enabled;
        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.emitTelemetry();
        break;
      }

      case 'SET_CORRIDOR_TSP': {
        const line = this.lines.getById(cmd.lineId);
        if (!line) {
          return;
        }
        if (line.mode !== 'LRT_LOW_FLOOR') {
          this.postOutbound({
            type: 'ERROR',
            message: 'Transit Signal Priority (TSP) applies only to Tier 3 Low-Floor Tram lines.',
          });
          return;
        }
        if (line.tspEnabled === cmd.enabled) {
          return;
        }
        const tspCost = Math.round(line.totalLengthKm * TSP_CAPEX_PER_KM_CAD);
        if (cmd.enabled) {
          const spend = this.economy.spendCapEx(tspCost);
          if (!spend.ok) {
            this.postOutbound({ type: 'ERROR', message: spend.error });
            return;
          }
          line.investedCapExCad += tspCost;
        } else {
          this.economy.refundCapEx(tspCost);
          line.investedCapExCad = Math.max(0, line.investedCapExCad - tspCost);
        }
        line.tspEnabled = cmd.enabled;
        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.emitTelemetry();
        break;
      }

      case 'UPGRADE_STATION_CONCOURSE': {
        const costInfo = this.stations.getConcourseTransitionCost(cmd.stationId, cmd.targetTier);
        if (!costInfo) {
          return;
        }
        if (costInfo.capExCostCad > 0) {
          const spend = this.economy.spendCapEx(costInfo.capExCostCad);
          if (!spend.ok) {
            this.postOutbound({ type: 'ERROR', message: spend.error });
            return;
          }
        } else if (costInfo.refundOriginalCad > 0) {
          this.economy.refundCapEx(costInfo.refundOriginalCad);
        }

        this.stations.setConcourseTier(cmd.stationId, cmd.targetTier);
        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, [cmd.stationId]);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'TOGGLE_PARK_AND_RIDE': {
        const costInfo = this.stations.getParkAndRideTransitionCost(cmd.stationId, cmd.enabled);
        if (!costInfo) {
          return;
        }
        if (costInfo.capExCostCad > 0) {
          const spend = this.economy.spendCapEx(costInfo.capExCostCad);
          if (!spend.ok) {
            this.postOutbound({ type: 'ERROR', message: spend.error });
            return;
          }
        } else if (costInfo.refundOriginalCad > 0) {
          this.economy.refundCapEx(costInfo.refundOriginalCad);
        }

        this.stations.setParkAndRideActive(cmd.stationId, cmd.enabled);
        this.demand.syncStationMatrix(this.stations);
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'SET_FEEDER_ZONE': {
        if (!this.manifest) {
          return;
        }
        const costInfo = this.stations.getFeederTransitionCost(cmd.stationId, cmd.enabled);
        if (!costInfo) {
          return;
        }
        if (costInfo.capExCostCad > 0) {
          const spend = this.economy.spendCapEx(costInfo.capExCostCad);
          if (!spend.ok) {
            this.postOutbound({ type: 'ERROR', message: spend.error });
            return;
          }
        } else if (costInfo.refundOriginalCad > 0) {
          this.economy.refundCapEx(costInfo.refundOriginalCad);
        }

        this.stations.setFeederZone(
          cmd.stationId,
          cmd.enabled,
          cmd.radiusKm ?? FEEDER_AI_DEFAULT_RADIUS_KM,
        );
        this.dispatch.recomputeFeederCatchments(this.stations, this.manifest.worldUnitsPerKm);
        this.demand.syncStationMatrix(this.stations);
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'STAMP_BLUEPRINT': {
        if (!this.manifest) {
          return;
        }
        const bp = getBlueprintById(cmd.blueprintId);
        if (!bp) {
          this.postOutbound({ type: 'ERROR', message: `Unknown blueprint "${cmd.blueprintId}"` });
          return;
        }
        const spend = this.economy.spendCapEx(bp.capExCad);
        if (!spend.ok) {
          this.postOutbound({ type: 'ERROR', message: spend.error });
          return;
        }

        const bounds = this.manifest.worldBounds;
        const clampX = (x: number): number => Math.round(Math.max(60, Math.min(bounds.width - 60, x)));
        const clampY = (y: number): number => Math.round(Math.max(60, Math.min(bounds.height - 60, y)));

        const resolvedNodes = new Map<string, { stationId: number; x: number; y: number }>();
        for (const nodeOffset of bp.nodes) {
          const st = this.stations.resolveOrCreateStation(
            clampX(cmd.centerX + nodeOffset.dx),
            clampY(cmd.centerY + nodeOffset.dy),
          );
          if (!st) {
            this.economy.refundCapEx(bp.capExCad / CAPEX_TEARDOWN_REFUND_RATIO);
            this.postOutbound({ type: 'ERROR', message: 'Maximum station capacity reached.' });
            return;
          }
          resolvedNodes.set(nodeOffset.key, { stationId: st.stationId, x: st.x, y: st.y });
        }

        const hubNode = resolvedNodes.get('center');
        if (hubNode) {
          const hubStation = this.stations.getById(hubNode.stationId);
          if (hubStation && hubStation.concourseTier < bp.hubConcourseTier) {
            this.stations.setConcourseTier(hubNode.stationId, bp.hubConcourseTier);
          }
          if (hubStation && bp.enableFeederAi) {
            this.stations.setFeederZone(
              hubNode.stationId,
              true,
              bp.feederRadiusKm ?? FEEDER_AI_DEFAULT_RADIUS_KM,
            );
          }
        }

        const affectedStations: number[] = [];
        for (let i = 0; i < bp.corridors.length; i++) {
          const spec = bp.corridors[i];
          const waypoints: RouteWaypointInput[] = [];
          for (let k = 0; k < spec.nodeKeys.length; k++) {
            const pt = resolvedNodes.get(spec.nodeKeys[k]);
            if (!pt) {
              continue;
            }
            const prevPt = waypoints[waypoints.length - 1];
            const crossing =
              prevPt && segmentIntersectsRiverRings(prevPt.x, prevPt.y, pt.x, pt.y, this.riverRings)
                ? 'TRANSIT_BRIDGE'
                : 'NONE';
            waypoints.push({ stationId: pt.stationId, x: pt.x, y: pt.y, crossingType: crossing });
          }
          const created = this.lines.createLine(
            spec.nameSuffix,
            spec.color,
            spec.mode,
            waypoints,
            this.stations,
            this.manifest.worldUnitsPerKm,
          );
          if ('error' in created) {
            continue;
          }
          if (spec.allDoorArc) {
            created.line.allDoorArc = true;
          }
          created.line.investedCapExCad = Math.round(bp.capExCad / bp.corridors.length);
          for (let v = 0; v < spec.initialVehicles; v++) {
            this.spawnVehicleWithStopCheck(created.line, false);
          }
          affectedStations.push(...created.line.stationIds);
        }

        this.dispatch.recomputeFeederCatchments(this.stations, this.manifest.worldUnitsPerKm);
        this.demand.syncStationMatrix(this.stations);
        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, affectedStations);
        this.pathfinder.stepRebuild(this.stations, 32);
        this.recomputePublicApproval();
        this.publishSnapshot(0);
        this.emitTopology();
        this.emitTelemetry();
        break;
      }

      case 'SELECT_INSPECTOR_TARGET':
        this.inspectorTarget = cmd.target;
        this.emitTelemetry();
        break;

      case 'REPAY_BOND':
        this.economy.repayBond(cmd.amountCad);
        this.emitTelemetry();
        break;

      case 'RETURN_SNAPSHOT_BUFFER':
        this.transferableWriter?.reclaimBuffer(cmd.buffer);
        break;

      default:
        break;
    }
  }

  private spawnVehicleWithStopCheck(line: TransitLineRecord, fromReserve: boolean): number {
    const vId = this.vehicles.spawnVehicle(line);
    if (vId === -1) {
      return -1;
    }
    if (fromReserve) {
      const spec = TRANSIT_MODES[line.mode];
      const perVehCapEx =
        spec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;
      line.investedCapExCad += perVehCapEx;
    }
    const segIdx = this.vehicles.segmentIdx[vId];
    const seg = line.segments[segIdx];
    if (seg) {
      const startStationId =
        this.vehicles.direction[vId] >= 0 ? seg.fromStationId : seg.toStationId;
      this.processStationStop(vId, startStationId, line);
    }
    return vId;
  }

  private recallLineVehicleToReserve(line: TransitLineRecord): boolean {
    if (line.vehicleIds.length <= 1) {
      return false;
    }
    const vId = this.vehicles.sellLastVehicle(line);
    if (vId === -1) {
      return false;
    }
    this.evacuateVehiclePassengers(vId, line);
    const spec = TRANSIT_MODES[line.mode];
    const perVehCapEx =
      spec.vehicleCapEx + Math.max(0, line.consistCars - 1) * LRV_EXTRA_CAR_CAPEX_CAD;
    line.investedCapExCad = Math.max(0, line.investedCapExCad - perVehCapEx);
    this.dispatch.addToReserve(line.mode, 1);
    return true;
  }

  private evacuateVehiclePassengers(vehicleId: number, line: TransitLineRecord): void {
    const segIdx = Math.min(
      this.vehicles.segmentIdx[vehicleId],
      Math.max(0, line.segments.length - 1),
    );
    const seg = line.segments[segIdx];
    const fallbackStationId = seg
      ? this.vehicles.direction[vehicleId] >= 0
        ? seg.fromStationId
        : seg.toStationId
      : line.stationIds[0];

    let cur = this.agents.headAgentByVehicle[vehicleId];
    while (cur !== -1) {
      const next = this.agents.nextInNode[cur];
      const count = this.agents.passengerCount[cur];
      const dest = this.agents.destStationId[cur];
      this.agents.unlinkFromVehicle(cur, vehicleId);
      if (fallbackStationId !== undefined && fallbackStationId !== dest) {
        this.agents.enqueueAtStation(cur, fallbackStationId, this.simTimeSeconds);
        this.stations.addWaitingCount(fallbackStationId, count);
      } else {
        this.agents.freeSlot(cur);
      }
      cur = next;
    }
    this.vehicles.onboardCount[vehicleId] = 0;
  }

  private startLoop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
    }
    this.lastTickWallMs = performance.now();
    this.lastTelemetryWallMs = this.lastTickWallMs;
    this.accumulatorRealSec = 0;

    this.timerId = setInterval(() => {
      const now = performance.now();
      const elapsedSec = Math.min(0.1, Math.max(0, (now - this.lastTickWallMs) / 1000));
      this.lastTickWallMs = now;

      this.accumulatorRealSec += elapsedSec;
      let steps = 0;
      while (this.accumulatorRealSec >= WORKER_FIXED_DT_REAL_SEC && steps < 4) {
        this.accumulatorRealSec -= WORKER_FIXED_DT_REAL_SEC;
        this.stepTick();
        steps += 1;
      }

      if (now - this.lastTelemetryWallMs >= 250) {
        this.lastTelemetryWallMs = now;
        this.emitTelemetry();
      }
    }, Math.floor(1000 / 30));
  }

  /** Executes a single 30Hz simulation tick and publishes a render snapshot. Returns tick duration in ms. */
  stepTick(overrideDtSimSeconds?: number): number {
    if (this.speed === 0 && overrideDtSimSeconds === undefined) {
      return 0;
    }
    const startMs = performance.now();
    const dtSimSeconds =
      overrideDtSimSeconds ?? WORKER_FIXED_DT_REAL_SEC * SIM_SECONDS_PER_REAL_SECOND * this.speed;

    this.simTimeSeconds += dtSimSeconds;
    const dailyTodTaxCad = this.tod.computeDailyTodTaxCad(this.stations.stations);
    const rollover = this.economy.stepDayAndWeekRollover(
      this.simTimeSeconds,
      this.lines.lines,
      this.stations.stations,
      dailyTodTaxCad,
    );
    if (rollover.dayRolledOver) {
      this.dailyRidership = 0;
      this.dailyCompletedWaitMinSum = 0;
      this.dailyCompletedRiderCount = 0;
      this.demand.resetDailyCounters();
    }
    if (rollover.weekRolledOver) {
      const todRes = this.tod.stepWeeklyTod(this.stations);
      if (this.manifest && (todRes.stationsUpzoned > 0 || todRes.totalWeightDelta > 0)) {
        this.dispatch.recomputeFeederCatchments(this.stations, this.manifest.worldUnitsPerKm);
        this.demand.syncStationMatrix(this.stations);
        this.emitTopology();
      }
    }

    const dispatchChanged = this.dispatch.stepDispatch(
      this.simTimeSeconds,
      this.lines.lines,
      this.stations,
      this.vehicles,
      this.economy,
      (l, fromReserve) => this.spawnVehicleWithStopCheck(l, fromReserve),
      (l) => this.recallLineVehicleToReserve(l),
    );
    if (dispatchChanged) {
      this.emitTopology();
    }

    if (this.pathfinder.isRebuildInProgress()) {
      this.pathfinder.stepRebuild(this.stations, 32);
    } else if (
      this.lines.lines.length > 0 &&
      this.pathfinder.checkSignificantShift(this.lines, 1.0, 1.0)
    ) {
      this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0);
      this.pathfinder.stepRebuild(this.stations, 32);
    }

    this.demand.stepDemandSlice(
      dtSimSeconds,
      this.simTimeSeconds,
      this.stations,
      this.pathfinder,
      this.agents,
    );

    this.vehicles.stepVehicles(dtSimSeconds, this.lines, (vId, stationId, line) =>
      this.processStationStop(vId, stationId, line),
    );

    this.tickIndex += 1;
    const durationMs = performance.now() - startMs;
    this.publishSnapshot(durationMs * 1000);
    return durationMs;
  }

  /**
   * O(k) vehicle stop handler: alights cohorts arriving at their destination or transfer hub,
   * credits $3.50 ARC fares on trip completion, and boards waiting cohorts in strict FIFO order.
   * Returns total riders boarded at this stop for dynamic dwell calculation.
   */
  processStationStop(vehicleId: number, stationId: number, line: TransitLineRecord): number {
    const agents = this.agents;
    const vehicles = this.vehicles;

    // 1. Alighting pass (O(k) over vehicle's intrusive passenger list).
    let curOnVehicle = agents.headAgentByVehicle[vehicleId];
    while (curOnVehicle !== -1) {
      const next = agents.nextInNode[curOnVehicle];
      const dest = agents.destStationId[curOnVehicle];
      const targetAlight = agents.alightStationId[curOnVehicle];

      if (targetAlight === stationId || dest === stationId) {
        const count = agents.passengerCount[curOnVehicle];
        agents.unlinkFromVehicle(curOnVehicle, vehicleId);
        vehicles.onboardCount[vehicleId] = Math.max(0, vehicles.onboardCount[vehicleId] - count);

        if (dest === stationId) {
          this.economy.collectFare(count);
          this.dailyRidership += count;

          const totalWaitMin = agents.waitTimer[curOnVehicle] / 60;
          this.dailyCompletedWaitMinSum += totalWaitMin * count;
          this.dailyCompletedRiderCount += count;
          this.recomputePublicApproval();

          agents.freeSlot(curOnVehicle);
        } else {
          agents.enqueueAtStation(curOnVehicle, stationId, this.simTimeSeconds);
          this.stations.addWaitingCount(stationId, count);
        }
      }
      curOnVehicle = next;
    }

    // Drain any deferred overflow riders at this station if slots opened.
    if (agents.getOverflowCount() > 0) {
      const drained = agents.drainOverflowForStation(
        stationId,
        this.stations.stations.length,
        this.simTimeSeconds,
      );
      if (drained > 0) {
        this.stations.addWaitingCount(stationId, drained);
      }
    }

    // 2. Boarding pass (O(k) over station's FIFO waiting queue).
    let remainingCap = vehicles.capacity[vehicleId] - vehicles.onboardCount[vehicleId];
    if (remainingCap <= 0) {
      return 0;
    }

    let boardedCount = 0;
    const lineLoadRatio =
      vehicles.onboardCount[vehicleId] / Math.max(1, vehicles.capacity[vehicleId]);
    let curWaiting = agents.headAgentByStation[stationId];

    while (curWaiting !== -1 && remainingCap > 0) {
      const next = agents.nextInNode[curWaiting];
      const dest = agents.destStationId[curWaiting];
      const primLine = this.pathfinder.getNextLine(stationId, dest);
      const altLine = this.pathfinder.getAltLine(stationId, dest);

      let targetAlight = UNREACHABLE_ID;
      if (primLine === line.lineId) {
        targetAlight = this.pathfinder.getAlightStation(stationId, dest);
      } else if (altLine === line.lineId && primLine !== UNREACHABLE_ID) {
        const primCap = this.pathfinder.getLineCapacity(primLine);
        const altCap = this.pathfinder.getLineCapacity(altLine);
        const altShare = Math.min(0.5, altCap / Math.max(1, primCap + altCap));
        const primLoad = this.getLineLoadRatio(primLine);
        if (primLoad > 0.85 || (lineLoadRatio < 0.5 && (curWaiting % 100) / 100 < altShare)) {
          targetAlight = this.pathfinder.getAltAlightStation(stationId, dest);
        }
      }

      if (targetAlight !== UNREACHABLE_ID) {
        const count = agents.passengerCount[curWaiting];
        if (count <= remainingCap) {
          agents.unlinkFromStation(curWaiting, stationId, this.simTimeSeconds);
          this.stations.addWaitingCount(stationId, -count);
          agents.enqueueOnVehicle(curWaiting, vehicleId, targetAlight);
          vehicles.onboardCount[vehicleId] += count;
          remainingCap -= count;
          boardedCount += count;
        } else {
          const splitSlot = agents.splitForVehicle(
            curWaiting,
            remainingCap,
            vehicleId,
            targetAlight,
            this.simTimeSeconds,
          );
          if (splitSlot !== -1) {
            this.stations.addWaitingCount(stationId, -remainingCap);
            vehicles.onboardCount[vehicleId] += remainingCap;
            boardedCount += remainingCap;
            remainingCap = 0;
          } else {
            break;
          }
        }
      }

      curWaiting = next;
    }

    if (boardedCount > 0) {
      this.stations.recordBoardings(stationId, boardedCount);
    }

    return boardedCount;
  }

  private getLineLoadRatio(lineId: number): number {
    const line = this.lines.getById(lineId);
    if (!line || line.vehicleIds.length === 0) {
      return 0;
    }
    let totalOnboard = 0;
    let totalCap = 0;
    for (const vId of line.vehicleIds) {
      totalOnboard += this.vehicles.onboardCount[vId];
      totalCap += this.vehicles.capacity[vId];
    }
    return totalCap > 0 ? totalOnboard / totalCap : 0;
  }

  private recomputePublicApproval(): void {
    const avgWaitMin =
      this.dailyCompletedRiderCount > 0
        ? this.dailyCompletedWaitMinSum / this.dailyCompletedRiderCount
        : 0;
    const satisfactionScore = 100 * Math.max(0, 1 - avgWaitMin / PATIENCE_CEILING_MIN);
    const modeShare = this.demand.getModeSharePct();
    const scenicBonus = Math.min(
      MAX_SCENIC_APPROVAL_BONUS_PCT,
      this.lines.countActiveTransitBridgeCrossings() * 5,
    );
    this.publicApprovalPct = Math.max(
      0,
      Math.min(100, Math.round(0.55 * satisfactionScore + 0.35 * modeShare + 15 + scenicBonus)),
    );
  }

  private publishSnapshot(tickDurationMicros: number): void {
    const meta: SnapshotWriteMetadata = {
      tickIndex: this.tickIndex,
      simTimeSeconds: this.simTimeSeconds,
      vehicleCount: this.vehicles.getHighWaterMark(),
      stationCount: this.stations.stations.length,
      topologyVersion: this.lines.getTopologyVersion(),
      tickDurationMicros,
    };

    if (this.sabWriter) {
      const { slotIndex, views } = this.sabWriter.acquireBackSlot();
      this.vehicles.writeToRenderSlot(views.vehicles);
      this.stations.writeToRenderSlot(views.stations);
      this.sabWriter.commit(slotIndex, meta);
      return;
    }

    if (this.transferableWriter) {
      const { buffer, views } = this.transferableWriter.acquireBuffer();
      this.vehicles.writeToRenderSlot(views.vehicles);
      this.stations.writeToRenderSlot(views.stations);
      const ready = this.transferableWriter.prepareTransfer(buffer, meta);
      this.postOutbound(
        {
          type: 'TRANSFER_SNAPSHOT',
          tickIndex: meta.tickIndex,
          simTimeSeconds: meta.simTimeSeconds,
          buffer: ready,
        },
        [ready],
      );
    }
  }

  private emitTopology(): void {
    const worldUnitsPerKm = this.manifest?.worldUnitsPerKm ?? 100;
    const feederZones = this.stations.stations
      .filter((s) => s.feederActive)
      .map((s) => ({
        stationId: s.stationId,
        radiusWorldUnits: s.feederRadiusKm * worldUnitsPerKm,
      }));

    const topology: TopologySnapshot = {
      topologyVersion: this.lines.getTopologyVersion(),
      stations: this.stations.stations.map((s) => ({
        stationId: s.stationId,
        seedId: s.seedId,
        name: s.name,
        x: s.x,
        y: s.y,
        zone: s.zone,
        subTag: s.subTag,
        concourseTier: s.concourseTier,
        parkAndRideActive: s.parkAndRideActive,
        feederActive: s.feederActive,
        feederRadiusKm: s.feederRadiusKm,
        baseProduction: s.baseProduction,
        weeklyBoardings: s.weeklyBoardings,
        todLevel: s.todLevel,
        todWeight: Math.round(s.todWeight),
        carryingCapacity: s.carryingCapacity,
      })),
      lines: this.lines.toTopologyLines(),
      feederZones,
    };
    this.postOutbound({ type: 'TOPOLOGY_SYNC', topology });
  }

  private buildSelectedInspectorData(): unknown {
    if (this.inspectorTarget.kind === 'STATION') {
      const st = this.stations.getById(this.inspectorTarget.stationId);
      return st
        ? {
            kind: 'STATION',
            stationId: st.stationId,
            waitingCount: st.waitingCount,
            concourseTier: st.concourseTier,
            parkAndRideActive: st.parkAndRideActive,
            feederActive: st.feederActive,
            feederRadiusKm: st.feederRadiusKm,
            baseProduction: st.baseProduction,
            weeklyBoardings: st.weeklyBoardings,
            todLevel: st.todLevel,
            todWeight: Math.round(st.todWeight),
            carryingCapacity: st.carryingCapacity,
          }
        : null;
    }
    return null;
  }

  private emitTelemetry(): void {
    const totalDays = Math.floor(this.simTimeSeconds / 86_400);
    const simDay = totalDays + 1;
    const simWeek = Math.floor(totalDays / 7) + 1;
    const daySec = Math.floor(this.simTimeSeconds % 86_400);
    const hh = String(Math.floor(daySec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((daySec % 3600) / 60)).padStart(2, '0');

    const dailyOpExCad = this.economy.computeDailyOpEx(this.lines.lines, this.stations.stations);
    const dailyTodTaxCad = this.tod.computeDailyTodTaxCad(this.stations.stations);

    const telemetry: TelemetrySnapshot = {
      simDay,
      simWeek,
      simHourMinute: `${hh}:${mm}`,
      speed: this.speed,
      treasuryCad: Math.round(this.economy.getTreasuryCad()),
      bondDebtCad: Math.round(this.economy.getBondDebtCad()),
      dailyFareRevenueCad: Math.round(this.economy.getDailyFareRevenueCad()),
      dailyTodTaxCad,
      dailyOpExCad,
      dailyRidership: this.dailyRidership,
      modeSharePct: Number(this.demand.getModeSharePct().toFixed(1)),
      publicApprovalPct: this.publicApprovalPct,
      councilTargetPct: 55,
      onProbation: false,
      milestoneIndex: 1,
      currentAct: 1,
      activeWeather: 'CLEAR',
      activeEvents: [],
      reservePoolCount: this.dispatch.getTotalReserveCount(),
      reservePoolByMode: this.dispatch.getReservePoolSnapshot(),
      policyDraftPending: false,
      runOutcome: 'ACTIVE',
      activeVehicleCount: this.vehicles.getActiveCount(),
      stationUnmetCar: this.demand.getOriginUnmetCarSnapshot(this.stations.stations.length),
      lines: this.lines.lines.map((l) => {
        const dispatchMetrics = this.dispatch.computeLineMetrics(l, this.stations, this.vehicles);
        return {
          lineId: l.lineId,
          name: l.name,
          color: l.color,
          mode: l.mode,
          vehicleCount: l.vehicleIds.length,
          stationCount: l.stationIds.length,
          stationIds: [...l.stationIds],
          lengthKm: Number(l.totalLengthKm.toFixed(2)),
          allDoorArc: l.allDoorArc,
          tspEnabled: l.tspEnabled,
          consistCars: l.consistCars,
          totalCapExCad: l.investedCapExCad,
          dailyOpExCad: this.economy.computeLineDailyOpEx(l),
          policy: l.policy,
          actualHeadwaySec: dispatchMetrics.actualHeadwaySec,
          targetHeadwaySec: dispatchMetrics.targetHeadwaySec,
          governorState: dispatchMetrics.governorState,
          upgradeRecommended: dispatchMetrics.upgradeRecommended,
          avgLoadPct: dispatchMetrics.avgLoadPct,
        };
      }),
      selectedInspectorData: this.buildSelectedInspectorData(),
    };

    this.postOutbound({ type: 'TELEMETRY_SYNC', telemetry });
  }
}

// Register listener only inside actual Web Worker global scope.
if (typeof globalThis !== 'undefined' && 'DedicatedWorkerGlobalScope' in globalThis) {
  const engine = new WorkerSimulationEngine();
  self.addEventListener('message', (event: MessageEvent<WorkerCommand>) => {
    engine.handleCommand(event.data);
  });
}
