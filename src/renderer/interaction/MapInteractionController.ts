import type { GeometryPack } from '../../cities/types';
import type { CrossingType, RouteWaypointInput, TopologyStation } from '../../core/contracts';
import type { MapViewport } from '../MapViewport';
import type { NetworkLayer } from '../layers/NetworkLayer';
import type { StationLayer } from '../layers/StationLayer';

export type InteractionTool = 'PAN' | 'DRAW_BUS_LINE';

export interface PendingRiverCrossingInfo {
  fromWaypoint: RouteWaypointInput;
  toWaypoint: RouteWaypointInput;
  lengthKm: number;
}

export interface InteractionCallbacks {
  onCommitBusLine: (waypoints: RouteWaypointInput[]) => void;
  onEditLineStops?: (lineId: number, waypoints: RouteWaypointInput[]) => void;
  onDraftChanged: (stopCount: number, editingLineId: number | null) => void;
  onSelectStation?: (stationId: number | null) => void;
  onRequireRiverCrossing?: (info: PendingRiverCrossingInfo) => void;
}

type Ring = Array<[number, number]>;

function extractRiverRings(geometry?: GeometryPack): Ring[] {
  if (!geometry) {
    return [];
  }
  const rings: Ring[] = [];
  for (const feat of geometry.features) {
    const isRiver =
      feat.properties.kind === 'RIVER' || feat.properties.id === 'north_saskatchewan_river';
    if (!isRiver || feat.geometry.type !== 'Polygon') {
      continue;
    }
    const coords = feat.geometry.coordinates as number[][][];
    for (const ring of coords) {
      if (ring.length >= 3) {
        rings.push(ring.map((pt) => [pt[0], pt[1]] as [number, number]));
      }
    }
  }
  return rings;
}

function orientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const val = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(val) < 1e-6) {
    return 0;
  }
  return val > 0 ? 1 : 2;
}

function onSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): boolean {
  return (
    px <= Math.max(ax, bx) + 1e-6 &&
    px >= Math.min(ax, bx) - 1e-6 &&
    py <= Math.max(ay, by) + 1e-6 &&
    py >= Math.min(ay, by) - 1e-6
  );
}

function segmentsIntersect2D(
  a1x: number,
  a1y: number,
  a2x: number,
  a2y: number,
  b1x: number,
  b1y: number,
  b2x: number,
  b2y: number,
): boolean {
  const o1 = orientation(a1x, a1y, a2x, a2y, b1x, b1y);
  const o2 = orientation(a1x, a1y, a2x, a2y, b2x, b2y);
  const o3 = orientation(b1x, b1y, b2x, b2y, a1x, a1y);
  const o4 = orientation(b1x, b1y, b2x, b2y, a2x, a2y);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  if (o1 === 0 && onSegment(a1x, a1y, a2x, a2y, b1x, b1y)) return true;
  if (o2 === 0 && onSegment(a1x, a1y, a2x, a2y, b2x, b2y)) return true;
  if (o3 === 0 && onSegment(b1x, b1y, b2x, b2y, a1x, a1y)) return true;
  if (o4 === 0 && onSegment(b1x, b1y, b2x, b2y, a2x, a2y)) return true;
  return false;
}

function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

export function segmentIntersectsRiverRings(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rings: readonly Ring[],
): boolean {
  const midX = (ax + bx) * 0.5;
  const midY = (ay + by) * 0.5;
  for (const ring of rings) {
    if (pointInRing(midX, midY, ring)) {
      return true;
    }
    for (let i = 0; i < ring.length; i++) {
      const [rx1, ry1] = ring[i];
      const [rx2, ry2] = ring[(i + 1) % ring.length];
      if (segmentsIntersect2D(ax, ay, bx, by, rx1, ry1, rx2, ry2)) {
        return true;
      }
    }
  }
  return false;
}

