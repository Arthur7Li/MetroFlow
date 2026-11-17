# Goldfish Review Report — Stage 5: Initial Zoom Out Review

**Targets:**
* [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`Lines 1-141`, Full File)
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md) (`Lines 1-238`, Full File)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |
| `egm-inventive-catalyst` | completed |

---

## Part 1: Zoom-Out Architecture & Simplicity Audit (`egm-zoom-out`)

### 1.1 Premature Optimization, Concurrency Risk & Milestone Ordering (`SharedArrayBuffer` + 100,000 Discrete Agent SoA) - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L8-L13) (`## 1. Architectural Philosophy`, lines 8–13), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L34-L63) (`## 3. High-Level System Architecture Diagram`, lines 34–63), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L67-L84) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 67–84), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L228-L230) (`## 7. Phased Implementation Roadmap`, lines 228–230)
* **Discrepancy Description**:
  1. **Unnecessary 100,000 Discrete Agent Allocation**: In `AgentStoreSoA` (lines 76–83), commuters have no $(x, y)$ world positions or independent spatial physics. They exist only in station queues or inside vehicles, keyed by `(currentNodeId, destStationId)`. Tracking 100,000 individual commuters when station count is $N \le 512$ adds unnecessary per-agent iteration overhead compared to aggregate destination-bucketed flow counts `(station, destination)`.
  2. **`SharedArrayBuffer` Synchronization & Hosting Friction**: Using `SharedArrayBuffer` requires `Cross-Origin-Opener-Policy` (`COOP`) and `Cross-Origin-Embedder-Policy` (`COEP`) headers and exposes data races between the 60Hz Simulation Worker writes and the 60–120Hz Main Thread reads (line 45) because no `Atomics` synchronization or double-buffering is specified. Furthermore, individual commuters are never rendered as world-space sprites—only vehicles and station queue indicators are drawn (lines 199–200)—so the renderer only needs compact snapshots of vehicle transforms and station queue counts.
  3. **Inverted Milestone Sequence**: Milestone 2 (`v0.2`, lines 228–230) builds the `SharedArrayBuffer` Web Worker ECS and benchmarks 50,000 agents before Milestone 3 (`v0.3`, lines 231–233) implements basic route drawing and vehicle movement.
* **Rationale & Recommendation**:
  Start with core gameplay (drawing a transit line, spawning stations, moving vehicles, and routing station-to-station passenger cohorts) before introducing cross-thread shared memory pipelines. Replace 1-to-1 per-commuter slots with destination-bucketed passenger cohorts or aggregate station queues, and move multi-threaded `SharedArrayBuffer` optimization after core gameplay is playable.

---

### 1.2 Conflicting ECS Abstractions (`bitECS` vs. Custom Manual `TypedArray` Views) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L25-L25) (`## 2. Recommended Tech Stack`, line 25), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L69-L84) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 69–84), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L181-L186) (`## 6. Repository Directory Structure`, lines 181–186)
* **Discrepancy Description**:
  Line 25 specifies `bitECS (or custom SoA TypedArrays)`, while Section 4.1 (lines 72–84) and Section 6 (lines 181–186) define a manual `SharedArrayBuffer` allocator (`sharedBuffers.ts`, `AgentStoreSoA`). Leaving the core state layer undecided between a third-party ECS library and custom typed-array views creates ambiguity across every simulation system.
* **Rationale & Recommendation**:
  Commit to a single state management approach. Because the simulation only manages a fixed set of domain entities (Stations, Lines, Vehicles, and Passenger Cohorts), plain typed stores without an external ECS library avoid dual-abstraction overhead.

---

### 1.3 Premature Custom WGSL/GLSL Shaders & WebGL2 Fallback Gap - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L23-L24) (`## 2. Recommended Tech Stack`, lines 23–24), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L38-L38) (`## 3. High-Level System Architecture Diagram`, line 38), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L201-L203) (`## 6. Repository Directory Structure`, lines 201–203)
* **Discrepancy Description**:
  Mandating custom shaders for animated river water, winter ice freeze (`river.wgsl`), blizzard weather, and track pulses (`trackPulse.wgsl`) is premature cosmetic work prior to a functioning simulation. Additionally, Section 2 (line 23) claims dual **WebGPU / WebGL2** support via PixiJS v8, but Section 6 (lines 201–203) only provisions `.wgsl` shader files, which fail when PixiJS falls back to WebGL2 unless paired with GLSL equivalents.
