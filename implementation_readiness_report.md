# Goldfish Review Report — Stage 9: Implementation Readiness Test

**Target (`DetailedRange`):**
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L237-L320) (`Lines 237-320`: `## 6. Repository Directory Structure (Implementation Blueprint)` and `## 7. Phased Implementation Roadmap`)

**Context Supplied:**
* [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`Lines 1-192`)
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L1-L236) (`FeatureRange: Lines 1-236`)

**Applied Document Standards:**
* `egm-implementation-readiness` $\rightarrow$ `resources/document_standards/implementation-readiness-standard.md`
* `egm-codebase-details` $\rightarrow$ `resources/document_standards/implementation-readiness-standard.md`
* `egm-style` $\rightarrow$ Persona Style Audit Vectors

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

**Overall Verdict:** **FAIL** — Does not yet meet `implementation-readiness-standard.md` (The Zero-Decision Rule, Target Scope & File Boundary, Actionable Steps, and Test Plan).

---

## Prioritized Findings (Blockers $\rightarrow$ Major $\rightarrow$ Nits)

### 1. Missing Target Scope & File Boundaries (`Create`/`Modify`/`Delete` Labels, Pinned Toolchain & Per-Milestone Allowlists) - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-01`
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L239-L320) (`## 6`, lines 239–302, and `## 7`, lines 306–320)
* **Discrepancy Description**:
  1. **Unpinned Dependencies & Missing Config Specs**: `package.json` (line 244), `tsconfig.json` (line 245), and `vite.config.ts` (line 246) omit exact package names, pinned semver versions, `pnpm` scripts (`dev`, `build`, `preview`, `test`, `typecheck`), compiler options (`DOM` vs. `WebWorker` `lib` boundaries, `strict`), Tailwind configuration choice (v3 PostCSS vs. v4 `@tailwindcss/vite`), and exact Vite `server.headers`/`preview.headers` (`COOP`/`COEP`) and worker bundling settings.
  2. **Missing `Create` / `Modify` / `Delete` Labels & Repo Root Mismatch**: Per `implementation-readiness-standard.md`, Section 6 lists repository paths without marking each path as `Create`, `Modify`, or `Delete`, and labels the root directory `yeg-transit-architect/` (line 240) instead of the workspace directory `MetroFlow/`. Section 7 assigns almost no explicit per-milestone file boundaries.
  3. **Missing Core Shell Files & Out-of-Scope Mixing**: Section 6 omits `src/App.tsx` (mounted by `main.tsx`), `src/vite-env.d.ts`, and `.gitignore`, while mixing Post-MVP entries (`tools/import-osm.ts`, `src/cities/montreal/`, `src/renderer/shaders/`) into the tree without explicit MVP exclusion boundaries.
* **Rationale & Recommendation**:
  Define pinned `package.json` dependencies/scripts, concrete `tsconfig.json` and `vite.config.ts` configurations, explicit `Create` / `Modify` / `Delete` annotations anchored to the repository root, and explicit per-milestone file write allowlists.

---

### 2. Missing Persistence & Serialization Architecture (`IndexedDB / Dexie.js` + `LZ-String`) - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-02`
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L237-L320) (`## 6`, lines 237–302; `## 7` Milestone 5, line 320; cross-referenced with Section 2, line 39)
* **Discrepancy Description**:
  Section 2 (line 39) specifies **IndexedDB (via Dexie.js) + LZ-String** for local auto-saves, binary simulation snapshots, and `< 4 KB` blueprint URL sharing, and Milestone 5 (line 320) mandates `LZ-String` blueprint URL sharing. However, Section 6 includes zero persistence, database schema, or state serialization files, and Section 7 omits IndexedDB auto-save/load from all 5 milestones.
* **Rationale & Recommendation**:
  Add dedicated persistence/serialization modules (e.g., `src/storage/saveDb.ts`, `src/storage/blueprintCodec.ts`), define the Dexie object-store schema, binary worker-state snapshot format, auto-save cadence, `LZ-String` URL schema (`< 4 KB` validated), and schedule save/load implementation in the milestone plan.

