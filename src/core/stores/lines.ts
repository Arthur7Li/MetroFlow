import type { TransitModeId } from '../../cities/types';
import { TRANSIT_MODES } from '../../config/modes';
import {
  RIVER_CROSSING_SPECS,
  TRAM_NO_TSP_SPEED_MULT,
  isModeAllowedOnCrossing,
} from '../../config/upgrades';
import type {
  AutoHeadwayPolicy,
  CrossingType,
  RouteWaypointInput,
  TopologyLine,
  TopologyLineSegment,
} from '../contracts';
import type { StationStore } from './stations';

const LUT_SAMPLES = 32;
const PARALLEL_LANE_SPACING_WORLD = 8;

export interface BezierSegment {
  fromStationId: number;
  toStationId: number;
  p0x: number;
  p0y: number;
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  p3x: number;
  p3y: number;
  crossingType: CrossingType;
  parallelLaneOffset: number;
  lengthMeters: number;
  lutX: Float32Array;
  lutY: Float32Array;
  lutBearing: Float32Array;
  lutDistMeters: Float32Array;
}

export interface TransitLineRecord {
  lineId: number;
  name: string;
  color: string;
  mode: TransitModeId;
  modeTier: 1 | 2 | 3 | 4 | 5;
  consistCars: 1 | 2 | 3 | 4;
  stationIds: number[];
  segmentCrossings: CrossingType[];
  segments: BezierSegment[];
  totalLengthKm: number;
  trackCapExCad: number;
  investedCapExCad: number;
  vehicleIds: number[];
  allDoorArc: boolean;
  tspEnabled: boolean;
  policy: AutoHeadwayPolicy;
}

export function computeParallelLaneOffset(laneIdx: number, totalLanes: number): number {
  if (totalLanes <= 1) {
    return 0;
  }
  return (laneIdx - (totalLanes - 1) / 2) * PARALLEL_LANE_SPACING_WORLD;
}

export function computeSegmentEffectiveCruiseMps(
  line: Pick<TransitLineRecord, 'mode' | 'tspEnabled'>,
  seg: Pick<BezierSegment, 'crossingType'>,
  weatherBusMult = 1.0,
  weatherRailMult = 1.0,
): number {
  const spec = TRANSIT_MODES[line.mode];
  const crossingSpec = RIVER_CROSSING_SPECS[seg.crossingType];
  let baseKmh = spec.cruiseSpeedKmh;
  if (crossingSpec.maxSpeedKmhCap !== null) {
    baseKmh = Math.min(baseKmh, crossingSpec.maxSpeedKmhCap);
  }
  let speedMps = (baseKmh / 3.6) * crossingSpec.slopeSpeedMult;
  if (line.mode === 'LRT_LOW_FLOOR' && !line.tspEnabled && seg.crossingType !== 'TUNNEL') {
    speedMps *= TRAM_NO_TSP_SPEED_MULT;
  }
  const weatherMult =
    crossingSpec.weatherImmune || spec.gradeSeparated
      ? weatherRailMult
      : 1 - spec.weatherVulnerability * (1 - weatherBusMult);
  return Math.max(1, speedMps * Math.max(0.2, weatherMult));
}

function evalCubic(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3;
}

function evalCubicDeriv(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * (c1 - p0) + 6 * u * t * (c2 - c1) + 3 * t * t * (p3 - c2);
}

function unitTangent(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return { x: 1, y: 0 };
  }
  return { x: dx / len, y: dy / len };
}

function canonicalSegmentNormal(
  fromId: number,
  fromPt: { x: number; y: number },
  toId: number,
  toPt: { x: number; y: number },
): { nx: number; ny: number } {
  // Canonicalize vector min(id) -> max(id) so opposing directions offset onto distinct parallel lanes.
  const a = fromId <= toId ? fromPt : toPt;
  const b = fromId <= toId ? toPt : fromPt;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    return { nx: 0, ny: 0 };
  }
  return { nx: -dy / len, ny: dx / len };
}

