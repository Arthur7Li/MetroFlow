import { MAX_AGENTS, MAX_STATIONS, MAX_VEHICLES, UNREACHABLE_ID } from '../contracts';

const COALESCE_POOL_THRESHOLD = 0.7;
const MAX_COHORT_PASSENGERS = 65_535;

/**
 * Worker-private Structure-of-Arrays (SoA) passenger cohort store.
 * Uses O(1) free-list allocation, FIFO intrusive doubly-linked lists per station/vehicle,
 * and O(1) (station, dest) coalescing above 70% pool load or at 100% saturation.
 */
export class AgentStoreSoA {
  readonly active = new Uint8Array(MAX_AGENTS); // 0 = free, 1 = waiting at station, 2 = on vehicle
  readonly passengerCount = new Uint16Array(MAX_AGENTS);
  readonly currentNodeId = new Uint16Array(MAX_AGENTS);
  readonly originStationId = new Uint16Array(MAX_AGENTS);
  readonly destStationId = new Uint16Array(MAX_AGENTS);
  readonly alightStationId = new Uint16Array(MAX_AGENTS);
  readonly waitTimer = new Float32Array(MAX_AGENTS);
  readonly tripStartTime = new Float32Array(MAX_AGENTS);
  readonly queueJoinTime = new Float32Array(MAX_AGENTS);
  readonly nextInNode = new Int32Array(MAX_AGENTS);
  readonly prevInNode = new Int32Array(MAX_AGENTS);

  readonly headAgentByStation = new Int32Array(MAX_STATIONS);
  readonly tailAgentByStation = new Int32Array(MAX_STATIONS);
  readonly headAgentByVehicle = new Int32Array(MAX_VEHICLES);
  readonly tailAgentByVehicle = new Int32Array(MAX_VEHICLES);

  private readonly freeListStack = new Int32Array(MAX_AGENTS);
  private freeTop = MAX_AGENTS;
  private activeCount = 0;

  // Maps (stationId * MAX_STATIONS + destStationId) -> most recent waiting cohort slot for O(1) coalescing.
  private readonly coalesceSlotBySD = new Int32Array(MAX_STATIONS * MAX_STATIONS);
  private readonly overflowBySD = new Uint32Array(MAX_STATIONS * MAX_STATIONS);
  private overflowTotal = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.active.fill(0);
    this.nextInNode.fill(-1);
    this.prevInNode.fill(-1);
    this.headAgentByStation.fill(-1);
    this.tailAgentByStation.fill(-1);
    this.headAgentByVehicle.fill(-1);
    this.tailAgentByVehicle.fill(-1);
    this.coalesceSlotBySD.fill(-1);
    this.overflowBySD.fill(0);

