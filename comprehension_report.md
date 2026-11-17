**What this proposes**
* **[game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`Lines 1-141`)**: Proposes *YEG Transit Architect* (working title: *MetroFlow*), a web-based urban transit strategy and automation game starting in Edmonton, Alberta and expanding to other global cities via modular data packages. Players build and upgrade multi-modal transit networks across five infrastructure tiers (from local buses to regional rail) to serve a time-of-day commuter demand cycle governed by a Transit Gravity Model. To avoid late-game micromanagement as the network scales, the game progresses through three acts that unlock automation tools—such as automated headway dispatchers and AI feeder shuttles—alongside dynamic Transit-Oriented Development (TOD) and roguelite City Council policy choices every four in-game weeks.
* **[technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md) (`Lines 1-238`)**: Proposes the technical stack, browser-based system architecture, memory layout, and five-milestone implementation roadmap for *YEG Transit Architect*, targeting 60–120 FPS with up to 100,000 active commuters, 2,500 vehicles, and 500+ stations. It decouples rendering and UI on the main browser thread (using PixiJS v8 over WebGPU/WebGL2 and React 19 + Zustand) from a fixed-timestep Simulation Web Worker that updates Structure-of-Arrays (SoA) `TypedArray` buffers backed by a `SharedArrayBuffer`. To avoid per-frame pathfinding per agent, the worker pre-computes an all-pairs next-hop routing table across stations whenever transit lines change, allowing $O(1)$ boarding and alighting lookups during simulation ticks. Finally, it outlines a modular multi-city GeoJSON/OSM pipeline (starting with Edmonton), a proposed repository file tree, and five implementation milestones (`v0.1` to `v1.0`).

**How the existing system works, per this document**
* **[game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`Lines 1-141`)**: This document is a conceptual, high-level Game Design Document and does not describe an existing codebase, runtime architecture, or previously implemented system. Section 5 briefly states in the present tense that the game is built around a "City Pack Manifest" architecture using GeoJSON map packages and city modifier profiles so new cities require zero engine rewrites. However, no existing engine components, data schemas, or implementation artifacts are described or linked within the document.
* **[technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md) (`Lines 1-238`)**: This document does not describe an existing software system; it is a greenfield architecture specification and initial scaffolding plan (starting at Milestone 1 `v0.1`: scaffolding Vite, TypeScript, PixiJS v8, and React/Tailwind). Rather than documenting existing code, it references real-world Edmonton transit domain elements (such as the Capital, Valley, and Metro LRT lines, ETS buses, the ARC Card fare system, and the North Saskatchewan River Valley) that the proposed simulation aims to model. Several game mechanics and progression systems are referenced as if already established in a separate, unlinked design context (`GAME_DESIGN.md`), leaving their underlying rules undefined in this file.

---

# Goldfish Review Report — Stage 6: Comprehension Test

**Targets:**
* [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`FeatureRange: Lines 1-141`, `DetailedRange: N/A`)
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md) (`FeatureRange: Lines 1-151`, `DetailedRange: Lines 152-238`)

## Reviewer Status

| Reviewer | Target | Status |
| --- | --- | --- |
| `egm-comprehension` | `game_design_document.md` | completed |
| `egm-comprehension` | `technical_stack_architecture.md` | completed |

---

## Part 1: Comprehension Findings in `technical_stack_architecture.md`