function buildBezierSegment(
  fromId: number,
  toId: number,
  pts: Array<{ x: number; y: number }>,
  segIdx: number,
  crossingType: CrossingType,
  parallelLaneOffset: number,
  metersPerWorldUnit: number,
): BezierSegment {
  const baseP0 = pts[segIdx];
  const baseP3 = pts[segIdx + 1];
  const prev = pts[segIdx - 1];
  const next = pts[segIdx + 2];

  const { nx, ny } = canonicalSegmentNormal(fromId, baseP0, toId, baseP3);
  const shiftX = nx * parallelLaneOffset;
  const shiftY = ny * parallelLaneOffset;

  const p0 = { x: baseP0.x + shiftX, y: baseP0.y + shiftY };
  const p3 = { x: baseP3.x + shiftX, y: baseP3.y + shiftY };

  const chordLen = Math.hypot(baseP3.x - baseP0.x, baseP3.y - baseP0.y);
  const handleLen = chordLen * 0.25;

  const tStart = prev
    ? unitTangent(baseP3.x - prev.x, baseP3.y - prev.y)
    : unitTangent(baseP3.x - baseP0.x, baseP3.y - baseP0.y);
  const tEnd = next
    ? unitTangent(next.x - baseP0.x, next.y - baseP0.y)
    : unitTangent(baseP3.x - baseP0.x, baseP3.y - baseP0.y);

  const cp1x = p0.x + tStart.x * handleLen;
  const cp1y = p0.y + tStart.y * handleLen;
  const cp2x = p3.x - tEnd.x * handleLen;
  const cp2y = p3.y - tEnd.y * handleLen;

  const count = LUT_SAMPLES + 1;
  const lutX = new Float32Array(count);
  const lutY = new Float32Array(count);
  const lutBearing = new Float32Array(count);
  const lutDistMeters = new Float32Array(count);

  let cumulativeM = 0;
  for (let i = 0; i <= LUT_SAMPLES; i++) {
    const t = i / LUT_SAMPLES;
    const x = evalCubic(p0.x, cp1x, cp2x, p3.x, t);
    const y = evalCubic(p0.y, cp1y, cp2y, p3.y, t);
    const dx = evalCubicDeriv(p0.x, cp1x, cp2x, p3.x, t);
    const dy = evalCubicDeriv(p0.y, cp1y, cp2y, p3.y, t);

    if (i > 0) {
      const segWorldDist = Math.hypot(x - lutX[i - 1], y - lutY[i - 1]);
      cumulativeM += segWorldDist * metersPerWorldUnit;
    }

    lutX[i] = x;
    lutY[i] = y;
    lutBearing[i] = Math.atan2(dy, dx);
    lutDistMeters[i] = cumulativeM;
  }

  return {
    fromStationId: fromId,
    toStationId: toId,
    p0x: p0.x,
    p0y: p0.y,
    cp1x,
    cp1y,
    cp2x,
    cp2y,
    p3x: p3.x,
    p3y: p3.y,
    crossingType,
    parallelLaneOffset,
    lengthMeters: Math.max(1, cumulativeM),
    lutX,
    lutY,
    lutBearing,
    lutDistMeters,
  };
}

export function sampleSegmentAtDistance(
  seg: BezierSegment,
  distanceMeters: number,
  direction: 1 | -1,
): { x: number; y: number; bearing: number } {
  const clamped = Math.max(0, Math.min(seg.lengthMeters, distanceMeters));
  const dists = seg.lutDistMeters;

  let lo = 0;
  let hi = LUT_SAMPLES;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (dists[mid] <= clamped) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const d0 = dists[lo];
  const d1 = dists[hi];
  const span = d1 - d0;
  const frac = span > 1e-5 ? (clamped - d0) / span : 0;

  const x = seg.lutX[lo] + (seg.lutX[hi] - seg.lutX[lo]) * frac;
  const y = seg.lutY[lo] + (seg.lutY[hi] - seg.lutY[lo]) * frac;
  let bearing = seg.lutBearing[lo];
  if (direction === -1) {
    bearing += Math.PI;
  }
  return { x, y, bearing };
}

