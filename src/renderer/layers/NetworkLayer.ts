import { Container, Graphics } from 'pixi.js';
import { getBlueprintById } from '../../config/upgrades';
import type { HeatmapLayerMode, TopologyLine, TopologyStation } from '../../core/contracts';

function parseHexColor(hex: string): number {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isFinite(parsed) ? parsed : 0x38bdf8;
}

const MODE_TIER_WIDTHS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 4.5,
  2: 5.5,
  3: 6.5,
  4: 7.5,
  5: 8.5,
};

export interface PreviewPoint {
  x: number;
  y: number;
}

export class NetworkLayer {
  readonly container = new Container();
  private readonly linesGraphics = new Graphics();
  private readonly previewGraphics = new Graphics();
  private lastLines: TopologyLine[] = [];
  private lastStations: TopologyStation[] = [];
  private heatmapMode: HeatmapLayerMode = 'NONE';
  private headwayRatios = new Map<number, number>();

  constructor() {
    this.container.addChild(this.linesGraphics);
    this.container.addChild(this.previewGraphics);
  }

  setHeatmapState(mode: HeatmapLayerMode, headwayRatios: Map<number, number>): void {
    this.heatmapMode = mode;
    this.headwayRatios = headwayRatios;
    this.updateTopology(this.lastLines, this.lastStations);
  }

  private resolveLineColor(line: TopologyLine): number {
    if (this.heatmapMode === 'HEADWAYS') {
      const ratio = this.headwayRatios.get(line.lineId) ?? 1.0;
      if (ratio <= 1.05) {
        return 0x10b981;
      }
      if (ratio <= 1.4) {
        return 0xf59e0b;
      }
      return 0xef4444;
    }
    return parseHexColor(line.color);
  }