---

### 3. Missing MVP Simulation Entities, Systems & UI Components Required by GDD and Sections 1–5 - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-03`
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L252-L320) (`src/config/`, `src/core/`, `src/ui/`, lines 252–302, and `## 7`, lines 306–320)
* **Discrepancy Description**:
  1. **Missing Core Entities & Systems (`src/core/`)**: `src/core/ecs/` (lines 268–271) models only `agents.ts`, `vehicles.ts`, and `stations.ts`, omitting modules for **Transit Lines, Corridors, Track Segments, River Crossings, Blueprint Interchanges, and Suburban Feeder Catchment Zones**. `src/core/systems/` (lines 274–278) omits **Economy & Treasury** (`$50,000 CAD` start, `$3.50` ARC fare, daily OpEx, `75%` teardown refund, `$25,000` Municipal Bond at `5%` weekly interest), **5 Ridership Milestones & Act I–III gating**, **Public Approval & 4-Week Election Cycles / Probation / Game-Over states**, and **Metropolitan Growth Seeds (`Seed A/B/C`)**.
  2. **Missing UI & App Shell (`src/ui/`)**: Omits `src/App.tsx`, interactive route-drawing and feeder-zone painting controllers, the 3-option **River-Crossing Selector** modal, **Blueprint Interchange** palette, and **New Game / Seed / Save-Load / Victory & Game-Over** views.
  3. **Unscheduled MVP Features in Section 7**: Milestones 1–5 never schedule **Growth Seeds (`Seed A/B/C`)**, **5 Ridership Milestones**, **time-scale controls (`Pause/1x/2x/4x` & 12-min diurnal clock)**, **All-Door ARC Boarding**, **Concourse Tiers (`0/1/2`)**, **Park-and-Ride vs. Suburban Feeder choice**, **TSP upgrades**, **One-Click Corridor Upgrading**, **`weatherSystem.ts`**, or **HUD `LayerToggles.tsx` heatmaps**.
* **Rationale & Recommendation**:
  Add missing core store/system/UI modules to Section 6 and explicitly assign every GDD MVP feature to a milestone in Section 7.

---

### 4. Unspecified Cross-Thread Contracts (`RenderSnapshotBuffer` Byte Layout, Topology Sync, `WorkerCommand` & `TelemetrySnapshot`) - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-04`
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L265-L293) (`worker.ts`, `sharedBuffers.ts`, `renderer/`, `useGameStore.ts`, lines 265–293; Milestone 2, lines 313–314)
* **Discrepancy Description**:
  1. **Unspecified `SharedArrayBuffer` Header & Alignment**: `sharedBuffers.ts` (line 267) lacks byte offsets, 4-byte alignment rules, active-vehicle count or active-slot flags, and `Atomics` control-header fields (`activeSlot`, `tickIndex`, `tickTimestampMs`, `vehicleCount`, `stationCount`) needed for 60–120Hz frame interpolation.
  2. **Incomplete Transferable `ArrayBuffer` Fallback**: Omits the main-thread-to-worker buffer-return `postMessage` handshake required to recycle ping-pong buffers without per-tick allocation when `self.crossOriginIsolated === false`.
  3. **Missing Worker `postMessage` & Topology Contracts**: Omits TypeScript discriminated union definitions for `WorkerCommand` (main $\rightarrow$ worker) and `TelemetrySnapshot` (4Hz worker $\rightarrow$ `useGameStore.ts`), as well as how static/semi-static topology (station `(x,y)` coordinates, corridor Bezier curves, bridge/tunnel flags, parallel offset indices) syncs from Worker to `NetworkLayer` and `StationLayer` (`VehicleRenderSoA` and `StationRenderSoA` carry no station coordinates or route geometry).
