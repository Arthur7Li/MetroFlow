import type { TransitModeId } from '../../cities/types';
import { TRANSIT_MODES } from '../../config/modes';
import type {
  AutoHeadwayPolicy,
  CrossingType,
  RouteWaypointInput,
  TopologyLine,
  TopologyLineSegment,
} from '../contracts';
import type { StationStore } from './stations';

const LUT_SAMPLES = 32;

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
  stationIds: number[];
  segments: BezierSegment[];
  totalLengthKm: number;
  vehicleIds: number[];
  allDoorArc: boolean;
  tspEnabled: boolean;
  policy: AutoHeadwayPolicy;
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

function buildBezierSegment(
  fromId: number,
  toId: number,
  pts: Array<{ x: number; y: number }>,
  segIdx: number,
  crossingType: CrossingType,
  metersPerWorldUnit: number,
): BezierSegment {
  const p0 = pts[segIdx];
  const p3 = pts[segIdx + 1];
  const prev = pts[segIdx - 1];
  const next = pts[segIdx + 2];

  const chordLen = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const handleLen = chordLen * 0.25;

  const tStart = prev
    ? unitTangent(p3.x - prev.x, p3.y - prev.y)
    : unitTangent(p3.x - p0.x, p3.y - p0.y);
  const tEnd = next
    ? unitTangent(next.x - p0.x, next.y - p0.y)
    : unitTangent(p3.x - p0.x, p3.y - p0.y);

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
    parallelLaneOffset: 0,
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

export class TransitLineStore {
  readonly lines: TransitLineRecord[] = [];
  private nextLineId = 1;
  private topologyVersion = 1;

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

  createLine(
    name: string,
    color: string,
    mode: TransitModeId,
    waypoints: RouteWaypointInput[],
    stationStore: StationStore,
    worldUnitsPerKm: number,
  ): { line: TransitLineRecord; trackCapExCad: number } | { error: string } {
    const resolvedStations: Array<{ id: number; x: number; y: number; crossingType: CrossingType }> = [];

    for (const wp of waypoints) {
      const station = stationStore.resolveOrCreateStation(wp.x, wp.y, wp.stationId);
      if (!station) {
        return { error: 'Maximum station limit reached' };
      }
      const prev = resolvedStations[resolvedStations.length - 1];
      if (!prev || prev.id !== station.stationId) {
        resolvedStations.push({
          id: station.stationId,
          x: station.x,
          y: station.y,
          crossingType: wp.crossingType ?? 'NONE',
        });
      }
    }

    if (resolvedStations.length < 2) {
      return { error: 'A transit line requires at least two distinct stops' };
    }

    const metersPerWorldUnit = 1000 / worldUnitsPerKm;
    const pts = resolvedStations.map((s) => ({ x: s.x, y: s.y }));
    const segments: BezierSegment[] = [];
    let totalMeters = 0;

    for (let i = 0; i < resolvedStations.length - 1; i++) {
      const seg = buildBezierSegment(
        resolvedStations[i].id,
        resolvedStations[i + 1].id,
        pts,
        i,
        resolvedStations[i + 1].crossingType,
        metersPerWorldUnit,
      );
      segments.push(seg);
      totalMeters += seg.lengthMeters;
    }

    const spec = TRANSIT_MODES[mode];
    const totalLengthKm = totalMeters / 1000;
    const trackCapExCad = Math.round(totalLengthKm * spec.trackCapExPerKm);

    const line: TransitLineRecord = {
      lineId: this.nextLineId++,
      name: name.trim() || `Route ${this.nextLineId - 1}`,
      color,
      mode,
      modeTier: spec.tier,
      stationIds: resolvedStations.map((s) => s.id),
      segments,
      totalLengthKm,
      vehicleIds: [],
      allDoorArc: false,
      tspEnabled: false,
      policy: { type: 'MANUAL' },
    };

    this.lines.push(line);
    this.bumpTopologyVersion();
    return { line, trackCapExCad };
  }

  toTopologyLines(): TopologyLine[] {
    return this.lines.map((line) => ({
      lineId: line.lineId,
      name: line.name,
      color: line.color,
      mode: line.mode,
      modeTier: line.modeTier,
      vehicleCount: line.vehicleIds.length,
      segments: line.segments.map(
        (seg): TopologyLineSegment => ({
          fromStationId: seg.fromStationId,
          toStationId: seg.toStationId,
          cp1x: seg.cp1x,
          cp1y: seg.cp1y,
          cp2x: seg.cp2x,
          cp2y: seg.cp2y,
          crossingType: seg.crossingType,
          parallelLaneOffset: seg.parallelLaneOffset,
          lengthMeters: seg.lengthMeters,
        }),
      ),
    }));
  }
}