export function computeTrackCapExCad(segments: readonly BezierSegment[], mode: TransitModeId): number {
  const spec = TRANSIT_MODES[mode];
  let weightedKm = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const mult = RIVER_CROSSING_SPECS[seg.crossingType].costMultiplier;
    weightedKm += (seg.lengthMeters / 1000) * mult;
  }
  return Math.round(weightedKm * spec.trackCapExPerKm);
}

export class TransitLineStore {
  readonly lines: TransitLineRecord[] = [];
  private nextLineId = 1;
  private topologyVersion = 1;

  reset(): void {
    this.lines.length = 0;
    this.nextLineId = 1;
    this.topologyVersion = 1;
  }

  getTopologyVersion(): number {
    return this.topologyVersion;
  }

  bumpTopologyVersion(): number {
    this.topologyVersion += 1;
    return this.topologyVersion;
  }

  getById(lineId: number): TransitLineRecord | undefined {
    return this.lines.find((l) => l.lineId === lineId);
  }

  private resolveWaypoints(
    waypoints: RouteWaypointInput[],
    mode: TransitModeId,
    stationStore: StationStore,
  ):
    | { resolved: Array<{ id: number; x: number; y: number; crossingType: CrossingType }> }
    | { error: string } {
    const resolved: Array<{ id: number; x: number; y: number; crossingType: CrossingType }> = [];

    for (const wp of waypoints) {
      const station = stationStore.resolveOrCreateStation(wp.x, wp.y, wp.stationId);
      if (!station) {
        return { error: 'Maximum station limit reached' };
      }
      const prev = resolved[resolved.length - 1];
      if (!prev || prev.id !== station.stationId) {
        const crossingType = prev ? (wp.crossingType ?? 'NONE') : 'NONE';
        if (prev && !isModeAllowedOnCrossing(mode, crossingType)) {
          return {
            error: `${TRANSIT_MODES[mode].name} cannot use ${RIVER_CROSSING_SPECS[crossingType].label}.`,
          };
        }
        resolved.push({
          id: station.stationId,
          x: station.x,
          y: station.y,
          crossingType,
        });
      }
    }

    if (resolved.length < 2) {
      return { error: 'A transit line requires at least two distinct stops' };
    }
    return { resolved };
  }

  private rebuildSegmentsForLine(
    line: TransitLineRecord,
    offsets: number[],
    stationStore: StationStore,
    worldUnitsPerKm: number,
  ): void {
    const metersPerWorldUnit = 1000 / worldUnitsPerKm;
    const pts = line.stationIds.map((id) => {
      const st = stationStore.getById(id);
      return st ? { x: st.x, y: st.y } : { x: 0, y: 0 };
    });

    const segments: BezierSegment[] = [];
    let totalMeters = 0;
    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const seg = buildBezierSegment(
        line.stationIds[i],
        line.stationIds[i + 1],
        pts,
        i,
        line.segmentCrossings[i] ?? 'NONE',
        offsets[i] ?? 0,
        metersPerWorldUnit,
      );
      segments.push(seg);
      totalMeters += seg.lengthMeters;
    }