    for (let i = 0; i < MAX_AGENTS; i++) {
      this.freeListStack[i] = MAX_AGENTS - 1 - i;
    }
    this.freeTop = MAX_AGENTS;
    this.activeCount = 0;
    this.overflowTotal = 0;
  }

  getActiveSlotCount(): number {
    return this.activeCount;
  }

  getPoolUtilization(): number {
    return this.activeCount / MAX_AGENTS;
  }

  getOverflowCount(): number {
    return this.overflowTotal;
  }

  private allocSlot(): number {
    if (this.freeTop <= 0) {
      return -1;
    }
    this.freeTop -= 1;
    const slot = this.freeListStack[this.freeTop];
    this.activeCount += 1;
    return slot;
  }

  freeSlot(slot: number): void {
    if (this.active[slot] === 0) {
      return;
    }
    this.active[slot] = 0;
    this.passengerCount[slot] = 0;
    this.nextInNode[slot] = -1;
    this.prevInNode[slot] = -1;
    this.alightStationId[slot] = UNREACHABLE_ID;
    this.freeListStack[this.freeTop] = slot;
    this.freeTop += 1;
    this.activeCount -= 1;
  }

  /**
   * Spawns a new cohort at originStationId destined for destStationId, or coalesces
   * into an active waiting cohort for (origin, dest) when pool utilization exceeds 70%.
   * Returns the actual passenger delta added to the station queue (0 if deferred to overflow).
   */
  spawnOrCoalesceAtStation(
    originStationId: number,
    destStationId: number,
    count: number,
    simTimeSec: number,
  ): number {
    if (count <= 0 || originStationId === destStationId) {
      return 0;
    }

    const sdIdx = originStationId * MAX_STATIONS + destStationId;
    const shouldCoalesce = this.activeCount / MAX_AGENTS > COALESCE_POOL_THRESHOLD || this.freeTop === 0;

    if (shouldCoalesce) {
      const existing = this.coalesceSlotBySD[sdIdx];
      if (
        existing !== -1 &&
        this.active[existing] === 1 &&
        this.currentNodeId[existing] === originStationId &&
        this.destStationId[existing] === destStationId &&
        this.passengerCount[existing] + count <= MAX_COHORT_PASSENGERS
      ) {
        this.mergeFreshPassengersIntoCohort(existing, count, simTimeSec);
        return count;
      }
    }

    let remaining = count;
    let addedToQueue = 0;

    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_COHORT_PASSENGERS);
      const slot = this.allocSlot();
      if (slot === -1) {
        // Pool at 100% saturation: try merging into existing matching waiting cohort at this station.
        const fallback = this.findWaitingCohortAtStation(originStationId, destStationId, chunk);
        if (fallback !== -1) {
          this.mergeFreshPassengersIntoCohort(fallback, chunk, simTimeSec);
          addedToQueue += chunk;
        } else {
          this.overflowBySD[sdIdx] += remaining;
          this.overflowTotal += remaining;
        }
        break;
      }

      this.originStationId[slot] = originStationId;
      this.destStationId[slot] = destStationId;
      this.alightStationId[slot] = UNREACHABLE_ID;
      this.waitTimer[slot] = 0;
      this.tripStartTime[slot] = simTimeSec;
      this.passengerCount[slot] = chunk;
      this.enqueueAtStation(slot, originStationId, simTimeSec);

      remaining -= chunk;
      addedToQueue += chunk;
    }

    return addedToQueue;
  }

  /** Flushes any overflow riders once slots open below 100% pool capacity. */
  drainOverflowForStation(stationId: number, stationCount: number, simTimeSec: number): number {
    if (this.overflowTotal === 0 || this.freeTop === 0) {
      return 0;
    }
    let drained = 0;
    const base = stationId * MAX_STATIONS;
    for (let dest = 0; dest < stationCount; dest++) {
      const qty = this.overflowBySD[base + dest];
      if (qty === 0) {
        continue;
      }
      this.overflowBySD[base + dest] = 0;
      this.overflowTotal -= qty;
      drained += this.spawnOrCoalesceAtStation(stationId, dest, qty, simTimeSec);
      if (this.freeTop === 0) {
        break;
      }
    }
    return drained;
  }

  enqueueAtStation(slot: number, stationId: number, simTimeSec: number): void {
    this.active[slot] = 1;
    this.currentNodeId[slot] = stationId;
    this.alightStationId[slot] = UNREACHABLE_ID;
    this.queueJoinTime[slot] = simTimeSec;

    const tail = this.tailAgentByStation[stationId];
    this.prevInNode[slot] = tail;
    this.nextInNode[slot] = -1;
    if (tail !== -1) {
      this.nextInNode[tail] = slot;
    } else {
      this.headAgentByStation[stationId] = slot;
    }
    this.tailAgentByStation[stationId] = slot;

    const sdIdx = stationId * MAX_STATIONS + this.destStationId[slot];
    this.coalesceSlotBySD[sdIdx] = slot;
  }

  unlinkFromStation(slot: number, stationId: number, simTimeSec: number): void {
    this.waitTimer[slot] += Math.max(0, simTimeSec - this.queueJoinTime[slot]);
    this.queueJoinTime[slot] = simTimeSec;
    this.active[slot] = 2; // In transit until enqueueOnVehicle or freeSlot updates state.

    const prev = this.prevInNode[slot];
    const next = this.nextInNode[slot];
    if (prev !== -1) {
      this.nextInNode[prev] = next;
    } else {
      this.headAgentByStation[stationId] = next;
    }
    if (next !== -1) {
      this.prevInNode[next] = prev;
    } else {
      this.tailAgentByStation[stationId] = prev;
    }

    this.prevInNode[slot] = -1;
    this.nextInNode[slot] = -1;

    const sdIdx = stationId * MAX_STATIONS + this.destStationId[slot];
    if (this.coalesceSlotBySD[sdIdx] === slot) {
      this.coalesceSlotBySD[sdIdx] =
        prev !== -1 && this.destStationId[prev] === this.destStationId[slot] ? prev : -1;
    }
  }

  enqueueOnVehicle(slot: number, vehicleId: number, alightStationId: number): void {
    this.active[slot] = 2;
    this.currentNodeId[slot] = vehicleId;
    this.alightStationId[slot] = alightStationId;

    const tail = this.tailAgentByVehicle[vehicleId];
    this.prevInNode[slot] = tail;
    this.nextInNode[slot] = -1;
    if (tail !== -1) {
      this.nextInNode[tail] = slot;
    } else {
      this.headAgentByVehicle[vehicleId] = slot;
    }
    this.tailAgentByVehicle[vehicleId] = slot;
  }

  unlinkFromVehicle(slot: number, vehicleId: number): void {
    const prev = this.prevInNode[slot];
    const next = this.nextInNode[slot];
    if (prev !== -1) {
      this.nextInNode[prev] = next;
    } else {
      this.headAgentByVehicle[vehicleId] = next;
    }
    if (next !== -1) {
      this.prevInNode[next] = prev;
    } else {
      this.tailAgentByVehicle[vehicleId] = prev;
    }
    this.prevInNode[slot] = -1;
    this.nextInNode[slot] = -1;
  }

  /**
   * Splits `boardCount` riders off `waitingSlot` onto `vehicleId`.
   * If zero free slots remain (100% pool full), returns -1 and leaves `waitingSlot` intact.
   */
  splitForVehicle(
    waitingSlot: number,
    boardCount: number,
    vehicleId: number,
    alightStationId: number,
    simTimeSec: number,
  ): number {
    const existingCount = this.passengerCount[waitingSlot];
    if (boardCount <= 0 || boardCount >= existingCount) {
      return -1;
    }

    const splitSlot = this.allocSlot();
    if (splitSlot === -1) {
      return -1;
    }

    const accumulatedWait =
      this.waitTimer[waitingSlot] + Math.max(0, simTimeSec - this.queueJoinTime[waitingSlot]);
    this.passengerCount[waitingSlot] = existingCount - boardCount;

    this.passengerCount[splitSlot] = boardCount;
    this.originStationId[splitSlot] = this.originStationId[waitingSlot];
    this.destStationId[splitSlot] = this.destStationId[waitingSlot];
    this.waitTimer[splitSlot] = accumulatedWait;
    this.tripStartTime[splitSlot] = this.tripStartTime[waitingSlot];
    this.queueJoinTime[splitSlot] = simTimeSec;
    this.enqueueOnVehicle(splitSlot, vehicleId, alightStationId);
    return splitSlot;
  }

  getEffectiveWaitSeconds(slot: number, simTimeSec: number): number {
    if (this.active[slot] === 1) {
      return this.waitTimer[slot] + Math.max(0, simTimeSec - this.queueJoinTime[slot]);
    }
    return this.waitTimer[slot];
  }

  private mergeFreshPassengersIntoCohort(slot: number, addCount: number, simTimeSec: number): void {
    const existing = this.passengerCount[slot];
    const total = existing + addCount;
    const elapsedWait = this.waitTimer[slot] + Math.max(0, simTimeSec - this.queueJoinTime[slot]);

    // Preserve passenger-weighted average wait and trip start timestamps.
    this.waitTimer[slot] = (elapsedWait * existing) / total;
    this.tripStartTime[slot] = (this.tripStartTime[slot] * existing + simTimeSec * addCount) / total;
    this.queueJoinTime[slot] = simTimeSec;
    this.passengerCount[slot] = total;
  }

  private findWaitingCohortAtStation(stationId: number, destStationId: number, addCount: number): number {
    let curr = this.tailAgentByStation[stationId];
    let steps = 0;
    while (curr !== -1 && steps < 64) {
      if (
        this.destStationId[curr] === destStationId &&
        this.passengerCount[curr] + addCount <= MAX_COHORT_PASSENGERS
      ) {
        return curr;
      }
      curr = this.prevInNode[curr];
      steps += 1;
    }
    return -1;
  }
}
