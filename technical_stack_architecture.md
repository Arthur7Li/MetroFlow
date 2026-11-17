# Technical Stack & System Architecture
*High-Performance Web Game Engine for YEG Transit Architect (MetroFlow) — Companion Game Design: [game_design_document.md](./game_design_document.md)*

---

## 1. Architectural Philosophy

### 1.1 Problem Statement
Running an urban transit simulation in a browser while targeting **60–120 FPS rendering** with up to **100,000 weighted passenger cohorts/commuters, 2,500 vehicles, and 512 stations** fails under naive main-thread object-oriented architectures. Per-frame DOM updates, frequent JavaScript object allocation inside simulation ticks, and per-agent shortest-path searches quickly exhaust the 8.3–16.6ms browser frame budget and trigger garbage collection (GC) pauses.

### 1.2 Core Engineering Principles
1. **Strict Thread Decoupling:** The Main Thread handles only **WebGPU/WebGL2 Interpolated Rendering (60–120Hz)** and **UI Input**. All simulation ticks (**30Hz fixed timestep**), cohort updates, and graph recalculations run inside a dedicated **Simulation Web Worker**.
2. **Data-Oriented Design (Structure of Arrays - SoA):** Weighted commuter cohorts and routing structures live in worker-private contiguous `TypedArray` buffers (`Float32Array`, `Uint32Array`, `Uint16Array`, `Int32Array`) to avoid per-tick simulation-loop allocation and GC pressure. Renderable vehicle and station states publish into a double-buffered `SharedArrayBuffer` render snapshot coordinated via `Atomics` (with an automatic transferable `ArrayBuffer` fallback when cross-origin isolation is unavailable).
3. **$O(1)$ Pre-Computed Next-Hop Routing:** Commuters never run pathfinding during the 30Hz simulation tick. Instead, **Time-Sliced Sparse All-Pairs Dijkstra** over a **Route-Segment Graph** asynchronously populates a double-buffered lookup matrix on route edits and major headway/weather shifts.
4. **Data-Driven City Packs:** City geometry, node seeds, and event schedules live in static JSON manifests (`manifest.json`, `geometry.json`, `nodes.json`, `events.json`), making Edmonton data-driven and enabling Post-MVP expansion cities through declarative capability traits.

### 1.3 Goals & Non-Goals
* **Goals:**
  * Maintain 60–120 FPS interpolated map rendering independently of a bounded `< 4ms` 30Hz worker simulation tick.
  * Guarantee tear-free cross-thread frame snapshots via double buffering and `Atomics`, with seamless fallback on hosts lacking Cross-Origin Isolation headers.
  * Eliminate $O(N_{\text{agents}})$ linear scans during station boarding/alighting and $O(N^3)$ synchronous pathfinding stalls.
* **Non-Goals:**
  * Server-side authoritative simulation or multiplayer lockstep synchronization.
  * Mobile browser memory guarantees below desktop/laptop WebGPU/WebGL2 baselines.
  * Dynamic street-level private-car pathfinding or turn-by-turn road traffic microsimulation.

---

## 2. Recommended Tech Stack

| Layer | Technology | Justification |
| :--- | :--- | :--- |
| **Language & Tooling** | **TypeScript 5.x + Vite 6 + pnpm** | Fast Hot Module Replacement (HMR), strict typing for `TypedArray` views, and native Web Worker module bundling. |
| **2D/2.5D Rendering** | **PixiJS v8 (WebGPU primary / WebGL2 fallback)** | Hardware-accelerated instanced sprite/particle batching and anti-aliased corridor rendering targeting 60–120 FPS with automatic WebGL2 fallback. |
| **Vector Curves & Shaders** | **PixiJS Graphics & Instanced Sprites (MVP); Dual WGSL/GLSL Shaders (Post-MVP)** | MVP uses standard PixiJS primitives so WebGPU and WebGL2 render identically without shader-backend mismatches; Post-MVP adds paired WGSL/GLSL shaders for river flow, snow, and track headway pulses. |
| **Simulation & State** | **Custom SoA `TypedArray` Stores** | Pre-allocated contiguous typed buffers avoid simulation-loop object churn and fit directly over `SharedArrayBuffer` views without external ECS abstraction lock-in. |
| **UI & HUD Overlay** | **React 19 + Tailwind CSS + Zustand** | Renders glassmorphic menus, telemetry charts, and Council policy modals over the canvas without per-frame re-renders, updated via throttled 4Hz `postMessage` telemetry snapshots. |
| **Audio Engine** | **Native Web Audio API (`AudioContext`)** | Zero-dependency procedural synthesis for **ETS** (Edmonton Transit Service) door chimes, **ARC** (smart fare card) taps, and modal pentatonic soundscapes. |
| **Persistence & Saves** | **IndexedDB (via Dexie.js) + LZ-String** | IndexedDB stores full local binary simulation snapshots and auto-saves; `LZ-String` encodes only the compact **Network & Policy Blueprint** (stations, lines, upgrades, growth seed; $<4\text{ KB}$) for shareable URLs. |

