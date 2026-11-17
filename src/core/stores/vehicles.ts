import { TRANSIT_MODES } from '../../config/modes';
import { ACTIVE_VEHICLE_SOFT_CAP, MAX_VEHICLES } from '../contracts';
import type { VehicleRenderSoA } from '../memory/sharedBuffers';
import { sampleSegmentAtDistance, type TransitLineRecord, type TransitLineStore } from './lines';

const ACCEL_MPS2 = 1.2;
const DECEL_MPS2 = 1.5;
const INTERMEDIATE_DWELL_SEC = 3.0;
const TERMINUS_DWELL_SEC = 15.0;
const BRIDGE_SLOPE_FACTOR = 0.85;

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
    this.consistCars[idx] = 1;
    this.capacity[idx] = spec.capacityPerUnit;
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

  stepVehicles(
    dtSimSeconds: number,
    lineStore: TransitLineStore,
    onStationStop?: (vehicleId: number, stationId: number, line: TransitLineRecord) => void,
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

      const spec = TRANSIT_MODES[line.mode];
      const baseCruiseMps = spec.cruiseSpeedKmh / 3.6;
      const slopeMult = seg.crossingType === 'TRANSIT_BRIDGE' ? BRIDGE_SLOPE_FACTOR : 1.0;
      const targetSpeed = baseCruiseMps * slopeMult;

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

      let nextDist = this.distanceAlongSegmentM[v] + dir * nextVel * dtSimSeconds;

      if (dir === 1 && nextDist >= seg.lengthMeters) {
        const arrivedStationId = seg.toStationId;
        if (segIndex < line.segments.length - 1) {
          this.segmentIdx[v] = segIndex + 1;
          this.distanceAlongSegmentM[v] = 0;
          this.dwellTimerS[v] = INTERMEDIATE_DWELL_SEC;
        } else {
          this.distanceAlongSegmentM[v] = seg.lengthMeters;
          this.direction[v] = -1;
          this.dwellTimerS[v] = TERMINUS_DWELL_SEC;
        }
        this.velocityMps[v] = 0;
        onStationStop?.(v, arrivedStationId, line);
      } else if (dir === -1 && nextDist <= 0) {
        const arrivedStationId = seg.fromStationId;
        if (segIndex > 0) {
          const prevSeg = line.segments[segIndex - 1];
          this.segmentIdx[v] = segIndex - 1;
          this.distanceAlongSegmentM[v] = prevSeg.lengthMeters;
          this.dwellTimerS[v] = INTERMEDIATE_DWELL_SEC;
        } else {
          this.distanceAlongSegmentM[v] = 0;
          this.direction[v] = 1;
          this.dwellTimerS[v] = TERMINUS_DWELL_SEC;
        }
        this.velocityMps[v] = 0;
        onStationStop?.(v, arrivedStationId, line);
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
      const cap = this.capacity[i] || 1;
      target.loadRatio[i] = Math.min(255, Math.round((this.onboardCount[i] / cap) * 255));
    }
  }
}
