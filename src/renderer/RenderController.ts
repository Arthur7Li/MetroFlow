import { Application, Container } from 'pixi.js';
import type { CityManifest, GeometryPack } from '../cities/types';
import type {
  HeatmapLayerMode,
  TelemetrySnapshot,
  TopologySnapshot,
} from '../core/contracts';
import type { WorkerClient } from '../core/workerClient';
import { MapViewport } from './MapViewport';
import { NetworkLayer } from './layers/NetworkLayer';
import { StationLayer } from './layers/StationLayer';
import { TerrainLayer } from './layers/TerrainLayer';
import { VehicleLayer } from './layers/VehicleLayer';

export class RenderController {
  private readonly host: HTMLElement;
  private readonly workerClient: WorkerClient;
  private readonly app = new Application();
  private readonly worldContainer = new Container();

  readonly viewport: MapViewport;
  readonly terrainLayer = new TerrainLayer();
  readonly networkLayer = new NetworkLayer();
  readonly stationLayer = new StationLayer();
  readonly vehicleLayer = new VehicleLayer();

  private heatmapMode: HeatmapLayerMode = 'NONE';
  private lastHeadwayRatios = new Map<number, number>();
  private rafId: number | null = null;
  private lastFrameMs = 0;
  private initialized = false;
  private destroyed = false;

  constructor(host: HTMLElement, manifest: CityManifest, geometry: GeometryPack, workerClient: WorkerClient) {
    this.host = host;
    this.workerClient = workerClient;
    this.viewport = new MapViewport(
      manifest.worldBounds,
      manifest.startingCamera.x,
      manifest.startingCamera.y,
      manifest.startingCamera.zoom,
    );

    this.terrainLayer.renderCityGeometry(manifest, geometry);
    this.worldContainer.addChild(this.terrainLayer.container);
    this.worldContainer.addChild(this.networkLayer.container);
    this.worldContainer.addChild(this.stationLayer.container);
    this.worldContainer.addChild(this.vehicleLayer.container);
  }

  async start(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      preference: 'webgpu',
      antialias: true,
      backgroundColor: 0x0b0f17,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    this.initialized = true;

    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }

    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldContainer);
    this.vehicleLayer.initTexture(this.app.renderer);

    this.lastFrameMs = performance.now();
    const tick = (nowMs: number): void => {
      if (this.destroyed) {
        return;
      }
      const dtSec = (nowMs - this.lastFrameMs) / 1000;
      this.lastFrameMs = nowMs;

      this.viewport.setViewportSize(this.app.screen.width, this.app.screen.height);
      this.viewport.update(dtSec, this.worldContainer);
      this.stationLayer.updateZoomLod(this.viewport.getZoom());

      const { frame, alpha } = this.workerClient.readLatestSnapshot(nowMs);
      if (frame) {
        this.vehicleLayer.syncFrame(frame.slot.vehicles, frame.vehicleCount, alpha);
        this.stationLayer.syncWaitingCounts(frame.slot.stations, frame.stationCount);
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  applyTopology(topology: TopologySnapshot): void {
    this.networkLayer.updateTopology(topology.lines, topology.stations);
    this.stationLayer.updateTopology(topology.stations, topology.feederZones);
  }

  setHeatmapMode(mode: HeatmapLayerMode): void {
    this.heatmapMode = mode;
    this.stationLayer.setHeatmapState(mode);
    this.networkLayer.setHeatmapState(mode, this.lastHeadwayRatios);
  }

  syncTelemetryOverlays(telemetry: TelemetrySnapshot): void {
    const nextRatios = new Map<number, number>();
    for (const line of telemetry.lines) {
      nextRatios.set(
        line.lineId,
        line.actualHeadwaySec / Math.max(1, line.targetHeadwaySec),
      );
    }
    this.lastHeadwayRatios = nextRatios;
    this.stationLayer.setHeatmapState(this.heatmapMode, telemetry.stationUnmetCar);
    if (this.heatmapMode === 'HEADWAYS') {
      this.networkLayer.setHeatmapState('HEADWAYS', nextRatios);
    }
  }

  dispose(): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.initialized) {
      this.app.destroy(true);
    }
  }
}