---

## 3. High-Level System Architecture Diagram

```text
+-----------------------------------------------------------------------------------+
|                                MAIN BROWSER THREAD                                |
|                                                                                   |
|  +-------------------------------------+   +-----------------------------------+  |
|  |       PixiJS v8 Render Engine       |   |     React 19 + Zustand HUD UI     |  |
|  |  - WebGPU/WebGL2 Instanced Vehicles |   |  - Line Builder & Fleet Manager   |  |
|  |  - Offset Bezier Corridor Layer     |   |  - Policy Deck & TOD Upzoning UI  |  |
|  |  - River Valley & Map Vector Layer  |   |  - Throttled 4Hz Telemetry Sync   |  |
|  +------------------+------------------+   +-----------------+-----------------+  |
|                     ^                                        |                    |
|                     | Lock-Free Snapshot Read (60-120Hz)     | Commands (PostMsg) |
+---------------------|----------------------------------------|--------------------+
                      |   [ Double-Buffered Render Snapshot ]  |
                      |   (SharedArrayBuffer + Atomics Index,  |
                      |    or Transferable ArrayBuffer Fallback)|
+---------------------|----------------------------------------v--------------------+
|                           SIMULATION WEB WORKER THREAD                            |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                         Fixed-Timestep Loop (30Hz)                          |  |
|  |                                                                             |  |
|  |  1. Demand Spawner     --> Time-Sliced Gravity + Logit Mode Split (1Hz full)|  |
|  |  2. Vehicle Kinematics --> Acceleration, Slope Penalty, Dwell & Spacing     |  |
|  |  3. Boarding/Alighting --> O(1) Lookup Matrix, Intrusive Lists & ARC Fares  |  |
|  |  4. Auto-Dispatcher AI --> OCC Fleet Scaling with OpEx & Headway Governor   |  |
|  |  5. TOD City Evolution --> Logistic Density Growth (Capped at K_i)          |  |
|  |  6. Shadow Pathfinder  --> Time-Sliced Sparse Dijkstra (32 origins/tick)    |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Cross-Thread Synchronization & Telemetry Boundary
* **60–120Hz Render Snapshot (`SharedArrayBuffer` / Transferable Fallback):** Carries only double-buffered `VehicleRenderSoA` and `StationRenderSoA` arrays (`prevX`, `prevY`, `currX`, `currY`, bearing, line ID, load ratio, station queue totals, TOD tier). The Simulation Worker writes into the inactive back slot, emits `Atomics.store` on the active-buffer index at tick completion, and the Main Thread interpolates between `prev` and `curr` coordinates at native refresh rate (`60–120Hz`) with zero mid-tick tearing. When `self.crossOriginIsolated === false`, the worker automatically falls back to transferring ping-pong `ArrayBuffer` snapshots over `postMessage`.
* **4Hz Throttled Telemetry Sync (`postMessage`):** Publishes low-frequency React UI state—treasury balance, daily OpEx/ARC fare revenue, city-wide Mode Share %, Public Approval, active Ridership Milestone/Act, Council Policy Deck state, weather/event alerts, and inspector modal details for the currently selected station or line.

---

## 4. Deep Dive: Scaling to 100,000+ Agents on the Web

### 4.1 Structure-of-Arrays (SoA) Memory Layout
Worker-private simulation state separates commuter cohort routing/timers (`AgentStoreSoA`) from the double-buffered render snapshot (`VehicleRenderSoA` and `StationRenderSoA`). To handle late-game demand surges beyond $100,000$ daily riders within fixed memory, `AgentStoreSoA` uses **weighted passenger cohorts** (`passengerCount`) and **intrusive doubly-linked lists** per station and vehicle:

```typescript
// Worker-private SoA cohort store: 100,000 cohort slots (~3.2 MB fixed allocation)
export const MAX_AGENTS = 100_000;
export const MAX_STATIONS = 512;
export const MAX_VEHICLES = 4_096;

