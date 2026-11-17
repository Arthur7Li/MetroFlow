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
export const MAX_VEHICLES = 4_096; // Power-of-two SoA buffer bound covering 2,500 active gameplay vehicles
export const UNREACHABLE_ID = 0xffff;

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

The pathfinder populates primary and secondary (parallel-corridor load splitting) flat `Uint16Array` lookup tables (with `0xFFFF` as the unreachable sentinel) plus a `Float32Array` expected transit cost table (`expectedCostTable`) consumed by `demandSystem.ts`, all indexed consistently by `originStation * MAX_STATIONS + destStation`:
1. `nextLineTable[originStation * MAX_STATIONS + destStation]: Uint16` (optimal Line ID to board at `originStation`, or `0xFFFF`)
2. `alightStationTable[originStation * MAX_STATIONS + destStation]: Uint16` (exact downstream Station ID along that line where the cohort must alight, or `0xFFFF`)
3. `nextLineAltTable` / `alightStationAltTable`: secondary parallel line options within a $10\%$ cost threshold so shared corridors (e.g., Capital + Metro lines between Churchill and Health Sciences) split riders proportionally to available capacity instead of starving parallel lines.
4. `expectedCostTable[originStation * MAX_STATIONS + destStation]: Float32` (expected generalized transit cost $C_{ij,\text{transit}}$ in simulated minutes; `Infinity` when unreachable).

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
  "worldUnitsPerKm": 100,
  "startingCamera": { "x": 2000, "y": 1600, "zoom": 0.75 },
  "climateProfile": "PRAIRIE_WINTER_CITY",
  "capabilityTraits": {},
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

* **`worldUnitsPerKm`:** Fixed spatial scale (`100 world units = 1 km`, i.e., `1 world unit = 10 m`, mapping `4000 x 3200` to `40 km x 32 km`).
* **`defaultLines`:** UI route-preset palettes (name, badge, color, suggested mode) displayed in the line-creation sidebar during Career Architect; they are **not** pre-built infrastructure at game start.
* **`geometry.json`:** Simplified GeoJSON `FeatureCollection` in city world units (`0..worldBounds`) defining river/water polygons (keyed by ID to `manifest.elevationObstacles[].id`), parks, and arterial road polylines.
* **`nodes.json`:** Array of district/station seed objects specifying coordinates, zone classification (`R`, `C`, `I`, `U`, plus optional `ENTERTAINMENT` commercial sub-tag), baseline $P_i/A_j$ demand weights, and TOD carrying capacity $K_i$.
* **`events.json`:** Declarative calendar and trigger rules for Career Architect seasonal weather profiles (`PRAIRIE_WINTER_CITY`, `MARITIME_RAIN`, `SNOW_BELT`) and dynamic local event spikes (playoff games, festivals, `-40°C` Polar Vortex cold-snap alerts).
* **Valid Enums:**
  * `mode`: `BUS_LOCAL`, `BRT_ARTICULATED`, `LRT_LOW_FLOOR`, `LRT_HIGH_FLOOR`, `REGIONAL_RAIL`.
  * `elevationObstacles[].type`: `RIVER_VALLEY_GORGE`, `HARBOR_INLET`, `CANAL_NETWORK`, `MOUNTAIN_RIDGE`.
  * `capabilityTraits` (Post-MVP typed object, empty `{}` for Edmonton MVP): `requireUnderground?: boolean`, `waterNavigationAllowed?: boolean`, `bikeCatchmentMultiplier?: number`, `throughRunningPairs?: Array<[string, string]>`, `stationRetailRevenueModel?: boolean`.

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

## 6. Repository Directory Structure & Implementation Specification

### 6.1 Repository Directory Layout (`MetroFlow/` Root)
Every repository-relative file path is marked `[Existing]`, `[Create]`, or `[Post-MVP — Excluded from v1.0]`:

