import { Container, Graphics, Particle, ParticleContainer, type Renderer, type Texture } from 'pixi.js';
import { MAX_VEHICLES } from '../../core/contracts';
import type { VehicleRenderSoA } from '../../core/memory/sharedBuffers';

const MODE_COLORS: Record<number, number> = {
  1: 0x38bdf8,
  2: 0xf59e0b,
  3: 0x10b981,
  4: 0x3b82f6,
  5: 0xa855f7,
};

export class VehicleLayer {
  readonly container = new Container();
  private particleContainer: ParticleContainer | null = null;
  private pool: Particle[] = [];
  private texture: Texture | null = null;

  initTexture(renderer: Renderer): void {
    if (this.particleContainer) {
      return;
    }

    // Generate 16x16 directional rounded vehicle sprite atlas procedurally once at startup.
    const gfx = new Graphics();
    gfx.roundRect(1, 3, 14, 10, 3).fill({ color: 0xffffff });
    gfx.poly([11, 5, 14, 8, 11, 11]).fill({ color: 0x0f172a });
    this.texture = renderer.generateTexture(gfx);
    gfx.destroy();

    this.particleContainer = new ParticleContainer({
      dynamicProperties: {
        position: true,
        rotation: true,
        color: true,
        scale: true,
      },
    });
    this.container.addChild(this.particleContainer);
  }

  syncFrame(vehicles: VehicleRenderSoA, count: number, alpha: number): void {
    if (!this.particleContainer || !this.texture) {
      return;
    }

    const activeLimit = Math.min(count, MAX_VEHICLES);
    let visibleIdx = 0;

    for (let i = 0; i < activeLimit; i++) {
      if (vehicles.activeFlag[i] === 0) {
        continue;
      }

      const x = vehicles.prevX[i] + (vehicles.currX[i] - vehicles.prevX[i]) * alpha;
      const y = vehicles.prevY[i] + (vehicles.currY[i] - vehicles.prevY[i]) * alpha;
      const rotation = vehicles.bearing[i];
      const tint = MODE_COLORS[vehicles.modeTier[i]] ?? 0x38bdf8;
      const cars = Math.max(1, vehicles.consistCars[i] || 1);

      let particle = this.pool[visibleIdx];
      if (!particle) {
        particle = new Particle({
          texture: this.texture,
          anchorX: 0.5,
          anchorY: 0.5,
          scaleX: 1.25,
          scaleY: 1.25,
        });
        this.pool.push(particle);
        this.particleContainer.addParticle(particle);
      }

      particle.x = x;
      particle.y = y;
      particle.rotation = rotation;
      particle.scaleX = 1.25 + (cars - 1) * 0.45;
      particle.scaleY = 1.25;
      particle.tint = tint;
      particle.alpha = 1;
      visibleIdx += 1;
    }

    for (let i = visibleIdx; i < this.pool.length; i++) {
      this.pool[i].alpha = 0;
    }
  }
}
