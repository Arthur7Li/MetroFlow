# Technical Stack & System Architecture
## High-Performance Web Game Engine for *YEG Transit Architect*

---

## 1. Architectural Philosophy

To deliver a **Steam-quality simulation** that runs natively in a browser at a locked $60\text{--}120\text{ FPS}$—even in the late game with **100,000+ active commuters, 2,500+ vehicles, and 500+ stations**—we cannot rely on standard DOM elements or naive object-oriented JavaScript loops on the main thread.

Our architecture is built on four uncompromising engineering principles:
1. **Strict Thread Decoupling:** The Main Thread only handles **WebGPU/WebGL2 Rendering** and **UI Input**. All simulation ticks, agent updates, and graph recalculations run inside a dedicated **Simulation Web Worker**.
2. **Data-Oriented Design (Structure of Arrays - SoA):** Commuters and vehicles are stored in contiguous flat `TypedArray` buffers (`Float32Array`, `Uint32Array`, `Uint16Array`) backed by a `SharedArrayBuffer`, eliminating garbage collection (GC) pauses and maximizing CPU L1/L2 cache locality.
3. **$O(1)$ Pre-Computed Next-Hop Routing:** Commuters never run A* or Dijkstra during the 60Hz simulation loop. Instead, a **Next-Hop Lookup Matrix** is computed asynchronously only when the player edits a transit line.
4. **Data-Driven City Packs:** All city geometry (rivers, arterial roads, neighborhoods, landmarks) is loaded from compact GeoJSON/TopoJSON manifests, making Edmonton and future global cities 100% modular.

---

## 2. Recommended Tech Stack (2026 Web Game Standard)

| Layer | Technology | Justification |
| :--- | :--- | :--- |
| **Language & Tooling** | **TypeScript 5.x + Vite 6 + pnpm** | Instant HMR, strict typing for `TypedArray` schemas, native Web Worker bundling, and zero-config WebAssembly support. |
| **2D/2.5D Rendering** | **PixiJS v8 (WebGPU / WebGL2)** | PixiJS v8 features a ground-up WebGPU renderer capable of drawing $100,000+$ instanced sprites/particles and smooth anti-aliased Bezier transit lines at $120\text{ FPS}$. |
| **Vector Curves & shaders** | **Custom WGSL / GLSL Shaders** | Used for animated dashed bus lanes, glowing LRT headway pulses, River Valley water flow, and snow/blizzard weather shaders. |
| **Simulation & ECS** | **bitECS** (or custom SoA TypedArrays) | Ultra-fast Data-Oriented Entity Component System operating directly on raw memory buffers (`SharedArrayBuffer`). |
| **UI & HUD Overlay** | **React 19 + Tailwind CSS + Zustand** | Renders crisp, accessible glassmorphic menus, telemetry charts, and policy decks over the canvas without re-rendering on every frame. |
| **Audio Engine** | **Web Audio API + Tone.js / Howler.js** | Low-latency procedural synthesis for ETS door chimes, ARC card taps, and dynamic ambient music that reacts to network load. |
| **Persistence & Saves** | **IndexedDB (via Dexie.js) + LZ-String** | Instant local auto-saves, replay snapshots, and shareable compressed URL strings for custom scenarios. |

---

## 3. High-Level System Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                MAIN BROWSER THREAD                                |
|                                                                                   |
|  +-------------------------------------+   +-----------------------------------+  |
|  |       PixiJS v8 Render Engine       |   |     React 19 + Zustand HUD UI     |  |
|  |  - WebGPU Instanced Vehicle Layer   |   |  - Line Builder & Fleet Manager   |  |
|  |  - Custom Shader Transit Corridors  |   |  - Policy Deck & TOD Upzoning UI  |  |
|  |  - River Valley & Map Vector Layer  |   |  - Throttled 4Hz Telemetry Sync   |  |
|  +------------------+------------------+   +-----------------+-----------------+  |
|                     ^                                        |                    |
|                     | Zero-Copy Read (60-120Hz)              | Commands (PostMsg) |
+---------------------|----------------------------------------|--------------------+
                      |                                        v