```text
MetroFlow/
├── README.md                                  [Create]
├── game_design_document.md                    [Existing]
├── technical_stack_architecture.md            [Existing]
├── .gitignore                                 [Create]
├── package.json                               [Create]
├── tsconfig.json                              [Create]
├── tsconfig.worker.json                       [Create]
├── vite.config.ts                             [Create]
├── vitest.config.ts                           [Create]
├── playwright.config.ts                       [Create]
├── index.html                                 [Create]
├── tools/                                     [Post-MVP — Excluded from v1.0]
│   ├── tsconfig.json                          [Post-MVP — Excluded from v1.0]
│   └── import-osm.ts                          [Post-MVP — Excluded from v1.0]
├── src/
│   ├── main.tsx                               [Create]
│   ├── App.tsx                                [Create]
│   ├── vite-env.d.ts                          [Create]
│   ├── config/
│   │   ├── modes.ts                           [Create] # Tiers 1-5 specs, CapEx/OpEx, speeds, safe headway floors
│   │   ├── policies.ts                        [Create] # 8-card City Council Election Policy Deck definitions
│   │   └── upgrades.ts                        [Create] # Station concourse, TSP, All-Door ARC & Feeder AI specs
│   ├── cities/
│   │   ├── types.ts                           [Create] # CityManifest, CityCapabilityTraits, GeometryPack, CityNodeSeed, EventSchedule
│   │   ├── edmonton/                          [Create] # MVP Map 01: Edmonton (YEG)
│   │   │   ├── manifest.json                  [Create]
│   │   │   ├── geometry.json                  [Create] # North Saskatchewan River, Henday, Whitemud, Yellowhead
│   │   │   ├── nodes.json                     [Create] # Edmonton district/station seeds, coordinates & demand weights
│   │   │   └── events.json                    [Create] # Career Architect playoff, festival & -40°C Polar Vortex events
│   │   ├── montreal/                          [Post-MVP — Excluded from v1.0: manifest,geometry,nodes,events.json]
│   │   ├── vancouver/                         [Post-MVP — Excluded from v1.0: manifest,geometry,nodes,events.json]
│   │   ├── amsterdam/                         [Post-MVP — Excluded from v1.0: manifest,geometry,nodes,events.json]
│   │   └── tokyo/                             [Post-MVP — Excluded from v1.0: manifest,geometry,nodes,events.json]
│   ├── core/                                  # DOM-free TypeScript Simulation Engine (Runs in Web Worker)
│   │   ├── contracts.ts                       [Create] # WorkerCommand, TelemetrySnapshot & TopologySnapshot unions
│   │   ├── worker.ts                          [Create] # Worker entry point, 30Hz loop & message bus
│   │   ├── workerClient.ts                    [Create] # Main-thread Worker lifecycle & SAB/transferable bridge
│   │   ├── memory/
│   │   │   └── sharedBuffers.ts               [Create] # RenderSnapshotBuffer layout, Atomics & ping-pong fallback
│   │   ├── stores/
│   │   │   ├── agents.ts                      [Create] # Worker-private 100k weighted cohort SoA & FIFO node lists
│   │   │   ├── vehicles.ts                    [Create] # VehicleStoreSoA, acceleration, slope penalty, dwell & spacing
│   │   │   ├── stations.ts                    [Create] # StationStore, platform cohort tails/heads & TOD levels
│   │   │   └── lines.ts                       [Create] # TransitLineStore, corridors, crossings, blueprints & feeders
│   │   ├── routing/
│   │   │   └── pathfinder.ts                  [Create] # Time-sliced Route-Segment Dijkstra & lookup matrices
│   │   └── systems/
│   │       ├── demandSystem.ts                [Create] # Time-sliced Singly-Constrained Gravity + Logit spawner
│   │       ├── dispatchSystem.ts              [Create] # Act II Auto-Headway (with OpEx governor) & Feeder AI
│   │       ├── todSystem.ts                   [Create] # Act III bounded TOD growth & property-tax revenue
│   │       ├── weatherSystem.ts               [Create] # Seasonal transitions & Career Architect event spikes
│   │       ├── economySystem.ts               [Create] # Treasury, ARC fares, OpEx, 75% refund & Municipal Bond
│   │       └── progressionSystem.ts           [Create] # Growth Seeds, 5 Ridership Milestones, Approval & Elections
│   ├── storage/
│   │   ├── saveDb.ts                          [Create] # Dexie v4 IndexedDB store & binary worker snapshot codec
│   │   └── blueprintCodec.ts                  [Create] # LZ-String URL blueprint serializer (< 4 KB enforced)
│   ├── renderer/                              # PixiJS v8 WebGPU / WebGL2 Map Renderer
│   │   ├── RenderController.ts                [Create] # PixiJS App lifecycle & 60-120Hz tick interpolation loop
│   │   ├── MapViewport.ts                     [Create] # Damped 60-120Hz pan/zoom camera & world-to-screen transforms
│   │   ├── interaction/
│   │   │   └── MapInteractionController.ts    [Create] # Station snapping, Bezier drawing & Feeder zone painting
│   │   ├── layers/
│   │   │   ├── TerrainLayer.ts                [Create] # River valley, parks & arterial grid
│   │   │   ├── NetworkLayer.ts                [Create] # Parallel offset Bezier tracks, bridges & tunnels
│   │   │   ├── VehicleLayer.ts                [Create] # ParticleContainer sprite batching & tick interpolation
│   │   │   └── StationLayer.ts                [Create] # Station nodes, heatmaps & commuter queue indicators
│   │   └── shaders/                           [Post-MVP — Excluded from v1.0]
│   │       ├── river.wgsl                     [Post-MVP — Excluded from v1.0]
│   │       ├── river.glsl                     [Post-MVP — Excluded from v1.0]
│   │       ├── trackPulse.wgsl                [Post-MVP — Excluded from v1.0]
│   │       └── trackPulse.glsl                [Post-MVP — Excluded from v1.0]
│   ├── audio/
│   │   └── SoundscapeEngine.ts                [Create] # Procedural Web Audio API chimes, voice pool & pentatonic cues
│   └── ui/                                    # React 19 + Tailwind CSS v4 + Zustand HUD
│       ├── store/
│       │   └── useGameStore.ts                [Create] # Zustand bridge syncing 4Hz worker telemetry & commands
│       ├── components/
│       │   ├── TopTelemetryBar.tsx            [Create] # Clock, Pause/1x/2x/4x, Treasury, Approval, Milestone bar
│       │   ├── LineManagerSidebar.tsx         [Create] # Line presets, fleet count, All-Door ARC & corridor upgrade
│       │   ├── StationInspectorModal.tsx      [Create] # Concourse upgrades, TSP, Park-and-Ride vs Feeder toggle
│       │   ├── RiverCrossingModal.tsx         [Create] # 3-option crossing selector (Road Bridge / Transit Bridge / Tunnel)
│       │   ├── BlueprintPalette.tsx           [Create] # Saved interchange templates & stamping controls
│       │   ├── OCCAutomationPanel.tsx         [Create] # Auto-Headway policies, OpEx caps & Central Garage pool
│       │   ├── CouncilElectionModal.tsx       [Create] # 4-week Election Policy Deck 1-of-3 draft & probation status
│       │   ├── RunSetupModal.tsx              [Create] # New Career run & Metropolitan Growth Seed (A/B/C) selector
│       │   ├── SaveLoadModal.tsx              [Create] # IndexedDB save slots & LZ-String URL import/export
│       │   └── RunStatusBanner.tsx            [Create] # Milestone 5 victory & 0%-approval / bond-default game-over
│       └── overlays/
│           └── LayerToggles.tsx               [Create] # Heatmap toggles (Crowding, Land Value, Headways, Unmet Car)
└── tests/
    ├── helpers/
    │   ├── mockWorker.ts                      [Create] # Deterministic synchronous worker & crossOriginIsolated=false harness
    │   ├── mockPixi.ts                        [Create] # Headless PixiJS Graphics/Container/ParticleContainer stubs
    │   ├── mockAudio.ts                       [Create] # Headless Web Audio API AudioContext mock
    │   ├── edmontonFixture.ts                 [Create] # Reduced 16-station Edmonton test graph & seed fixture
    │   └── transferFixture.ts                 [Create] # Synthetic 2-line transfer fixture for Milestone 2 tests
    ├── unit/
    │   ├── sharedBuffers.test.ts              [Create]
    │   ├── agents.test.ts                     [Create]
    │   ├── pathfinder.test.ts                 [Create]
    │   ├── demandSystem.test.ts               [Create]
    │   ├── economySystem.test.ts              [Create]
    │   ├── dispatchTod.test.ts                [Create]
    │   └── storageCodec.test.ts               [Create]
    ├── integration/
    │   ├── workerPipeline.test.ts             [Create]
    │   ├── benchmark50k.test.ts               [Create]
    │   └── persistenceRoundtrip.test.ts       [Create]
    └── e2e/
        └── careerFlow.spec.ts                 [Create]
```

