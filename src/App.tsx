import { useEffect, useRef } from 'react';
import edmontonGeometryRaw from './cities/edmonton/geometry.json';
import edmontonManifestRaw from './cities/edmonton/manifest.json';
import edmontonNodesRaw from './cities/edmonton/nodes.json';
import type { CityManifest, CityNodeSeed, GeometryPack } from './cities/types';
import { WorkerClient } from './core/workerClient';
import { RenderController } from './renderer/RenderController';
import { MapInteractionController } from './renderer/interaction/MapInteractionController';
import { LineManagerSidebar } from './ui/components/LineManagerSidebar';
import { RiverCrossingModal } from './ui/components/RiverCrossingModal';
import { StationInspectorModal } from './ui/components/StationInspectorModal';
import { TopTelemetryBar } from './ui/components/TopTelemetryBar';
import { useGameStore } from './ui/store/useGameStore';

const edmontonManifest = edmontonManifestRaw as CityManifest;
const edmontonGeometry = edmontonGeometryRaw as GeometryPack;
const edmontonNodes = edmontonNodesRaw as CityNodeSeed[];

export function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const store = useGameStore.getState();
    let interaction: MapInteractionController | null = null;
    let disposed = false;

    const client = new WorkerClient({
      onReady: (mode) => {
        useGameStore.getState().setTransportMode(mode);
      },
      onTopology: (topology) => {
        renderController.applyTopology(topology);
        interaction?.setStations(topology.stations);
        useGameStore.getState().setTopology(topology);
      },
      onTelemetry: (telemetry) => {
        useGameStore.getState().setTelemetry(telemetry);
      },
      onError: (msg) => {
        useGameStore.getState().setErrorMessage(msg);
      },
    });

    const renderController = new RenderController(host, edmontonManifest, edmontonGeometry, client);
    interaction = new MapInteractionController(
      host,
      renderController.viewport,
      renderController.networkLayer,
      renderController.stationLayer,
      {
        onCommitBusLine: (waypoints) => {
          useGameStore.getState().commitBusLineWaypoints(waypoints);
        },
        onEditLineStops: (lineId, waypoints) => {
          useGameStore.getState().commitEditedLineStops(lineId, waypoints);
        },
        onDraftChanged: (count, editingLineId) => {
          useGameStore.getState().setDraftState(count, editingLineId);
        },
        onSelectStation: (stationId) => {
          useGameStore.getState().setSelectedStationId(stationId);
        },
        onRequireRiverCrossing: (info) => {
          useGameStore.getState().setPendingRiverCrossing(info);
        },
      },
      edmontonGeometry,
      edmontonManifest.worldUnitsPerKm,
    );

    store.setTransportMode(client.getTransportMode());
    store.setHandlers({
      sendCommand: (cmd) => client.sendCommand(cmd),
      setInteractionTool: (tool) => interaction?.setTool(tool),
      startEditingLine: (lineId, existingWaypoints) =>
        interaction?.startEditingLine(lineId, existingWaypoints),
      undoDraftWaypoint: () => interaction?.undoLastWaypoint(),
      commitDraftLine: () => interaction?.commitDraft(),
      cancelDraftLine: () => interaction?.cancelDraft(),
      resolveRiverCrossing: (crossingType) => interaction?.resolveRiverCrossing(crossingType),
      highlightSelectedStation: (stationId) =>
        renderController.stationLayer.setSelectedStation(stationId),
    });

    const onKeyToggle = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'b' || e.key === 'B') {
        const current = useGameStore.getState().activeTool;
        useGameStore.getState().setActiveTool(current === 'PAN' ? 'DRAW_BUS_LINE' : 'PAN');
      }
    };
    window.addEventListener('keydown', onKeyToggle);

    void renderController.start().then(() => {
      if (disposed) {
        return;
      }
      client.sendCommand({
        type: 'INIT_CITY',
        manifest: edmontonManifest,
        geometry: edmontonGeometry,
        nodes: edmontonNodes,
        events: [],
        growthSeed: 'SEED_A',
      });
    });

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyToggle);
      store.setHandlers(null);
      interaction?.dispose();
      renderController.dispose();
      client.dispose();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0b0f17]">
      <div ref={canvasHostRef} className="h-full w-full cursor-grab active:cursor-grabbing" />
      <TopTelemetryBar />
      <LineManagerSidebar />
      <StationInspectorModal />
      <RiverCrossingModal />
    </main>
  );
}
export default App;