* **Rationale & Recommendation**:
  Use standard PixiJS v8 `Graphics` primitives and instanced sprites for initial milestones, and defer custom shaders until post-MVP polish. If WebGL2 fallback is required, document how shader compatibility is maintained across both backends.

---

### 1.4 Speculative Multi-City OSM CLI Pipeline (`tools/import-osm.ts`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L144-L149) (`### Offline GIS-to-Game Map Converter Script`, lines 144–149), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L163-L164) (`## 6. Repository Directory Structure`, lines 163–164, 178)
* **Discrepancy Description**:
  Designing an offline Node CLI tool to query the OpenStreetMap Overpass API and run Ramer–Douglas–Peucker polygon simplification for Montreal, Vancouver, Tokyo, and London (lines 144–149) violates YAGNI before Map 01 (Edmonton) is built and validated.
* **Rationale & Recommendation**:
  Ship Edmonton using a single static GeoJSON/JSON asset first. Defer automated Overpass API ingestion and polygon simplification tooling until a second city is actively in production.

---

### 1.5 Altitude Drops into Low-Level Implementation Details - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L72-L98) (`### 4.1` & `### 4.2`, lines 72–98), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L117-L142) (`## 5. Multi-City Data Pipeline & Schema`, lines 117–142), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L152-L217) (`## 6. Repository Directory Structure`, lines 152–217)
* **Discrepancy Description**:
  High-level architecture sections drop into low-level implementation details:
  * Concrete `Uint8Array`/`Uint16Array` field types, 1D array indexing arithmetic (`originStation * MAX_STATIONS + destStation`), and L2 cache byte math (`512 * 512 * 2 bytes = 512 KB`) in Sections 4.1–4.2.
  * Hardcoded pixel dimensions, camera coordinates, hex colors, and cost multipliers (`2.4`, `3.2`) in `manifest.json` (lines 117–142).
  * A 60-line file tree prescribing individual React component filenames (`CouncilElectionModal.tsx`, `StationInspectorModal.tsx`) in Section 6 before any source code exists.
* **Rationale & Recommendation**:
  Keep the architecture sections focused on subsystem boundaries, interfaces, and data flow contracts, moving concrete constants and file-level checklists into the detailed implementation plan.

---

### 1.6 YAGNI Violation & Contradiction in Multi-City Expansion Framework - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L15-L15) (`### Core Design Pillars`, line 15), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L124-L135) (`## 5. Multi-City Expansion Framework`, lines 124–135)
* **Discrepancy Description**:
  Section 5 (lines 126–127) states that adding new cities after Edmonton requires "zero engine rewrites—only a new GeoJSON map package and a city modifier profile." However, the table in lines 128–135 introduces city-specific mechanics that require dedicated simulation and UI logic:
  * **Montreal (line 131)**: 100% underground restriction and REM conversion mechanics.
  * **Vancouver (line 132)**: Water-based SeaBus Passenger Ferries.
  * **Amsterdam (line 133)**: Underground bicycle parking garages multiplying station catchment radius, plus ferries.
  * **Tokyo (line 134)**: Through-running commuter rail into subway tunnels and Station Department Store retail as primary revenue.
* **Rationale & Recommendation**:
  Scope the initial design strictly around **Map 01: Edmonton (YEG)** and either remove bespoke engine rules from the multi-city table or explicitly mark them as post-launch expansion modules.

---

### 1.7 Over-Scoped Transit Mode Tiers & Late-Game Subsystem Count - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L40-L50) (`### 2.2 Infrastructure Tiers & Right-of-Way (ROW) Physics`, lines 40–50), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L86-L96) (`### Act II` & `### Act III`, lines 86–96)
* **Discrepancy Description**:
  Specifying 5 transit mode tiers (Local Bus, Articulated BRT with road-lane conversion, Low-Floor Tram with Transit Signal Priority at arterial intersections, High-Floor LRT, and Regional Rail) plus On-Demand Micro-Transit Feeder AI, temporary replacement bus shuttles during construction upgrades (line 90), Quad-Tracking Express Bypass scheduling, and Land Value Capture real-estate leasing creates excessive initial simulation surface area.
* **Rationale & Recommendation**:
  Consolidate the baseline MVP around 3 core transit tiers (Local Bus, At-Grade Tram/BRT, Grade-Separated LRT) and defer complex subsystems (construction replacement shuttles, quad-track express bypassing, and real-estate leasing) to post-MVP milestones.

---