### 6.2 Toolchain & Build Configuration Specification
* **Package Manager:** `pnpm` (`>= 9.0.0`).
* **`package.json` Pinned Dependencies & Scripts:**
  * `dependencies`: `"pixi.js": "^8.6.0"`, `"react": "^19.0.0"`, `"react-dom": "^19.0.0"`, `"zustand": "^5.0.0"`, `"dexie": "^4.0.10"`, `"lz-string": "^1.5.0"`.
  * `devDependencies`: `"typescript": "~5.7.2"`, `"vite": "^6.0.0"`, `"@vitejs/plugin-react": "^4.3.4"`, `"tailwindcss": "^4.0.0"`, `"@tailwindcss/vite": "^4.0.0"`, `"@types/react": "^19.0.0"`, `"@types/react-dom": "^19.0.0"`, `"@types/lz-string": "^1.5.0"`, `"vitest": "^3.0.0"`, `"@playwright/test": "^1.50.0"`.
  * `scripts`: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"preview": "vite preview"`, `"typecheck": "tsc -b --noEmit"`, `"test": "vitest run"`, `"test:bench": "vitest run tests/integration/benchmark50k.test.ts"`, `"test:e2e": "playwright test"`.
* **`tsconfig.json` & `tsconfig.worker.json`:**
  * Root `tsconfig.json` uses project references (`files: []`, `references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.worker.json" }]` or combined strict `"ES2022"` app config with `"lib": ["ES2022", "DOM", "DOM.Iterable"]`, `"moduleResolution": "Bundler"`, `"jsx": "react-jsx"`, `"strict": true`).
  * `tsconfig.worker.json` restricts `"lib": ["ES2022", "WebWorker"]` and `"include": ["src/core/**/*", "src/config/**/*", "src/cities/types.ts"]` so DOM APIs never leak into worker modules.
* **`vite.config.ts`:**
  * Registers `plugins: [react(), tailwindcss()]`, sets `worker: { format: 'es' }`, and injects `headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }` on both `server` and `preview`.
