import { TRANSIT_MODES } from '../../config/modes';
import { ALL_DOOR_ARC_DWELL_MULT, CONCOURSE_UPGRADES } from '../../config/upgrades';
import { MAX_STATIONS, UNREACHABLE_ID } from '../contracts';
import {
  computeLineRoundTripSec,
  computeSegmentEffectiveCruiseMps,
  type TransitLineRecord,
  type TransitLineStore,
} from '../stores/lines';
import type { StationStore } from '../stores/stations';

const INTERMEDIATE_DWELL_SEC = 3.0;
const ALT_COST_RATIO_LIMIT = 1.1;
const SIGNIFICANT_SHIFT_THRESHOLD = 0.15;

export interface RoutingTableSet {
  nextLineTable: Uint16Array;
  alightStationTable: Uint16Array;
  nextLineAltTable: Uint16Array;
  alightStationAltTable: Uint16Array;
  expectedCostTable: Float32Array;
}

interface RouteSegmentEdge {
  toStationId: number;
  lineId: number;
  lineCapacity: number;
  legCostMin: number;
}

interface HeapNode {
  stationId: number;
  incomingLineId: number;
  firstLineId: number;
  firstAlightStationId: number;
  costMin: number;
}

function createTableSet(): RoutingTableSet {
  const size = MAX_STATIONS * MAX_STATIONS;
  const nextLineTable = new Uint16Array(size);
  const alightStationTable = new Uint16Array(size);
  const nextLineAltTable = new Uint16Array(size);
  const alightStationAltTable = new Uint16Array(size);
  const expectedCostTable = new Float32Array(size);

  nextLineTable.fill(UNREACHABLE_ID);
  alightStationTable.fill(UNREACHABLE_ID);
  nextLineAltTable.fill(UNREACHABLE_ID);
  alightStationAltTable.fill(UNREACHABLE_ID);
  expectedCostTable.fill(Number.POSITIVE_INFINITY);

  return {
    nextLineTable,
    alightStationTable,
    nextLineAltTable,
    alightStationAltTable,
    expectedCostTable,
  };
}

class MinHeap {
  private readonly items: HeapNode[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }

