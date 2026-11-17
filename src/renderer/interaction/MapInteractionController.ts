import type { RouteWaypointInput, TopologyStation } from '../../core/contracts';
import type { MapViewport } from '../MapViewport';
import type { NetworkLayer } from '../layers/NetworkLayer';
import type { StationLayer } from '../layers/StationLayer';

export type InteractionTool = 'PAN' | 'DRAW_BUS_LINE';

export interface InteractionCallbacks {
  onCommitBusLine: (waypoints: RouteWaypointInput[]) => void;
  onDraftChanged: (stopCount: number) => void;
}

export class MapInteractionController {
  private readonly element: HTMLElement;
  private readonly viewport: MapViewport;
  private readonly networkLayer: NetworkLayer;
  private readonly stationLayer: StationLayer;
  private readonly callbacks: InteractionCallbacks;

  private tool: InteractionTool = 'PAN';
  private stations: TopologyStation[] = [];
  private draftWaypoints: RouteWaypointInput[] = [];
  private pointerWorld: { x: number; y: number } | null = null;
  private isPanning = false;
  private lastScreenX = 0;
  private lastScreenY = 0;
  private dragMoved = false;

  private readonly onPointerDown = (e: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 1 || e.button === 2 || this.tool === 'PAN') {
      this.isPanning = true;
      this.lastScreenX = sx;
      this.lastScreenY = sy;
      this.dragMoved = false;
      this.element.setPointerCapture(e.pointerId);
      return;
    }

    if (e.button === 0 && this.tool === 'DRAW_BUS_LINE') {
      const world = this.viewport.screenToWorld(sx, sy);
      const snapped = this.findSnapStation(world.x, world.y, 25);
      const waypoint: RouteWaypointInput = snapped
        ? { stationId: snapped.stationId, x: snapped.x, y: snapped.y }
        : { x: Math.round(world.x), y: Math.round(world.y) };

      const prev = this.draftWaypoints[this.draftWaypoints.length - 1];
      if (
        prev &&
        ((prev.stationId !== undefined && prev.stationId === waypoint.stationId) ||
          Math.hypot(prev.x - waypoint.x, prev.y - waypoint.y) < 12)
      ) {
        return;
      }

      this.draftWaypoints.push(waypoint);
      this.callbacks.onDraftChanged(this.draftWaypoints.length);
      this.refreshPreview();
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.isPanning) {
      const dx = sx - this.lastScreenX;
      const dy = sy - this.lastScreenY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        this.dragMoved = true;
      }
      this.viewport.panByScreenDelta(dx, dy);
      this.lastScreenX = sx;
      this.lastScreenY = sy;
      return;
    }

    const world = this.viewport.screenToWorld(sx, sy);
    this.pointerWorld = world;
    if (this.tool === 'DRAW_BUS_LINE') {
      const snapped = this.findSnapStation(world.x, world.y, 25);
      this.stationLayer.setHoverPreview(snapped ? snapped.stationId : null, snapped ? null : world);
      this.refreshPreview();
    } else {
      this.stationLayer.setHoverPreview(null, null);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.isPanning) {
      this.isPanning = false;
      if (this.element.hasPointerCapture(e.pointerId)) {
        this.element.releasePointerCapture(e.pointerId);
      }
      if (e.button === 2 && !this.dragMoved && this.tool === 'DRAW_BUS_LINE') {
        this.cancelDraft();
      }
    }
  };

  private readonly onDoubleClick = (): void => {
    if (this.tool === 'DRAW_BUS_LINE' && this.draftWaypoints.length >= 2) {
      this.commitDraft();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.viewport.zoomAtScreenPoint(factor, sx, sy);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && this.tool === 'DRAW_BUS_LINE' && this.draftWaypoints.length >= 2) {
      this.commitDraft();
    } else if (e.key === 'Escape' && this.tool === 'DRAW_BUS_LINE') {
      this.cancelDraft();
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  constructor(
    element: HTMLElement,
    viewport: MapViewport,
    networkLayer: NetworkLayer,
    stationLayer: StationLayer,
    callbacks: InteractionCallbacks,
  ) {
    this.element = element;
    this.viewport = viewport;
    this.networkLayer = networkLayer;
    this.stationLayer = stationLayer;
    this.callbacks = callbacks;

    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('dblclick', this.onDoubleClick);
    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  setStations(stations: TopologyStation[]): void {
    this.stations = stations;
  }

  setTool(tool: InteractionTool): void {
    this.tool = tool;
    if (tool === 'PAN') {
      this.cancelDraft();
      this.stationLayer.setHoverPreview(null, null);
    }
  }

  commitDraft(): void {
    if (this.draftWaypoints.length < 2) {
      return;
    }
    const committed = [...this.draftWaypoints];
    this.draftWaypoints = [];
    this.callbacks.onDraftChanged(0);
    this.networkLayer.clearPreview();
    this.callbacks.onCommitBusLine(committed);
  }

  cancelDraft(): void {
    this.draftWaypoints = [];
    this.callbacks.onDraftChanged(0);
    this.networkLayer.clearPreview();
  }

  private findSnapStation(wx: number, wy: number, radius: number): TopologyStation | undefined {
    const rSq = radius * radius;
    let best: TopologyStation | undefined;
    let bestSq = rSq;
    for (const st of this.stations) {
      const dx = st.x - wx;
      const dy = st.y - wy;
      const dSq = dx * dx + dy * dy;
      if (dSq <= bestSq) {
        bestSq = dSq;
        best = st;
      }
    }
    return best;
  }

  private refreshPreview(): void {
    const pts = this.draftWaypoints.map((w) => ({ x: w.x, y: w.y }));
    const cursor = this.pointerWorld
      ? (() => {
          const snapped = this.findSnapStation(this.pointerWorld.x, this.pointerWorld.y, 25);
          return snapped ? { x: snapped.x, y: snapped.y } : this.pointerWorld;
        })()
      : null;
    this.networkLayer.renderDraftPreview(pts, cursor);
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('dblclick', this.onDoubleClick);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
