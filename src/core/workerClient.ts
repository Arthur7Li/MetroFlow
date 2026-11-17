import type {
  TelemetrySnapshot,
  TopologySnapshot,
  TransportMode,
  WorkerCommand,
  WorkerOutboundMessage,
} from './contracts';
import {
  SAB_TOTAL_BYTES,
  SharedSnapshotReader,
  TransferableSnapshotReader,
  type SnapshotReadFrame,
} from './memory/sharedBuffers';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent<WorkerOutboundMessage>) => void): void;
  removeEventListener(type: 'message', listener: (ev: MessageEvent<WorkerOutboundMessage>) => void): void;
  terminate(): void;
}

export interface WorkerClientListeners {
  onReady?: (mode: TransportMode) => void;
  onTopology?: (topology: TopologySnapshot) => void;
  onTelemetry?: (telemetry: TelemetrySnapshot) => void;
  onError?: (message: string) => void;
}

export function isSharedMemoryAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}

export class WorkerClient {
  private readonly worker: WorkerLike;
  private readonly transportMode: TransportMode;
  private readonly sharedBuffer?: SharedArrayBuffer;
  private readonly sabReader?: SharedSnapshotReader;
  private readonly transferableReader?: TransferableSnapshotReader;
  private readonly listeners: WorkerClientListeners;
  private lastSeenTickIndex = -1;
  private lastTickTimestampMs = 0;

  private readonly handleMessage = (event: MessageEvent<WorkerOutboundMessage>): void => {
    const msg = event.data;
    switch (msg.type) {
      case 'READY':
        this.listeners.onReady?.(msg.transportMode);
        break;
      case 'TOPOLOGY_SYNC':
        this.listeners.onTopology?.(msg.topology);
        break;
      case 'TELEMETRY_SYNC':
        this.listeners.onTelemetry?.(msg.telemetry);
        break;
      case 'TRANSFER_SNAPSHOT': {
        if (!this.transferableReader) {
          return;
        }
        const retired = this.transferableReader.acceptIncoming(msg.buffer);
        this.lastSeenTickIndex = msg.tickIndex;
        this.lastTickTimestampMs = performance.now();
        if (retired) {
          this.worker.postMessage({ type: 'RETURN_SNAPSHOT_BUFFER', buffer: retired }, [retired]);
        }
        break;
      }
      case 'SNAPSHOT_EXPORTED':
        break;
      case 'ERROR':
        this.listeners.onError?.(msg.message);
        break;
    }
  };

  constructor(
    listeners: WorkerClientListeners = {},
    workerFactory?: () => WorkerLike,
    forceTransferable = false,
  ) {
    this.listeners = listeners;
    this.worker =
      workerFactory?.() ??
      new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });

    if (!forceTransferable && isSharedMemoryAvailable()) {
      this.transportMode = 'SAB';
      this.sharedBuffer = new SharedArrayBuffer(SAB_TOTAL_BYTES);
      this.sabReader = new SharedSnapshotReader(this.sharedBuffer);
    } else {
      this.transportMode = 'TRANSFERABLE';
      this.transferableReader = new TransferableSnapshotReader();
    }

    this.worker.addEventListener('message', this.handleMessage);
  }

  getTransportMode(): TransportMode {
    return this.transportMode;
  }

  getSharedBuffer(): SharedArrayBuffer | undefined {
    return this.sharedBuffer;
  }

  sendCommand(command: WorkerCommand): void {
    if (command.type === 'INIT_CITY' && this.sharedBuffer && !command.sharedBuffer) {
      this.worker.postMessage({ ...command, sharedBuffer: this.sharedBuffer });
      return;
    }
    this.worker.postMessage(command);
  }

  readLatestSnapshot(nowMs: number): { frame: SnapshotReadFrame | null; alpha: number } {
    if (this.sabReader) {
      const frame = this.sabReader.readLatest();
      if (frame.tickIndex !== this.lastSeenTickIndex) {
        this.lastSeenTickIndex = frame.tickIndex;
        this.lastTickTimestampMs = nowMs;
      }
      const alpha = Math.max(0, Math.min(1, (nowMs - this.lastTickTimestampMs) / (1000 / 30)));
      return { frame, alpha };
    }

    if (this.transferableReader) {
      const frame = this.transferableReader.readLatest();
      const alpha = Math.max(0, Math.min(1, (nowMs - this.lastTickTimestampMs) / (1000 / 30)));
      return { frame, alpha };
    }

    return { frame: null, alpha: 1 };
  }

  dispose(): void {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.terminate();
  }
}