  push(node: HeapNode): void {
    const items = this.items;
    let i = items.length;
    items.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].costMin <= node.costMin) {
        break;
      }
      items[i] = items[parent];
      i = parent;
    }
    items[i] = node;
  }

  pop(): HeapNode | undefined {
    const items = this.items;
    const len = items.length;
    if (len === 0) {
      return undefined;
    }
    const top = items[0];
    const last = items.pop()!;
    if (len > 1) {
      let i = 0;
      const half = (len - 1) >> 1;
      while (i < half) {
        let child = (i << 1) + 1;
        const right = child + 1;
        if (right < len - 1 && items[right].costMin < items[child].costMin) {
          child = right;
        }
        if (last.costMin <= items[child].costMin) {
          break;
        }
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}

export function computeLineHeadwaySec(
  line: TransitLineRecord,
  weatherBusMult: number,
  weatherRailMult: number,
): number {
  const spec = TRANSIT_MODES[line.mode];
  const roundTripSec = computeLineRoundTripSec(line, weatherBusMult, weatherRailMult);
  const fleet = Math.max(1, line.vehicleIds.length);
  return Math.max(spec.minSafeHeadwaySec, roundTripSec / fleet);
}

/**
 * Time-sliced Sparse Route-Segment Dijkstra all-pairs pathfinder.
 * Computes up to 32 origin stations per 30Hz tick into double-buffered shadow tables,
 * then atomically swaps front <-> back tables on completion.
 */
export class RouteSegmentPathfinder {
  private front: RoutingTableSet = createTableSet();
  private back: RoutingTableSet = createTableSet();

  private adjByOrigin: RouteSegmentEdge[][] = Array.from({ length: MAX_STATIONS }, () => []);
  private lineCapacityMap = new Map<number, number>();

  private rebuildQueue: number[] = [];
  private rebuildCursor = 0;
  private rebuildStationCount = 0;
  private rebuildActive = false;

  private lastBuiltHeadways = new Map<number, number>();
  private lastBuiltWeatherBus = 1.0;
  private lastBuiltWeatherRail = 1.0;

  private readonly heap = new MinHeap();
  private readonly bestCost = new Float32Array(MAX_STATIONS);
  private readonly bestLine = new Uint16Array(MAX_STATIONS);
  private readonly bestAlight = new Uint16Array(MAX_STATIONS);
  private readonly altCost = new Float32Array(MAX_STATIONS);
  private readonly altLine = new Uint16Array(MAX_STATIONS);
  private readonly altAlight = new Uint16Array(MAX_STATIONS);

  isRebuildInProgress(): boolean {
    return this.rebuildActive;
  }

  getNextLine(originStationId: number, destStationId: number): number {
    return this.front.nextLineTable[originStationId * MAX_STATIONS + destStationId];
  }

  getAlightStation(originStationId: number, destStationId: number): number {
    return this.front.alightStationTable[originStationId * MAX_STATIONS + destStationId];
  }

  getAltLine(originStationId: number, destStationId: number): number {
    return this.front.nextLineAltTable[originStationId * MAX_STATIONS + destStationId];
  }

  getAltAlightStation(originStationId: number, destStationId: number): number {
    return this.front.alightStationAltTable[originStationId * MAX_STATIONS + destStationId];
  }

  getExpectedCost(originStationId: number, destStationId: number): number {
    return this.front.expectedCostTable[originStationId * MAX_STATIONS + destStationId];
  }

  getLineCapacity(lineId: number): number {
    return this.lineCapacityMap.get(lineId) ?? 50;
  }

  checkSignificantShift(
    lineStore: TransitLineStore,
    weatherBusMult: number,
    weatherRailMult: number,
  ): boolean {
    if (
      Math.abs(weatherBusMult - this.lastBuiltWeatherBus) >= SIGNIFICANT_SHIFT_THRESHOLD ||
      Math.abs(weatherRailMult - this.lastBuiltWeatherRail) >= SIGNIFICANT_SHIFT_THRESHOLD
    ) {
      return true;
    }
    for (const line of lineStore.lines) {
      const prevH = this.lastBuiltHeadways.get(line.lineId);
      if (prevH === undefined) {
        return true;
      }
      const nextH = computeLineHeadwaySec(line, weatherBusMult, weatherRailMult);
      if (Math.abs(nextH - prevH) / Math.max(1, prevH) >= SIGNIFICANT_SHIFT_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  /**
   * Queues a time-sliced shadow rebuild across all active stations, scheduling
   * priorityStations (stations along newly edited lines) in the first slice.
   */
  scheduleRebuild(
    stationStore: StationStore,
    lineStore: TransitLineStore,
    weatherBusMult = 1.0,
    weatherRailMult = 1.0,
    priorityStationIds: number[] = [],
  ): void {
    const stationCount = stationStore.stations.length;
    this.rebuildStationCount = stationCount;
    this.rebuildCursor = 0;
    this.rebuildActive = stationCount > 0;

    // Reset back buffer before writing slices.
    this.back.nextLineTable.fill(UNREACHABLE_ID);
    this.back.alightStationTable.fill(UNREACHABLE_ID);
    this.back.nextLineAltTable.fill(UNREACHABLE_ID);
    this.back.alightStationAltTable.fill(UNREACHABLE_ID);
    this.back.expectedCostTable.fill(Number.POSITIVE_INFINITY);

    this.buildSegmentGraph(lineStore, weatherBusMult, weatherRailMult, stationCount);

    const seen = new Uint8Array(stationCount);
    const ordered: number[] = [];
    for (const sid of priorityStationIds) {
      if (sid >= 0 && sid < stationCount && seen[sid] === 0) {
        seen[sid] = 1;
        ordered.push(sid);
      }
    }
    for (let s = 0; s < stationCount; s++) {
      if (seen[s] === 0) {
        ordered.push(s);
      }
    }
    this.rebuildQueue = ordered;
  }

  /**
   * Advances up to `maxOriginsPerTick` (default 32) origin station Dijkstra runs in the shadow
   * back-buffer. Swaps front <-> back atomically when all origins finish; returns true on swap.
   */
  stepRebuild(stationStore: StationStore, maxOriginsPerTick = 32): boolean {
    if (!this.rebuildActive) {
      return false;
    }

    const end = Math.min(this.rebuildQueue.length, this.rebuildCursor + maxOriginsPerTick);
    for (let idx = this.rebuildCursor; idx < end; idx++) {
      const origin = this.rebuildQueue[idx];
      this.computeOriginRoutes(origin, stationStore, this.rebuildStationCount);
    }
    this.rebuildCursor = end;

    if (this.rebuildCursor >= this.rebuildQueue.length) {
      const completed = this.back;
      this.back = this.front;
      this.front = completed;
      this.rebuildActive = false;
      return true;
    }

    return false;
  }

  /** Synchronously completes any active rebuild (useful in deterministic unit tests). */
  flushRebuild(stationStore: StationStore): void {
    while (this.rebuildActive) {
      this.stepRebuild(stationStore, this.rebuildQueue.length || 32);
    }
  }

  private buildSegmentGraph(
    lineStore: TransitLineStore,
    weatherBusMult: number,
    weatherRailMult: number,
    stationCount: number,
  ): void {
    for (let i = 0; i < stationCount; i++) {
      this.adjByOrigin[i].length = 0;
    }
    this.lineCapacityMap.clear();
    this.lastBuiltHeadways.clear();
    this.lastBuiltWeatherBus = weatherBusMult;
    this.lastBuiltWeatherRail = weatherRailMult;

    for (const line of lineStore.lines) {
      if (line.segments.length === 0 || line.vehicleIds.length === 0) {
        continue;
      }

      const spec = TRANSIT_MODES[line.mode];
      const dwellSec = INTERMEDIATE_DWELL_SEC * (line.allDoorArc ? ALL_DOOR_ARC_DWELL_MULT : 1.0);
      const headwaySec = computeLineHeadwaySec(line, weatherBusMult, weatherRailMult);
      const waitMin = headwaySec / 2 / 60;
      const lineCap = spec.capacityPerUnit * line.consistCars;

      this.lineCapacityMap.set(line.lineId, lineCap);
      this.lastBuiltHeadways.set(line.lineId, headwaySec);

      const segMinutes: number[] = [];
      for (const seg of line.segments) {
        const speedMps = computeSegmentEffectiveCruiseMps(
          line,
          seg,
          weatherBusMult,
          weatherRailMult,
        );
        segMinutes.push(seg.lengthMeters / speedMps / 60);
      }

      const stops = line.stationIds;
      const m = stops.length;
      for (let i = 0; i < m; i++) {
        const u = stops[i];
        // Forward direction along line.
        let forwardRideMin = 0;
        for (let j = i + 1; j < m; j++) {
          forwardRideMin += segMinutes[j - 1];
          if (j > i + 1) {
            forwardRideMin += dwellSec / 60;
          }
          this.adjByOrigin[u].push({
            toStationId: stops[j],
            lineId: line.lineId,
            lineCapacity: lineCap,
            legCostMin: forwardRideMin + waitMin,
          });
        }

        // Reverse direction along line.
        let reverseRideMin = 0;
        for (let j = i - 1; j >= 0; j--) {
          reverseRideMin += segMinutes[j];
          if (j < i - 1) {
            reverseRideMin += dwellSec / 60;
          }
          this.adjByOrigin[u].push({
            toStationId: stops[j],
            lineId: line.lineId,
            lineCapacity: lineCap,
            legCostMin: reverseRideMin + waitMin,
          });
        }
      }
    }
  }

  private computeOriginRoutes(originId: number, stationStore: StationStore, stationCount: number): void {
    const bestCost = this.bestCost;
    const bestLine = this.bestLine;
    const bestAlight = this.bestAlight;
    const altCost = this.altCost;
    const altLine = this.altLine;
    const altAlight = this.altAlight;

    for (let i = 0; i < stationCount; i++) {
      bestCost[i] = Number.POSITIVE_INFINITY;
      bestLine[i] = UNREACHABLE_ID;
      bestAlight[i] = UNREACHABLE_ID;
      altCost[i] = Number.POSITIVE_INFINITY;
      altLine[i] = UNREACHABLE_ID;
      altAlight[i] = UNREACHABLE_ID;
    }

    bestCost[originId] = 0;
    const heap = this.heap;
    heap.clear();

    // Hop 0 from origin: delta_transfer = 0 (no concourse penalty on initial boarding).
    const initialEdges = this.adjByOrigin[originId];
    for (let i = 0; i < initialEdges.length; i++) {
      const edge = initialEdges[i];
      const nextStation = edge.toStationId;
      if (nextStation === originId) {
        continue;
      }
      this.relaxTarget(
        nextStation,
        edge.lineId,
        edge.lineId,
        nextStation,
        edge.legCostMin,
        heap,
      );
    }

    while (heap.size > 0) {
      const cur = heap.pop()!;
      const u = cur.stationId;

      // Prune entries worse than both best and alternate bounds for u.
      if (cur.costMin > altCost[u] && cur.costMin > bestCost[u]) {
        continue;
      }

      const concourseTier = stationStore.getById(u)?.concourseTier ?? 0;
      const transferPenaltyMin = CONCOURSE_UPGRADES[concourseTier].transferPenaltySec / 60;
      const edges = this.adjByOrigin[u];

      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        // Route-Segment edges span arbitrary distances along a single line, so staying on
        // incomingLineId is always strictly dominated by taking the direct edge from u's parent.
        if (edge.lineId === cur.incomingLineId || edge.toStationId === originId) {
          continue;
        }
        const totalMin = cur.costMin + transferPenaltyMin + edge.legCostMin;
        this.relaxTarget(
          edge.toStationId,
          edge.lineId,
          cur.firstLineId,
          cur.firstAlightStationId,
          totalMin,
          heap,
        );
      }
    }

    const rowBase = originId * MAX_STATIONS;
    for (let d = 0; d < stationCount; d++) {
      this.back.expectedCostTable[rowBase + d] = bestCost[d];
      this.back.nextLineTable[rowBase + d] = bestLine[d];
      this.back.alightStationTable[rowBase + d] = bestAlight[d];

      if (altLine[d] !== UNREACHABLE_ID && altCost[d] <= bestCost[d] * ALT_COST_RATIO_LIMIT) {
        this.back.nextLineAltTable[rowBase + d] = altLine[d];
        this.back.alightStationAltTable[rowBase + d] = altAlight[d];
      } else {
        this.back.nextLineAltTable[rowBase + d] = UNREACHABLE_ID;
        this.back.alightStationAltTable[rowBase + d] = UNREACHABLE_ID;
      }
    }
  }

  private relaxTarget(
    targetStation: number,
    incomingLineId: number,
    firstLineId: number,
    firstAlightStationId: number,
    costMin: number,
    heap: MinHeap,
  ): void {
    const curBest = this.bestCost[targetStation];
    const curBestLine = this.bestLine[targetStation];

    if (costMin < curBest) {
      if (curBestLine !== UNREACHABLE_ID && curBestLine !== firstLineId) {
        this.altCost[targetStation] = curBest;
        this.altLine[targetStation] = curBestLine;
        this.altAlight[targetStation] = this.bestAlight[targetStation];
      }
      this.bestCost[targetStation] = costMin;
      this.bestLine[targetStation] = firstLineId;
      this.bestAlight[targetStation] = firstAlightStationId;
      heap.push({
        stationId: targetStation,
        incomingLineId,
        firstLineId,
        firstAlightStationId,
        costMin,
      });
      return;
    }

    if (firstLineId !== curBestLine && costMin < this.altCost[targetStation]) {
      this.altCost[targetStation] = costMin;
      this.altLine[targetStation] = firstLineId;
      this.altAlight[targetStation] = firstAlightStationId;
      heap.push({
        stationId: targetStation,
        incomingLineId,
        firstLineId,
        firstAlightStationId,
        costMin,
      });
    }
  }
}