export interface AgentStoreSoA {
  active: Uint8Array;          // 0 = free, 1 = waiting at station, 2 = riding vehicle
  passengerCount: Uint16Array; // Riders in cohort; demandSystem coalesces identical (origin, dest) above 70% pool load
  currentNodeId: Uint16Array;  // Station ID (0..511) or Vehicle ID (0..4095)
  originStationId: Uint16Array;// Trip origin station ID (for realized Generalized Cost C_ij)
  destStationId: Uint16Array;  // Final destination station ID
  alightStationId: Uint16Array;// Assigned on boarding from alightStationTable[S * MAX_STATIONS + dest]
  waitTimer: Float32Array;     // Cumulative waiting seconds (drives rider satisfaction & Public Approval)
  tripStartTime: Float32Array; // Simulation timestamp at trip start (computes realized C_ij on arrival)
  nextInNode: Int32Array;      // Intrusive list next-index (-1 = tail) indexed by headAgentByStation / headAgentByVehicle
  prevInNode: Int32Array;      // Intrusive list prev-index (-1 = head) for O(1) cohort removal
}

// Double-buffered SharedArrayBuffer Render Snapshot (Front + Back slots)
export interface VehicleRenderSoA {
  prevX: Float32Array; prevY: Float32Array;
  currX: Float32Array; currY: Float32Array;
  bearing: Float32Array;
  lineId: Uint16Array;
  modeTier: Uint8Array;
  loadRatio: Uint8Array;       // Normalized 0..255 occupancy for HUD heatmaps and sprite fill
}