* **`src/vite-env.d.ts`:** Includes `/// <reference types="vite/client" />`.

### 6.3 Cross-Thread Binary & Message Contracts (`sharedBuffers.ts`, `contracts.ts`, `workerClient.ts`)
* **Binary `RenderSnapshotBuffer` Byte Layout (16-Byte Aligned):**
  * **Control Header (`CONTROL_HEADER_BYTES = 64`, `Int32Array` indices `0..15`):**
    * `[0] activeSlot` (`0 | 1`, written last by worker via `Atomics.store`, read by renderer via `Atomics.load`)
    * `[1] tickIndex` (monotonic tick counter)
    * `[2] simTimeSeconds` (integer simulated seconds from Day 1 `00:00`)
    * `[3] vehicleCount` (`0..MAX_VEHICLES`, active gameplay cap `2,500`, buffer bound `4_096`)
    * `[4] stationCount` (`0..MAX_STATIONS`, bound `512`)
    * `[5] topologyVersion` (increments on any route/station/crossing edit)
    * `[6] tickDurationMicros` (worker simulation step wall-clock duration)
  * **Double-Buffered Data Slots (`SLOT_STRIDE_BYTES = 110_592`, starting at offset `64`; total `SharedArrayBuffer` size `221_248` bytes):**
    * `VehicleRenderSoA` (`MAX_VEHICLES = 4_096`, `106_496` bytes per slot): `prevX` (`+0`, `Float32`, `16_384B`), `prevY` (`+16_384`, `Float32`, `16_384B`), `currX` (`+32_768`, `Float32`, `16_384B`), `currY` (`+49_152`, `Float32`, `16_384B`), `bearing` (`+65_536`, `Float32`, `16_384B`), `lineId` (`+81_920`, `Uint16`, `8_192B`), `modeTier` (`+90_112`, `Uint8`, `4_096B`), `loadRatio` (`+94_208`, `Uint8`, `4_096B`), `activeFlag` (`+98_304`, `Uint8`, `4_096B`), `4_096B` padding (`+102_400`).
    * `StationRenderSoA` (`MAX_STATIONS = 512`, `4_096` bytes per slot starting at `+106_496`): `waitingCount` (`+106_496`, `Uint32`, `2_048B`), `todLevel` (`+108_544`, `Uint8`, `512B`), `concourseTier` (`+109_056`, `Uint8`, `512B`), `parkAndRideFlag` (`+109_568`, `Uint8`, `512B`), `feederActiveFlag` (`+110_080`, `Uint8`, `512B`).
* **Transferable Ping-Pong Fallback (`self.crossOriginIsolated === false`):**
  * Worker allocates two `110_656`-byte `ArrayBuffer` instances (`64B` header + `110_592B` single slot). At tick end, Worker transfers its filled buffer via `postMessage({ type: 'TRANSFER_SNAPSHOT', buffer }, [buffer])`; `workerClient.ts` swaps its active render buffer and immediately transfers the retired buffer back via `postMessage({ type: 'RETURN_SNAPSHOT_BUFFER', buffer }, [buffer])` for zero-allocation recycling.
* **Typed Message Contracts (`src/core/contracts.ts`):**
  * `WorkerCommand` (Main $\rightarrow$ Worker): discriminated union covering `INIT_CITY` (manifest, geometry, nodes, events, growthSeed), `SET_SPEED` (`0 | 1 | 2 | 4`), `CREATE_LINE`, `EDIT_LINE_STOPS`, `DELETE_LINE`, `UPGRADE_CORRIDOR`, `BUY_VEHICLE`, `SELL_VEHICLE`, `SET_LINE_POLICY` (auto-headway policy, target value, OpEx cap), `SET_ALL_DOOR_ARC`, `UPGRADE_STATION_CONCOURSE`, `SET_CORRIDOR_TSP`, `TOGGLE_PARK_AND_RIDE`, `SET_FEEDER_ZONE`, `STAMP_BLUEPRINT`, `SELECT_COUNCIL_POLICY`, `SELECT_INSPECTOR_TARGET`, `EXPORT_SNAPSHOT`, `IMPORT_SNAPSHOT`, and `RETURN_SNAPSHOT_BUFFER`.
  * `TopologySnapshot` (Worker $\rightarrow$ Main on `topologyVersion` change): array of `{ stationId, x, y, name, zone, concourseTier, todLevel, carryingCapacity }` and lines `{ lineId, name, color, modeTier, segments: Array<{ fromStationId, toStationId, cp1x, cp1y, cp2x, cp2y, crossingType: 'NONE' | 'ROAD_BRIDGE' | 'TRANSIT_BRIDGE' | 'TUNNEL', parallelLaneOffset }> }`, plus active feeder circles `{ stationId, radiusWorldUnits }`.
  * `TelemetrySnapshot` (Worker $\rightarrow$ `useGameStore.ts` at `4Hz`): `{ simDay, simWeek, simHourMinute, speed, treasuryCad, bondDebtCad, dailyFareRevenueCad, dailyTodTaxCad, dailyOpExCad, dailyRidership, modeSharePct, publicApprovalPct, councilTargetPct, onProbation, milestoneIndex, currentAct, activeWeather, activeEvents, reservePoolCount, policyDraftPending, runOutcome: 'ACTIVE' | 'VICTORY' | 'BANKRUPT' | 'ZERO_APPROVAL', selectedInspectorData }`.