+---------------------|-------------------------------------------------------------+
|                     +--> [ SharedArrayBuffer (Render State) ]                     |
|                                        ^                                          |
|                           SIMULATION WEB WORKER THREAD                            |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                        Fixed-Timestep Loop (30Hz / 60Hz)                    |  |
|  |                                                                             |  |
|  |  1. Demand Spawner     --> Gravity Model & Time-of-Day Pulse Generator      |  |
|  |  2. Vehicle Kinematics --> Acceleration, Dwell Timers & Headway Spacing     |  |
|  |  3. Boarding/Alighting --> O(1) Next-Hop Matrix Lookup & ARC Revenue Calc   |  |
|  |  4. Auto-Dispatcher AI --> Dynamic Peak/Off-Peak Fleet Scaling              |  |
|  |  5. TOD City Evolution --> Land Value & Density Growth around Stations      |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 4. Deep Dive: Scaling to 100,000+ Agents on the Web

### 4.1 Structure-of-Arrays (SoA) Memory Layout
Instead of creating $100,000$ JavaScript objects (`{ id, x, y, origin, dest }`) which causes massive memory overhead and garbage collection stutters, we allocate fixed contiguous buffers inside our `SharedArrayBuffer`:

```typescript
// Capacity for 100,000 active commuters in < 1.6 MB of RAM!
export const MAX_AGENTS = 100_000;

export interface AgentStoreSoA {
  active: Uint8Array;          // 0 = inactive, 1 = waiting at station, 2 = on vehicle
  currentNodeId: Uint16Array;  // Station ID or Vehicle ID (up to 65,535)
  destStationId: Uint16Array;  // Final target Station ID
  nextHopLineId: Uint16Array;  // Pre-calculated optimal Line ID to board next
  waitTimer: Float32Array;     // Seconds spent waiting (drives satisfaction)
  tripStartTime: Float32Array; // Used to calculate realized Generalized Cost C_ij
}
```

### 4.2 The $O(1)$ All-Pairs Next-Hop Routing Table
Running pathfinding for $100,000$ agents every frame would melt any CPU. However, in a transit network, the number of **Stations ($N$)** is relatively small ($N \le 512$, even in a massive late-game city).

Whenever the player adds a stop, upgrades a line, or modifies headways, the worker runs a fast **Multi-Criteria Modified Floyd-Warshall / All-Pairs Dijkstra** algorithm across the $N$ stations and writes the result into two flat lookup tables:
1. `nextLineTable[originStation * MAX_STATIONS + destStation]: Uint16`
2. `transferStationTable[originStation * MAX_STATIONS + destStation]: Uint16`

For a $512$-station network, $512 \times 512 \times 2\text{ bytes} = 512\text{ KB}$—fitting entirely inside the CPU L2 cache!

**Result during the 60Hz Simulation Tick:**
* When Vehicle $V$ on Line $L$ arrives at Station $S$:
  * Each riding passenger checks: `transferStationTable[S * N + p.dest]`. If `S` is their destination or optimal transfer hub, they alight in **$O(1)$ time** (a single array index read).
  * Waiting passengers at Station $S$ whose `nextLineTable[S * N + p.dest] === L` board the vehicle in **$O(1)$ time**.

### 4.3 Edge-Cost Formulation for Realistic Pathfinding
When building the lookup table, the edge weight $W(u, v, L)$ between station $u$ and station $v$ on line $L$ incorporates real transit engineering factors:

$$W(u, v, L) = \frac{d(u, v)}{v_{\text{mode}}(L) \cdot \eta_{\text{weather}}} + \tau_{\text{dwell}} + \delta_{\text{transfer}} \cdot \left(\frac{H(L)}{2} + P_{\text{concourse}}(u)\right)$$

Where:
* $d(u, v)$ is track/road distance and $v_{\text{mode}}(L)$ is the vehicle cruise speed.
* $\eta_{\text{weather}}$ is the current weather modifier (e.g., $0.68$ for buses in a blizzard without winter tires; $1.0$ for grade-separated LRT).
* $H(L)$ is the current headway of Line $L$ (average wait time is half the headway: $\frac{H(L)}{2}$).
* $P_{\text{concourse}}(u)$ is the station transfer friction penalty (reduced by upgrading the station concourse).

