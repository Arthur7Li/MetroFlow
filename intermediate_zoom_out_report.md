# Goldfish Review Report — Stage 8: Intermediate Zoom Out Review

**Targets:**
* [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`Lines 1-192`, Full File)
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md) (`Lines 1-320`, Full File)

**Baseline Comparison:** [zoom_out_report.md](file:///Users/arthurli/MetroFlow/zoom_out_report.md) (Stage 5 Initial Zoom Out)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

## Stage 5 Progression Summary
Context sufficiency passes across both documents, and earlier issues regarding `bitECS` vs. custom `TypedArray` stores, overlapping audio libraries (`Tone.js`/`Howler.js`), unbounded gravity demand, and Act I bankruptcy soft-locks are resolved. However, several Stage 5 issues persist or expanded through mitigation additions: dual `SharedArrayBuffer`/transferable snapshot synchronization, inverted Milestone 2 ordering, 100k-slot intrusive SoA cohort complexity, speculative multi-city hooks in `v1.0`, a cross-document contradiction on Crisis Scenarios, and expanded low-level implementation details in high-level architecture sections.

---

## Prioritized Findings (Blockers $\rightarrow$ Major $\rightarrow$ Nits)

### 1. Dual-Transport `SharedArrayBuffer` + `Atomics` / Transferable Fallback & Inverted Milestone Sequence - Severity: 🔴 Blocker
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L11-L20) (`### 1.2` & `### 1.3`, lines 13, 20)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L58-L78) (`## 3. High-Level System Architecture Diagram`, lines 58–60, 78)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L107-L121) (`### 4.1`, lines 107–121)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L214-L224) (`### 5.3` & `### 5.4`, lines 214–217, 222–224)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L246-L267) (`## 6`, lines 246, 267)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L310-L316) (`## 7. Phased Implementation Roadmap`, lines 310–316)
* **Discrepancy Description & Simplicity Rationale:**
  1. **Premature Optimization & Dual-Transport Complexity:** Based on `VehicleRenderSoA` (24 bytes/vehicle) and `StationRenderSoA` (6 bytes/station), the entire render snapshot is ~15 KB at typical 500-vehicle gameplay and ~99 KB at `MAX_VEHICLES = 4_096` and `MAX_STATIONS = 512`. Transferring a 15–100 KB `ArrayBuffer` at 30Hz via `postMessage` transfer lists is already zero-copy and sub-millisecond without `SharedArrayBuffer`, `Atomics`, or `COOP`/`COEP` hosting headers. Maintaining two cross-thread memory models (`SharedArrayBuffer` + `Atomics` plus transferable `ArrayBuffer` fallback) for a `< 100 KB` snapshot violates Simplicity and Minimalist Data Flow.
  2. **Inverted Milestone Sequence (Unresolved Stage 5 Blocker):** Milestone 2 (`v0.2`, lines 313–314) still builds the full Worker Cohort SoA, dual-buffer render snapshot, time-sliced pathfinder, and 50,000+ commuter transfer benchmarks *before* Milestone 3 (`v0.3`, lines 315–316) implements interactive route drawing, river crossings, the 5 transit modes, and core economy. Core playable mechanics should precede cross-thread scaling optimizations.

---

### 2. Cross-Document MVP Contradiction on Crisis Scenarios (`Post-MVP` vs. `v1.0`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L24-L24) (`### 1.3 Goals & Non-Goals`, line 24)
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L140-L141) (`### 4.3 Game Modes`, lines 140–141)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L319-L320) (`## 7. Phased Implementation Roadmap`, Milestone 5 `v1.0`, line 320)
* **Discrepancy Description & Simplicity Rationale:**
  `game_design_document.md` scopes MVP to a single primary game mode (`Career Architect`) and places **Crisis Scenarios** (`-40°C Polar Vortex Breakdown`, `Stanley Cup Finals Game 7`) in **Post-MVP Scope** (lines 24, 141). However, `technical_stack_architecture.md` schedules **Edmonton Crisis Scenarios (-40°C Polar Vortex, Stanley Cup Finals)** into **Milestone 5 (`v1.0`)** (line 320).

---

