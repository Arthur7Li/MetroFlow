import type { WorkerOutboundMessage } from '../../src/core/contracts';
import type { WorkerLike } from '../../src/core/workerClient';

type MessageListener = (ev: MessageEvent<WorkerOutboundMessage>) => void;

/**
 * Deterministic in-memory Worker test double for verifying WorkerClient ping-pong
 * transferable ArrayBuffer recycling without spawning a browser Web Worker.
 */
export class MockWorker implements WorkerLike {
  private readonly listeners = new Set<MessageListener>();
  readonly sentCommands: Array<{ message: unknown; transfer?: Transferable[] }> = [];
  terminated = false;

  onCommandReceived?: (message: unknown, transfer?: Transferable[]) => void;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.sentCommands.push({ message, transfer });
    this.onCommandReceived?.(message, transfer);
  }

  addEventListener(_type: 'message', listener: MessageListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: MessageListener): void {
    this.listeners.delete(listener);
  }

  emitFromWorker(data: WorkerOutboundMessage): void {
    const event = { data } as MessageEvent<WorkerOutboundMessage>;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
  }
}
