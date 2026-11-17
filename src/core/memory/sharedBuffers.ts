import { MAX_STATIONS, MAX_VEHICLES } from '../contracts';

/** 64-byte 16-byte-aligned Int32Array control header at byte offset 0. */
export const CONTROL_HEADER_BYTES = 64;
export const SLOT_STRIDE_BYTES = 110_592;
export const SAB_TOTAL_BYTES = CONTROL_HEADER_BYTES + 2 * SLOT_STRIDE_BYTES; // 221,248 bytes
export const TRANSFER_BUFFER_BYTES = CONTROL_HEADER_BYTES + SLOT_STRIDE_BYTES; // 110,656 bytes

export const HEADER_ACTIVE_SLOT = 0;
export const HEADER_TICK_INDEX = 1;
export const HEADER_SIM_TIME_SECONDS = 2;
export const HEADER_VEHICLE_COUNT = 3;
export const HEADER_STATION_COUNT = 4;
export const HEADER_TOPOLOGY_VERSION = 5;
export const HEADER_TICK_DURATION_MICROS = 6;

// Slot-relative byte offsets (all 16-byte aligned for Float32 / Uint32 / Uint16 / Uint8).
const OFF_PREV_X = 0;
const OFF_PREV_Y = 16_384;
const OFF_CURR_X = 32_768;
const OFF_CURR_Y = 49_152;
const OFF_BEARING = 65_536;
const OFF_LINE_ID = 81_920;
const OFF_MODE_TIER = 90_112;
const OFF_LOAD_RATIO = 94_208;
const OFF_ACTIVE_FLAG = 98_304;
// 4,096 bytes padding from 102,400 to 106,496 maintains 16-byte alignment before StationRenderSoA.
const OFF_WAITING_COUNT = 106_496;
const OFF_TOD_LEVEL = 108_544;
const OFF_CONCOURSE_TIER = 109_056;
const OFF_PARK_AND_RIDE = 109_568;
const OFF_FEEDER_ACTIVE = 110_080;

export interface VehicleRenderSoA {
  prevX: Float32Array;
  prevY: Float32Array;
  currX: Float32Array;
  currY: Float32Array;
  bearing: Float32Array;
  lineId: Uint16Array;
  modeTier: Uint8Array;
  loadRatio: Uint8Array;
  activeFlag: Uint8Array;
}

export interface StationRenderSoA {
  waitingCount: Uint32Array;
  todLevel: Uint8Array;
  concourseTier: Uint8Array;
  parkAndRideFlag: Uint8Array;
  feederActiveFlag: Uint8Array;
}

export interface RenderSlotViews {
  vehicles: VehicleRenderSoA;
  stations: StationRenderSoA;
}

export interface SnapshotReadFrame {
  tickIndex: number;
  simTimeSeconds: number;
  vehicleCount: number;
  stationCount: number;
  topologyVersion: number;
  tickDurationMicros: number;
  slot: RenderSlotViews;
}

export interface SnapshotWriteMetadata {
  tickIndex: number;
  simTimeSeconds: number;
  vehicleCount: number;
  stationCount: number;
  topologyVersion: number;
  tickDurationMicros: number;
}

/**
 * Constructs typed SoA views at a 16-byte-aligned slot offset inside a SharedArrayBuffer or ArrayBuffer.
 */