---

## 5. Multi-City Data Pipeline & Schema

Every city lives in its own self-contained folder under `src/cities/<city_id>/`. Adding a new city after Edmonton requires only three files:

```json
// src/cities/edmonton/manifest.json
{
  "id": "edmonton_yeg",
  "name": "Edmonton",
  "region": "Alberta, Canada",
  "currency": "CAD",
  "fareSystemName": "ARC Card",
  "worldBounds": { "width": 4000, "height": 3200 },
  "startingCamera": { "x": 2000, "y": 1600, "zoom": 0.75 },
  "climateProfile": "PRAIRIE_WINTER_CITY",
  "elevationObstacles": [
    {
      "id": "north_saskatchewan_river_valley",
      "type": "RIVER_VALLEY_GORGE",
      "bridgeCostMultiplier": 2.4,
      "tunnelCostMultiplier": 3.2
    }
  ],
  "defaultLines": [
    { "badge": "CAP", "name": "Capital Line", "color": "#2563eb", "mode": "LRT_HIGH_FLOOR" },
    { "badge": "VAL", "name": "Valley Line", "color": "#10b981", "mode": "LRT_LOW_FLOOR" },
    { "badge": "MET", "name": "Metro Line", "color": "#ef4444", "mode": "LRT_HIGH_FLOOR" }
  ]
}
```

### Offline GIS-to-Game Map Converter Script (`tools/import-osm.ts`)
To rapidly build new cities (Montreal, Vancouver, Tokyo, London):
1. A Node CLI script queries **OpenStreetMap (Overpass API)** for waterways, coastlines, primary/motorway highways, and existing transit hubs for a bounding box.
2. It runs **Ramer–Douglas–Peucker (RDP)** polygon simplification so rivers and ring roads (like Anthony Henday Drive) look crisp, stylized, and render with minimal vertices.
3. Outputs a compressed `geometry.json` and `nodes.json` directly into `src/cities/<city_id>/`.

---

## 6. Repository Directory Structure (Ready for Antigravity)

