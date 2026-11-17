import { create } from 'zustand';
import type { TransitModeId } from '../../cities/types';
import type {
  CrossingType,
  RouteWaypointInput,
  SimSpeed,
  TelemetrySnapshot,
  TopologySnapshot,
  TransportMode,
  WorkerCommand,
} from '../../core/contracts';
import type {
  InteractionTool,
  PendingRiverCrossingInfo,
} from '../../renderer/interaction/MapInteractionController';

const LINE_PALETTE = ['#38bdf8', '#f59e0b', '#10b981', '#a855f7', '#f43f5e', '#2563eb', '#ef4444'];

export interface EdmontonPresetSpec {
  badge: 'CAP' | 'VAL' | 'MET';
  name: string;
  color: string;
  mode: TransitModeId;
}

export const EDMONTON_LINE_PRESETS: readonly EdmontonPresetSpec[] = [
  { badge: 'CAP', name: 'Capital Line', color: '#2563eb', mode: 'LRT_HIGH_FLOOR' },
  { badge: 'VAL', name: 'Valley Line', color: '#10b981', mode: 'LRT_LOW_FLOOR' },
  { badge: 'MET', name: 'Metro Line', color: '#ef4444', mode: 'LRT_HIGH_FLOOR' },
];

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  simDay: 1,
  simWeek: 1,
  simHourMinute: '06:30',
  speed: 1,
  treasuryCad: 50_000,
  bondDebtCad: 0,
  dailyFareRevenueCad: 0,
  dailyTodTaxCad: 0,
  dailyOpExCad: 0,
  dailyRidership: 0,
  modeSharePct: 0,
  publicApprovalPct: 75,
  councilTargetPct: 55,
  onProbation: false,
  milestoneIndex: 1,
  currentAct: 1,
  activeWeather: 'CLEAR',
  activeEvents: [],
  reservePoolCount: 0,
  policyDraftPending: false,
  runOutcome: 'ACTIVE',
  activeVehicleCount: 0,
  lines: [],
  selectedInspectorData: null,
};

export interface GameBridgeHandlers {
  sendCommand: (cmd: WorkerCommand) => void;
  setInteractionTool: (tool: InteractionTool) => void;
  startEditingLine: (lineId: number, existingWaypoints: RouteWaypointInput[]) => void;
  undoDraftWaypoint: () => void;
  commitDraftLine: () => void;
  cancelDraftLine: () => void;
  resolveRiverCrossing: (crossingType: CrossingType | null) => void;
  highlightSelectedStation: (stationId: number | null) => void;
}

interface GameUiState {
  telemetry: TelemetrySnapshot;
  topology: TopologySnapshot | null;
  transportMode: TransportMode;
  activeTool: InteractionTool;
  selectedMode: TransitModeId;
  selectedPreset: EdmontonPresetSpec | null;
  draftStopCount: number;
  editingLineId: number | null;
  selectedLineId: number | null;
  selectedStationId: number | null;
  pendingRiverCrossing: PendingRiverCrossingInfo | null;
  errorMessage: string | null;
  handlers: GameBridgeHandlers | null;

  setHandlers: (handlers: GameBridgeHandlers | null) => void;
  setTransportMode: (mode: TransportMode) => void;
  setTopology: (topology: TopologySnapshot) => void;
  setTelemetry: (telemetry: TelemetrySnapshot) => void;
  setDraftState: (count: number, editingLineId: number | null) => void;
  setSelectedLineId: (lineId: number | null) => void;
  setSelectedStationId: (stationId: number | null) => void;
  setPendingRiverCrossing: (info: PendingRiverCrossingInfo | null) => void;
  setErrorMessage: (message: string | null) => void;

  setSelectedMode: (mode: TransitModeId) => void;
  setSelectedPreset: (preset: EdmontonPresetSpec | null) => void;
  setActiveTool: (tool: InteractionTool) => void;
  setSpeed: (speed: SimSpeed) => void;
  commitBusLineWaypoints: (waypoints: RouteWaypointInput[]) => void;
  commitEditedLineStops: (lineId: number, waypoints: RouteWaypointInput[]) => void;
  startEditStopsForLine: (lineId: number) => void;
  undoDraftStop: () => void;
  requestCommitDraft: () => void;
  requestCancelDraft: () => void;
  confirmRiverCrossing: (crossingType: CrossingType) => void;
  cancelRiverCrossing: () => void;