export function createRenderSlotViews(buffer: ArrayBufferLike, slotByteOffset: number): RenderSlotViews {
  if (slotByteOffset % 16 !== 0) {
    throw new RangeError(`slotByteOffset (${slotByteOffset}) must be 16-byte aligned`);
  }
  if (slotByteOffset + SLOT_STRIDE_BYTES > buffer.byteLength) {
    throw new RangeError(
      `Buffer length (${buffer.byteLength}) too small for slot at offset ${slotByteOffset}`,
    );
  }

  return {
    vehicles: {
      prevX: new Float32Array(buffer, slotByteOffset + OFF_PREV_X, MAX_VEHICLES),
      prevY: new Float32Array(buffer, slotByteOffset + OFF_PREV_Y, MAX_VEHICLES),
      currX: new Float32Array(buffer, slotByteOffset + OFF_CURR_X, MAX_VEHICLES),
      currY: new Float32Array(buffer, slotByteOffset + OFF_CURR_Y, MAX_VEHICLES),
      bearing: new Float32Array(buffer, slotByteOffset + OFF_BEARING, MAX_VEHICLES),
      lineId: new Uint16Array(buffer, slotByteOffset + OFF_LINE_ID, MAX_VEHICLES),
      modeTier: new Uint8Array(buffer, slotByteOffset + OFF_MODE_TIER, MAX_VEHICLES),
      loadRatio: new Uint8Array(buffer, slotByteOffset + OFF_LOAD_RATIO, MAX_VEHICLES),
      activeFlag: new Uint8Array(buffer, slotByteOffset + OFF_ACTIVE_FLAG, MAX_VEHICLES),
    },
    stations: {
      waitingCount: new Uint32Array(buffer, slotByteOffset + OFF_WAITING_COUNT, MAX_STATIONS),
      todLevel: new Uint8Array(buffer, slotByteOffset + OFF_TOD_LEVEL, MAX_STATIONS),
      concourseTier: new Uint8Array(buffer, slotByteOffset + OFF_CONCOURSE_TIER, MAX_STATIONS),
      parkAndRideFlag: new Uint8Array(buffer, slotByteOffset + OFF_PARK_AND_RIDE, MAX_STATIONS),
      feederActiveFlag: new Uint8Array(buffer, slotByteOffset + OFF_FEEDER_ACTIVE, MAX_STATIONS),
    },
  };
}

function writeHeaderMetadata(header: Int32Array, slotIndex: number, meta: SnapshotWriteMetadata): void {
  header[HEADER_TICK_INDEX] = meta.tickIndex;
  header[HEADER_SIM_TIME_SECONDS] = Math.floor(meta.simTimeSeconds);
  header[HEADER_VEHICLE_COUNT] = meta.vehicleCount;
  header[HEADER_STATION_COUNT] = meta.stationCount;
  header[HEADER_TOPOLOGY_VERSION] = meta.topologyVersion;
  header[HEADER_TICK_DURATION_MICROS] = Math.max(0, Math.round(meta.tickDurationMicros));
  // Active slot must be published last with Atomics.store so readers never observe partial slot writes.
  Atomics.store(header, HEADER_ACTIVE_SLOT, slotIndex);
}

function readHeaderMetadata(header: Int32Array, slot: RenderSlotViews): SnapshotReadFrame {
  return {
    tickIndex: header[HEADER_TICK_INDEX] >>> 0,
    simTimeSeconds: header[HEADER_SIM_TIME_SECONDS],
    vehicleCount: header[HEADER_VEHICLE_COUNT],
    stationCount: header[HEADER_STATION_COUNT],
    topologyVersion: header[HEADER_TOPOLOGY_VERSION],
    tickDurationMicros: header[HEADER_TICK_DURATION_MICROS],
    slot,
  };
}

export class SharedSnapshotWriter {
  private readonly header: Int32Array;
  private readonly slots: [RenderSlotViews, RenderSlotViews];
  private currentActiveSlot = 0;

  constructor(buffer: SharedArrayBuffer) {
    if (buffer.byteLength < SAB_TOTAL_BYTES) {
      throw new RangeError(`Expected SharedArrayBuffer >= ${SAB_TOTAL_BYTES} bytes, got ${buffer.byteLength}`);
    }
    this.header = new Int32Array(buffer, 0, CONTROL_HEADER_BYTES / 4);
    this.slots = [
      createRenderSlotViews(buffer, CONTROL_HEADER_BYTES),
      createRenderSlotViews(buffer, CONTROL_HEADER_BYTES + SLOT_STRIDE_BYTES),
    ];
    Atomics.store(this.header, HEADER_ACTIVE_SLOT, 0);
  }

  /** Returns the inactive back-buffer slot so the worker writes safely without racing the renderer. */
  acquireBackSlot(): { slotIndex: number; views: RenderSlotViews } {
    const nextSlot = 1 - this.currentActiveSlot;
    return { slotIndex: nextSlot, views: this.slots[nextSlot] };
  }