export class MapInteractionController {
  private readonly element: HTMLElement;
  private readonly viewport: MapViewport;
  private readonly networkLayer: NetworkLayer;
  private readonly stationLayer: StationLayer;
  private readonly callbacks: InteractionCallbacks;
  private readonly riverRings: Ring[];
  private readonly worldUnitsPerKm: number;

  private tool: InteractionTool = 'PAN';
  private stations: TopologyStation[] = [];
  private draftWaypoints: RouteWaypointInput[] = [];
  private editingLineId: number | null = null;
  private pendingCrossingWaypoint: RouteWaypointInput | null = null;
  private pointerWorld: { x: number; y: number } | null = null;
  private isPanning = false;
  private isDrawingDrag = false;
  private drawStartScreenX = 0;
  private drawStartScreenY = 0;
  private lastScreenX = 0;
  private lastScreenY = 0;
  private dragMoved = false;

  private tryAppendWaypoint(sx: number, sy: number, minGapWorld = 12): void {
    if (this.pendingCrossingWaypoint) {
      return;
    }
    const world = this.viewport.screenToWorld(sx, sy);
    const snapped = this.findSnapStation(world.x, world.y, 25);
    const waypoint: RouteWaypointInput = snapped
      ? { stationId: snapped.stationId, x: snapped.x, y: snapped.y }
      : { x: Math.round(world.x), y: Math.round(world.y) };

    const prev = this.draftWaypoints[this.draftWaypoints.length - 1];
    if (
      prev &&
      ((prev.stationId !== undefined && prev.stationId === waypoint.stationId) ||
        Math.hypot(prev.x - waypoint.x, prev.y - waypoint.y) < minGapWorld)
    ) {
      return;
    }

    if (prev && segmentIntersectsRiverRings(prev.x, prev.y, waypoint.x, waypoint.y, this.riverRings)) {
      this.pendingCrossingWaypoint = waypoint;
      const lengthKm = Number(
        (Math.hypot(waypoint.x - prev.x, waypoint.y - prev.y) / this.worldUnitsPerKm).toFixed(2),
      );
      this.refreshPreview();
      if (this.callbacks.onRequireRiverCrossing) {
        this.callbacks.onRequireRiverCrossing({
          fromWaypoint: prev,
          toWaypoint: waypoint,
          lengthKm,
        });
      } else {
        this.resolveRiverCrossing('TRANSIT_BRIDGE');
      }
      return;
    }

    this.draftWaypoints.push({ ...waypoint, crossingType: 'NONE' });
    this.callbacks.onDraftChanged(this.draftWaypoints.length, this.editingLineId);
    this.refreshPreview();
  }

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
      this.isDrawingDrag = true;
      this.drawStartScreenX = sx;
      this.drawStartScreenY = sy;
      this.tryAppendWaypoint(sx, sy, 12);
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.isPanning) {
      const dx = sx - this.lastScreenX;
      const dy = sy - this.lastScreenY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
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
      const snapped = this.findSnapStation(world.x, world.y, 25);
      this.stationLayer.setHoverPreview(snapped ? snapped.stationId : null, null);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.isPanning) {
      this.isPanning = false;
      if (this.element.hasPointerCapture(e.pointerId)) {
        this.element.releasePointerCapture(e.pointerId);
      }
      if (e.button === 2 && !this.dragMoved && this.tool === 'DRAW_BUS_LINE') {
        this.cancelDraft();
        return;
      }
      if (e.button === 0 && !this.dragMoved && this.tool === 'PAN') {
        const world = this.viewport.screenToWorld(sx, sy);
        const snapped = this.findSnapStation(world.x, world.y, 28);
        this.callbacks.onSelectStation?.(snapped ? snapped.stationId : null);
      }
      return;
    }

    if (this.isDrawingDrag && e.button === 0 && this.tool === 'DRAW_BUS_LINE') {
      this.isDrawingDrag = false;
      if (Math.hypot(sx - this.drawStartScreenX, sy - this.drawStartScreenY) > 16) {
        this.tryAppendWaypoint(sx, sy, 25);
      }
    }
  };

  private readonly onDoubleClick = (): void => {
    if (
      this.tool === 'DRAW_BUS_LINE' &&
      !this.pendingCrossingWaypoint &&
      this.draftWaypoints.length >= 2
    ) {
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
    if (e.key === 'Enter' && this.tool === 'DRAW_BUS_LINE' && !this.pendingCrossingWaypoint && this.draftWaypoints.length >= 2) {
      this.commitDraft();
    } else if (e.key === 'Escape' && this.tool === 'DRAW_BUS_LINE') {
      this.cancelDraft();
    } else if (e.key === 'Backspace' && this.tool === 'DRAW_BUS_LINE' && !this.pendingCrossingWaypoint) {
      this.undoLastWaypoint();
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
    geometry?: GeometryPack,
    worldUnitsPerKm = 100,
  ) {
    this.element = element;
    this.viewport = viewport;
    this.networkLayer = networkLayer;
    this.stationLayer = stationLayer;
    this.callbacks = callbacks;
    this.riverRings = extractRiverRings(geometry);
    this.worldUnitsPerKm = worldUnitsPerKm;

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

  startEditingLine(lineId: number, existingWaypoints: RouteWaypointInput[]): void {
    this.tool = 'DRAW_BUS_LINE';
    this.editingLineId = lineId;
    this.pendingCrossingWaypoint = null;
    this.draftWaypoints = existingWaypoints.map((w) => ({ ...w }));
    this.callbacks.onDraftChanged(this.draftWaypoints.length, this.editingLineId);
    this.refreshPreview();
  }

  undoLastWaypoint(): void {
    if (this.draftWaypoints.length === 0) {
      return;
    }
    this.draftWaypoints.pop();
    this.callbacks.onDraftChanged(this.draftWaypoints.length, this.editingLineId);
    this.refreshPreview();
  }

  resolveRiverCrossing(crossingType: CrossingType | null): void {
    const pending = this.pendingCrossingWaypoint;
    this.pendingCrossingWaypoint = null;
    if (pending && crossingType !== null) {
      this.draftWaypoints.push({ ...pending, crossingType });
      this.callbacks.onDraftChanged(this.draftWaypoints.length, this.editingLineId);
    }
    this.refreshPreview();
  }

  commitDraft(): void {
    if (this.draftWaypoints.length < 2 || this.pendingCrossingWaypoint) {
      return;
    }
    const committed = [...this.draftWaypoints];
    const editingId = this.editingLineId;
    this.draftWaypoints = [];
    this.editingLineId = null;
    this.callbacks.onDraftChanged(0, null);
    this.networkLayer.clearPreview();

    if (editingId !== null && this.callbacks.onEditLineStops) {
      this.callbacks.onEditLineStops(editingId, committed);
    } else {
      this.callbacks.onCommitBusLine(committed);
    }
  }

  cancelDraft(): void {
    this.draftWaypoints = [];
    this.editingLineId = null;
    this.pendingCrossingWaypoint = null;
    this.callbacks.onDraftChanged(0, null);
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
    if (this.pendingCrossingWaypoint) {
      pts.push({ x: this.pendingCrossingWaypoint.x, y: this.pendingCrossingWaypoint.y });
      this.networkLayer.renderDraftPreview(pts, null, true);
      return;
    }
    const cursor = this.pointerWorld
      ? (() => {
          const snapped = this.findSnapStation(this.pointerWorld.x, this.pointerWorld.y, 25);
          return snapped ? { x: snapped.x, y: snapped.y } : this.pointerWorld;
        })()
      : null;
    const crossesRiver =
      cursor && pts.length > 0
        ? segmentIntersectsRiverRings(
            pts[pts.length - 1].x,
            pts[pts.length - 1].y,
            cursor.x,
            cursor.y,
            this.riverRings,
          )
        : false;
    this.networkLayer.renderDraftPreview(pts, cursor, crossesRiver);
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
