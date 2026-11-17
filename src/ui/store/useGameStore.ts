import { create } from 'zustand';
import type {
  RouteWaypointInput,
  SimSpeed,
  TelemetrySnapshot,
  TopologySnapshot,
  TransportMode,
  WorkerCommand,
} from '../../core/contracts';
import type { InteractionTool } from '../../renderer/interaction/MapInteractionController';

const LINE_PALETTE = ['#38bdf8', '#f59e0b', '#10b981', '#a855f7', '#f43f5e'];

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
  commitDraftLine: () => void;
  cancelDraftLine: () => void;
}

interface GameUiState {
  telemetry: TelemetrySnapshot;
  topology: TopologySnapshot | null;
  transportMode: TransportMode;
  activeTool: InteractionTool;
  draftStopCount: number;
  selectedLineId: number | null;
  errorMessage: string | null;
  handlers: GameBridgeHandlers | null;

  setHandlers: (handlers: GameBridgeHandlers | null) => void;
  setTransportMode: (mode: TransportMode) => void;
  setTopology: (topology: TopologySnapshot) => void;
  setTelemetry: (telemetry: TelemetrySnapshot) => void;
  setDraftStopCount: (count: number) => void;
  setSelectedLineId: (lineId: number | null) => void;
  setErrorMessage: (message: string | null) => void;

  setActiveTool: (tool: InteractionTool) => void;
  setSpeed: (speed: SimSpeed) => void;
  commitBusLineWaypoints: (waypoints: RouteWaypointInput[]) => void;
  requestCommitDraft: () => void;
  requestCancelDraft: () => void;
  buyBusOnSelectedLine: () => void;
}

export const useGameStore = create<GameUiState>((set, get) => ({
  telemetry: INITIAL_TELEMETRY,
  topology: null,
  transportMode: 'TRANSFERABLE',
  activeTool: 'PAN',
  draftStopCount: 0,
  selectedLineId: null,
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
      return { topology, selectedLineId: nextSelected };
    }),
  setTelemetry: (telemetry) => set({ telemetry }),
  setDraftStopCount: (draftStopCount) => set({ draftStopCount }),
  setSelectedLineId: (selectedLineId) => set({ selectedLineId }),
  setErrorMessage: (errorMessage) => set({ errorMessage }),

  setActiveTool: (tool) => {
    get().handlers?.setInteractionTool(tool);
    set({ activeTool: tool });
  },

  setSpeed: (speed) => {
    get().handlers?.sendCommand({ type: 'SET_SPEED', speed });
  },

  commitBusLineWaypoints: (waypoints) => {
    const state = get();
    const index = state.telemetry.lines.length;
    const color = LINE_PALETTE[index % LINE_PALETTE.length];
    state.handlers?.sendCommand({
      type: 'CREATE_LINE',
      name: `Route ${index + 1}`,
      color,
      mode: 'BUS_LOCAL',
      waypoints,
      initialVehicles: 1,
    });
    state.handlers?.setInteractionTool('PAN');
    set({ activeTool: 'PAN', draftStopCount: 0, errorMessage: null });
  },

  requestCommitDraft: () => {
    get().handlers?.commitDraftLine();
  },

  requestCancelDraft: () => {
    get().handlers?.cancelDraftLine();
    get().handlers?.setInteractionTool('PAN');
    set({ activeTool: 'PAN', draftStopCount: 0 });
  },

  buyBusOnSelectedLine: () => {
    const state = get();
    const targetId =
      state.selectedLineId ?? state.telemetry.lines[state.telemetry.lines.length - 1]?.lineId;
    if (targetId === undefined || targetId === null) {
      return;
    }
    state.handlers?.sendCommand({ type: 'BUY_VEHICLE', lineId: targetId, count: 1 });
  },
}));
