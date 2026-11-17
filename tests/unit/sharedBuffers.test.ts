import { describe, expect, it } from 'vitest';
import { MAX_STATIONS, MAX_VEHICLES, type WorkerCommand } from '../../src/core/contracts';
import {
  CONTROL_HEADER_BYTES,
  SAB_TOTAL_BYTES,
  SLOT_STRIDE_BYTES,
  SharedSnapshotReader,
  SharedSnapshotWriter,
  TRANSFER_BUFFER_BYTES,
  TransferableSnapshotWriter,
  createRenderSlotViews,
} from '../../src/core/memory/sharedBuffers';
import { TransitLineStore } from '../../src/core/stores/lines';
import { StationStore } from '../../src/core/stores/stations';
import { VehicleStoreSoA } from '../../src/core/stores/vehicles';
import { WorkerClient } from '../../src/core/workerClient';
import { EDMONTON_MANIFEST_FIXTURE, EDMONTON_NODES_16_FIXTURE } from '../helpers/edmontonFixture';
import { MockWorker } from '../helpers/mockWorker';

describe('sharedBuffers & Milestone 1 core pipeline', () => {
  it('enforces exact 16-byte-aligned SharedArrayBuffer and slot offsets', () => {
    expect(CONTROL_HEADER_BYTES).toBe(64);
    expect(SLOT_STRIDE_BYTES).toBe(110_592);
    expect(SLOT_STRIDE_BYTES % 16).toBe(0);
    expect(SAB_TOTAL_BYTES).toBe(221_248);
    expect(TRANSFER_BUFFER_BYTES).toBe(110_656);

    const sab = new SharedArrayBuffer(SAB_TOTAL_BYTES);
    const slot0 = createRenderSlotViews(sab, CONTROL_HEADER_BYTES);
    const slot1 = createRenderSlotViews(sab, CONTROL_HEADER_BYTES + SLOT_STRIDE_BYTES);

    expect(slot0.vehicles.prevX.length).toBe(MAX_VEHICLES);
    expect(slot0.stations.waitingCount.length).toBe(MAX_STATIONS);
    expect(slot1.vehicles.currY.byteOffset % 16).toBe(0);
    expect(slot1.stations.waitingCount.byteOffset % 16).toBe(0);

    expect(() => createRenderSlotViews(sab, 68)).toThrow(RangeError);
  });

  it('isolates double-buffered SharedArrayBuffer writes until Atomics slot commit', () => {
    const sab = new SharedArrayBuffer(SAB_TOTAL_BYTES);
    const writer = new SharedSnapshotWriter(sab);
    const reader = new SharedSnapshotReader(sab);

    // Commit slot 1 with vehicle #0 at (100, 200).
    const firstBack = writer.acquireBackSlot();
    expect(firstBack.slotIndex).toBe(1);
    firstBack.views.vehicles.activeFlag[0] = 1;
    firstBack.views.vehicles.prevX[0] = 95;
    firstBack.views.vehicles.currX[0] = 100;
    firstBack.views.vehicles.currY[0] = 200;
    firstBack.views.stations.waitingCount[2] = 42;
    writer.commit(firstBack.slotIndex, {
      tickIndex: 1,
      simTimeSeconds: 23_400,
      vehicleCount: 1,
      stationCount: 16,
      topologyVersion: 1,
      tickDurationMicros: 320,
    });

    const snap1 = reader.readLatest();
    expect(snap1.tickIndex).toBe(1);
    expect(snap1.slot.vehicles.currX[0]).toBe(100);
    expect(snap1.slot.stations.waitingCount[2]).toBe(42);

    // Prepare slot 0 without committing yet; reader must still observe tick 1 intact.
    const secondBack = writer.acquireBackSlot();
    expect(secondBack.slotIndex).toBe(0);
    secondBack.views.vehicles.activeFlag[0] = 1;
    secondBack.views.vehicles.currX[0] = 999;
    expect(reader.readLatest().slot.vehicles.currX[0]).toBe(100);

    writer.commit(secondBack.slotIndex, {
      tickIndex: 2,
      simTimeSeconds: 23_404,
      vehicleCount: 1,
      stationCount: 16,
      topologyVersion: 1,
      tickDurationMicros: 280,
    });

    const snap2 = reader.readLatest();
    expect(snap2.tickIndex).toBe(2);
    expect(snap2.slot.vehicles.currX[0]).toBe(999);
  });

  it('recycles transferable ArrayBuffers without extra allocations when crossOriginIsolated is false', () => {
    const mockWorker = new MockWorker();
    const writer = new TransferableSnapshotWriter();
    const returnedBuffers: ArrayBuffer[] = [];

    mockWorker.onCommandReceived = (raw) => {
      const cmd = raw as WorkerCommand;
      if (cmd.type === 'RETURN_SNAPSHOT_BUFFER') {
        returnedBuffers.push(cmd.buffer);
        writer.reclaimBuffer(cmd.buffer);
      }
    };

    const client = new WorkerClient({}, () => mockWorker, true);
    expect(client.getTransportMode()).toBe('TRANSFERABLE');

    const first = writer.acquireBuffer();
    first.views.vehicles.activeFlag[0] = 1;
    first.views.vehicles.currX[0] = 1234;
    const firstBuf = writer.prepareTransfer(first.buffer, {
      tickIndex: 1,
      simTimeSeconds: 23_400,
      vehicleCount: 1,
      stationCount: 16,
      topologyVersion: 1,
      tickDurationMicros: 150,
    });
    mockWorker.emitFromWorker({
      type: 'TRANSFER_SNAPSHOT',
      tickIndex: 1,
      simTimeSeconds: 23_400,
      buffer: firstBuf,
    });

    expect(returnedBuffers.length).toBe(0);
    expect(client.readLatestSnapshot(1000).frame?.slot.vehicles.currX[0]).toBe(1234);

    // Second frame swaps in and must immediately return firstBuf back to the worker pool.
    const second = writer.acquireBuffer();
    second.views.vehicles.activeFlag[0] = 1;
    second.views.vehicles.currX[0] = 1250;
    const secondBuf = writer.prepareTransfer(second.buffer, {
      tickIndex: 2,
      simTimeSeconds: 23_404,
      vehicleCount: 1,
      stationCount: 16,
      topologyVersion: 1,
      tickDurationMicros: 140,
    });
    mockWorker.emitFromWorker({
      type: 'TRANSFER_SNAPSHOT',
      tickIndex: 2,
      simTimeSeconds: 23_404,
      buffer: secondBuf,
    });

    expect(returnedBuffers.length).toBe(1);
    expect(returnedBuffers[0]).toBe(firstBuf);
    expect(client.readLatestSnapshot(1033).frame?.slot.vehicles.currX[0]).toBe(1250);

    // Acquiring a third buffer reuses the reclaimed firstBuf rather than allocating new memory.
    const third = writer.acquireBuffer();
    expect(third.buffer).toBe(firstBuf);

    client.dispose();
    expect(mockWorker.terminated).toBe(true);
  });

  it('steps single-line bus Bezier kinematics, station dwell, and terminus reversal', () => {
    const stations = new StationStore();
    stations.initFromSeeds(EDMONTON_NODES_16_FIXTURE);
    const lines = new TransitLineStore();
    const vehicles = new VehicleStoreSoA();

    // University of Alberta (idx 3) -> Churchill Square (idx 0) -> NAIT / Blatchford (idx 6).
    const res = lines.createLine(
      'Route 1',
      '#38bdf8',
      'BUS_LOCAL',
      [
        { stationId: 3, x: stations.stations[3].x, y: stations.stations[3].y },
        { stationId: 0, x: stations.stations[0].x, y: stations.stations[0].y },
        { stationId: 6, x: stations.stations[6].x, y: stations.stations[6].y },
      ],
      stations,
      EDMONTON_MANIFEST_FIXTURE.worldUnitsPerKm,
    );

    expect('line' in res).toBe(true);
    if (!('line' in res)) {
      return;
    }

    expect(res.line.segments.length).toBe(2);
    expect(res.trackCapExCad).toBeGreaterThan(0);

    const vId = vehicles.spawnVehicle(res.line);
    expect(vId).toBe(0);
    expect(vehicles.direction[vId]).toBe(1);

    let enteredIntermediateDwell = false;
    let reversedAtTerminus = false;

    for (let step = 0; step < 500; step++) {
      vehicles.stepVehicles(4.0, lines);
      if (vehicles.segmentIdx[vId] === 1 && vehicles.dwellTimerS[vId] > 0) {
        enteredIntermediateDwell = true;
      }
      if (vehicles.direction[vId] === -1) {
        reversedAtTerminus = true;
        break;
      }
    }

    expect(enteredIntermediateDwell).toBe(true);
    expect(reversedAtTerminus).toBe(true);
    expect(vehicles.dwellTimerS[vId]).toBeGreaterThan(0);
  });
});