    line.segments = segments;
    line.totalLengthKm = totalMeters / 1000;
  }

  recomputeParallelOffsets(stationStore: StationStore, worldUnitsPerKm = 100): void {
    const corridorGroups = new Map<
      string,
      Array<{ lineIdx: number; segIdx: number; lineId: number }>
    >();

    for (let lineIdx = 0; lineIdx < this.lines.length; lineIdx++) {
      const line = this.lines[lineIdx];
      for (let segIdx = 0; segIdx < line.stationIds.length - 1; segIdx++) {
        const u = line.stationIds[segIdx];
        const v = line.stationIds[segIdx + 1];
        const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
        let group = corridorGroups.get(key);
        if (!group) {
          group = [];
          corridorGroups.set(key, group);
        }
        group.push({ lineIdx, segIdx, lineId: line.lineId });
      }
    }

    const lineOffsets = this.lines.map((l) =>
      new Array<number>(Math.max(0, l.stationIds.length - 1)).fill(0),
    );
    for (const group of corridorGroups.values()) {
      group.sort((a, b) => (a.lineId !== b.lineId ? a.lineId - b.lineId : a.segIdx - b.segIdx));
      const total = group.length;
      for (let laneIdx = 0; laneIdx < total; laneIdx++) {
        const item = group[laneIdx];
        lineOffsets[item.lineIdx][item.segIdx] = computeParallelLaneOffset(laneIdx, total);
      }
    }

    for (let lineIdx = 0; lineIdx < this.lines.length; lineIdx++) {
      this.rebuildSegmentsForLine(
        this.lines[lineIdx],
        lineOffsets[lineIdx],
        stationStore,
        worldUnitsPerKm,
      );
    }
  }

  createLine(
    name: string,
    color: string,
    mode: TransitModeId,
    waypoints: RouteWaypointInput[],
    stationStore: StationStore,
    worldUnitsPerKm: number,
  ): { line: TransitLineRecord; trackCapExCad: number } | { error: string } {
    const res = this.resolveWaypoints(waypoints, mode, stationStore);
    if ('error' in res) {
      return res;
    }

    const spec = TRANSIT_MODES[mode];
    const line: TransitLineRecord = {
      lineId: this.nextLineId++,
      name: name.trim() || `Route ${this.nextLineId - 1}`,
      color,
      mode,
      modeTier: spec.tier,
      consistCars: 1,
      stationIds: res.resolved.map((s) => s.id),
      segmentCrossings: res.resolved.slice(1).map((s) => s.crossingType),
      segments: [],
      totalLengthKm: 0,
      trackCapExCad: 0,
      investedCapExCad: 0,
      vehicleIds: [],
      allDoorArc: false,
      tspEnabled: false,
      policy: { type: 'MANUAL' },
    };

    this.lines.push(line);
    this.recomputeParallelOffsets(stationStore, worldUnitsPerKm);

    const trackCapExCad = computeTrackCapExCad(line.segments, mode);
    line.trackCapExCad = trackCapExCad;
    line.investedCapExCad = trackCapExCad;
    this.bumpTopologyVersion();
    return { line, trackCapExCad };
  }

  deleteLine(
    lineId: number,
    stationStore: StationStore,
    worldUnitsPerKm = 100,
  ): TransitLineRecord | undefined {
    const idx = this.lines.findIndex((l) => l.lineId === lineId);
    if (idx === -1) {
      return undefined;
    }
    const [removed] = this.lines.splice(idx, 1);
    this.recomputeParallelOffsets(stationStore, worldUnitsPerKm);
    this.bumpTopologyVersion();
    return removed;
  }

  previewUpgradeCorridor(
    lineId: number,
    targetMode: TransitModeId,
  ):
    | {
        line: TransitLineRecord;
        oldTrackCapExCad: number;
        newTrackCapExCad: number;
        upgradedCrossings: CrossingType[];
      }
    | { error: string } {
    const line = this.getById(lineId);
    if (!line) {
      return { error: `Line ${lineId} not found` };
    }
    if (line.mode === targetMode) {
      return { error: 'Corridor is already operating this transit mode' };
    }

    const upgradedCrossings = line.segmentCrossings.map((crossing) => {
      if (isModeAllowedOnCrossing(targetMode, crossing)) {
        return crossing;
      }
      // Upgrade road-only bridges to dedicated transit bridges when rail corridor upgrades occur.
      return 'TRANSIT_BRIDGE' as CrossingType;
    });

    const spec = TRANSIT_MODES[targetMode];
    let weightedKm = 0;
    for (let i = 0; i < line.segments.length; i++) {
      const mult = RIVER_CROSSING_SPECS[upgradedCrossings[i] ?? 'NONE'].costMultiplier;
      weightedKm += (line.segments[i].lengthMeters / 1000) * mult;
    }
    const newTrackCapExCad = Math.round(weightedKm * spec.trackCapExPerKm);
    return {
      line,
      oldTrackCapExCad: line.trackCapExCad,
      newTrackCapExCad,
      upgradedCrossings,
    };
  }

  applyUpgradeCorridor(
    line: TransitLineRecord,
    targetMode: TransitModeId,
    newTrackCapExCad: number,
    upgradedCrossings: CrossingType[],
    stationStore: StationStore,
    worldUnitsPerKm = 100,
  ): void {
    const spec = TRANSIT_MODES[targetMode];
    line.mode = targetMode;
    line.modeTier = spec.tier;
    line.segmentCrossings = upgradedCrossings;
    line.trackCapExCad = newTrackCapExCad;
    if (targetMode !== 'LRT_LOW_FLOOR') {
      line.tspEnabled = false;
    }
    if (targetMode !== 'LRT_HIGH_FLOOR') {
      line.consistCars = 1;
    }
    this.recomputeParallelOffsets(stationStore, worldUnitsPerKm);
    this.bumpTopologyVersion();
  }

  editLineStops(
    lineId: number,
    waypoints: RouteWaypointInput[],
    stationStore: StationStore,
    worldUnitsPerKm = 100,
    canAffordDelta?: (deltaCad: number) => { ok: true } | { ok: false; error: string },
  ):
    | {
        line: TransitLineRecord;
        oldTrackCapExCad: number;
        newTrackCapExCad: number;
      }
    | { error: string } {
    const line = this.getById(lineId);
    if (!line) {
      return { error: `Line ${lineId} not found` };
    }
    const res = this.resolveWaypoints(waypoints, line.mode, stationStore);
    if ('error' in res) {
      return res;
    }

    const prevStationIds = [...line.stationIds];
    const prevCrossings = [...line.segmentCrossings];
    const oldTrackCapExCad = line.trackCapExCad;

    line.stationIds = res.resolved.map((s) => s.id);
    line.segmentCrossings = res.resolved.slice(1).map((s) => s.crossingType);
    this.recomputeParallelOffsets(stationStore, worldUnitsPerKm);
    const newTrackCapExCad = computeTrackCapExCad(line.segments, line.mode);

    if (canAffordDelta && newTrackCapExCad > oldTrackCapExCad) {
      const check = canAffordDelta(newTrackCapExCad - oldTrackCapExCad);
      if (!check.ok) {
        line.stationIds = prevStationIds;
        line.segmentCrossings = prevCrossings;
        this.recomputeParallelOffsets(stationStore, worldUnitsPerKm);
        return { error: check.error };
      }
    }

    line.trackCapExCad = newTrackCapExCad;
    this.bumpTopologyVersion();
    return { line, oldTrackCapExCad, newTrackCapExCad };
  }

  countActiveTransitBridgeCrossings(): number {
    let count = 0;
    for (const line of this.lines) {
      for (const crossing of line.segmentCrossings) {
        if (crossing === 'TRANSIT_BRIDGE') {
          count += 1;
        }
      }
    }
    return count;
  }

  toTopologyLines(): TopologyLine[] {
    return this.lines.map((line) => ({
      lineId: line.lineId,
      name: line.name,
      color: line.color,
      mode: line.mode,
      modeTier: line.modeTier,
      consistCars: line.consistCars,
      vehicleCount: line.vehicleIds.length,
      segments: line.segments.map(
        (seg): TopologyLineSegment => ({
          fromStationId: seg.fromStationId,
          toStationId: seg.toStationId,
          p0x: seg.p0x,
          p0y: seg.p0y,
          cp1x: seg.cp1x,
          cp1y: seg.cp1y,
          cp2x: seg.cp2x,
          cp2y: seg.cp2y,
          p3x: seg.p3x,
          p3y: seg.p3y,
          crossingType: seg.crossingType,
          parallelLaneOffset: seg.parallelLaneOffset,
          lengthMeters: seg.lengthMeters,
        }),
      ),
    }));
  }
}