  commit(slotIndex: number, meta: SnapshotWriteMetadata): void {
    writeHeaderMetadata(this.header, slotIndex, meta);
    this.currentActiveSlot = slotIndex;
  }
}

export class SharedSnapshotReader {
  private readonly header: Int32Array;
  private readonly slots: [RenderSlotViews, RenderSlotViews];

  constructor(buffer: SharedArrayBuffer) {
    if (buffer.byteLength < SAB_TOTAL_BYTES) {
      throw new RangeError(`Expected SharedArrayBuffer >= ${SAB_TOTAL_BYTES} bytes, got ${buffer.byteLength}`);
    }
    this.header = new Int32Array(buffer, 0, CONTROL_HEADER_BYTES / 4);
    this.slots = [
      createRenderSlotViews(buffer, CONTROL_HEADER_BYTES),
      createRenderSlotViews(buffer, CONTROL_HEADER_BYTES + SLOT_STRIDE_BYTES),
    ];
  }

  readLatest(): SnapshotReadFrame {
    const activeSlot = Atomics.load(this.header, HEADER_ACTIVE_SLOT) & 1;
    return readHeaderMetadata(this.header, this.slots[activeSlot]);
  }
}

/**
 * Ping-pong transferable ArrayBuffer writer used when SharedArrayBuffer is unavailable
 * (e.g., crossOriginIsolated === false).
 */
export class TransferableSnapshotWriter {
  private readonly pool: ArrayBuffer[];

  constructor() {
    this.pool = [
      new ArrayBuffer(TRANSFER_BUFFER_BYTES),
      new ArrayBuffer(TRANSFER_BUFFER_BYTES),
    ];
  }

  acquireBuffer(): { buffer: ArrayBuffer; views: RenderSlotViews } {
    const buffer = this.pool.pop() ?? new ArrayBuffer(TRANSFER_BUFFER_BYTES);
    return {
      buffer,
      views: createRenderSlotViews(buffer, CONTROL_HEADER_BYTES),
    };
  }

  prepareTransfer(buffer: ArrayBuffer, meta: SnapshotWriteMetadata): ArrayBuffer {
    const header = new Int32Array(buffer, 0, CONTROL_HEADER_BYTES / 4);
    header[HEADER_ACTIVE_SLOT] = 0;
    header[HEADER_TICK_INDEX] = meta.tickIndex;
    header[HEADER_SIM_TIME_SECONDS] = Math.floor(meta.simTimeSeconds);
    header[HEADER_VEHICLE_COUNT] = meta.vehicleCount;
    header[HEADER_STATION_COUNT] = meta.stationCount;
    header[HEADER_TOPOLOGY_VERSION] = meta.topologyVersion;
    header[HEADER_TICK_DURATION_MICROS] = Math.max(0, Math.round(meta.tickDurationMicros));
    return buffer;
  }

  reclaimBuffer(buffer: ArrayBuffer): void {
    if (buffer.byteLength === TRANSFER_BUFFER_BYTES && this.pool.length < 2) {
      this.pool.push(buffer);
    }
  }
}

export class TransferableSnapshotReader {
  private activeBuffer: ArrayBuffer | null = null;
  private activeHeader: Int32Array | null = null;
  private activeSlot: RenderSlotViews | null = null;

  /** Installs the newly transferred buffer and returns any retired buffer for return to the worker. */
  acceptIncoming(buffer: ArrayBuffer): ArrayBuffer | null {
    const retired = this.activeBuffer;
    this.activeBuffer = buffer;
    this.activeHeader = new Int32Array(buffer, 0, CONTROL_HEADER_BYTES / 4);
    this.activeSlot = createRenderSlotViews(buffer, CONTROL_HEADER_BYTES);
    return retired;
  }

  readLatest(): SnapshotReadFrame | null {
    if (!this.activeHeader || !this.activeSlot) {
      return null;
    }
    return readHeaderMetadata(this.activeHeader, this.activeSlot);
  }
}
