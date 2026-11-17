import { Container, Graphics, Text } from 'pixi.js';
import type { ZoneType } from '../../cities/types';
import type { TopologyStation } from '../../core/contracts';
import type { StationRenderSoA } from '../../core/memory/sharedBuffers';

const ZONE_COLORS: Record<ZoneType, number> = {
  R: 0x38bdf8,
  C: 0xf59e0b,
  I: 0xa855f7,
  U: 0x10b981,
};

interface StationNodeVisual {
  stationId: number;
  x: number;
  y: number;
  radius: number;
  marker: Graphics;
  label: Text;
  queueBadge: Text;
  lastWaiting: number;
}

export class StationLayer {
  readonly container = new Container();
  private readonly queueRings = new Graphics();
  private readonly markersLayer = new Container();
  private readonly labelsLayer = new Container();
  private readonly badgesLayer = new Container();
  private readonly hoverRing = new Graphics();
  private visuals: StationNodeVisual[] = [];
  private stationsById = new Map<number, TopologyStation>();

  constructor() {
    this.container.addChild(this.queueRings);
    this.container.addChild(this.markersLayer);
    this.container.addChild(this.labelsLayer);
    this.container.addChild(this.badgesLayer);
    this.container.addChild(this.hoverRing);
  }

  updateTopology(stations: TopologyStation[]): void {
    this.queueRings.clear();
    this.markersLayer.removeChildren();
    this.labelsLayer.removeChildren();
    this.badgesLayer.removeChildren();
    this.visuals = [];
    this.stationsById.clear();

    for (const st of stations) {
      this.stationsById.set(st.stationId, st);

      const marker = new Graphics();
      const fill = ZONE_COLORS[st.zone];
      const radius = st.seedId ? 9 : 6;
      marker
        .circle(0, 0, radius)
        .fill({ color: 0x0f172a })
        .stroke({ width: 3, color: fill });
      marker.position.set(st.x, st.y);
      this.markersLayer.addChild(marker);

      const label = new Text({
        text: st.name,
        style: {
          fontSize: 14,
          fontWeight: '600',
          fill: 0xe2e8f0,
          stroke: { color: 0x0b0f17, width: 3 },
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(st.x, st.y + radius + 5);
      this.labelsLayer.addChild(label);

      const queueBadge = new Text({
        text: '',
        style: {
          fontSize: 12,
          fontWeight: '700',
          fill: 0x38bdf8,
          stroke: { color: 0x0b0f17, width: 3 },
        },
      });
      queueBadge.anchor.set(0.5, 1);
      queueBadge.position.set(st.x, st.y - radius - 6);
      queueBadge.visible = false;
      this.badgesLayer.addChild(queueBadge);

      this.visuals.push({
        stationId: st.stationId,
        x: st.x,
        y: st.y,
        radius,
        marker,
        label,
        queueBadge,
        lastWaiting: 0,
      });
    }
  }

  syncWaitingCounts(stationsRender: StationRenderSoA, count: number): void {
    const limit = Math.min(count, this.visuals.length);
    let dirtyRings = false;

    for (let i = 0; i < limit; i++) {
      const vis = this.visuals[i];
      const waiting = stationsRender.waitingCount[i];
      if (waiting !== vis.lastWaiting) {
        vis.lastWaiting = waiting;
        dirtyRings = true;
        if (waiting > 0) {
          vis.queueBadge.text = String(waiting);
          vis.queueBadge.visible = true;
          vis.queueBadge.style.fill = waiting >= 100 ? 0xf59e0b : 0x38bdf8;
        } else {
          vis.queueBadge.visible = false;
        }
      }
    }

    if (dirtyRings) {
      const g = this.queueRings;
      g.clear();
      for (let i = 0; i < limit; i++) {
        const vis = this.visuals[i];
        if (vis.lastWaiting <= 0) {
          continue;
        }
        const haloRadius = vis.radius + 4 + Math.min(18, Math.sqrt(vis.lastWaiting) * 0.9);
        const haloColor = vis.lastWaiting >= 100 ? 0xf59e0b : 0x38bdf8;
        g.circle(vis.x, vis.y, haloRadius).stroke({ width: 2, color: haloColor, alpha: 0.45 });
      }
    }
  }

  setHoverPreview(stationId: number | null, customPos: { x: number; y: number } | null): void {
    const g = this.hoverRing;
    g.clear();
    if (stationId !== null) {
      const st = this.stationsById.get(stationId);
      if (st) {
        g.circle(st.x, st.y, 16).stroke({ width: 2.5, color: 0x22d3ee, alpha: 0.95 });
        return;
      }
    }
    if (customPos) {
      g.circle(customPos.x, customPos.y, 8).stroke({ width: 2, color: 0xfacc15, alpha: 0.9 });
    }
  }

  updateZoomLod(zoom: number): void {
    const showLabels = zoom >= 0.42;
    this.labelsLayer.visible = showLabels;
    const invScale = Math.min(1.4, Math.max(0.7, 1 / Math.sqrt(zoom)));
    for (const item of this.visuals) {
      item.label.scale.set(invScale);
      item.queueBadge.scale.set(invScale);
    }
  }
}
