import { Container, Graphics } from 'pixi.js';
import type { TopologyLine, TopologyStation } from '../../core/contracts';

function parseHexColor(hex: string): number {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : 0x38bdf8;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

export class NetworkLayer {
  readonly container = new Container();
  private readonly linesGraphics = new Graphics();
  private readonly previewGraphics = new Graphics();

  constructor() {
    this.container.addChild(this.linesGraphics);
    this.container.addChild(this.previewGraphics);
  }

  updateTopology(lines: TopologyLine[], stations: TopologyStation[]): void {
    const g = this.linesGraphics;
    g.clear();

    const byId = new Map<number, TopologyStation>();
    for (const st of stations) {
      byId.set(st.stationId, st);
    }

    for (const line of lines) {
      const color = parseHexColor(line.color);

      // Outer corridor glow pass.
      for (const seg of line.segments) {
        const from = byId.get(seg.fromStationId);
        const to = byId.get(seg.toStationId);
        if (!from || !to) {
          continue;
        }
        g.moveTo(from.x, from.y).bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, to.x, to.y);
      }
      g.stroke({ width: 12, color, alpha: 0.22, cap: 'round', join: 'round' });

      // Core corridor vector pass.
      for (const seg of line.segments) {
        const from = byId.get(seg.fromStationId);
        const to = byId.get(seg.toStationId);
        if (!from || !to) {
          continue;
        }
        g.moveTo(from.x, from.y).bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, to.x, to.y);
      }
      g.stroke({ width: 5.5, color, alpha: 0.95, cap: 'round', join: 'round' });
    }
  }

  renderDraftPreview(points: PreviewPoint[], cursor: PreviewPoint | null): void {
    const g = this.previewGraphics;
    g.clear();

    if (points.length === 0) {
      return;
    }

    if (points.length >= 2 || cursor) {
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        g.lineTo(points[i].x, points[i].y);
      }
      if (cursor) {
        g.lineTo(cursor.x, cursor.y);
      }
      g.stroke({ width: 4, color: 0x38bdf8, alpha: 0.75, cap: 'round', join: 'round' });
    }

    for (const pt of points) {
      g.circle(pt.x, pt.y, 7).fill({ color: 0x38bdf8, alpha: 0.9 });
    }
  }

  clearPreview(): void {
    this.previewGraphics.clear();
  }
}