### 3. Speculative Multi-City Capability Trait Hooks, Unrequested `LZ-String` URL Sharing, and Post-MVP Stubs in `v1.0` - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L15-L15) (`### 1.2`, line 15), [Line 39](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L39-L39), [Lines 159–203](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L159-L203), [Lines 248–288](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L248-L288), [Line 320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L320-L320)
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L15-L15) (`### 1.2`, line 15), [Lines 146–157](file:///Users/arthurli/MetroFlow/game_design_document.md#L146-L157), [Line 178](file:///Users/arthurli/MetroFlow/game_design_document.md#L178-L178)
* **Discrepancy Description & Simplicity Rationale:**
  1. **Speculative `capabilityTraits` in `v1.0`:** Both documents define five speculative engine traits (`requireUnderground`, `waterNavigationAllowed`, `bikeCatchmentMultiplier`, `throughRunningPairs`, `stationRetailRevenueModel`) and non-Edmonton obstacle enums for Post-MVP cities, and `technical_stack_architecture.md` Milestone 5 (`v1.0`, line 320) builds **City Capability Trait hooks for future City Packs** into `v1.0` even though Edmonton sets `"capabilityTraits": []` (line 173).
  2. **Unrequested `LZ-String` URL Sharing:** `technical_stack_architecture.md` (lines 39, 320) schedules `< 4 KB` shareable Network & Policy Blueprint URL serialization in `v1.0`, which is absent from `game_design_document.md`.
  3. **Retained Post-MVP Stubs:** `tools/import-osm.ts` (lines 199–203, 248–249), `src/cities/montreal/` (line 263), and `src/renderer/shaders/river.wgsl` + `trackPulse.wgsl` (lines 286–288, lacking the `.glsl` counterparts referenced in line 233) remain in the active blueprint.

---

### 4. Hybrid 100,000-Slot Intrusive SoA Pool With Dual `>70%` Coalescing & Capacity Splitting - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L9-L9) (`### 1.1`, line 9)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L85-L105) (`### 4.1`, lines 85–105)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L134-L138) (`### 4.2`, lines 134–138)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L225-L227) (`### 5.4`, lines 225–227)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L269-L269) (`## 6`, line 269)
* **Discrepancy Description & Simplicity Rationale:**
  Commuters have no world $(x,y)$ coordinates or individual sprites; the renderer reads only station waiting totals and vehicle load ratios. Keeping `MAX_AGENTS = 100_000` with intrusive doubly-linked lists (`nextInNode`, `prevInNode`, `headAgentByStation`, `headAgentByVehicle`), dynamic coalescing above `70%` pool usage (lines 96, 227), and capacity-split allocation during boarding (line 137) introduces two runtime behaviors (`<70%` vs. `>=70%`) and pointer bookkeeping compared to representing station and vehicle queues directly as aggregated destination-bucketed flow counts.

---

### 5. Over-Engineered MVP Routing: Dual Parallel-Corridor Matrices (`nextLineAltTable`) & Dense Route-Segment Graph - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L14-L14) (`### 1.2`, line 14)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L124-L150) (`### 4.2` & `### 4.3`, lines 124–150)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L210-L213) (`### 5.3`, lines 210–213)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L228-L230) (`### 5.4`, lines 228–230)
* **Discrepancy Description & Simplicity Rationale:**
  Section 4.2/4.3 adds a **Route-Segment Graph** connecting every $(u, w)$ pair on each line ($O(S^2)$ chord edges per line), double-buffered primary and secondary matrices (`nextLineTable`, `alightStationTable`, `nextLineAltTable`, `alightStationAltTable`), 32-origin time slicing with tick-1 priority scheduling and `>= 15%` weather/headway shift triggers, and parallel-corridor splitting within a `10%` threshold. Additionally, `nextLineAltTable` stores only a `Uint16` line ID without specifying proportional capacity-splitting weights at boarding (lines 130, 137), and `demandSystem.ts` (line 152) requires $C_{ij,\text{transit}}$ total-cost lookups not stored in those matrices.

---

### 6. Persistent MVP Mode & Subsystem Bloat (`5 Tiers`, `Suburban Feeder AI`, `Blueprint Interchanges`) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L21-L21) (`### 1.3`, line 21)
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L54-L63) (`### 2.2`, lines 54–63)
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L79-L79) (`### 2.3`, line 79)
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L111-L112) (`### 3.2`, lines 111–112)
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L133-L137) (`### 4.2`, lines 133–137)
* **Discrepancy Description & Simplicity Rationale:**
  All 5 transit mode tiers (`Local Bus`, `Articulated BRT`, `Low-Floor Tram` with TSP, `High-Floor LRT` multi-car consists, `Regional Rail`) remain in MVP. Furthermore, **Suburban Feeder AI** (line 111: "Automated on-demand shuttles dynamically collect local riders inside that radius") implies dynamic spatial shuttle routing absent from `technical_stack_architecture.md`'s station-ID graph; a station catchment-radius upgrade solves the trunk-and-feeder mechanic without bespoke shuttle AI. **Blueprint Interchanges** (line 112) and **3 Metropolitan Growth Seeds** (lines 133–137) also add MVP UI and state scope prior to core network validation.

---

### 7. Expanded Altitude Drops into Low-Level Implementation Details (Weeds) - Severity: 🟡 Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L72-L72) (`## 3`, line 72)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L88-L152) (`### 4.1`, `### 4.2`, `### 4.3`, lines 88–152)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L163-L197) (`### 5.1`, lines 163–197)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L239-L302) (`## 6`, lines 239–302)
* **Discrepancy Description & Simplicity Rationale:**
  High-level architecture sections retain and expand low-level details: exact TypeScript `TypedArray` field declarations (`Uint8Array`, `Uint16Array`, `Int32Array`, `Float32Array`, `Uint32Array`), 1D indexing arithmetic (`S * MAX_STATIONS + dest`), byte sizing (`~3.2 MB`, `512 KB`), tuning/slicing constants (`32 origins/tick`, `~17 origin zones/tick`, `<= 16 ticks (~0.53s)`, `> 70% pool load`, `>= 15%` trigger, `10%` threshold, `0.68` weather multiplier, `240s`/`120s`/`60s` penalties), hardcoded `manifest.json` pixel bounds and hex colors, and a 64-line component file tree in Section 6 before any code exists.

---

### 8. Stale `ecs/` Folder Naming & Unnecessary `Dexie.js` Wrapper - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:**
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L39-L39) (`## 2`, line 39)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L268-L268) (`## 6`, line 268)
* **Discrepancy Description & Simplicity Rationale:**
  1. **Stale `src/core/ecs/` Naming (line 268):** Section 5.3 (line 208) rejects `bitECS` in favor of plain domain `TypedArray` stores, yet Section 6 still nests `agents.ts`, `vehicles.ts`, and `stations.ts` under `src/core/ecs/` instead of `src/core/stores/` or `src/core/model/`.
  2. **`Dexie.js` Dependency (line 39):** Persisting local auto-saves and binary savegame snapshots by slot key requires only a small wrapper over native `IndexedDB` rather than an external query library.
