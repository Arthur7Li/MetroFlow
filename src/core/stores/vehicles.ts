import { TRANSIT_MODES } from '../../config/modes';
import { ALL_DOOR_ARC_DWELL_MULT } from '../../config/upgrades';
import { ACTIVE_VEHICLE_SOFT_CAP, MAX_VEHICLES } from '../contracts';
import type { VehicleRenderSoA } from '../memory/sharedBuffers';
import {
  computeSegmentEffectiveCruiseMps,
  sampleSegmentAtDistance,
  type TransitLineRecord,
  type TransitLineStore,
} from './lines';

const ACCEL_MPS2 = 1.2;
const DECEL_MPS2 = 1.5;
const INTERMEDIATE_DWELL_SEC = 3.0;
const TERMINUS_DWELL_SEC = 15.0;
const MAX_DYNAMIC_BOARD_DWELL_SEC = 18.0;

export class VehicleStoreSoA {
  readonly active = new Uint8Array(MAX_VEHICLES);
  readonly lineId = new Uint16Array(MAX_VEHICLES);
  readonly modeTier = new Uint8Array(MAX_VEHICLES);
  readonly segmentIdx = new Uint16Array(MAX_VEHICLES);
  readonly distanceAlongSegmentM = new Float32Array(MAX_VEHICLES);
  readonly velocityMps = new Float32Array(MAX_VEHICLES);
  readonly direction = new Int8Array(MAX_VEHICLES);
  readonly dwellTimerS = new Float32Array(MAX_VEHICLES);
  readonly consistCars = new Uint8Array(MAX_VEHICLES);
  readonly capacity = new Uint16Array(MAX_VEHICLES);
  readonly onboardCount = new Uint16Array(MAX_VEHICLES);
  readonly prevX = new Float32Array(MAX_VEHICLES);
  readonly prevY = new Float32Array(MAX_VEHICLES);
  readonly currX = new Float32Array(MAX_VEHICLES);
  readonly currY = new Float32Array(MAX_VEHICLES);
  readonly bearing = new Float32Array(MAX_VEHICLES);

  private activeCount = 0;
  private highWaterMark = 0;