### 1.8 Overlapping Audio Dependencies (`Web Audio API + Tone.js / Howler.js`) - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L27-L27) (`## 2. Recommended Tech Stack`, line 27)
* **Discrepancy Description**:
  Listing `Web Audio API + Tone.js / Howler.js` includes two overlapping third-party audio libraries (`Tone.js` for synthesis and `Howler.js` for sample playback) alongside the native Web Audio API.
* **Rationale & Recommendation**:
  Use native Web Audio API (`AudioContext`) directly for procedural pentatonic chimes, or pick a single audio library if sample management is needed.

---

### 1.9 Unseparated MVP vs. Post-MVP Game Modes in Replayability Engine - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L99-L121) (`## 4. Replayability Engine: No Two Runs Play the Same`, lines 99–121)
* **Discrepancy Description**:
  Section 4 specifies three distinct game modes (Career Campaign, 20-Minute Crisis Scenarios with bespoke rule overrides, and Endless Sandbox) alongside a City Council Policy Deck and Metropolitan Growth Seeds without distinguishing baseline MVP scope from expansion content.
* **Rationale & Recommendation**:
  Designate a single primary game mode for the initial playable release and mark Crisis Scenarios and secondary modes as post-core milestones.

---

## Part 2: Strategic Contradiction & False Compromise Audit (`egm-inventive-catalyst`)

### 2.1 Static Player-Triggered Routing Matrix vs. Dynamic Simulation Edge Weights & Single-Worker Tick Blocking - Severity: 🟡 Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L13-L13) (`## 1. Architectural Philosophy`, line 13), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L51-L62) (`## 3. High-Level System Architecture Diagram`, lines 51–62), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L86-L110) (`### 4.2` & `### 4.3`, lines 86–110); cross-referenced with [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L88-L88) (`### Act II`, line 88) and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L119-L119) (`### 4.3`, line 119)
* **False Compromise**:
  The architecture trades **Dynamic Routing Accuracy** for **60Hz Tick Determinism**. Lines 13 and 89 state that the All-Pairs Next-Hop Matrix is recomputed *only* when the player edits a transit line or modifies headways. However, Section 4.3 (lines 103–109) defines edge cost $W(u, v, L)$ using runtime-mutating variables: weather modifier $\eta_{\text{weather}}$ (blizzards / polar vortex events) and line headway $H(L)$ (mutated automatically at 07:00 and 10:00 by the Act II Auto-Headway Dispatcher). Furthermore, running All-Pairs shortest path for $N = 512$ stations ($262,144$ pairs) synchronously inside the single Simulation Web Worker blocks the 16.6ms tick budget, and mutating `nextLineTable` conflicts with the cached per-agent `nextHopLineId` in `AgentStoreSoA` (line 80).
* **Proposed Resolution**:
  Apply **Segmentation** (time-sliced incremental Dijkstra across $k$ origin stations per tick) and **Beforehand Cushioning** (double-buffered `nextLineTable` swap on player edits and major weather/headway shifts), and remove the redundant `nextHopLineId` field from `AgentStoreSoA` so agents read the active routing table at station boarding time.
* **Secondary Liabilities**:
  $2\times$ memory footprint for the routing lookup tables ($2 \times 1\text{ MB}$ for front/back buffers) and a brief multi-tick window before background route updates take effect.

---

### 2.2 Unsynchronized Zero-Copy `SharedArrayBuffer` Reads vs. Mid-Tick Tearing & Missing COOP/COEP Fallback - Severity: 🟡 Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L11-L12) (`## 1. Architectural Philosophy`, lines 11–12), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L44-L55) (`## 3. High-Level System Architecture Diagram`, lines 44–55), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L69-L84) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 69–84)
* **False Compromise**:
  The architecture trades **Frame State Consistency & Deployment Portability** for **Zero-Copy Read Speed**. Reading `[ SharedArrayBuffer (Render State) ]` at 60–120Hz on the Main Thread while the Simulation Worker mutates it at 30–60Hz causes mid-tick read tearing (rendering partially updated vehicle and station states). Additionally, relying exclusively on `SharedArrayBuffer` breaks execution whenever the game is embedded on hosts without `COOP`/`COEP` cross-origin isolation headers.
* **Proposed Resolution**:
  Apply **Beforehand Cushioning** (double-buffered render state slots coordinated with an `Atomics` sequence index, or transferable `ArrayBuffer` ping-pong swaps over `postMessage` when `self.crossOriginIsolated === false`).
* **Secondary Liabilities**:
  $2\times$ memory allocation for render state buffers, atomic index synchronization at tick boundaries, and maintaining a fallback `postMessage` buffer swap path.