* **Rationale & Recommendation**:
  Specify exact `RenderSnapshotBuffer` byte/header layouts, buffer-return fallback handshakes, `WorkerCommand` and `TelemetrySnapshot` TypeScript unions, and the topology sync payload before implementation.

---

### 5. Unspecified Core Data Schemas, Spatial Scale & Simulation Formulas (Zero-Decision Rule Violations) - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-05`
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L252-L290) (`src/config/*`, `src/cities/*`, `src/core/*`, `src/renderer/*`, `src/audio/*`, lines 252–290; Milestones 1–5, lines 310–320)
* **Discrepancy Description**:
  An implementing engineer must make independent design decisions across nearly every module due to missing schemas and constants:
  1. **Spatial Scale & City Schemas (`src/cities/types.ts`)**: `worldBounds` (`4000 x 3200`) has no world-unit-to-kilometer conversion constant (needed for `km/h` speeds, `$/km` CapEx, and `300m` pedway range). Exact JSON/TS schemas for `GeometryPack`, `CityNodeSeed`, and `EventSchedule` are absent.
  2. **SoA Lifecycle & Routing (`agents.ts`, `vehicles.ts`, `stations.ts`, `pathfinder.ts`)**: Missing free-slot stack management, FIFO vs. LIFO tail pointers on intrusive lists, exact merge/split behavior for `> 70%` cohort coalescing and pool-full overflow, `VehicleStoreSoA` / `StationStore` / `TransitLine` schemas, acceleration/dwell/anti-bunching physics, unreachable-route sentinel (`0xFFFF`), expected $C_{ij,\text{transit}}$ cost table location for `demandSystem.ts`, and capacity-proportional splitting math for `nextLineAltTable`.
  3. **Config & Gameplay Math (`modes.ts`, `policies.ts`, `upgrades.ts`, `systems/*`)**: Missing Gravity/Logit constants ($\gamma, \beta$), $C_{ij,\text{car}}$ formula, 24h/weekend diurnal demand curves, weather penalties (`-30°C` vs. `-40°C`), minimum safe headway floors, LRV consist rules, TSP & station upgrade costs, complete Policy Deck definitions, Council Approval target formula, TOD logistic growth rate $r$ and tier thresholds (`0..5`), and Feeder AI catchment rules.
  4. **Renderer & Audio (`NetworkLayer.ts`, `VehicleLayer.ts`, `SoundscapeEngine.ts`)**: Missing station placement/snapping rules (fixed seeds vs. free-form placement), Bezier parameterization and parallel-corridor offset math, river polygon intersection check, PixiJS instancing strategy (`ParticleContainer` vs. custom `Mesh`), heatmap normalization formulas, modal pentatonic pitch table, voice polyphony/rate limits, and autoplay-unlock handling.
* **Rationale & Recommendation**:
  Document all conversion constants, exact config/SoA TypeScript interfaces, simulation equations, and rendering/audio rules in the implementation specification so zero design decisions remain.

---

### 6. Missing Test Plan, Test Infrastructure & Verification Assertions - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-06`
* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L237-L320) (`## 6`, lines 237–302, and `## 7`, lines 306–320)
* **Discrepancy Description**:
  Line 308 states `"5 testable incremental milestones"`, yet Section 6 defines zero test runners (`vitest.config.ts`, `playwright.config.ts`), zero test directories/files, and zero test infrastructure/mocks (Worker mock, `crossOriginIsolated === false` harness, PixiJS headless mock, `AudioContext` mock, deterministic seeded fixtures). Section 7 contains zero test cases or pass criteria for Milestones 1, 3, 4, and 5, and Milestone 2's verification note (`line 314`) omits concrete assertions, vehicle-count benchmarks (`2,500` vs. `4,096` vs. `50,000+` cohorts), and the `< 4ms` worker tick assertion.
* **Rationale & Recommendation**:
  Add test tooling, directory layout, shared mocks, and explicit happy-path, edge-case, and quantitative benchmark assertions per milestone.

---