  reset(): void {
    this.active.fill(0);
    this.lineId.fill(0);
    this.modeTier.fill(0);
    this.segmentIdx.fill(0);
    this.distanceAlongSegmentM.fill(0);
    this.velocityMps.fill(0);
    this.direction.fill(0);
    this.dwellTimerS.fill(0);
    this.consistCars.fill(0);
    this.capacity.fill(0);
    this.onboardCount.fill(0);
    this.prevX.fill(0);
    this.prevY.fill(0);
    this.currX.fill(0);
    this.currY.fill(0);
    this.bearing.fill(0);
    this.activeCount = 0;
    this.highWaterMark = 0;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getHighWaterMark(): number {
    return this.highWaterMark;
  }

  spawnVehicle(line: TransitLineRecord): number {
    if (this.activeCount >= ACTIVE_VEHICLE_SOFT_CAP || line.segments.length === 0) {
      return -1;
    }

    let idx = -1;
    for (let i = 0; i < MAX_VEHICLES; i++) {
      if (this.active[i] === 0) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      return -1;
    }

    const spec = TRANSIT_MODES[line.mode];
    const startForward = line.vehicleIds.length % 2 === 0;
    const startSegIdx = startForward ? 0 : line.segments.length - 1;
    const seg = line.segments[startSegIdx];
    const startDist = startForward ? 0 : seg.lengthMeters;
    const dir: 1 | -1 = startForward ? 1 : -1;
    const sample = sampleSegmentAtDistance(seg, startDist, dir);

    this.active[idx] = 1;
    this.lineId[idx] = line.lineId;
    this.modeTier[idx] = spec.tier;
    this.segmentIdx[idx] = startSegIdx;
    this.distanceAlongSegmentM[idx] = startDist;
    this.velocityMps[idx] = 0;
    this.direction[idx] = dir;
    this.dwellTimerS[idx] = 0;
    this.consistCars[idx] = line.consistCars;
    this.capacity[idx] = spec.capacityPerUnit * line.consistCars;
    this.onboardCount[idx] = 0;
    this.prevX[idx] = sample.x;
    this.prevY[idx] = sample.y;
    this.currX[idx] = sample.x;
    this.currY[idx] = sample.y;
    this.bearing[idx] = sample.bearing;

    line.vehicleIds.push(idx);
    this.activeCount += 1;
    if (idx + 1 > this.highWaterMark) {
      this.highWaterMark = idx + 1;
    }
    return idx;
  }

  sellLastVehicle(line: TransitLineRecord): number {
    const vId = line.vehicleIds.pop();
    if (vId === undefined) {
      return -1;
    }
    if (this.active[vId] === 1) {
      this.active[vId] = 0;
      this.onboardCount[vId] = 0;
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    return vId;
  }

  removeAllVehiclesForLine(line: TransitLineRecord): number[] {
    const removed = [...line.vehicleIds];
    for (const vId of removed) {
      if (this.active[vId] === 1) {
        this.active[vId] = 0;
        this.onboardCount[vId] = 0;
        this.activeCount = Math.max(0, this.activeCount - 1);
      }
    }
    line.vehicleIds.length = 0;
    return removed;
  }

  syncLineFleetSpec(line: TransitLineRecord): void {
    const spec = TRANSIT_MODES[line.mode];
    for (const vId of line.vehicleIds) {
      if (this.active[vId] === 0) {
        continue;
      }
      this.modeTier[vId] = spec.tier;
      this.consistCars[vId] = line.consistCars;
      this.capacity[vId] = spec.capacityPerUnit * line.consistCars;
    }
  }

  clampVehiclesAfterStopEdit(line: TransitLineRecord): void {
    if (line.segments.length === 0) {
      return;
    }
    for (const vId of line.vehicleIds) {
      if (this.active[vId] === 0) {
        continue;
      }
      const segIdx = Math.min(this.segmentIdx[vId], line.segments.length - 1);
      this.segmentIdx[vId] = segIdx;
      const seg = line.segments[segIdx];
      this.distanceAlongSegmentM[vId] = Math.max(
        0,
        Math.min(seg.lengthMeters, this.distanceAlongSegmentM[vId]),
      );
      const dir: 1 | -1 = this.direction[vId] >= 0 ? 1 : -1;
      const sample = sampleSegmentAtDistance(seg, this.distanceAlongSegmentM[vId], dir);
      this.prevX[vId] = sample.x;
      this.prevY[vId] = sample.y;
      this.currX[vId] = sample.x;
      this.currY[vId] = sample.y;
      this.bearing[vId] = sample.bearing;
    }
  }

  stepVehicles(
    dtSimSeconds: number,
    lineStore: TransitLineStore,
    onStationStop?: (vehicleId: number, stationId: number, line: TransitLineRecord) => number | void,
    weatherBusMult = 1.0,
    weatherRailMult = 1.0,
  ): void {
    if (dtSimSeconds <= 0 || this.highWaterMark === 0) {
      return;
    }

    for (let v = 0; v < this.highWaterMark; v++) {
      if (this.active[v] === 0) {
        continue;
      }

      this.prevX[v] = this.currX[v];
      this.prevY[v] = this.currY[v];

      const line = lineStore.getById(this.lineId[v]);
      if (!line || line.segments.length === 0) {
        continue;
      }

      if (this.dwellTimerS[v] > 0) {
        this.dwellTimerS[v] = Math.max(0, this.dwellTimerS[v] - dtSimSeconds);
        this.velocityMps[v] = 0;
        continue;
      }

      const segIndex = Math.min(this.segmentIdx[v], line.segments.length - 1);
      const seg = line.segments[segIndex];
      const dir: 1 | -1 = this.direction[v] >= 0 ? 1 : -1;

      const targetSpeed = computeSegmentEffectiveCruiseMps(
        line,
        seg,
        weatherBusMult,
        weatherRailMult,
      );

      const remainingDist =
        dir === 1 ? seg.lengthMeters - this.distanceAlongSegmentM[v] : this.distanceAlongSegmentM[v];
      const curVel = this.velocityMps[v];
      const stopDist = (curVel * curVel) / (2 * DECEL_MPS2);

      let nextVel: number;
      if (remainingDist <= stopDist + 2.0) {
        nextVel = Math.max(1.5, curVel - DECEL_MPS2 * dtSimSeconds);
      } else if (curVel < targetSpeed) {
        nextVel = Math.min(targetSpeed, curVel + ACCEL_MPS2 * dtSimSeconds);
      } else {
        nextVel = targetSpeed;
      }

      const nextDist = this.distanceAlongSegmentM[v] + dir * nextVel * dtSimSeconds;
      const dwellMult = line.allDoorArc ? ALL_DOOR_ARC_DWELL_MULT : 1.0;

      if (dir === 1 && nextDist >= seg.lengthMeters) {
        const arrivedStationId = seg.toStationId;
        const isTerminus = segIndex >= line.segments.length - 1;
        if (!isTerminus) {
          this.segmentIdx[v] = segIndex + 1;
          this.distanceAlongSegmentM[v] = 0;
        } else {
          this.distanceAlongSegmentM[v] = seg.lengthMeters;
          this.direction[v] = -1;
        }
        this.velocityMps[v] = 0;
        const boarded = onStationStop?.(v, arrivedStationId, line) ?? 0;
        this.dwellTimerS[v] =
          (isTerminus
            ? TERMINUS_DWELL_SEC
            : Math.min(MAX_DYNAMIC_BOARD_DWELL_SEC, INTERMEDIATE_DWELL_SEC + 0.5 * boarded)) *
          dwellMult;
      } else if (dir === -1 && nextDist <= 0) {
        const arrivedStationId = seg.fromStationId;
        const isTerminus = segIndex <= 0;
        if (!isTerminus) {
          const prevSeg = line.segments[segIndex - 1];
          this.segmentIdx[v] = segIndex - 1;
          this.distanceAlongSegmentM[v] = prevSeg.lengthMeters;
        } else {
          this.distanceAlongSegmentM[v] = 0;
          this.direction[v] = 1;
        }
        this.velocityMps[v] = 0;
        const boarded = onStationStop?.(v, arrivedStationId, line) ?? 0;
        this.dwellTimerS[v] =
          (isTerminus
            ? TERMINUS_DWELL_SEC
            : Math.min(MAX_DYNAMIC_BOARD_DWELL_SEC, INTERMEDIATE_DWELL_SEC + 0.5 * boarded)) *
          dwellMult;
      } else {
        this.distanceAlongSegmentM[v] = nextDist;
        this.velocityMps[v] = nextVel;
      }

      const activeSeg = line.segments[this.segmentIdx[v]];
      const activeDir: 1 | -1 = this.direction[v] >= 0 ? 1 : -1;
      const sample = sampleSegmentAtDistance(activeSeg, this.distanceAlongSegmentM[v], activeDir);
      this.currX[v] = sample.x;
      this.currY[v] = sample.y;
      this.bearing[v] = sample.bearing;
    }
  }

  writeToRenderSlot(target: VehicleRenderSoA): void {
    const count = this.highWaterMark;
    for (let i = 0; i < count; i++) {
      target.activeFlag[i] = this.active[i];
      if (this.active[i] === 0) {
        continue;
      }
      target.prevX[i] = this.prevX[i];
      target.prevY[i] = this.prevY[i];
      target.currX[i] = this.currX[i];
      target.currY[i] = this.currY[i];
      target.bearing[i] = this.bearing[i];
      target.lineId[i] = this.lineId[i];
      target.modeTier[i] = this.modeTier[i];
      target.consistCars[i] = this.consistCars[i] || 1;
      const cap = this.capacity[i] || 1;
      target.loadRatio[i] = Math.min(255, Math.round((this.onboardCount[i] / cap) * 255));
    }
  }
}