### 6.4 Module Contracts, Data Schemas & Deterministic Simulation Constants
* **Spatial Scale & City Schemas (`src/cities/types.ts`):**
  * `worldUnitsPerKm = 100` (`1 world unit = 10 meters`, mapping `4000 x 3200` to `40 km x 32 km`).
  * `CityCapabilityTraits` is a typed optional-field interface (`{ requireUnderground?: boolean; waterNavigationAllowed?: boolean; bikeCatchmentMultiplier?: number; throughRunningPairs?: Array<[string, string]>; stationRetailRevenueModel?: boolean }`), initialized to `{}` in Edmonton MVP.
  * `GeometryPack` uses GeoJSON `FeatureCollection` polygons (`RIVER`, `PARK`) and `LineString` arterials in world units; `CityNodeSeed` defines `{ id, name, x, y, zone: 'R' | 'C' | 'I' | 'U', subTag?: 'ENTERTAINMENT', baseProduction, baseAttraction, carryingCapacityK }`; `EventSchedule` defines `{ id, label, type: 'WEATHER' | 'SURGE', startDay?, durationDays, speedMultiplierBus, speedMultiplierSurfaceRail, surgeNodeId?, surgeFactor? }`.
* **Cohort Lifecycle & Physics (`src/core/stores/{agents,vehicles,stations,lines}.ts`):**
  * `AgentStoreSoA` maintains an $O(1)$ `freeListStack: Int32Array` + `freeTop` stack and FIFO doubly-linked node lists (`headAgentByStation`, `tailAgentByStation`, `headAgentByVehicle`, `tailAgentByVehicle`).
  * **Coalescing & Saturation Rules:** Above `70%` pool usage (`> 70,000` active slots), `demandSystem.ts` scans up to the tail cohort of `(origin, dest)` at the station and merges newly spawned riders into it using passenger-weighted averages for `waitTimer` and `tripStartTime` (capped at `Uint16` max `65,535` per cohort). At `100%` saturation, spawned riders always merge into existing matching station cohorts (or wait in an aggregated overflow bucket until slots free); mid-boarding vehicle splits always retain the original cohort slot on the station if zero free slots remain.
  * `VehicleStoreSoA` tracks `lineId`, `segmentIdx`, `distanceAlongSegmentM`, `velocityMps`, `direction` (`1 | -1`), `dwellTimerS`, `consistCars` (`1..4`), `capacity`, and `onboardCount`. Kinematics use trapezoidal acceleration `1.2 m/s^2`, deceleration `1.5 m/s^2`, `-15%` speed cap across `TRANSIT_BRIDGE` river segments, `baseDwell = 3.0s + 0.5s * boardingCount * (line.allDoorArc ? 0.5 : 1.0)`, `15.0s` terminus turnaround dwell, and anti-bunching holding at stations (holds up to `+15s` if time headway behind preceding vehicle is `< 0.75 * targetHeadway`).
* **Routing Matrix (`src/core/routing/pathfinder.ts`):**
  * Unreachable sentinel is `UNREACHABLE_ID = 0xffff`. Maintains `expectedCostTable: Float32Array` (`512 * 512`, `Infinity` when unreachable) alongside `nextLineTable`, `alightStationTable`, `nextLineAltTable`, and `alightStationAltTable`.
  * Forward Dijkstra operates over states `(stationId, incomingLineId)` propagating `(firstLineId, firstAlightStationId)` from origin $u$ (setting $\delta_{\text{transfer}} = 0$ on initial leg and $1$ on any line change).
  * **Parallel-Corridor Capacity Split:** If primary line next departing vehicle or station queue load exceeds `85%` and `nextLineAltTable[S' * 512 + dest] !== 0xffff`, incoming cohorts divert to the alternate line with probability $\min\left(0.5, \frac{\text{cap}_{\text{alt}}}{\text{cap}_{\text{prim}} + \text{cap}_{\text{alt}}}\right)$.
