import type { Container } from 'pixi.js';

export interface WorldBounds {
  width: number;
  height: number;
}

export class MapViewport {
  private readonly bounds: WorldBounds;
  private viewportWidth = 1280;
  private viewportHeight = 720;

  private currentX: number;
  private currentY: number;
  private currentZoom: number;

  private targetX: number;
  private targetY: number;
  private targetZoom: number;

  private readonly minZoom = 0.25;
  private readonly maxZoom = 3.0;
  private readonly dampingRate = 16;

  constructor(bounds: WorldBounds, initialX: number, initialY: number, initialZoom: number) {
    this.bounds = bounds;
    this.currentX = initialX;
    this.currentY = initialY;
    this.currentZoom = this.clampZoom(initialZoom);
    this.targetX = this.currentX;
    this.targetY = this.currentY;
    this.targetZoom = this.currentZoom;
  }

  setViewportSize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
  }

  getZoom(): number {
    return this.currentZoom;
  }

  panByScreenDelta(dx: number, dy: number): void {
    this.targetX = this.clampX(this.targetX - dx / this.targetZoom);
    this.targetY = this.clampY(this.targetY - dy / this.targetZoom);
  }

  zoomAtScreenPoint(zoomMultiplier: number, screenX: number, screenY: number): void {
    const worldBefore = this.screenToWorld(screenX, screenY);
    const nextZoom = this.clampZoom(this.targetZoom * zoomMultiplier);
    this.targetZoom = nextZoom;

    const offsetX = (screenX - this.viewportWidth / 2) / nextZoom;
    const offsetY = (screenY - this.viewportHeight / 2) / nextZoom;
    this.targetX = this.clampX(worldBefore.x - offsetX);
    this.targetY = this.clampY(worldBefore.y - offsetY);
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewportWidth / 2) / this.currentZoom + this.currentX,
      y: (screenY - this.viewportHeight / 2) / this.currentZoom + this.currentY,
    };
  }

  update(dtSec: number, worldContainer: Container): void {
    const alpha = 1 - Math.exp(-this.dampingRate * Math.min(0.1, Math.max(0, dtSec)));
    this.currentX += (this.targetX - this.currentX) * alpha;
    this.currentY += (this.targetY - this.currentY) * alpha;
    this.currentZoom += (this.targetZoom - this.currentZoom) * alpha;

    worldContainer.scale.set(this.currentZoom);
    worldContainer.position.set(
      this.viewportWidth / 2 - this.currentX * this.currentZoom,
      this.viewportHeight / 2 - this.currentY * this.currentZoom,
    );
  }

  private clampZoom(zoom: number): number {
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  private clampX(x: number): number {
    return Math.min(this.bounds.width, Math.max(0, x));
  }

  private clampY(y: number): number {
    return Math.min(this.bounds.height, Math.max(0, y));
  }
}