### 1.1 Disconnected Routing Lookup Logic & Missing `AgentStoreSoA` State - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L76-L83) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 76–83) and [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L86-L99) (`### 4.2 The O(1) All-Pairs Next-Hop Routing Table`, lines 86–99) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  The explanation of how `AgentStoreSoA`, `nextLineTable`, and `transferStationTable` connect during the 60Hz tick is self-contradictory and incomplete:
  1. Line 97 states that when Vehicle $V$ on Line $L$ arrives at Station $S$, each riding passenger checks `transferStationTable[S * N + p.dest]`, and *"If `S` is their destination or optimal transfer hub, they alight in $O(1)$ time"*. However, `transferStationTable` is indexed by `[originStation * MAX_STATIONS + destStation]` (Line 91). Once the passenger is at station `S`, `S` is the current origin; looking up `[S * N + p.dest]` returns the *next* transfer station on the path from `S` to `p.dest`, not `S` itself (and the lookup key `[S * N + p.dest]` does not include the passenger's current riding line $L$, so it cannot tell whether the passenger just arrived on the incoming line or is already on the outgoing transfer line).
  2. `AgentStoreSoA` defines `nextHopLineId: Uint16Array` (Line 80: *"Pre-calculated optimal Line ID to board next"*), yet the boarding logic on Line 98 ignores `nextHopLineId` and instead queries `nextLineTable[S * N + p.dest] === L`. It is never explained when `nextHopLineId` is written or read, or how a passenger knows which station to alight at for a transfer if `AgentStoreSoA` stores no `transferStationId` (or `originStationId` from when they boarded).
  3. Lines 90–91 index the tables using `MAX_STATIONS` as the row stride (`originStation * MAX_STATIONS + destStation`), whereas Lines 97–98 use `N` (`S * N + p.dest`) without clarifying whether `N` is a dynamic station count or fixed at `MAX_STATIONS = 512`.

---

### 1.2 Undefined Variables ($\tau_{\text{dwell}}$, $\delta_{\text{transfer}}$) and Unexplained Multi-Criteria Graph Formulation - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L89-L89) (`### 4.2`, line 89) and [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L100-L110) (`### 4.3 Edge-Cost Formulation for Realistic Pathfinding`, lines 100–110) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  1. In the edge-cost formula on Line 103:
     $$W(u, v, L) = \frac{d(u, v)}{v_{\text{mode}}(L) \cdot \eta_{\text{weather}}} + \tau_{\text{dwell}} + \delta_{\text{transfer}} \cdot \left(\frac{H(L)}{2} + P_{\text{concourse}}(u)\right)$$
     the variables $\tau_{\text{dwell}}$ and $\delta_{\text{transfer}}$ are omitted from the *"Where:"* definition list (Lines 105–110).
  2. Because the graph is described as having $N \le 512$ station nodes (Line 87) and edge weights $W(u, v, L)$ are parameterized by station $u$, station $v$, and line $L$, a fresh reader cannot tell how $\delta_{\text{transfer}}$ is evaluated during All-Pairs shortest-path calculation (since whether boarding line $L$ at station $u$ is a transfer depends on the incoming line from the previous hop).
  3. Line 89 names the algorithm **"Multi-Criteria Modified Floyd-Warshall / All-Pairs Dijkstra"**, neither defining what makes it "Multi-Criteria" (given the single scalar cost $W(u,v,L)$ in Section 4.3) nor specifying whether Floyd-Warshall or Dijkstra is used and how it is modified to track line transfers.

---

### 1.3 Unexplained `SharedArrayBuffer (Render State)` Schema and Worker-to-Main Synchronization - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L37-L62) (`## 3. High-Level System Architecture Diagram`, lines 37–62) and [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L69-L84) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 69–84) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  1. Section 3 shows the PixiJS v8 Render Engine performing a `Zero-Copy Read (60-120Hz)` from `[ SharedArrayBuffer (Render State) ]` to draw the `WebGPU Instanced Vehicle Layer` (Lines 37, 45, 49). However, Section 4.1 only defines `AgentStoreSoA` (which contains station/vehicle IDs and timers, not spatial coordinates or vehicle state). The schema of the vehicle/station render buffers in `SharedArrayBuffer` and how tearing or race conditions are avoided between the 30Hz/60Hz worker writes and 60–120Hz main-thread reads are never explained.
  2. Line 55 labels the worker loop `Fixed-Timestep Loop (30Hz / 60Hz)`, whereas Lines 13 and 95 refer exclusively to the `60Hz simulation loop` / `60Hz Simulation Tick`, leaving the actual tick rate or when it switches between 30Hz and 60Hz undefined.
  3. Line 39 (`Throttled 4Hz Telemetry Sync`) and Line 45 (`Commands (PostMsg)`) are introduced in the architecture diagram without defining what state is synced via the 4Hz `postMessage` bridge versus read directly from `SharedArrayBuffer`.

---

### 1.4 Undefined Simulation Subsystems & Metrics (`Generalized Cost C_ij`, `satisfaction`, `Gravity Model`, `Auto-Dispatcher AI`, `TOD`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L26-L27) (`## 2`, lines 26–27), [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L37-L61) (`## 3`, lines 37–61), and [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L81-L82) (`### 4.1`, lines 81–82) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  Several domain-specific mechanics and formulas are referenced in `technical_stack_architecture.md` without inline definitions or a link to `game_design_document.md`:
  1. `AgentStoreSoA` comments reference `drives satisfaction` (Line 81) and `realized Generalized Cost C_ij` (Line 82). Neither `satisfaction` nor $C_{ij}$ (or how $C_{ij}$ is computed from `tripStartTime` and used by the simulation) is defined anywhere in the document.
  2. Section 3's worker pipeline lists five core stages—`1. Demand Spawner --> Gravity Model & Time-of-Day Pulse Generator`, `2. Vehicle Kinematics --> Acceleration, Dwell Timers & Headway Spacing`, `3. Boarding/Alighting --> ... & ARC Revenue Calc`, `4. Auto-Dispatcher AI --> Dynamic Peak/Off-Peak Fleet Scaling`, and `5. TOD City Evolution --> Land Value & Density Growth around Stations` (Lines 56–60)—along with `Policy Deck & TOD Upzoning UI` (Line 37). Only stage 3's lookup table is explained in Section 4; the remaining stages and terms (`TOD`, `Policy Deck`, `ARC Revenue Calc`) are left undefined.
  3. Local transit acronyms `ETS` and `ARC` (Line 27: *"ETS door chimes, ARC card taps"*; Line 58: *"ARC Revenue Calc"*) are used without defining what they stand for or how fare calculation works.

---

### 1.5 Incomplete Multi-City File Schemas (`geometry.json`, `nodes.json`) and Undefined `manifest.json` Enums - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L113-L149) (`## 5. Multi-City Data Pipeline & Schema`, lines 113–149) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  1. Line 115 states that adding a new city requires three files (`manifest.json`, `geometry.json`, `nodes.json`), but only `manifest.json` is shown (Lines 118–141). The data schemas and coordinate systems for `geometry.json` and `nodes.json` (and how `import-osm.ts` maps Overpass API queries into them on Line 148) are never defined.
  2. Within `manifest.json`, project-specific enum strings and parameters—`"climateProfile": "PRAIRIE_WINTER_CITY"`, `"type": "RIVER_VALLEY_GORGE"`, `"bridgeCostMultiplier": 2.4`, `"tunnelCostMultiplier": 3.2`, and `"mode": "LRT_HIGH_FLOOR"` / `"LRT_LOW_FLOOR"` (Lines 127–140)—are presented without defining the valid enum sets or how the simulation engine consumes them.

---

### 1.6 Contradiction in Multi-City File Requirements (`events.ts`, `DistrictSeed`, `EventProfile`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L171-L178) (`## 6. Repository Directory Structure`, lines 171–178) vs. [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L115-L115) (`## 5`, line 115) — `DetailedRange`
* **Discrepancy Description & Rationale**:
  Section 5 (Line 115) states *"Adding a new city after Edmonton requires only three files"* (`manifest.json`, `geometry.json`, `nodes.json`), which are purely JSON data files. However, Section 6's directory tree under `src/cities/edmonton/` adds a fourth TypeScript file, `events.ts # Oilers playoffs, Fringe Fest, -35C Polar Vortex` (Line 177), and `src/cities/types.ts` (Line 172) introduces `DistrictSeed` and `EventProfile` interfaces alongside `CityManifest`. Neither `DistrictSeed`, `EventProfile`, nor `events.ts` is defined or reconciled with the three-file city pack specification in Section 5.

---

### 1.7 Undefined Game Progression & Automation Concepts in Architecture Roadmap (`Act II`, `Act III`, `OCC`, `Suburban Feeder Catchment Zones`, `City Council roguelite policy deck`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L157-L216) (`## 6`, lines 157–216) and [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L231-L238) (`## 7. Phased Implementation Roadmap`, lines 231–238) — `DetailedRange`
* **Discrepancy Description & Rationale**:
  Sections 6 and 7 introduce several project-specific gameplay systems and acronyms without defining them or linking to `game_design_document.md` (furthermore, Line 157 names the file `GAME_DESIGN.md` and Line 158 names `ARCHITECTURE.md`, which do not match the actual filenames `game_design_document.md` and `technical_stack_architecture.md` in the repository):
  1. **Act Structure (`Act II`, `Act III`)**: Lines 191–192 describe `dispatchSystem.ts` as `Act II Auto-Headway & Feeder AI automation` and `todSystem.ts` as `Act III Transit-Oriented Development city growth`. The document never defines what Acts I, II, and III are or what triggers transitions between acts.
  2. **`OCC` (`OCC automation modules`, `OCCAutomationPanel.tsx`, `OCC Auto-Headway Dispatcher`)**: Referenced on Lines 170, 213, and 235 without expanding the acronym (Operations Control Centre) or explaining how `OCC Auto-Headway Dispatcher` and `Suburban Feeder Catchment Zones` (Line 235) operate.
  3. **Gameplay Systems in Milestones 3–5**: Terms such as `Bridge vs. Tunnel river-crossing prompts` (Line 233), `"The Network Must Grow" Automation` (Line 234), `City Council roguelite policy deck` / `City Council Election Policy Deck` (Lines 169, 214, 238), `Edmonton Crisis Scenarios` (Line 238), and `procedural pentatonic audio chimes` (Lines 205, 238) are named as milestone deliverables without defining their mechanics, inputs, or outputs.

---

### 1.8 Undefined Tool/Environment Reference (`Antigravity`) and Temperature Value Inconsistency (`-35C` vs. `-40°C Polar Vortex`) - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L152-L238) (`## 6` & `## 7`, lines 152, 177, 221–223, 238) — `DetailedRange`
* **Discrepancy Description & Rationale**:
  1. Lines 152 and 221–223 reference `Antigravity` (*"Ready for Antigravity"*, *"When working with Antigravity in your repository..."*) without defining what Antigravity is for a standalone reader of the architecture document.
  2. Line 177 refers to the crisis event as `-35C Polar Vortex`, whereas Line 238 refers to it as `-40°C Polar Vortex`.

---

## Part 2: Comprehension Findings in `game_design_document.md`

### 2.1 Disconnected Economic, Approval, and Progression Systems - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L14-L14) (`## 1`, line 14), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L41-L50) (`### 2.2`, lines 41–50), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L66-L66) (`### 2.3`, line 66), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L77-L96) (`## 3`, lines 77–96), and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L103-L119) (`## 4`, lines 103–119) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  Multiple core game loops are referenced across sections without explaining how their underlying metrics work or connect:
  1. **Financial Economy**: The document references `CapEx` and `OpEx` (Line 41), `tax revenue` (Line 14), `ARC fare revenue` (Line 84), `Land Value Capture lease revenue` (Line 95), and a `$1,500 semesterly lump-sum grant` (Line 108), but never defines the player's budget, starting funds, fare structure, or cost scale (leaving `$1,500` and qualitative table values like `Moderate CapEx` / `1x` capacity without a numeric baseline).
  2. **Approval & Satisfaction Metrics**: The document introduces `rider happiness` (Line 66), `Public Approval` / `Council target` (Line 104), `suburban car-commuter patience` (Line 106), and losing a scenario when `approval hits zero` (Line 119). It is never explained whether these are separate stats or a single metric, how Public Approval is calculated, or what happens in the standard campaign if Public Approval falls below the Council target at an election cycle.
  3. **Progression & Milestone Gating**: Section 3 headers gate Acts I, II, and III by time (`Weeks 1–4`, `Weeks 5–12`, `Weeks 13+` in Lines 82, 86, 92), whereas the ASCII diagram (Line 79) and text (Line 87) state that Act II unlocks `Once the player hits ridership milestones`. Furthermore, Section 2.2 defines 5 Infrastructure Tiers (Lines 43–49) and Section 4.3 states the Career Architect campaign grows the city across `5 Milestones` (Line 118), without defining what those 5 Milestones are or how they map to the 3 Acts, 5 Infrastructure Tiers, and 4-week Election Cycles.

---

### 2.2 Incomplete Specification of the 24-Hour Demand Pulse and Transit Gravity Model - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L21-L37) (`### 2.1 The 4-Step Commuter Demand Pulse`, lines 21–37) and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L109-L109) (`### 4.1`, line 109) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  1. **Missing 12-Hour Overnight Window & Zone Types**: Section 2.1 claims to describe a `24-Hour / 7-Day Rhythm` in 4 steps (Line 22), but the time steps only cover `06:30–09:30`, `09:30–15:30`, and `15:30–18:30` (Lines 23–25), while the 4th bullet is `Special Event Surges` (Line 26). The 12-hour period from `18:30–06:30` (and how weekend days differ in the `7-Day Rhythm`) is omitted from Section 2.1, even though Section 4.1 later assumes the reader knows about a `nighttime lull` (Line 109). Additionally, Line 23 defines zone types `R`, `C`, `I`, and `U`, while Line 25 introduces `Entertainment & Nightlife districts` without clarifying whether that is a fifth zone type or a subset of `C`.
  2. **Transit Gravity Model vs. Mode Share %**: In the formula $D_{ij}(t) = \frac{P_i(t) \cdot A_j(t)}{(C_{ij})^\gamma}$ (Lines 28–36), $C_{ij}$ is defined solely in terms of transit (`in-vehicle travel time + waiting time + transfer penalty`). The document does not explain what $C_{ij}$ is when no transit connection exists between $i$ and $j$, how car travel cost is modeled, or how $D_{ij}(t)$ translates into `Mode Share %` (Line 36).

---

### 2.3 Undefined Gameplay Mechanics Referenced Inline (`Blueprint Interchanges`, `scenic bonus`, `grade slope`, `central garage`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L13-L13) (`## 1`, line 13), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L62-L63) (`### 2.3`, lines 62–63), and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L88-L88) (`### Act II`, line 88) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  Several project-specific mechanics are named once without explanation:
  1. `Blueprint Interchanges` (Line 13) is listed as a core mid-to-late-game unlock in Pillar 2, but never appears again in Section 3 or anywhere else in the document.
  2. `scenic bonus` and `medium grade slope` / `zero slope penalty` (Lines 62–63) are listed as trade-offs for river crossings, without explaining what gameplay effect a scenic bonus confers or how slope affects different transit tiers.
  3. `central garage` and `reserve pool` (Line 88) are referenced as the source of automated vehicle dispatches, without explaining whether garages are physical structures players must place on the map or an abstract global vehicle pool.

---

### 2.4 Unlinked and Undefined Technical Architecture Concepts in GDD - Severity: 🟡 Major
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L15-L15) (`## 1`, line 15) and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L126-L135) (`## 5. Multi-City Expansion Framework`, lines 126–135) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  The document asserts that adding new cities requires zero engine rewrites because of the `City Pack Manifest` architecture, `GeoJSON map package`, and `city modifier profile` (Line 126), even though the city table immediately below it (Lines 128–135) introduces bespoke per-city mechanics (sea ferries, underground bike parking garages multiplying catchment radius, through-running commuter rail, department store retail revenue). Neither the manifest schema nor how a "city modifier profile" expresses these distinct mechanics without engine code changes is defined inline or linked to `technical_stack_architecture.md`.