* **Gameplay Config & Formulas (`src/config/*`, `src/core/systems/*`):**
  * **Gravity & Logit Constants:** $\gamma = 1.8$, $\beta = 0.12\text{ min}^{-1}$, $C_{\min} = 1.0\text{ min}$; $C_{ij,\text{car}} = \frac{d_{\text{euclid}}(i,j) \cdot 1.25}{42\text{ km/h}} \cdot 60 + 4.0\text{ min}$ ($+6.0\text{ min}$ for `C` downtown hubs).
  * **Diurnal & Weather Curves:** Piecewise multipliers: `06:30–09:30` (`R->C/I/U: 2.4x`), `09:30–15:30` (`0.9x`), `15:30–18:30` (`C/I/U->R: 2.2x`, `R->C_ent: 1.4x`), `18:30–23:00` (`0.7x`), `23:00–06:30` (`0.15x` `I/U` shifts only); Sat–Sun apply `0.45x` commuter peak scaling and `1.35x` midday `C` scaling. Weather speed multipliers: Clear `1.0`, Routine Snow (`-30°C`) `0.68` Bus / `0.85` BRT & Tram, Polar Vortex Event (`-40°C`) `0.45` Bus / `0.75` BRT & Tram, `1.0` for Grade-Separated Tier 4–5 and Tunneled segments.
  * **Upgrades & Safe Headways (`config/upgrades.ts`, `config/modes.ts`):** Minimum safe headway floors (simulated seconds): `Bus: 60s, BRT: 75s, Tram: 90s, LRT: 90s, Regional: 180s`. Concourses: Curbside (`$0`, `240s`), Heated Transit Centre (`$1,200`, `120s`), Multi-Modal Pedway (`$3,500`, `60s`). Park-and-Ride Lot (`$800`, `+400` daily demand capture cap, consumes `1` TOD tier slot); Suburban Feeder AI Zone (`$2,400` + `$65/day`, `2.5 km` radius, zero TOD land loss); All-Door ARC Boarding (`$1,500`/line); TSP Upgrade (`$900`/km on Tier 3); LRV multi-car consists (`1..4` cars, `$1,800` CapEx and `+$150` daily OpEx per added car).
  * **8-Card City Council Policy Deck (`config/policies.ts`):** (1) *Abolish Parking Minimums*, (2) *Winter City Heated Pedway Network*, (3) *U-Pass Universal Expansion*, (4) *24/7 Night Owl Industrial Shift*, (5) *Dedicated Bus Lane Mandate* (`-30%` BRT track CapEx, `+10%` car road penalty), (6) *Off-Peak ARC Fare Discount* (`-25%` off-peak fare, `+20%` midday/evening Mode Share attraction), (7) *TOD Density Bonus Zoning* (`+20%` carrying capacity $K_i$ at Milestone 4+ stations), (8) *All-Weather Rolling Stock Retrofit* (`+15%` bus/tram snow speed multiplier, `+$15/day` vehicle OpEx).
  * **Public Approval & Election Target (`progressionSystem.ts`):** `approval = clamp(0, 100, 0.55 * satisfactionScore + 0.35 * modeSharePct + scenicAndPolicyBonus)`, where `satisfactionScore = 100 * max(0, 1 - avgWaitSimMin / patienceLimitMin)` (`patienceLimitMin = 12`). Election Cycle target begins at `55%` on Week 4 and increases `+3%` per successful cycle up to `75%`.
  * **TOD Logistic Formula (`todSystem.ts`):** Weekly growth $\Delta W_i = 0.08 \cdot W_i \cdot (1 - W_i / K_i)$ when station weekly boardings exceed `1,000`; station `todLevel` maps across `[0, 500, 2000, 6000, 15000, 30000]` weekly boardings and yields `+$25 CAD/day` property-tax revenue per level `> 0`.
  * **Economy & Bond (`economySystem.ts`):** Starts at `$50,000 CAD`, `$3.50` base ARC fare, `75%` teardown refund, `$25,000` Municipal Bond overdraft limit accruing `5%` interest per in-game week.
* **Persistence (`src/storage/{saveDb,blueprintCodec}.ts`):**
  * `saveDb.ts` defines Dexie v4 database `MetroFlowSaveDB` (`saves: 'id, cityId, updatedAt'`), storing `Uint8Array` snapshots (`"MTFL"` 4-byte magic + `uint16 version = 1` + JSON state header + compressed/raw store slices) on manual save, 5-minute auto-save interval, and every 4-week election milestone.
  * `blueprintCodec.ts` serializes `{ v: 1, cityId, seed, lines, stations, upgrades, policies }` via `LZString.compressToEncodedURIComponent` and rejects payloads exceeding `4096` UTF-16 URL characters.
* **Renderer & Audio (`src/renderer/*`, `src/audio/SoundscapeEngine.ts`):**
  * `MapInteractionController.ts` snaps stations within `25 world units (250 m)` of arterial nodes/corridors; custom non-seed stations inherit local `P_i/A_j` via inverse-distance weighting of unassigned cells within `500 m` and `K_i = 1.5 * base`.
  * `NetworkLayer.ts` renders cubic Bezier paths with parallel normal offset `(laneIdx - (totalLanes - 1) / 2) * 8` world units; ray-segment vs. `geometry.json` river polygon intersection automatically opens `RiverCrossingModal.tsx`.
  * `VehicleLayer.ts` uses PixiJS v8 `ParticleContainer` backed by a `16x16` procedural `RenderTexture` icon atlas; `LayerToggles.tsx` normalizes heatmaps across `[0..1]` (`crowding = waitingCount / 200`, `landValue = todLevel / 5`, `headway = actualHeadway / targetHeadway`, `unmetCar = T_ij - D_ij`).
  * `SoundscapeEngine.ts` maps station hash to C minor modal pentatonic MIDI notes `[60, 63, 65, 67, 70, 72, 75, 77, 79]`, using sine oscillator + `0.01s` attack / `0.18s` decay at `0.08` gain, capped at `MAX_VOICES = 12` and `50ms` minimum trigger interval, unlocking `AudioContext.resume()` on first user pointer/keydown event.