### 7. Cross-Document Scope Contradiction on Crisis Scenarios (`Post-MVP` vs. `v1.0`) & Uncalibrated Phasing - Severity: 🔴 Blocker
* **Finding ID:** `readiness-r1-07`
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-style`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L308-L320) (`## 7`, lines 308–320) vs. [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L24-L141) (lines 24, 140–141)
* **Discrepancy Description**:
  1. **Crisis Scenarios Contradiction**: Milestone 5 (`v1.0`, line 320) schedules `Edmonton Crisis Scenarios (*-40°C Polar Vortex*, *Stanley Cup Finals*)`, contradicting `game_design_document.md` lines 24 and 141 which mark Crisis Scenarios (`"-40°C Polar Vortex Breakdown"` and `"Stanley Cup Finals Game 7"`) as **Post-MVP** and limit MVP to Career Architect (and Section 6 has no scenario-rule engine or challenge-timer UI).
  2. **Milestone 1 Throwaway Code & Milestone 2 Dependency Ordering**: Milestone 1 (line 312) builds a `"minimal single-line bus drawing and vehicle movement prototype"` before Milestone 2 (line 314) builds the Simulation Worker, without clarifying whether M1 creates temporary main-thread simulation code or scaffolds the Worker upfront. Furthermore, Milestone 2 tests 50,000+ commuter multi-line transfers before Milestone 3 implements multi-line route drawing, without assigning `demandSystem.ts`, `edmonton/nodes.json`, or a transfer test fixture to M1/M2.
  3. **Performance Scale Mismatch**: Section 1.1 targets `2,500 vehicles`, Section 4.1 allocates `MAX_VEHICLES = 4_096`, and Milestone 2 verifies only `50,000+` commuters without a vehicle-count assertion.
* **Rationale & Recommendation**:
  Remove Post-MVP Crisis Scenarios from `v1.0` (or separate Career Architect dynamic events in `events.json` from Post-MVP Crisis Scenarios), clarify M1 worker scaffolding, resolve the M2 test-fixture dependency, and align vehicle/commuter benchmark targets.

---

