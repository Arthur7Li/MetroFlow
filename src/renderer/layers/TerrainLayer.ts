import { Container, Graphics } from 'pixi.js';
import type { CityManifest, GeometryPack } from '../../cities/types';

export class TerrainLayer {
  readonly container = new Container();
  private readonly graphics = new Graphics();

  constructor() {
    this.container.addChild(this.graphics);
  }

  renderCityGeometry(manifest: CityManifest, geometry: GeometryPack): void {
    const g = this.graphics;
    g.clear();

    const { width, height } = manifest.worldBounds;

    // Subtle GIS reference grid (500 world units = 5 km intervals).
    g.rect(0, 0, width, height).fill({ color: 0x0b0f17 });
    for (let x = 0; x <= width; x += 500) {
      g.moveTo(x, 0).lineTo(x, height);
    }
    for (let y = 0; y <= height; y += 500) {
      g.moveTo(0, y).lineTo(width, y);
    }
    g.stroke({ width: 1.5, color: 0x162032, alpha: 0.6 });

    // Layer order: valley/parks -> river -> arterial road grid.
    const polygons = geometry.features.filter((f) => f.geometry.type === 'Polygon');
    for (const feature of polygons) {
      if (feature.geometry.type !== 'Polygon') {
        continue;
      }
      const ring = feature.geometry.coordinates[0];
      if (!ring || ring.length < 3) {
        continue;
      }
      const flat: number[] = [];
      for (const pt of ring) {
        flat.push(pt[0], pt[1]);
      }

      if (feature.properties.kind === 'VALLEY' || feature.properties.kind === 'PARK') {
        g.poly(flat).fill({ color: 0x122620, alpha: 0.9 });
      } else if (feature.properties.kind === 'RIVER') {
        g.poly(flat)
          .fill({ color: 0x0f2f4f, alpha: 0.96 })
          .stroke({ width: 3, color: 0x1d4ed8, alpha: 0.35 });
      }
    }

    const lines = geometry.features.filter((f) => f.geometry.type === 'LineString');
    for (const feature of lines) {
      if (feature.geometry.type !== 'LineString') {
        continue;
      }
      const coords = feature.geometry.coordinates;
      if (coords.length < 2) {
        continue;
      }
      g.moveTo(coords[0][0], coords[0][1]);
      for (let i = 1; i < coords.length; i++) {
        g.lineTo(coords[i][0], coords[i][1]);
      }

      const roadClass = feature.properties.roadClass ?? 'ARTERIAL';
      if (roadClass === 'RING') {
        g.stroke({ width: 6, color: 0x334155, alpha: 0.65, cap: 'round', join: 'round' });
      } else if (roadClass === 'FREEWAY') {
        g.stroke({ width: 4.5, color: 0x2b394e, alpha: 0.75, cap: 'round', join: 'round' });
      } else {
        g.stroke({ width: 2.5, color: 0x1f2b3d, alpha: 0.75, cap: 'round', join: 'round' });
      }
    }
  }
}