---

## 7. Phased Implementation Roadmap (5 Incremental Milestones)

Standalone timed **Crisis Scenarios** (*"-40°C Polar Vortex Breakdown"*, *"Stanley Cup Finals Game 7"*) are **Post-MVP (`v1.1+`)**; `edmonton/events.json` in `v1.0` delivers dynamic seasonal weather and playoff demand spikes inside **Career Architect**.

* **Milestone 1: Engine Foundation, Worker Shell, Edmonton Map & Single-Line Prototype (`v0.1`)**
  * **Scope:** Scaffold `pnpm` + `TypeScript ~5.7` + `Vite 6` + `PixiJS v8` + `React 19` + `Tailwind CSS v4` + `Zustand` (with COOP/COEP Vite headers and strict `tsconfig.worker.json`). Implement `TerrainLayer`, damped `60–120Hz` `MapViewport`, `worker.ts` + `sharedBuffers.ts` (SAB + transferable ping-pong fallback) + `vehicles.ts` moving vehicles along a single-line bus route drawing prototype (no throwaway main-thread simulation).
  * **File Allowlist (`Create`):** `README.md`, `.gitignore`, `package.json`, `tsconfig.json`, `tsconfig.worker.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `src/cities/types.ts`, `src/cities/edmonton/{manifest,geometry,nodes}.json`, `src/config/modes.ts`, `src/core/{contracts,worker,workerClient}.ts`, `src/core/memory/sharedBuffers.ts`, `src/core/stores/{vehicles,stations,lines}.ts`, `src/renderer/{RenderController,MapViewport}.ts`, `src/renderer/interaction/MapInteractionController.ts`, `src/renderer/layers/{TerrainLayer,NetworkLayer,VehicleLayer,StationLayer}.ts`, `src/ui/store/useGameStore.ts`, `src/ui/components/TopTelemetryBar.tsx`, `tests/helpers/{mockWorker,mockPixi,edmontonFixture}.ts`, `tests/unit/sharedBuffers.test.ts`.
  * **Verification & Test Plan:** Run `pnpm typecheck && pnpm test && pnpm build`. `sharedBuffers.test.ts` asserts 16-byte alignment, `Atomics` slot swap integrity, and zero-allocation buffer return under `crossOriginIsolated = false` (`mockWorker`).

* **Milestone 2: Weighted Cohort SoA, Time-Sliced $O(1)$ Routing & Demand Benchmark (`v0.2`)**
  * **Scope:** Implement worker-private `AgentStoreSoA` (`100,000` weighted cohort slots with `freeListStack`, FIFO node lists, `> 70%` coalescing, and `100%` saturation safety), `pathfinder.ts` (Time-Sliced Sparse Route-Segment Dijkstra with `0xFFFF` sentinel, `expectedCostTable`, and parallel-corridor split), and `demandSystem.ts` (1Hz time-sliced Singly-Constrained Gravity + Logit spawner).
  * **File Allowlist (`Create` / `Modify`):** `Create` `src/core/stores/agents.ts`, `src/core/routing/pathfinder.ts`, `src/core/systems/demandSystem.ts`, `tests/helpers/transferFixture.ts`, `tests/unit/{agents,pathfinder,demandSystem}.test.ts`, `tests/integration/{workerPipeline,benchmark50k}.test.ts`; `Modify` `src/core/worker.ts`, `src/core/stores/{vehicles,stations}.ts`.
  * **Verification & Test Plan:** Run `pnpm typecheck && pnpm test && pnpm test:bench`. Unit tests verify Gravity mass conservation, $C_{\min}=1.0\text{ min}$ clamping, Logit `[0,1]` bounds, FIFO boarding order, cohort coalescing above `70%` load, and multi-line transfer alighting over `transferFixture.ts`. `benchmark50k.test.ts` asserts `< 4.0ms` median 30Hz worker tick at `2,500` active vehicles and `100,000` daily weighted riders with zero dropped cohorts and zero torn frames.

* **Milestone 3: Multi-Tier Corridors, 3-Option River Crossings & Economy (`v0.3`)**
  * **Scope:** Build the point-and-drag Bezier corridor drawing tool with normal parallel lane offsetting, `3-option river-crossing selector` (`Shared Road Bridge`, `Dedicated Transit Bridge`, `Deep Bored Tunnel`), all 5 transit modes, LRV multi-car consists, All-Door ARC Boarding, TSP upgrades, Concourse Tiers (`0/1/2`), Park-and-Ride Lots, One-Click Corridor Upgrading, time-scale controls (`Pause/1x/2x/4x`), and `economySystem.ts` (`$50,000` start, `$3.50` ARC fare, `75%` teardown refund, `$25,000` Municipal Bond overdraft).
  * **File Allowlist (`Create` / `Modify`):** `Create` `src/config/upgrades.ts`, `src/core/systems/economySystem.ts`, `src/ui/components/{LineManagerSidebar,StationInspectorModal,RiverCrossingModal}.tsx`, `tests/unit/economySystem.test.ts`; `Modify` `src/core/{contracts,worker}.ts`, `src/core/stores/{lines,vehicles,stations}.ts`, `src/renderer/interaction/MapInteractionController.ts`, `src/renderer/layers/NetworkLayer.ts`, `src/ui/components/TopTelemetryBar.tsx`, `src/ui/store/useGameStore.ts`.
  * **Verification & Test Plan:** Run `pnpm typecheck && pnpm test && pnpm build`. `economySystem.test.ts` verifies `$3.50` fare collection, `75%` demolition refunds, `$25,000` bond overdraft activation + `5%` weekly interest, and bridge `-15%` slope speed penalties.

* **Milestone 4: OCC Automation, Blueprint Interchanges, Bounded TOD & Heatmaps (`v0.4`)**
  * **Scope:** Implement `dispatchSystem.ts` (**Auto-Headway Dispatcher** with Central Garage reserve pool + minimum safe headway / OpEx governor, and **Suburban Feeder AI** `2.5 km` catchment zones), **Blueprint Interchanges** (`BlueprintPalette.tsx`), `todSystem.ts` (bounded logistic TOD upzoning + `+$25 CAD/day` per level property-tax revenue), and `LayerToggles.tsx` heatmaps (`Crowding`, `Land Value`, `Headways`, `Unmet Car`).
  * **File Allowlist (`Create` / `Modify`):** `Create` `src/core/systems/{dispatchSystem,todSystem}.ts`, `src/ui/components/{OCCAutomationPanel,BlueprintPalette}.tsx`, `src/ui/overlays/LayerToggles.tsx`, `tests/unit/dispatchTod.test.ts`; `Modify` `src/core/{contracts,worker}.ts`, `src/core/stores/{lines,stations}.ts`, `src/renderer/layers/{StationLayer,NetworkLayer}.ts`, `src/ui/store/useGameStore.ts`, `src/App.tsx`.
  * **Verification & Test Plan:** Run `pnpm typecheck && pnpm test && pnpm build`. `dispatchTod.test.ts` asserts headway governor clamping at mode safe floors, OpEx cap enforcement, Feeder AI catchment capture without TOD slot loss, and TOD logistic convergence below $K_i$.

* **Milestone 5: Policy Deck, Dynamic Events, Procedural Web Audio, Persistence & Trait Hooks (`v1.0`)**
  * **Scope:** Implement `progressionSystem.ts` (Growth Seeds `A/B/C`, 5 Ridership Milestones, Public Approval, 4-week Election Cycles, Probation, Bankruptcy/Victory outcomes), all 8 **City Council Election Policy Deck** cards (`policies.ts`), `weatherSystem.ts` + `edmonton/events.json` (routine `-30°C` snow, `-40°C` Polar Vortex cold-snap, and playoff surges in Career Architect), **Procedural Web Audio** pentatonic synthesis (`SoundscapeEngine.ts`), Dexie IndexedDB auto-save/load + `LZ-String` `< 4 KB` blueprint URL sharing (`saveDb.ts`, `blueprintCodec.ts`), and typed `CityCapabilityTraits` config hooks for Post-MVP City Packs. *(Standalone timed Crisis Scenarios and additional cities are excluded and deferred to Post-MVP `v1.1+`.)*
  * **File Allowlist (`Create` / `Modify`):** `Create` `playwright.config.ts`, `src/config/policies.ts`, `src/cities/edmonton/events.json`, `src/core/systems/{progressionSystem,weatherSystem}.ts`, `src/storage/{saveDb,blueprintCodec}.ts`, `src/audio/SoundscapeEngine.ts`, `src/ui/components/{CouncilElectionModal,RunSetupModal,SaveLoadModal,RunStatusBanner}.tsx`, `tests/helpers/mockAudio.ts`, `tests/unit/storageCodec.test.ts`, `tests/integration/persistenceRoundtrip.test.ts`, `tests/e2e/careerFlow.spec.ts`; `Modify` `src/core/{contracts,worker}.ts`, `src/ui/store/useGameStore.ts`, `src/App.tsx`, `package.json`.
  * **Verification & Test Plan:** Run `pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`. `storageCodec.test.ts` verifies `< 4 KB` URL constraint enforcement; `persistenceRoundtrip.test.ts` verifies binary `"MTFL"` save/load parity; `careerFlow.spec.ts` launches a seeded Edmonton Career run, draws a corridor across the river valley, advances ticks, triggers an auto-save, and verifies zero console/worker errors.