  buyVehicle: (lineId: number) => void;
  sellVehicle: (lineId: number) => void;
  setConsistCars: (lineId: number, consistCars: 1 | 2 | 3 | 4) => void;
  toggleAllDoorArc: (lineId: number, enabled: boolean) => void;
  toggleCorridorTsp: (lineId: number, enabled: boolean) => void;
  upgradeCorridor: (lineId: number, targetMode: TransitModeId) => void;
  deleteLine: (lineId: number) => void;
  removeLastStopFromLine: (lineId: number) => void;

  upgradeStationConcourse: (stationId: number, targetTier: 0 | 1 | 2) => void;
  toggleParkAndRide: (stationId: number, enabled: boolean) => void;
  repayBond: (amountCad: number) => void;
}

export const useGameStore = create<GameUiState>((set, get) => ({
  telemetry: INITIAL_TELEMETRY,
  topology: null,
  transportMode: 'TRANSFERABLE',
  activeTool: 'PAN',
  selectedMode: 'BUS_LOCAL',
  selectedPreset: null,
  draftStopCount: 0,
  editingLineId: null,
  selectedLineId: null,
  selectedStationId: null,
  pendingRiverCrossing: null,
  errorMessage: null,
  handlers: null,

  setHandlers: (handlers) => set({ handlers }),
  setTransportMode: (transportMode) => set({ transportMode }),
  setTopology: (topology) =>
    set((state) => {
      const latestLine = topology.lines[topology.lines.length - 1];
      const nextSelected =
        state.selectedLineId && topology.lines.some((l) => l.lineId === state.selectedLineId)
          ? state.selectedLineId
          : (latestLine?.lineId ?? null);
      const stationStillExists =
        state.selectedStationId !== null &&
        topology.stations.some((s) => s.stationId === state.selectedStationId);
      return {
        topology,
        selectedLineId: nextSelected,
        selectedStationId: stationStillExists ? state.selectedStationId : null,
      };
    }),
  setTelemetry: (telemetry) => set({ telemetry }),
  setDraftState: (draftStopCount, editingLineId) => set({ draftStopCount, editingLineId }),
  setSelectedLineId: (selectedLineId) => set({ selectedLineId }),
  setSelectedStationId: (selectedStationId) => {
    const handlers = get().handlers;
    handlers?.highlightSelectedStation(selectedStationId);
    handlers?.sendCommand({
      type: 'SELECT_INSPECTOR_TARGET',
      target:
        selectedStationId !== null
          ? { kind: 'STATION', stationId: selectedStationId }
          : { kind: 'NONE' },
    });
    set({ selectedStationId });
  },
  setPendingRiverCrossing: (pendingRiverCrossing) => set({ pendingRiverCrossing }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  setSelectedMode: (selectedMode) => set({ selectedMode, selectedPreset: null }),
  setSelectedPreset: (selectedPreset) =>
    set((state) => ({
      selectedPreset,
      selectedMode: selectedPreset ? selectedPreset.mode : state.selectedMode,
    })),

  setActiveTool: (tool) => {
    const handlers = get().handlers;
    handlers?.setInteractionTool(tool);
    if (tool === 'DRAW_BUS_LINE') {
      handlers?.highlightSelectedStation(null);
      set({ activeTool: tool, selectedStationId: null, errorMessage: null });
    } else {
      set({ activeTool: tool, pendingRiverCrossing: null, editingLineId: null, draftStopCount: 0 });
    }
  },

  setSpeed: (speed) => {
    get().handlers?.sendCommand({ type: 'SET_SPEED', speed });
  },

  commitBusLineWaypoints: (waypoints) => {
    const state = get();
    const index = state.telemetry.lines.length;
    const preset = state.selectedPreset;
    const duplicatePresetCount = preset
      ? state.telemetry.lines.filter((l) => l.name.startsWith(preset.name)).length
      : 0;
    const name = preset
      ? duplicatePresetCount === 0
        ? preset.name
        : `${preset.name} ${duplicatePresetCount + 1}`
      : `Route ${index + 1}`;
    const color = preset ? preset.color : LINE_PALETTE[index % LINE_PALETTE.length];
    const mode = preset ? preset.mode : state.selectedMode;

    state.handlers?.sendCommand({
      type: 'CREATE_LINE',
      name,
      color,
      mode,
      waypoints,
      initialVehicles: 1,
    });
    state.handlers?.setInteractionTool('PAN');
    set({
      activeTool: 'PAN',
      draftStopCount: 0,
      editingLineId: null,
      pendingRiverCrossing: null,
      selectedPreset: null,
      errorMessage: null,
    });
  },

  commitEditedLineStops: (lineId, waypoints) => {
    const state = get();
    state.handlers?.sendCommand({
      type: 'EDIT_LINE_STOPS',
      lineId,
      waypoints,
    });
    state.handlers?.setInteractionTool('PAN');
    set({
      activeTool: 'PAN',
      draftStopCount: 0,
      editingLineId: null,
      pendingRiverCrossing: null,
      errorMessage: null,
    });
  },

  startEditStopsForLine: (lineId) => {
    const state = get();
    const topLine = state.topology?.lines.find((l) => l.lineId === lineId);
    const stationMap = new Map(state.topology?.stations.map((s) => [s.stationId, s]) ?? []);
    if (!topLine || topLine.segments.length === 0) {
      return;
    }

    const waypoints: RouteWaypointInput[] = [];
    const firstId = topLine.segments[0].fromStationId;
    const firstSt = stationMap.get(firstId);
    if (!firstSt) {
      return;
    }
    waypoints.push({ stationId: firstSt.stationId, x: firstSt.x, y: firstSt.y, crossingType: 'NONE' });
    for (const seg of topLine.segments) {
      const toSt = stationMap.get(seg.toStationId);
      if (toSt) {
        waypoints.push({
          stationId: toSt.stationId,
          x: toSt.x,
          y: toSt.y,
          crossingType: seg.crossingType,
        });
      }
    }

    state.handlers?.highlightSelectedStation(null);
    state.handlers?.startEditingLine(lineId, waypoints);
    set({
      activeTool: 'DRAW_BUS_LINE',
      selectedLineId: lineId,
      selectedStationId: null,
      editingLineId: lineId,
      draftStopCount: waypoints.length,
      errorMessage: null,
    });
  },

  undoDraftStop: () => {
    get().handlers?.undoDraftWaypoint();
  },

  requestCommitDraft: () => {
    get().handlers?.commitDraftLine();
  },

  requestCancelDraft: () => {
    get().handlers?.cancelDraftLine();
    get().handlers?.setInteractionTool('PAN');
    set({
      activeTool: 'PAN',
      draftStopCount: 0,
      editingLineId: null,
      pendingRiverCrossing: null,
    });
  },

  confirmRiverCrossing: (crossingType) => {
    get().handlers?.resolveRiverCrossing(crossingType);
    set({ pendingRiverCrossing: null, errorMessage: null });
  },

  cancelRiverCrossing: () => {
    get().handlers?.resolveRiverCrossing(null);
    set({ pendingRiverCrossing: null });
  },

  buyVehicle: (lineId) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'BUY_VEHICLE', lineId, count: 1 });
  },

  sellVehicle: (lineId) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'SELL_VEHICLE', lineId, count: 1 });
  },

  setConsistCars: (lineId, consistCars) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'SET_CONSIST_CARS', lineId, consistCars });
  },

  toggleAllDoorArc: (lineId, enabled) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'SET_ALL_DOOR_ARC', lineId, enabled });
  },

  toggleCorridorTsp: (lineId, enabled) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'SET_CORRIDOR_TSP', lineId, enabled });
  },

  upgradeCorridor: (lineId, targetMode) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'UPGRADE_CORRIDOR', lineId, targetMode });
  },

  deleteLine: (lineId) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'DELETE_LINE', lineId });
  },

  removeLastStopFromLine: (lineId) => {
    const state = get();
    const topLine = state.topology?.lines.find((l) => l.lineId === lineId);
    const stationMap = new Map(state.topology?.stations.map((s) => [s.stationId, s]) ?? []);
    if (!topLine || topLine.segments.length <= 1) {
      return;
    }
    const waypoints: RouteWaypointInput[] = [];
    const firstSt = stationMap.get(topLine.segments[0].fromStationId);
    if (!firstSt) {
      return;
    }
    waypoints.push({ stationId: firstSt.stationId, x: firstSt.x, y: firstSt.y, crossingType: 'NONE' });
    for (let i = 0; i < topLine.segments.length - 1; i++) {
      const seg = topLine.segments[i];
      const toSt = stationMap.get(seg.toStationId);
      if (toSt) {
        waypoints.push({
          stationId: toSt.stationId,
          x: toSt.x,
          y: toSt.y,
          crossingType: seg.crossingType,
        });
      }
    }
    state.handlers?.sendCommand({ type: 'EDIT_LINE_STOPS', lineId, waypoints });
  },

  upgradeStationConcourse: (stationId, targetTier) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'UPGRADE_STATION_CONCOURSE', stationId, targetTier });
  },

  toggleParkAndRide: (stationId, enabled) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'TOGGLE_PARK_AND_RIDE', stationId, enabled });
  },

  repayBond: (amountCad) => {
    set({ errorMessage: null });
    get().handlers?.sendCommand({ type: 'REPAY_BOND', amountCad });
  },
}));
