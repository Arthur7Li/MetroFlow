import { describe, expect, it } from 'vitest';
import { MAX_AGENTS, UNREACHABLE_ID } from '../../src/core/contracts';
import { AgentStoreSoA } from '../../src/core/stores/agents';

describe('AgentStoreSoA weighted cohorts and intrusive lists', () => {
  it('allocates O(1) slots, enforces FIFO station order, and recycles freed slots', () => {
    const store = new AgentStoreSoA();

    expect(store.spawnOrCoalesceAtStation(0, 2, 10, 100)).toBe(10);
    expect(store.spawnOrCoalesceAtStation(0, 3, 15, 110)).toBe(15);
    expect(store.getActiveSlotCount()).toBe(2);

    const first = store.headAgentByStation[0];
    const second = store.nextInNode[first];
    expect(first).not.toBe(-1);
    expect(second).not.toBe(-1);
    expect(store.passengerCount[first]).toBe(10);
    expect(store.passengerCount[second]).toBe(15);
    expect(store.tailAgentByStation[0]).toBe(second);

    // Move first cohort onto vehicle 7; second becomes new FIFO head.
    store.unlinkFromStation(first, 0, 130);
    expect(store.getEffectiveWaitSeconds(first, 130)).toBe(30);
    expect(store.headAgentByStation[0]).toBe(second);

    store.enqueueOnVehicle(first, 7, 2);
    expect(store.headAgentByVehicle[7]).toBe(first);
    expect(store.alightStationId[first]).toBe(2);

    store.unlinkFromVehicle(first, 7);
    store.freeSlot(first);
    expect(store.headAgentByVehicle[7]).toBe(-1);
    expect(store.alightStationId[first]).toBe(UNREACHABLE_ID);
    expect(store.getActiveSlotCount()).toBe(1);
  });

  it('coalesces identical (origin, dest) spawns above 70% pool utilization with weighted timers', () => {
    const store = new AgentStoreSoA();

    // Fill 70,001 slots (70.001% > 70% threshold) across stations 10 -> 11.
    for (let i = 0; i < 70_001; i++) {
      store.spawnOrCoalesceAtStation(10 + (i % 50), 100 + (i % 50), 1, 0);
    }
    expect(store.getPoolUtilization()).toBeGreaterThan(0.7);

    // Spawn twice at (0, 1) at different timestamps -> must coalesce into a single cohort slot.
    const slotsBefore = store.getActiveSlotCount();
    store.spawnOrCoalesceAtStation(0, 1, 20, 100);
    expect(store.getActiveSlotCount()).toBe(slotsBefore + 1);

    const cohortSlot = store.tailAgentByStation[0];
    store.spawnOrCoalesceAtStation(0, 1, 10, 130);
    expect(store.getActiveSlotCount()).toBe(slotsBefore + 1);
    expect(store.passengerCount[cohortSlot]).toBe(30);

    // At t=130: previous 20 waited 30s, new 10 waited 0s -> weighted wait = (20*30 + 10*0)/30 = 20s.
    expect(store.getEffectiveWaitSeconds(cohortSlot, 130)).toBeCloseTo(20, 4);
    expect(store.tripStartTime[cohortSlot]).toBeCloseTo((100 * 20 + 130 * 10) / 30, 4);
  });

  it('splits partial boarding cohorts and retains station cohort intact at 100% saturation', () => {
    const store = new AgentStoreSoA();
    store.spawnOrCoalesceAtStation(0, 5, 40, 200);
    const waitingSlot = store.headAgentByStation[0];

    const splitSlot = store.splitForVehicle(waitingSlot, 15, 3, 5, 220);
    expect(splitSlot).not.toBe(-1);
    expect(store.passengerCount[waitingSlot]).toBe(25);
    expect(store.passengerCount[splitSlot]).toBe(15);
    expect(store.getEffectiveWaitSeconds(splitSlot, 220)).toBe(20);
    expect(store.headAgentByVehicle[3]).toBe(splitSlot);

    // Exhaust remaining pool slots across distinct (origin, dest) pairs so >70% coalescing does not short-circuit.
    let pairSeq = 0;
    while (store.getActiveSlotCount() < MAX_AGENTS) {
      const origin = 1 + (pairSeq % 400);
      const dest = 1 + ((origin + 1 + Math.floor(pairSeq / 400)) % 400);
      store.spawnOrCoalesceAtStation(origin, dest, 1, 220);
      pairSeq += 1;
    }
    expect(store.getActiveSlotCount()).toBe(MAX_AGENTS);

    // Attempt split when 0 slots remain: must return -1 and preserve waitingSlot intact.
    const failedSplit = store.splitForVehicle(waitingSlot, 10, 4, 5, 230);
    expect(failedSplit).toBe(-1);
    expect(store.passengerCount[waitingSlot]).toBe(25);
    expect(store.active[waitingSlot]).toBe(1);

    // Spawning fresh riders at 100% saturation merges safely into matching station cohort without dropping.
    const merged = store.spawnOrCoalesceAtStation(0, 5, 5, 240);
    expect(merged).toBe(5);
    expect(store.passengerCount[waitingSlot]).toBe(30);
    expect(store.getOverflowCount()).toBe(0);
  });
});
