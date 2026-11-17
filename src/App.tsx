import { useEffect, useRef } from 'react';
import edmontonGeometryRaw from './cities/edmonton/geometry.json';
import edmontonManifestRaw from './cities/edmonton/manifest.json';
import edmontonNodesRaw from './cities/edmonton/nodes.json';
import type { CityManifest, CityNodeSeed, GeometryPack } from './cities/types';
import { WorkerClient } from './core/workerClient';
import { RenderController } from './renderer/RenderController';
import { MapInteractionController } from './renderer/interaction/MapInteractionController';
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
        onDraftChanged: (count) => {
          useGameStore.getState().setDraftStopCount(count);
        },
      },
    );

    store.setTransportMode(client.getTransportMode());
    store.setHandlers({
      sendCommand: (cmd) => client.sendCommand(cmd),
      setInteractionTool: (tool) => interaction?.setTool(tool),
      commitDraftLine: () => interaction?.commitDraft(),
      cancelDraftLine: () => interaction?.cancelDraft(),
    });

    const onKeyToggle = (e: KeyboardEvent): void => {
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
    </main>
  );
}
export default App;