### 8. Spec/Tree Drift (`shaders/`, `cities/`, `capabilityTraits`, `defaultLines`, `ecs/` Naming) - Severity: 🟡 Major
* **Finding ID:** `readiness-r1-08`
* **Reviewer Lens:** `egm-codebase-details`, `egm-style`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L254-L288) (`## 6`, lines 254, 257–263, 268, 286–288)
* **Discrepancy Description**:
  1. **Stale `ecs/` Folder Naming (line 268)**: Section 2 (line 36) and Section 5.3 (lines 206–209) reject ECS (`bitECS`) in favor of plain SoA `TypedArray` stores, yet line 268 still places `agents.ts`, `vehicles.ts`, and `stations.ts` under `src/core/ecs/` instead of `src/core/stores/` or `src/core/soa/`.
  2. **Missing `.glsl` Counterparts & Bare `montreal/` Directory**: Lines 286–288 list `river.wgsl` and `trackPulse.wgsl` without the paired `.glsl` fallback files mandated in lines 35 and 233; line 263 lists a bare `src/cities/montreal/` directory instead of explicit files and omits Maps 03–05 (`vancouver`, `amsterdam`, `tokyo`).
  3. **`capabilityTraits` & `defaultLines` Ambiguity**: `edmonton/manifest.json` sets `"capabilityTraits": []` (array, line 173) whereas parameterized traits (`bikeCatchmentMultiplier`, `throughRunningPairs`, line 197) imply key-value parameters; `defaultLines` (`CAP`, `VAL`, `MET`, lines 183–187) is unspecified as to whether lines are pre-built at game start (conflicting with Act I's `$50,000` manual bus start) or UI line templates.
  4. **Jargon Mismatch (`roguelite`, line 254)**: Line 254 uses `"City Council roguelite policy deck definitions"` where GDD Section 4.1 and TSA lines 1–236 use `City Council Election Policy Deck`.
* **Rationale & Recommendation**:
  Rename `src/core/ecs/` to `src/core/stores/`, cleanly separate Post-MVP directories/shaders out of MVP scope (or list explicit paired files), reconcile `capabilityTraits` and `defaultLines` semantics in `types.ts`, and replace `"roguelite"` with `City Council Election Policy Deck`.

---

### 9. Editorial Precision, Subjective Descriptors & Terminology Calibration in Sections 6 & 7 - Severity: 🟡 Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L242-L320) (`## 6` & `## 7`, lines 242–243, 258, 261, 264, 280, 309–320)
* **Discrepancy Description**:
  1. **Subjective / Uncalibrated Phrasing**: `"smooth pan/zoom"` (lines 280, 312) and `"transferring cleanly"` (line 314) should use measurable terms (`damped 60–120Hz pan/zoom`, `< 4ms` tick budget, zero torn frames). `"5 testable incremental milestones"` (line 309) is uncalibrated while Milestones 1, 3, 4, and 5 lack test assertions.
  2. **Imprecise Terminology & Enumeration**: `"single-line bus drawing"` (line 312) is ambiguous (`single-line bus route drawing`); `"Tactile"` (line 315), `"full Bezier/Metro route drawing tool"` (line 316), and `"Bridge vs. Tunnel river-crossing selectors"` (line 316, omitting `Shared Road Bridge`) should be written as `point-and-drag Bezier corridor drawing tool` and `3-option river-crossing selector (Shared Road Bridge, Dedicated Transit Bridge, Deep Bored Tunnel)`.
  3. **Audio & City Pack Wording (lines 319–320)**: Replace `"Native Audio"` with `Procedural Web Audio`, and deduplicate `"Post-MVP City Pack Hooks"` / `"City Capability Trait hooks for future City Packs"` to `City Capability Trait hooks for Post-MVP City Packs`.
* **Rationale & Recommendation**:
  Tighten wording across Section 6 comments and Section 7 milestone bullets to remove subjective modifiers and align terminology with Sections 1–5 and the GDD.

---

### 10. Minor Cross-Doc & Project-Scaffold Nits - Severity: 🟢 Nit
* **Reviewer Lens:** `egm-codebase-details`, `egm-implementation-readiness`, `egm-style`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L240-L320) (`## 6` & `## 7`, lines 240–243, 258, 261–264, 286–288, 299, 311, 317–320)
* **Discrepancy Description**:
  1. **Cross-Doc Consistency**: GDD line 82 mentions Act III "TOD tax/lease revenue" in MVP Economy while GDD line 117 marks "Land Value Capture lease revenue" as Post-MVP (`todSystem.ts` / Milestone 4 do not specify which applies); GDD line 59 cites `-30°C snow` while `events.json` cites `-40°C Polar Vortex`; Section 1.1 targets `2,500 vehicles` while Section 4.1 sets `MAX_VEHICLES = 4_096` without specifying whether `2,500` is a soft cap; `CouncilElectionModal.tsx` (line 299) does not indicate whether probation/bankruptcy/victory states live there or in a separate modal.
  2. **Tooling & Style Polish**: Milestone 1 (line 311) omits `pnpm` and version qualifiers (`TypeScript 5.x`, `Vite 6`, `React 19`) from Section 2; `tools/import-osm.ts` lacks a Node TS runner (`tsx`/`tools/tsconfig.json`); line 242–243 comments duplicate adjacent filenames; line 258 (`Flagship`) and line 261 (`Authentic`) are promotional adjectives; line 264 (`Pure TypeScript Simulation Engine`) should read `DOM-free TypeScript Simulation Engine`; line 317 embeds `"The Network Must Grow"` marketing slogan into the Milestone 4 heading.
* **Rationale & Recommendation**:
  Clarify TOD lease scope, soft vs. hard vehicle bounds, election/status UI ownership, Node TS execution for `tools/`, and clean up minor comment/heading wording.