  updateTopology(lines: TopologyLine[], stations: TopologyStation[]): void {
    this.lastLines = lines;
    this.lastStations = stations;
    const g = this.linesGraphics;
    g.clear();

    const byId = new Map<number, TopologyStation>();
    for (const st of stations) {
      byId.set(st.stationId, st);
    }

    for (const line of lines) {
      const color = this.resolveLineColor(line);
      const baseWidth = MODE_TIER_WIDTHS[line.modeTier] ?? 5.5;

      // Pass 1: Structural river-crossing casings (bridge decks & transit bridge truss rails).
      for (const seg of line.segments) {
        const from = byId.get(seg.fromStationId);
        const to = byId.get(seg.toStationId);
        if (!from || !to) {
          continue;
        }
        const x0 = seg.p0x ?? from.x;
        const y0 = seg.p0y ?? from.y;
        const x3 = seg.p3x ?? to.x;
        const y3 = seg.p3y ?? to.y;

        if (seg.crossingType === 'ROAD_BRIDGE') {
          g.moveTo(x0, y0)
            .bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, x3, y3)
            .stroke({ width: baseWidth + 7, color: 0x64748b, alpha: 0.48, cap: 'butt', join: 'round' });
        } else if (seg.crossingType === 'TRANSIT_BRIDGE') {
          g.moveTo(x0, y0)
            .bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, x3, y3)
            .stroke({ width: baseWidth + 8, color: 0xfbbf24, alpha: 0.45, cap: 'round', join: 'round' });
          g.moveTo(x0, y0)
            .bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, x3, y3)
            .stroke({ width: baseWidth + 4, color: 0x0f172a, alpha: 0.85, cap: 'round', join: 'round' });
        }
      }

      // Pass 2: Outer bloom halo across non-tunneled segments.
      let hasSurface = false;
      for (const seg of line.segments) {
        if (seg.crossingType === 'TUNNEL') {
          continue;
        }
        const from = byId.get(seg.fromStationId);
        const to = byId.get(seg.toStationId);
        if (!from || !to) {
          continue;
        }
        hasSurface = true;
        g.moveTo(seg.p0x ?? from.x, seg.p0y ?? from.y).bezierCurveTo(
          seg.cp1x,
          seg.cp1y,
          seg.cp2x,
          seg.cp2y,
          seg.p3x ?? to.x,
          seg.p3y ?? to.y,
        );
      }
      if (hasSurface) {
        g.stroke({ width: baseWidth + 7, color, alpha: 0.22, cap: 'round', join: 'round' });
      }

      // Pass 3: Core vector corridor strokes (surface vs. translucent subterranean bore).
      let hasCoreSurface = false;
      for (const seg of line.segments) {
        const from = byId.get(seg.fromStationId);
        const to = byId.get(seg.toStationId);
        if (!from || !to) {
          continue;
        }
        const x0 = seg.p0x ?? from.x;
        const y0 = seg.p0y ?? from.y;
        const x3 = seg.p3x ?? to.x;
        const y3 = seg.p3y ?? to.y;

        if (seg.crossingType === 'TUNNEL') {
          g.moveTo(x0, y0)
            .bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, x3, y3)
            .stroke({ width: baseWidth + 4, color: 0x020617, alpha: 0.75, cap: 'round' });
          g.moveTo(x0, y0)
            .bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, x3, y3)
            .stroke({ width: baseWidth * 0.85, color, alpha: 0.45, cap: 'round' });
          // Draw subterranean portal collars slightly inset along the tunnel chord.
          const pInX = x0 + (x3 - x0) * 0.14;
          const pInY = y0 + (y3 - y0) * 0.14;
          const pOutX = x0 + (x3 - x0) * 0.86;
          const pOutY = y0 + (y3 - y0) * 0.86;
          g.circle(pInX, pInY, 4.5).fill({ color: 0x0f172a }).stroke({ width: 2, color: 0x38bdf8 });
          g.circle(pOutX, pOutY, 4.5).fill({ color: 0x0f172a }).stroke({ width: 2, color: 0x38bdf8 });
        } else {
          hasCoreSurface = true;
          g.moveTo(x0, y0).bezierCurveTo(seg.cp1x, seg.cp1y, seg.cp2x, seg.cp2y, x3, y3);
        }
      }
      if (hasCoreSurface) {
        g.stroke({ width: baseWidth, color, alpha: 0.95, cap: 'round', join: 'round' });
      }
    }
  }

  renderDraftPreview(
    points: PreviewPoint[],
    cursor: PreviewPoint | null,
    crossesRiver = false,
  ): void {
    const g = this.previewGraphics;
    g.clear();

    if (points.length === 0) {
      return;
    }

    const activeColor = crossesRiver ? 0xf59e0b : 0x38bdf8;
    if (points.length >= 2) {
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        g.lineTo(points[i].x, points[i].y);
      }
      g.stroke({ width: 4, color: 0x38bdf8, alpha: 0.78, cap: 'round', join: 'round' });
    }

    if (cursor) {
      const last = points[points.length - 1];
      g.moveTo(last.x, last.y);
      g.lineTo(cursor.x, cursor.y);
      g.stroke({ width: 4, color: activeColor, alpha: 0.85, cap: 'round', join: 'round' });
    }

    for (const pt of points) {
      g.circle(pt.x, pt.y, 7).fill({ color: 0x38bdf8, alpha: 0.9 });
    }
  }

  renderBlueprintPreview(blueprintId: string | null, centerX: number, centerY: number): void {
    const g = this.previewGraphics;
    g.clear();
    if (!blueprintId) {
      return;
    }
    const bp = getBlueprintById(blueprintId);
    if (!bp) {
      return;
    }

    if (bp.enableFeederAi) {
      const radiusWorld = (bp.feederRadiusKm ?? 2.5) * 100;
      g.circle(centerX, centerY, radiusWorld)
        .fill({ color: 0x06b6d4, alpha: 0.1 })
        .stroke({ width: 2, color: 0x22d3ee, alpha: 0.7 });
    }

    const nodePos = new Map<string, { x: number; y: number }>();
    for (const n of bp.nodes) {
      nodePos.set(n.key, { x: centerX + n.dx, y: centerY + n.dy });
    }

    for (const corridor of bp.corridors) {
      const strokeColor = parseHexColor(corridor.color);
      for (let i = 0; i < corridor.nodeKeys.length - 1; i++) {
        const a = nodePos.get(corridor.nodeKeys[i]);
        const b = nodePos.get(corridor.nodeKeys[i + 1]);
        if (a && b) {
          g.moveTo(a.x, a.y)
            .lineTo(b.x, b.y)
            .stroke({ width: 6, color: strokeColor, alpha: 0.65, cap: 'round' });
        }
      }
    }

    for (const pt of nodePos.values()) {
      g.circle(pt.x, pt.y, 9)
        .fill({ color: 0x0f172a, alpha: 0.85 })
        .stroke({ width: 2.5, color: 0x22d3ee, alpha: 0.9 });
    }
  }

  clearPreview(): void {
    this.previewGraphics.clear();
  }
}
