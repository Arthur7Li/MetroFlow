import type { CityManifest } from '../cities/types';
import { TRANSIT_MODES } from '../config/modes';
import {
  SIM_SECONDS_PER_REAL_SECOND,
  UNREACHABLE_ID,
  WORKER_FIXED_DT_REAL_SEC,
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
import { TransitLineStore, type TransitLineRecord } from './stores/lines';
import { StationStore } from './stores/stations';
import { VehicleStoreSoA } from './stores/vehicles';
import { DemandSystem } from './systems/demandSystem';

const START_TREASURY_CAD = 50_000;
const INITIAL_HOUR_SECONDS = 6 * 3600 + 30 * 60; // Start campaign day at 06:30 Morning Peak.
const BASE_ARC_FARE_CAD = 3.5;
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

  private sabWriter: SharedSnapshotWriter | null = null;
  private transferableWriter: TransferableSnapshotWriter | null = null;
  private transportMode: TransportMode = 'TRANSFERABLE';

  private speed: SimSpeed = 1;
  private treasuryCad = START_TREASURY_CAD;
  private tickIndex = 0;
  private simTimeSeconds = INITIAL_HOUR_SECONDS;
  private currentDayIndex = 0;

  private dailyFareRevenueCad = 0;
  private dailyRidership = 0;
  private dailyCompletedWaitMinSum = 0;
  private dailyCompletedRiderCount = 0;
  private publicApprovalPct = 75;

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
    return this.treasuryCad;
  }

  getDailyRidership(): number {
    return this.dailyRidership;
  }

  getDailyFareRevenueCad(): number {
    return this.dailyFareRevenueCad;
  }

  handleCommand(cmd: WorkerCommand, startWorkerLoop = true): void {
    switch (cmd.type) {
      case 'INIT_CITY': {
        this.manifest = cmd.manifest;
        this.stations.initFromSeeds(cmd.nodes);
        this.agents.reset();
        this.demand.initCity(this.stations, cmd.manifest.worldUnitsPerKm);
        this.treasuryCad = START_TREASURY_CAD;
        this.simTimeSeconds = INITIAL_HOUR_SECONDS;
        this.currentDayIndex = 0;
        this.tickIndex = 0;
        this.speed = 1;
        this.dailyFareRevenueCad = 0;
        this.dailyRidership = 0;
        this.dailyCompletedWaitMinSum = 0;
        this.dailyCompletedRiderCount = 0;
        this.publicApprovalPct = 75;

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

        this.demand.syncStationMatrix(this.stations);
        const initialVehicles = cmd.initialVehicles ?? 1;
        const spec = TRANSIT_MODES[cmd.mode];
        const spawnedIds: number[] = [];
        for (let i = 0; i < initialVehicles; i++) {
          const vId = this.vehicles.spawnVehicle(created.line);
          if (vId !== -1) {
            spawnedIds.push(vId);
          }
        }
        this.treasuryCad -= created.trackCapExCad + spawnedIds.length * spec.vehicleCapEx;

        this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, created.line.stationIds);
        this.pathfinder.stepRebuild(this.stations, 32);

        for (const vId of spawnedIds) {
          const segIdx = this.vehicles.segmentIdx[vId];
          const seg = created.line.segments[segIdx];
          const startStationId =
            this.vehicles.direction[vId] >= 0 ? seg.fromStationId : seg.toStationId;
          this.processStationStop(vId, startStationId, created.line);
        }

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
        const spawnedIds: number[] = [];
        for (let i = 0; i < count; i++) {
          const vId = this.vehicles.spawnVehicle(line);
          if (vId !== -1) {
            spawnedIds.push(vId);
          }
        }
        if (spawnedIds.length > 0) {
          this.treasuryCad -= spawnedIds.length * spec.vehicleCapEx;
          if (this.pathfinder.checkSignificantShift(this.lines, 1.0, 1.0)) {
            this.pathfinder.scheduleRebuild(this.stations, this.lines, 1.0, 1.0, line.stationIds);
          }
          for (const vId of spawnedIds) {
            const segIdx = this.vehicles.segmentIdx[vId];
            const seg = line.segments[segIdx];
            const startStationId =
              this.vehicles.direction[vId] >= 0 ? seg.fromStationId : seg.toStationId;
            this.processStationStop(vId, startStationId, line);
          }
          this.publishSnapshot(0);
          this.emitTopology();
          this.emitTelemetry();
        }
        break;
      }

      case 'RETURN_SNAPSHOT_BUFFER':
        this.transferableWriter?.reclaimBuffer(cmd.buffer);
        break;

      default:
        break;
    }
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
    const nextDayIdx = Math.floor(this.simTimeSeconds / 86_400);
    if (nextDayIdx > this.currentDayIndex) {
      this.currentDayIndex = nextDayIdx;
      this.dailyFareRevenueCad = 0;
      this.dailyRidership = 0;
      this.dailyCompletedWaitMinSum = 0;
      this.dailyCompletedRiderCount = 0;
      this.demand.resetDailyCounters();
    }

    if (this.pathfinder.isRebuildInProgress()) {
      this.pathfinder.stepRebuild(this.stations, 32);
    } else if (this.lines.lines.length > 0 && this.pathfinder.checkSignificantShift(this.lines, 1.0, 1.0)) {
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

    this.vehicles.stepVehicles(dtSimSeconds, this.lines, (vId, stationId, line) => {
      this.processStationStop(vId, stationId, line);
    });

    this.tickIndex += 1;
    const durationMs = performance.now() - startMs;
    this.publishSnapshot(durationMs * 1000);
    return durationMs;
  }

  /**
   * O(k) vehicle stop handler: alights cohorts arriving at their destination or transfer hub,
   * credits $3.50 ARC fares on trip completion, and boards waiting cohorts in strict FIFO order.
   */
  processStationStop(vehicleId: number, stationId: number, line: TransitLineRecord): void {
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
          // Trip complete: collect ARC fare & update rolling satisfaction.
          const fare = count * BASE_ARC_FARE_CAD;
          this.treasuryCad += fare;
          this.dailyFareRevenueCad += fare;
          this.dailyRidership += count;

          const totalWaitMin = agents.waitTimer[curOnVehicle] / 60;
          this.dailyCompletedWaitMinSum += totalWaitMin * count;
          this.dailyCompletedRiderCount += count;
          this.recomputePublicApproval();

          agents.freeSlot(curOnVehicle);
        } else {
          // Transfer hub: re-enqueue onto station FIFO waiting queue for connecting leg.
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
      return;
    }

    const lineLoadRatio = vehicles.onboardCount[vehicleId] / Math.max(1, vehicles.capacity[vehicleId]);
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
        // Capacity-proportional split on parallel trunk corridors when vehicle/corridor load is elevated.
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
            remainingCap = 0;
          } else {
            // Pool at 100% capacity with zero split slots left: leave cohort waiting intact.
            break;
          }
        }
      }

      curWaiting = next;
    }
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
    this.publicApprovalPct = Math.max(
      0,
      Math.min(100, Math.round(0.55 * satisfactionScore + 0.35 * modeShare + 15)),
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
        todLevel: s.todLevel,
        carryingCapacity: s.carryingCapacity,
      })),
      lines: this.lines.toTopologyLines(),
      feederZones: [],
    };
    this.postOutbound({ type: 'TOPOLOGY_SYNC', topology });
  }

  private emitTelemetry(): void {
    const totalDays = Math.floor(this.simTimeSeconds / 86_400);
    const simDay = totalDays + 1;
    const simWeek = Math.floor(totalDays / 7) + 1;
    const daySec = Math.floor(this.simTimeSeconds % 86_400);
    const hh = String(Math.floor(daySec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((daySec % 3600) / 60)).padStart(2, '0');

    let dailyOpExCad = 0;
    for (const line of this.lines.lines) {
      dailyOpExCad += line.vehicleIds.length * TRANSIT_MODES[line.mode].dailyOpExPerUnit;
    }

    const telemetry: TelemetrySnapshot = {
      simDay,
      simWeek,
      simHourMinute: `${hh}:${mm}`,
      speed: this.speed,
      treasuryCad: Math.round(this.treasuryCad),
      bondDebtCad: 0,
      dailyFareRevenueCad: Math.round(this.dailyFareRevenueCad),
      dailyTodTaxCad: 0,
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
      reservePoolCount: 0,
      policyDraftPending: false,
      runOutcome: 'ACTIVE',
      activeVehicleCount: this.vehicles.getActiveCount(),
      lines: this.lines.lines.map((l) => ({
        lineId: l.lineId,
        name: l.name,
        color: l.color,
        mode: l.mode,
        vehicleCount: l.vehicleIds.length,
        stationCount: l.stationIds.length,
        lengthKm: Number(l.totalLengthKm.toFixed(2)),
      })),
      selectedInspectorData: null,
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