export interface StationRenderSoA {
  waitingCount: Uint32Array;   // Sum of cohort passengerCount values waiting at station
  todLevel: Uint8Array;        // Current TOD upzoning tier (0..5)
  concourseTier: Uint8Array;   // 0 = Curbside, 1 = Heated Transit Centre, 2 = Multi-Modal Pedway
}
```

### 4.2 The $O(1)$ All-Pairs Next-Hop Routing Table
Running per-frame pathfinding for $100,000$ commuters is avoided because the transit network has at most $N \le 512$ stations (`MAX_STATIONS = 512`). Whenever the player edits a transit line, or when the Auto-Dispatcher / weather system shifts a line's headway $H(L)$ or weather multiplier $\eta_{\text{weather}}$ by $\ge 15\%$, the worker triggers **Time-Sliced Sparse All-Pairs Dijkstra** over the **Route-Segment Graph** ($32$ origin stations per 30Hz tick, completing a full 512-station rebuild in $\le 16$ ticks into a shadow back-buffer before atomically swapping table pointers).

The pathfinder populates primary and secondary (parallel-corridor load splitting) flat `Uint16Array` lookup tables indexed consistently by `originStation * MAX_STATIONS + destStation`:
1. `nextLineTable[originStation * MAX_STATIONS + destStation]: Uint16` (optimal Line ID to board at `originStation`)
2. `alightStationTable[originStation * MAX_STATIONS + destStation]: Uint16` (exact downstream Station ID along that line where the cohort must alight)
3. `nextLineAltTable` / `alightStationAltTable`: secondary parallel line options within a $10\%$ cost threshold so shared corridors (e.g., Capital + Metro lines between Churchill and Health Sciences) split riders proportionally to available capacity instead of starving parallel lines.

For $N = 512$, each `Uint16` table occupies $512 \times 512 \times 2\text{ bytes} = 512\text{ KB}$, making a primary pair (`nextLineTable` + `alightStationTable`) **$1\text{ MB}$ total** (or **$2\text{ MB}$** when double-buffered for shadow rebuild swaps).

**Result during the 30Hz Simulation Tick ($O(k)$ per vehicle arrival):**
* When Vehicle $V$ on Line $L$ arrives at Station $S'$:
  * **Alighting:** Walk only Vehicle $V$'s intrusive list (`headAgentByVehicle[V]`). Any cohort with `p.alightStationId === S'` alights in $O(1)$ per cohort. If `S' === p.destStationId`, the worker records realized $C_{ij}$, updates rider satisfaction, collects the ARC fare, and frees the cohort slot; otherwise the cohort moves onto `headAgentByStation[S']` to await its connecting line.
  * **Boarding:** Walk only Station $S'$'s intrusive waiting list (`headAgentByStation[S']`). Any cohort whose `nextLineTable[S' * MAX_STATIONS + p.destStationId] === L` (or `nextLineAltTable` when splitting parallel lines) boards Vehicle $V$ (splitting `passengerCount` if remaining vehicle capacity is lower) and writes `p.alightStationId = alightStationTable[S' * MAX_STATIONS + p.destStationId]`.

### 4.3 Edge-Cost Formulation & Time-Sliced Demand Spawner
Pathfinding executes over a **Route-Segment Graph**, where each candidate direct ride from boarding station $u$ to downstream alighting station $w$ on Line $L$ forms a segment leg with cost:

$$W_{\text{leg}}(u, w, L) = \sum_{e \in u \to w} \left(\frac{d(e)}{v_{\text{mode}}(L) \cdot \eta_{\text{weather}}} + \tau_{\text{dwell}}\right) + \frac{H(L)}{2} + \delta_{\text{transfer}} \cdot P_{\text{concourse}}(u)$$

Where:
* $d(e)$ is the track or road segment distance along edge $e$ ($\text{km}$), and $v_{\text{mode}}(L)$ is Line $L$'s mode cruise speed ($\text{km/h}$, reduced by river-valley grade slope penalties where applicable).
* $\eta_{\text{weather}}$ is the active weather speed multiplier (e.g., $0.68$ for mixed-traffic buses in snow; $1.0$ for grade-separated or tunneled LRT).
* $\tau_{\text{dwell}}$ is average per-stop boarding/alighting dwell time in seconds (halved by All-Door ARC Tap upgrades).
* $H(L)$ is Line $L$'s current headway in seconds (yielding expected platform wait time $\frac{H(L)}{2}$).
* $P_{\text{concourse}}(u)$ is the station transfer friction penalty at station $u$ in seconds ($240\text{s}$ Curbside $\rightarrow$ $120\text{s}$ Heated Transit Centre $\rightarrow$ $60\text{s}$ Pedway Concourse, or $0\text{s}$ under the Heated Pedway policy).
* $\delta_{\text{transfer}} \in \{0, 1\}$ equals $0$ on a commuter's initial origin boarding leg and $1$ on subsequent mid-trip transfers.

**Time-Sliced Demand Spawner:** Rather than recomputing the $512 \times 512$ Singly-Constrained Gravity and Logit Mode Split formulas ([game_design_document.md Section 2.1](./game_design_document.md#L21-L52)) on every 30Hz tick, `demandSystem.ts` evaluates $\sim 17$ origin zones per tick so the entire OD matrix refreshes smoothly at **1Hz** within the worker frame budget.

---

## 5. Multi-City Data Pipeline & Schema

### 5.1 City Pack Schema
Every city lives in its own folder under `src/cities/<city_id>/` and uses **four declarative JSON files** (`manifest.json`, `geometry.json`, `nodes.json`, `events.json`), plus optional Post-MVP `capabilityTraits` flags:

Example `src/cities/edmonton/manifest.json`:

```json
{
  "id": "edmonton_yeg",
  "name": "Edmonton",
  "region": "Alberta, Canada",
  "currency": "CAD",
  "fareSystemName": "ARC Card",
  "worldBounds": { "width": 4000, "height": 3200 },
  "startingCamera": { "x": 2000, "y": 1600, "zoom": 0.75 },
  "climateProfile": "PRAIRIE_WINTER_CITY",
  "capabilityTraits": [],
  "elevationObstacles": [
    {
      "id": "north_saskatchewan_river_valley",
      "type": "RIVER_VALLEY_GORGE",
      "bridgeCostMultiplier": 2.4,
      "tunnelCostMultiplier": 3.2,
      "bridgeSlopePenalty": 0.15
    }
  ],
  "defaultLines": [
    { "badge": "CAP", "name": "Capital Line", "color": "#2563eb", "mode": "LRT_HIGH_FLOOR" },
    { "badge": "VAL", "name": "Valley Line", "color": "#10b981", "mode": "LRT_LOW_FLOOR" },
    { "badge": "MET", "name": "Metro Line", "color": "#ef4444", "mode": "LRT_HIGH_FLOOR" }
  ]
}
```

* **`geometry.json`:** Simplified GeoJSON `FeatureCollection` in city world units (`0..worldBounds`) defining river/water polygons (keyed by ID to `manifest.elevationObstacles[].id`), parks, and arterial road polylines.
* **`nodes.json`:** Array of district/station seed objects specifying coordinates, zone classification (`R`, `C`, `I`, `U`, plus optional `ENTERTAINMENT` commercial sub-tag), baseline $P_i/A_j$ demand weights, and TOD carrying capacity $K_i$.
* **`events.json`:** Declarative calendar and trigger rules for seasonal weather profiles (`PRAIRIE_WINTER_CITY`, `MARITIME_RAIN`, `SNOW_BELT`) and local event spikes (playoff games, festivals, polar vortex alerts).
* **Valid Enums:**
  * `mode`: `BUS_LOCAL`, `BRT_ARTICULATED`, `LRT_LOW_FLOOR`, `LRT_HIGH_FLOOR`, `REGIONAL_RAIL`.
  * `elevationObstacles[].type`: `RIVER_VALLEY_GORGE`, `HARBOR_INLET`, `CANAL_NETWORK`, `MOUNTAIN_RIDGE`.
  * `capabilityTraits` (Post-MVP): `requireUnderground`, `waterNavigationAllowed`, `bikeCatchmentMultiplier`, `throughRunningPairs`, `stationRetailRevenueModel`.

### 5.2 Offline GIS-to-Game Map Converter Script (`tools/import-osm.ts`) — Post-MVP Tooling
Edmonton ships in MVP as curated static JSON files (`src/cities/edmonton/`). For Post-MVP city expansion (Montreal, Vancouver, Amsterdam, Tokyo), `tools/import-osm.ts` provides a Node CLI pipeline that:
1. Queries **OpenStreetMap (Overpass API)** for waterways, coastlines, arterial highways, landuse zoning, and existing transit hubs inside a bounding box.
2. Applies **Ramer–Douglas–Peucker (RDP)** polygon simplification to reduce vertex counts while preserving corridor topology.
3. Projects coordinates into city `worldBounds`, derives baseline `R/C/I/U` production and attraction weights from OSM landuse/building tags, and writes `geometry.json` and `nodes.json`.

### 5.3 Alternatives Considered
1. **Custom SoA `TypedArray` Stores vs. `bitECS` or Object-Oriented Arrays:**
   * *Rejected — OOP Arrays:* High GC pause pressure across 100k entity updates and manual serialization cost across worker boundaries.
   * *Rejected — `bitECS`:* Adds external library indirection over what is fundamentally a fixed set of domain tables (agents, vehicles, stations) whose exact byte layout must align with `SharedArrayBuffer` render snapshots.
   * *Chosen — Custom SoA `TypedArray` Stores:* Full control over cohort fields, intrusive linked-list indices, and zero-overhead `SharedArrayBuffer` views.
2. **Time-Sliced Route-Segment Dijkstra vs. Floyd-Warshall, Per-Agent A*, or Dynamic RAPTOR:**
   * *Rejected — Per-Agent A*:* Prohibitive CPU cost when tens of thousands of riders recalculate paths on line edits.
   * *Rejected — Synchronous $O(N^3)$ Floyd-Warshall:* Causes 150–400ms worker frame stalls at $N = 512$ and collapses transfer-line awareness onto station-only nodes.
   * *Chosen — Time-Sliced Route-Segment All-Pairs Dijkstra:* Correctly models transfer penalties $\delta_{\text{transfer}}$ and parallel line splitting while bounding per-tick worker CPU cost via 16-tick shadow-buffer slicing.
3. **Double-Buffered `SharedArrayBuffer` (+ Transferable Fallback) vs. Single-Buffer Direct Reads or Pure JSON `postMessage`:**
   * *Rejected — Single-Buffer Reads:* Introduces mid-tick tearing between worker writes and 120Hz renderer reads.
   * *Rejected — Pure JSON `postMessage`:* High structured-clone overhead for thousands of vehicle transforms at 30Hz.
   * *Chosen — Double-Buffered `SharedArrayBuffer` with `Atomics` + Transferable Fallback:* Lock-free, tear-free 120Hz interpolation with guaranteed compatibility when Cross-Origin Isolation headers are absent.
4. **PixiJS v8 vs. Three.js or Deck.gl; Native Web Audio API vs. Tone.js / Howler.js:**
   * *Chosen — PixiJS v8 + Native `AudioContext`:* Lightweight 2D/2.5D instanced vector/sprite performance with WebGL2 fallback, and zero third-party audio runtime bloat for simple procedural pentatonic synthesis.

### 5.4 Risks & Mitigations
1. **Cross-Origin Isolation (`COOP` / `COEP`) Restriction for `SharedArrayBuffer`:**
   * *Risk:* Browsers throw a `ReferenceError` or disable `SharedArrayBuffer` unless served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
   * *Mitigation:* Configure mandatory `COOP`/`COEP` headers in Vite dev/preview server configs and production hosting manifests, and implement an automatic `self.crossOriginIsolated` guard that switches the render transport to double-buffered transferable `ArrayBuffer` ping-pong messages if isolation is unavailable.
2. **Cohort Pool Saturation (`MAX_AGENTS = 100_000`):**
   * *Risk:* Peak event surges or high Act III ridership could exhaust 100,000 slots if modeled 1-to-1.
   * *Mitigation:* `demandSystem.ts` dynamically merges riders spawned in the same tick with identical `(originStationId, destStationId)` into weighted cohorts (`passengerCount > 1`) once active pool usage exceeds $70\%$.
3. **Time-Sliced Pathfinding Staleness Window:**
   * *Risk:* Recomputing 512 origins at 32 origins/tick takes up to 16 ticks (~0.53s at 30Hz) before new line edits propagate.
   * *Mitigation:* Agents continue routing cleanly on the intact front buffer during shadow-buffer calculation, and priority origins directly connected to the edited line are scheduled in tick 1.
4. **WebGPU-to-WebGL2 Shader Mismatch:**
   * *Risk:* Shipping WGSL-only shaders breaks browsers or GPUs that fall back to WebGL2.
   * *Mitigation:* MVP renders all map geometry, lines, and vehicles using standard PixiJS v8 Graphics and instanced sprites; optional Post-MVP shader passes ship paired WGSL and GLSL implementations.

---

## 6. Repository Directory Structure (Implementation Blueprint)

```text
yeg-transit-architect/
├── README.md
├── game_design_document.md        # High-level game design & mechanics
├── technical_stack_architecture.md # Technical stack & system architecture
├── package.json
├── tsconfig.json
├── vite.config.ts                 # Includes COOP/COEP headers for SharedArrayBuffer dev/preview
├── index.html
├── tools/
│   └── import-osm.ts              # Post-MVP CLI script to convert OSM/GeoJSON into City Packs
└── src/
    ├── main.tsx                   # App entry point
    ├── config/
    │   ├── modes.ts               # Bus, BRT, Low-Floor Tram, High-Floor LRT, Regional Rail specs
    │   ├── policies.ts            # City Council roguelite policy deck definitions
    │   └── upgrades.ts            # OCC automation modules & station concourse upgrades
    ├── cities/
    │   ├── types.ts               # CityManifest, GeometryPack, CityNodeSeed, EventSchedule
    │   ├── edmonton/              # Flagship Map 01: Edmonton (YEG)
    │   │   ├── manifest.json
    │   │   ├── geometry.json      # North Saskatchewan River, Henday, Whitemud, Yellowhead
    │   │   ├── nodes.json         # Authentic YEG neighborhoods, campuses & hubs
    │   │   └── events.json        # Oilers playoffs, Fringe Fest, -40°C Polar Vortex
    │   └── montreal/              # Post-MVP Map 02: Montreal (YUL)
    ├── core/                      # Pure TypeScript Simulation Engine (Runs in Web Worker)
    │   ├── worker.ts              # Worker entry point, 30Hz loop & message bus
    │   ├── memory/
    │   │   └── sharedBuffers.ts   # Double-buffered RenderSnapshotBuffer (SAB + transferable fallback)
    │   ├── ecs/
    │   │   ├── agents.ts          # Worker-private 100k weighted cohort SoA & intrusive node lists
    │   │   ├── vehicles.ts        # Kinematics, slope penalties, dwell & headway spacing
    │   │   └── stations.ts        # Platform cohort heads, concourse tiers & TOD density
    │   ├── routing/
    │   │   └── pathfinder.ts      # Time-sliced Route-Segment Dijkstra & O(1) lookup matrices
    │   └── systems/
    │       ├── demandSystem.ts    # Time-sliced Singly-Constrained Gravity + Logit demand spawner
    │       ├── dispatchSystem.ts  # Act II Auto-Headway (with OpEx governor) & Suburban Feeder AI
    │       ├── todSystem.ts       # Act III Transit-Oriented Development (capped at K_i)
    │       └── weatherSystem.ts   # Seasonal transitions & special event triggers
    ├── renderer/                  # PixiJS v8 WebGPU / WebGL2 Map Renderer
    │   ├── MapViewport.ts         # Smooth pan/zoom camera & coordinate transforms
    │   ├── layers/
    │   │   ├── TerrainLayer.ts    # River valley, parks & arterial grid
    │   │   ├── NetworkLayer.ts    # Parallel offset bezier tracks, bridges & tunnels
    │   │   ├── VehicleLayer.ts    # Instanced GPU rendering with prev/curr tick interpolation
    │   │   └── StationLayer.ts    # Station nodes, heatmaps & commuter queue indicators
    │   └── shaders/               # Post-MVP dual WGSL/GLSL visual polish shaders (optional)
    │       ├── river.wgsl         # Animated water & winter ice freeze (paired with GLSL fallback)
    │       └── trackPulse.wgsl    # Headway flow visualization (paired with GLSL fallback)
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

## 7. Phased Implementation Roadmap

Execute the build in **5 testable incremental milestones** (establishing playable core mechanics before multi-threaded optimization and automation):

* **Milestone 1: Engine Foundation, Edmonton Map & Basic Transit Loop (`v0.1`)**
  * Scaffold Vite + TypeScript + PixiJS v8 + React/Tailwind + Zustand (with COOP/COEP Vite headers configured).
  * Implement `TerrainLayer` rendering Edmonton's North Saskatchewan River Valley and arterial corridors with smooth pan/zoom, plus a minimal single-line bus drawing and vehicle movement prototype.
* **Milestone 2: Web Worker Cohort SoA, Double-Buffered Snapshot & $O(1)$ Routing Matrix (`v0.2`)**
  * Implement the 30Hz Simulation Worker, `AgentStoreSoA` weighted cohorts with intrusive lists, double-buffered `RenderSnapshotBuffer` (`SharedArrayBuffer` + transferable fallback), and Time-Sliced Route-Segment Dijkstra. Verify 50,000+ commuters routing and transferring cleanly with 60–120Hz interpolated rendering.
* **Milestone 3: Tactile Multi-Tier Corridors & River Crossing Physics (`v0.3`)**
  * Build the full Bezier/Metro route drawing tool with automatic parallel line offsetting (Capital and Metro lines running side-by-side from Churchill to Health Sciences), Bridge vs. Tunnel river-crossing selectors, and all 5 transit modes with economy and soft-lock protections.
* **Milestone 4: "The Network Must Grow" OCC Automation & Bounded TOD (`v0.4`)**
  * Implement the **OCC Auto-Headway Dispatcher** (with OpEx/Headway capacity governor), **Suburban Feeder AI** catchment zones, **Blueprint Interchanges**, and logistic-capped **TOD** station upzoning.
* **Milestone 5: City Council Policy Deck, Native Audio & Post-MVP City Pack Hooks (`v1.0`)**
  * Add the **City Council Election Policy Deck**, Edmonton Crisis Scenarios (*-40°C Polar Vortex*, *Stanley Cup Finals*), procedural Web Audio pentatonic chimes, `LZ-String` blueprint URL sharing, and City Capability Trait hooks for future City Packs.