---

### 2.3 Hard-Capped Individual Agent Pool (`MAX_AGENTS = 100_000`) vs. Induced Demand & Event Surge Scaling - Severity: 🟡 Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L70-L84) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 70–84), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L95-L99) (`### 4.2`, lines 95–99); cross-referenced with [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L28-L37) (`### 2.1`, lines 28–37), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L79-L79) (`## 3`, line 79), and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L108-L119) (`### 4.1` & `### 4.3`, lines 108–119)
* **False Compromise**:
  The architecture trades **Unbounded Late-Game / Surge Demand** for **Fixed-Memory Allocation** (`MAX_AGENTS = 100_000`, line 74). Act III baseline ridership already reaches `100k+ Riders` (GDD line 79), and the Transit Gravity Model ($D_{ij}(t) \propto C_{ij}^{-\gamma}$, line 30) induces extra demand on top of `2x` U-Pass campus volume (line 108), `100%` Night Owl demand (line 109), and `25,000`-fan event surges (line 119). A 1-to-1 agent slot ceiling will saturate and drop spawned commuters, even though commuters at the same station or vehicle with the same `destStationId` follow identical routing transitions (Architecture lines 96–98).
* **Proposed Resolution**:
  Apply **Dynamics** (adaptive cohort batching) or **Segmentation** (destination-bucketed station queues): add a `passengerCount: Uint16Array` weight field so commuters spawned in the same tick with identical `(originStationId, destStationId)` coalesce into weighted cohorts (splitting only when a vehicle hits capacity), or represent station platform queues directly as a $512 \times 512$ origin-destination matrix.
* **Secondary Liabilities**:
  Cohort splitting/merging logic during capacity-constrained boarding and cohort-averaged wait/satisfaction timers rather than per-individual timers.

---

### 2.4 Static "Zero Engine Rewrites" City Manifest vs. Polymorphic City Mechanics - Severity: 🟡 Major
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L15-L15) (line 15), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L124-L135) (`## 5. Multi-City Expansion Framework`, lines 124–135), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L14-L14) (line 14), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L113-L142) (`## 5. Multi-City Data Pipeline & Schema`, lines 113–142)
* **False Compromise**:
  Restricting city packs to static JSON scalar modifiers (`manifest.json`, `geometry.json`, `nodes.json`) while promising mechanics that invert core engine rules (water as navigable SeaBus corridors in Vancouver/Amsterdam vs. obstacles in Edmonton; through-running suburban-to-subway rail and retail revenue in Tokyo; underground-only rubber-tired metro in Montreal) creates a contradiction between **Data-Driven Modularity** and **City-Specific Gameplay Rules**.
* **Proposed Resolution**:
  Apply **Inversion** (declarative capability traits / rule hooks): if multi-city mechanics are retained, define composable capability traits (e.g., `waterNavigationAllowed`, `throughRunningPairs`, `stationRetailRevenueModel`) that city manifests bind declaratively without rewriting core simulation loops.
* **Secondary Liabilities**:
  Additional trait-evaluation indirection during line validation, pathfinding edge construction, and revenue calculation.

---

### 2.5 Unbounded Auto-Headway Dispatcher vs. Gravity Model & TOD Runaway Feedback Loop - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L28-L37) (`### 2.1`, lines 28–37), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L86-L96) (`### Act II` & `### Act III`, lines 86–96), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L103-L109) (`### 4.3`, lines 103–109)
* **False Compromise**:
  Coupling an unthrottled `"Target 80% Load"` Auto-Headway Dispatcher (GDD line 88) with the Transit Gravity Model ($D_{ij}(t) \propto C_{ij}^{-\gamma}$, line 30) and TOD density growth (line 95) creates a positive feedback runaway loop: dispatching more vehicles lowers headway $H(L)$, which reduces Generalized Travel Cost $C_{ij}$, inducing higher demand and TOD growth, which pushes load back above 80% until the fleet saturates the corridor's physical minimum headway or bankrupts OpEx reserves.
* **Proposed Resolution**:
  Apply **Blessing in Disguise** and **Self-Service**: enforce a mode-specific minimum safe headway floor and OpEx ceiling in `dispatchSystem.ts`, converting corridor saturation into a prompt to upgrade the corridor to the next transit mode tier.
* **Secondary Liabilities**:
  Additional per-line hysteresis timers, minimum headway floors, and OpEx reserve caps in `dispatchSystem.ts`.