```text
yeg-transit-architect/
├── README.md
├── GAME_DESIGN.md                 # High-level game design & mechanics
├── ARCHITECTURE.md                # Technical stack & system architecture
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── tools/
│   └── import-osm.ts              # CLI script to convert OSM/GeoJSON into City Packs
└── src/
    ├── main.tsx                   # App entry point
    ├── config/
    │   ├── modes.ts               # Bus, BRT, Low-Floor Tram, High-Floor LRT specs
    │   ├── policies.ts            # City Council roguelite policy deck definitions
    │   └── upgrades.ts            # OCC automation modules & station upgrades
    ├── cities/
    │   ├── types.ts               # CityManifest, DistrictSeed, EventProfile interfaces
    │   ├── edmonton/              # Flagship Map 01: Edmonton (YEG)
    │   │   ├── manifest.json
    │   │   ├── geometry.json      # North Saskatchewan River, Henday, Whitemud, Yellowhead
    │   │   ├── nodes.json         # Authentic YEG neighborhoods, campuses & hubs
    │   │   └── events.ts          # Oilers playoffs, Fringe Fest, -35C Polar Vortex
    │   └── montreal/              # Future Map 02: Montreal (YUL)
    ├── core/                      # Pure TypeScript Simulation Engine (Runs in Web Worker)
    │   ├── worker.ts              # Worker entry point & message bus
    │   ├── memory/
    │   │   └── sharedBuffers.ts   # SharedArrayBuffer SoA allocation & typed views
    │   ├── ecs/
    │   │   ├── agents.ts          # 100k commuter SoA store & lifecycle
    │   │   ├── vehicles.ts        # Kinematics, acceleration, dwell & headway spacing
    │   │   └── stations.ts        # Platform queues, concourse levels & TOD density
    │   ├── routing/
    │   │   └── pathfinder.ts      # All-Pairs Dijkstra & O(1) Next-Hop Lookup Matrix
    │   └── systems/
    │       ├── demandSystem.ts    # Gravity model & 24h rush-hour wave generator
    │       ├── dispatchSystem.ts  # Act II Auto-Headway & Feeder AI automation
    │       ├── todSystem.ts       # Act III Transit-Oriented Development city growth
    │       └── weatherSystem.ts   # Seasonal transitions & special event triggers
    ├── renderer/                  # PixiJS v8 WebGPU / WebGL2 Map Renderer
    │   ├── MapViewport.ts         # Smooth pan/zoom camera & coordinate transforms
    │   ├── layers/
    │   │   ├── TerrainLayer.ts    # River valley, parks, arterial grid & snow shader
    │   │   ├── NetworkLayer.ts    # Parallel offset bezier tracks, bridges & tunnels
    │   │   ├── VehicleLayer.ts    # Instanced GPU rendering for thousands of vehicles
    │   │   └── StationLayer.ts    # Station nodes, heatmaps & commuter queue pips
    │   └── shaders/
    │       ├── river.wgsl         # Subtle animated water & winter ice freeze shader
    │       └── trackPulse.wgsl    # Headway flow visualization shader
    ├── audio/
    │   └── SoundscapeEngine.ts    # Procedural Web Audio API chimes & pentatonic cues
    └── ui/                        # React 19 + Tailwind CSS + Zustand HUD
        ├── store/
        │   └── useGameStore.ts    # Zustand bridge syncing Worker telemetry at 4Hz
        ├── components/
        │   ├── TopTelemetryBar.tsx
        │   ├── LineManagerSidebar.tsx
        │   ├── StationInspectorModal.tsx
        │   ├── OCCAutomationPanel.tsx
        │   └── CouncilElectionModal.tsx
        └── overlays/
            └── LayerToggles.tsx   # Heatmap toggles (Crowding, Land Value, Headways)
```

---

## 7. Phased Implementation Roadmap for Antigravity

When working with Antigravity in your repository, execute the build in these **5 clean, testable sprints**:

* **Milestone 1: Engine Foundation & Edmonton GIS Map (`v0.1`)**
  * Scaffold Vite + TypeScript + PixiJS v8 + React/Tailwind + Zustand.
  * Implement `TerrainLayer` rendering Edmonton's North Saskatchewan River Valley, ravine system, and arterial corridors (Anthony Henday, Whitemud, Yellowhead, Calgary Trail) with smooth pan/zoom.
* **Milestone 2: Web Worker ECS & $O(1)$ Routing Matrix (`v0.2`)**
  * Set up the `SharedArrayBuffer` pipeline between the Simulation Worker and Main Thread.
  * Implement the SoA Agent Store and the $O(1)$ All-Pairs Next-Hop Lookup Table. Verify 50,000+ commuters routing and transferring seamlessly at 60 FPS.
* **Milestone 3: Tactile Line Builder & River Crossing Physics (`v0.3`)**
  * Build the interactive Bezier/Metro-style route drawing tool with automatic parallel line offsetting (so Capital and Metro lines run side-by-side cleanly from Churchill to NAIT/Health Sciences).
  * Add Bridge vs. Tunnel river-crossing prompts and differentiated Transit Modes (ETS Bus, BRT, Low-Floor Valley Line LRT, High-Floor Capital Line LRT).
* **Milestone 4: "The Network Must Grow" Automation & TOD (`v0.4`)**
  * Implement the **OCC Auto-Headway Dispatcher** (eliminating manual vehicle buying in the mid-game) and **Suburban Feeder Catchment Zones**.
  * Add **Transit-Oriented Development (TOD)** where well-served Edmonton stations visibly sprout mid-rise and high-rise buildings, increasing catchment population.
* **Milestone 5: Replayability Deck, Audio & Multi-City Loader (`v1.0`)**
  * Add the **City Council Election Policy Deck**, Edmonton Crisis Scenarios (*-40°C Polar Vortex*, *Stanley Cup Finals*), procedural pentatonic audio chimes, and the City Pack selector menu.