---

### 2.5 Inconsistent Naming of Automation Features Across Sections - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L13-L89) (Sections `1`, `2.3`, and `3`, lines 13, 58, 68, 78, 87–89) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  The same automation concepts are referred to by different names across sections without explicitly equating them:
  * Headway automation is variably called `Automated Dispatchers, Headway Controllers` (Line 13), `Automated Headway Spacing` (Line 58), `Auto-Headway` (Line 78), and `Auto-Headway Dispatcher` (Line 88).
  * Feeder automation is variably called `Autonomous Feeder Loops` (Line 13), `Autonomous Neighborhood Feeder Loops` (Line 68), `Feeder AI` (Line 78), and `Suburban Feeder AI (Micro-Transit Zones)` / `On-Demand Feeder Shuttles` (Line 89).

---

### 2.6 Undefined Regional/Domain Acronyms and Minor Inconsistencies - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-comprehension`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L15-L141) (lines 15, 36, 45–47, 58, 83–84, 108, 128–141) — `FeatureRange`
* **Discrepancy Description & Rationale**:
  1. Regional and domain acronyms `ETS` (Edmonton Transit Service), `ARC` (Edmonton region's smart fare card), `BRT` (Bus Rapid Transit), `LRT` (Light Rail Transit), `LRV` (Light Rail Vehicle), and `REM` (Réseau express métropolitain) are used without expansion on first use.
  2. Line 108 grants a `$1,500 semesterly lump-sum grant`, but "semester" is never defined in terms of in-game days or weeks.
  3. Line 15 lists `London` among the planned expansion cities `(Montreal, Vancouver, Tokyo, London, Amsterdam)`, but London is omitted from the Section 5 Multi-City Expansion Framework table (Lines 128–135).
