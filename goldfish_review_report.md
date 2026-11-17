# Goldfish Annotated Review Report

**Target (`DetailedRange`):**
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L237-L320) (`Lines 237-320`: `## 6. Repository Directory Structure (Implementation Blueprint)` and `## 7. Phased Implementation Roadmap`)

*(Stage 9 Implementation Readiness Resolution — minor cross-document alignments also touch `technical_stack_architecture.md` Sections 2–5 and `game_design_document.md` Sections 2.2–4.1 where referenced.)*

## Prioritized Findings & AI Suggestions

### 1. Missing Target Scope & File Boundaries (`Create`/`Modify`/`Delete` Labels, Pinned Toolchain & Per-Milestone Allowlists) [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 239-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L239-L320) (`## 6` & `## 7`)
*   **Discrepancy Description:**
    1. `package.json`, `tsconfig.json`, and `vite.config.ts` omit exact package names, pinned semver versions, `pnpm` scripts, `DOM` vs. `WebWorker` `lib` compiler boundaries, Tailwind v3 vs. v4 configuration, and Vite `COOP`/`COEP` header and worker bundling settings.
    2. Section 6 lists paths without `Create` / `Modify` / `Delete` annotations and labels the root `yeg-transit-architect/` instead of the actual workspace root `MetroFlow/`. Section 7 lacks per-milestone file boundaries.
    3. Section 6 omits `src/App.tsx`, `src/vite-env.d.ts`, and `.gitignore`, while mixing Post-MVP paths (`tools/import-osm.ts`, `src/cities/montreal/`, `src/renderer/shaders/`) into the tree without explicit MVP exclusion boundaries.
*   **Rationale:** `implementation-readiness-standard.md` requires explicit repository-relative `Create`/`Modify`/`Delete` file boundaries, pinned dependencies, and build configs so implementation leaves zero tooling choices to the implementer.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Specifying the exact `package.json` dependencies/versions/scripts, `tsconfig.json` + `tsconfig.worker.json` compiler settings, `vite.config.ts` (`@tailwindcss/vite` + COOP/COEP headers), complete `MetroFlow/` tree with `[Create]`/`[Modify]` tags, Post-MVP exclusions, and per-milestone allowlists satisfies Target Scope & File Boundary.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Section `6` and Section `7`
    *   Change: Anchor the tree at `MetroFlow/`, annotate every entry as `[Existing]`, `[Create]`, or `[Post-MVP — Do Not Create in v1.0]`, add `src/App.tsx`, `src/vite-env.d.ts`, and `.gitignore`, add an explicit **Toolchain & Build Configuration Spec** (`package.json`, `tsconfig.json`, `tsconfig.worker.json`, `vite.config.ts`), and list explicit `Create`/`Modify` file allowlists under each milestone in Section 7.

---

### 2. Missing Persistence & Serialization Architecture (`IndexedDB / Dexie.js` + `LZ-String`) [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 237-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L237-L320) (`## 6` & `## 7` Milestone 5; cross-referenced with Section 2, line 39)
*   **Discrepancy Description:** Section 2 (line 39) specifies `IndexedDB (via Dexie.js) + LZ-String` for local auto-saves, binary simulation snapshots, and `< 4 KB` blueprint URL sharing, and Milestone 5 (line 320) mandates `LZ-String` blueprint URL sharing, yet Section 6 omits persistence/serialization files and Section 7 omits IndexedDB save/load and auto-save from all 5 milestones.
*   **Rationale:** Without concrete Dexie object-store schemas, binary snapshot format, worker pause/export messages, and URL codec specs, persistence cannot be implemented without inventing schemas.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Adding `src/storage/saveDb.ts` and `src/storage/blueprintCodec.ts` with exact Dexie table schemas, binary snapshot version header + typed-array framing, 5-minute auto-save cadence, `SaveLoadModal.tsx`, and versioned `LZ-String` blueprint payload schema (`< 4 KB` limit enforcement) resolves the gap cleanly.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Section `6` (new `src/storage/` entries) and Section `7` (Milestone 5)
    *   Change: Add `src/storage/saveDb.ts` and `src/storage/blueprintCodec.ts`, document the exact Dexie v4 schema (`saves` table keyed by `id`, `cityId`, `updatedAt`, `snapshotBlob`), binary snapshot layout, worker `EXPORT_SNAPSHOT`/`IMPORT_SNAPSHOT` protocol, and `BlueprintPayloadV1` `LZ-String` schema, and schedule IndexedDB auto-save/load and URL import/export in Milestone 5.

---

### 3. Missing MVP Simulation Entities, Systems & UI Components Required by GDD and Sections 1–5 [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 252-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L252-L320) (`src/config/`, `src/core/`, `src/ui/`, and `## 7`)
*   **Discrepancy Description:**
    1. `src/core/` omits stores/systems for **Transit Lines, Track Segments, River Crossings, Blueprint Interchanges, Feeder Catchment Zones**, **Economy & Treasury** (`$50,000 CAD`, `$3.50` ARC fare, daily OpEx, `75%` refund, `$25,000` Municipal Bond), **5 Ridership Milestones & Act I–III gating**, **Public Approval & 4-Week Election Cycles / Probation / Game-Over**, and **Growth Seeds (`Seed A/B/C`)**.
    2. `src/ui/` omits `src/App.tsx`, map-editing/route-drawing/feeder-painting input controller, **River-Crossing Selector**, **Blueprint Interchange Palette**, and **New Run / Seed / Save-Load / Victory & Game-Over** views.
    3. Milestones 1–5 omit scheduling for Growth Seeds, 5 Ridership Milestones, speed controls (`Pause/1x/2x/4x`), All-Door ARC Boarding, Concourse Tiers (`0/1/2`), Park-and-Ride vs. Feeder choice, TSP upgrades, One-Click Corridor Upgrading, `weatherSystem.ts`, and `LayerToggles.tsx` heatmaps.
*   **Rationale:** Every GDD MVP feature must map to concrete modules in Section 6 and explicit milestone tasks in Section 7.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Expanding `src/core/stores/` (`lines.ts`), `src/core/systems/` (`economySystem.ts`, `progressionSystem.ts`), `src/renderer/interaction/MapInteractionController.ts`, and `src/ui/components/` (`RiverCrossingModal.tsx`, `BlueprintPalette.tsx`, `RunSetupModal.tsx`, `SaveLoadModal.tsx`, `RunStatusBanner.tsx`), and explicitly assigning every MVP mechanic to Milestones 1–5 closes the coverage gap.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Sections `6` and `7`
    *   Change: Add missing stores, systems, interaction controller, and UI components to Section 6 and map every GDD MVP mechanic (time controls, Growth Seeds, 5 Milestones, Economy/Bond, Concourse/TSP/ARC upgrades, Park-and-Ride vs. Feeder, Corridor Upgrading, weather, heatmaps) explicitly across Milestones 1–5.

---

### 4. Unspecified Cross-Thread Contracts (`RenderSnapshotBuffer` Byte Layout, Topology Sync, `WorkerCommand` & `TelemetrySnapshot`) [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 265-293](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L265-L293) (`worker.ts`, `sharedBuffers.ts`, `renderer/`, `useGameStore.ts`) and Milestone 2 ([Lines 313-314](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L313-L314))
*   **Discrepancy Description:**
    1. `sharedBuffers.ts` omits byte offsets, 4-byte alignment, `Atomics` control-header fields (`activeSlot`, `tickIndex`, `tickTimestampMs`, `vehicleCount`, `stationCount`), and active-vehicle flag/count.
    2. Transferable `ArrayBuffer` fallback omits the main-thread-to-worker buffer-return `postMessage` recycling handshake.
    3. Omits TypeScript discriminated unions for `WorkerCommand` (main $\rightarrow$ worker), `TelemetrySnapshot` (4Hz worker $\rightarrow$ UI), and `TopologySnapshot` (station `(x,y)`, Bezier control points, crossing types, parallel lane offsets synced to `NetworkLayer`/`StationLayer`).
*   **Rationale:** Cross-thread byte layouts and message schemas must be fully specified to avoid main-thread/worker integration mismatches.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Adding a dedicated **Cross-Thread Binary & Message Contracts** subsection defining exact `Int32Array` header offsets (aligned to 16-byte boundaries), vehicle/station byte strides, `TRANSFER_BUFFER_RETURN` ping-pong recycling, `WorkerCommand` / `TelemetrySnapshot` / `TopologySnapshot` TypeScript unions, and `src/renderer/RenderController.ts` / `src/core/workerClient.ts` resolves this completely.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Section `6` (add `src/core/contracts.ts`, `src/core/workerClient.ts`, `src/renderer/RenderController.ts`, plus complete binary header, transferable return handshake, and TypeScript message contract specs)
    *   Change: Specify the exact byte offsets of `RenderSnapshotBuffer` (`[activeSlot, tickIndex, vehicleCount, stationCount, simTimeSecLow, simTimeSecHigh]` + 2 slots $\times$ 4-byte aligned vehicle/station blocks), the `TRANSFER_SNAPSHOT` / `RETURN_SNAPSHOT_BUFFER` recycling handshake, and full TypeScript definitions for `WorkerCommand`, `TelemetrySnapshot`, and `TopologySnapshot`.

---

### 5. Unspecified Core Data Schemas, Spatial Scale & Simulation Formulas (Zero-Decision Rule Violations) [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 252-290](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L252-L290) (`src/config/*`, `src/cities/*`, `src/core/*`, `src/renderer/*`, `src/audio/*`) and Milestones 1–5 ([Lines 310-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L310-L320))
*   **Discrepancy Description:** Missing conversion scale (`worldBounds` `4000 x 3200` to `km`), `GeometryPack`/`CityNodeSeed`/`EventSchedule` schemas, `AgentStoreSoA` free-list stack + FIFO tail pointers + deterministic coalesce/split/overflow rules, `VehicleStoreSoA`/`StationStore`/`TransitLine` schemas, vehicle physics/dwell/anti-bunching formulas, `0xFFFF` unreachable sentinel + expected $C_{ij,\text{transit}}$ cost matrix + `nextLineAltTable` splitting rule, Gravity/Logit constants ($\gamma, \beta, C_{ij,\text{car}}$), diurnal curves, complete Policy Deck & Council Approval targets, upgrade pricing & safe headway floors, TOD logistic growth rate $r$ & tier thresholds, station snapping rules, parallel Bezier offset geometry, river intersection check, PixiJS instancing strategy, heatmap normalization, modal pentatonic pitch table, and audio voice-pooling limits.
*   **Rationale:** Under `implementation-readiness-standard.md` (The Zero-Decision Rule), all numeric constants, formulas, and schemas must be pre-determined in the plan.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Writing an explicit **Implementation Constants, Schemas & Deterministic Formulas** specification inside Section 6 covering every module (`cities/types.ts`, `config/*`, `core/stores/*`, `routing/pathfinder.ts`, `core/systems/*`, `renderer/*`, and `audio/SoundscapeEngine.ts`) eliminates every design guess.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Section `6` (new **Module Contracts, Schemas & Simulation Constants** subsection following the directory tree, plus `1 world unit = 10 meters` scale added to `manifest.json` / spatial spec)
    *   Change: Specify exact spatial scale (`1 world unit = 10 m`, `100 units = 1 km`), full TS schemas for `CityManifest`, `GeometryPack`, `CityNodeSeed`, `EventSchedule`, `VehicleStoreSoA`, `StationStore`, `TransitLineStore`, free-list stack + FIFO tail pointers, deterministic cohort overflow fallback, `0xFFFF` routing sentinel, capacity-proportional split weight formula for `nextLineAltTable`, expected $C_{ij,\text{transit}}$ array, Gravity/Logit constants ($\gamma = 1.8, \beta = 0.12$), diurnal multipliers, full 8-card Policy Deck, exact upgrade/headway/LRV/TSP/Feeder/TOD constants, parallel Bezier normal offset math, PixiJS `ParticleContainer` / procedural graphics texture atlas strategy, and C-pentatonic MIDI pitch table with max-12-voice Web Audio limiter.

---

### 6. Missing Test Plan, Test Infrastructure & Verification Assertions [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 237-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L237-L320) (`## 6` & `## 7`)
*   **Discrepancy Description:** Section 6 defines zero test runners (`vitest.config.ts`, `playwright.config.ts`), zero test directories/files, and zero mocks/fixtures; Section 7 defines zero test cases or quantitative assertions for Milestones 1, 3, 4, and 5 and lacks vehicle/tick-budget assertions in Milestone 2.
*   **Rationale:** Every milestone must leave the codebase buildable and testable with explicit happy-path, edge-case, and performance assertions.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Adding `vitest.config.ts`, `playwright.config.ts`, `tests/` unit/integration/e2e files, shared deterministic mocks (`tests/helpers/`), and concrete per-milestone `pnpm` verification commands and test cases (covering happy paths, boundary cases, and `< 4ms` worker tick benchmark at 2,500 vehicles and 100k commuter demand) fulfills the Test Plan requirement.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Section `6` (`tests/` tree + `vitest.config.ts` / `playwright.config.ts`) and Section `7` (per-milestone **Verification & Test Plan** blocks)
    *   Change: Add `vitest.config.ts`, `playwright.config.ts`, `tests/helpers/` mocks/fixtures, unit/integration/e2e test file paths marked `[Create]`, and explicit test cases + CLI commands (`pnpm typecheck && pnpm test && pnpm build`) for every milestone.

---

### 7. Cross-Document Scope Contradiction on Crisis Scenarios (`Post-MVP` vs. `v1.0`) & Uncalibrated Phasing [`egm-codebase-details`, `egm-implementation-readiness`, `egm-style`] - Severity: Blocker
*   **Affected Scope:** [Lines 308-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L308-L320) (`## 7`) vs. [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L24-L141) (lines 24, 140–141)
*   **Discrepancy Description:**
    1. Milestone 5 (`v1.0`, line 320) schedules `Edmonton Crisis Scenarios (*-40°C Polar Vortex*, *Stanley Cup Finals*)`, contradicting `game_design_document.md` lines 24 & 141 which place Crisis Scenarios in Post-MVP.
    2. Milestone 1 (`line 312`) builds a `"minimal single-line bus drawing and vehicle movement prototype"` before Milestone 2 (`line 314`) builds the Worker, risking throwaway code; Milestone 2 tests 50,000+ commuter multi-line transfers before Milestone 3 builds multi-line drawing without assigning a transfer test fixture or `demandSystem.ts`/`nodes.json`.
    3. Section 1.1 targets `2,500 vehicles`, Section 4.1 sets `MAX_VEHICLES = 4_096`, and Milestone 2 checks only `50,000+` commuters.
*   **Rationale:** Milestone scope, dependencies, and performance targets must align across both documents without throwaway rewrites or missing test dependencies.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid blocker. Scoping `edmonton/events.json` and Milestone 5 strictly to **Career Architect dynamic seasonal/stadium events** (while moving standalone timed Crisis Scenarios explicitly to Post-MVP `v1.1+`), scaffolding the Worker shell cleanly in Milestone 1 (so M1 moves vehicles via the worker with zero throwaway main-thread simulation), assigning `nodes.json` + `demandSystem.ts` + a synthetic 2-line transfer fixture to Milestone 2 tests, and specifying `2,500` active vehicles inside the `MAX_VEHICLES = 4_096` buffer resolves all phasing contradictions.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Sections `6` and `7` (Milestones 1, 2, 5) and line 92 (`MAX_VEHICLES` comment)
    *   Change: Clarify `2,500` active gameplay vehicle target vs. `4,096` power-of-two SoA buffer capacity; scaffold `worker.ts` + `sharedBuffers.ts` + single-line `vehicles.ts` in M1 (no throwaway main-thread physics); assign `demandSystem.ts` + `nodes.json` + synthetic multi-line transfer test fixture to M2 benchmarking `2,500` vehicles & `100,000` daily commuters at `< 4ms` tick; move standalone **Crisis Scenarios** out of `v1.0` into a clearly marked `Post-MVP (v1.1+)` note while keeping `events.json` as Career Architect dynamic weather/event spikes (`-30°C` / `-40°C` Polar Vortex cold snap and Stanley Cup playoff surges).

---

### 8. Spec/Tree Drift (`shaders/`, `cities/`, `capabilityTraits`, `defaultLines`, `ecs/` Naming) [`egm-codebase-details`, `egm-style`] - Severity: Major
*   **Affected Scope:** [Lines 254-288](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L254-L288) (`## 6`) and [Lines 173-197](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L173-L197) (`### 5.1`)
*   **Discrepancy Description:**
    1. `src/core/ecs/` contradicts Section 2 & 5.3's rejection of ECS.
    2. `src/renderer/shaders/` omits paired `.glsl` files mandated by lines 35 & 233; `src/cities/montreal/` is a bare directory and omits Maps 03–05.
    3. `edmonton/manifest.json` uses `"capabilityTraits": []` (array) while parameterized traits (`bikeCatchmentMultiplier`, `throughRunningPairs`) imply typed records; `defaultLines` (`CAP`, `VAL`, `MET`) is ambiguous between pre-built Career Architect lines (contradicting Act I's `$50,000` manual bus start) and reference UI/Sandbox presets.
    4. Line 254 uses `"roguelite"` instead of `City Council Election Policy Deck`.
*   **Rationale:** The directory tree and manifest types must strictly match the architectural specification.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid major finding. Renaming `src/core/ecs/` to `src/core/stores/`, marking Post-MVP paths (`tools/import-osm.ts`, `src/cities/{montreal,vancouver,amsterdam,tokyo}/`, `src/renderer/shaders/{river,trackPulse}.{wgsl,glsl}`) explicitly as Post-MVP (excluded from MVP Milestone allowlists), typing `capabilityTraits` as a structured `CityCapabilityTraits` object (with defaults `{}`/disabled for Edmonton), clarifying `defaultLines` as **named line-preset palettes** in Career Architect (not pre-built infrastructure), and replacing `"roguelite"` with `City Council Election Policy Deck` eliminates all drift.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Sections `5.1`, `6`, and `7` (plus line 13 `ecs/` consistency if referenced)
    *   Change: Rename `src/core/ecs/` $\rightarrow$ `src/core/stores/`, type `capabilityTraits` consistently in `manifest.json` (`{}`) and `types.ts`, document `defaultLines` as named line-preset suggestions, explicitly mark Post-MVP files/shaders (listing paired `.wgsl`/`.glsl` names), and replace `"roguelite"` on line 254.

---

### 9. Editorial Precision, Subjective Descriptors & Terminology Calibration in Sections 6 & 7 [`egm-style`] - Severity: Major
*   **Affected Scope:** [Lines 242-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L242-L320) (`## 6` & `## 7`)
*   **Discrepancy Description:** Subjective/uncalibrated phrases (`smooth pan/zoom`, `transferring cleanly`, `5 testable incremental milestones` without per-milestone test criteria), imprecise labels (`single-line bus drawing`, `Tactile`, `full Bezier/Metro route drawing tool`, `Bridge vs. Tunnel river-crossing selectors`, `Native Audio`), and redundant phrasing (`Post-MVP City Pack Hooks` / `City Capability Trait hooks for future City Packs`).
*   **Rationale:** Implementation blueprints must use exact, measurable terminology aligned with the design and architecture sections.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid major style finding. Replacing subjective modifiers with measurable terms (`damped 60–120Hz pan/zoom`, `single-line bus route drawing`, `point-and-drag Bezier corridor drawing tool`, `3-option river-crossing selector (Shared Road Bridge, Dedicated Transit Bridge, Deep Bored Tunnel)`, `Procedural Web Audio`, and `City Capability Trait hooks for Post-MVP City Packs`) aligns `DetailedRange` with the rest of the specification.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Sections `6` and `7`
    *   Change: Apply every wording calibration in Section 6 comments and Section 7 milestone titles/bullets.

---

### 10. Minor Cross-Doc & Project-Scaffold Nits [`egm-codebase-details`, `egm-implementation-readiness`, `egm-style`] - Severity: Nit
*   **Affected Scope:** [Lines 240-320](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L240-L320) (`## 6` & `## 7`; cross-referenced with `game_design_document.md` lines 59, 82, 117)
*   **Discrepancy Description:**
    1. GDD line 82 cites Act III "TOD tax/lease revenue" in MVP Economy while line 117 marks "Land Value Capture lease revenue" as Post-MVP; GDD line 59 cites `-30°C snow` while `events.json` cites `-40°C Polar Vortex`; Section 1.1 targets `2,500 vehicles` vs. `MAX_VEHICLES = 4_096`; `CouncilElectionModal.tsx` vs. victory/probation/bankruptcy UI ownership is unspecified.
    2. Milestone 1 omits `pnpm` and version qualifiers (`TypeScript 5.x`, `Vite 6`, `React 19`); `tools/import-osm.ts` lacks Node TS runner specs; line 242–243 comments duplicate filenames; `Flagship`, `Authentic`, `Pure TypeScript`, and `"The Network Must Grow"` add fluff.
*   **Rationale:** Reconciling these minor details avoids ambiguity during implementation and keeps comments factual.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Easy to resolve alongside the structural and readiness updates. Clarify that MVP Act III grants **TOD property-tax bonus revenue** per upzoned station tier (while Post-MVP adds station retail/parcel leasing), distinguish normal winter snow (`-30°C`) from the extreme cold-snap event (`-40°C Polar Vortex`) in `events.json`, document `2,500` active soft cap vs. `4,096` power-of-two array bound, assign probation/victory/game-over states cleanly, include `pnpm` & pinned versions in Milestone 1, and clean up the Section 6/7 wording.
*   ***Proposed Edit:***
    *   Location: `technical_stack_architecture.md` Sections `6` & `7` (plus brief clarifying alignment in `game_design_document.md` line 82 `TOD property-tax revenue` and Section 2.2/4.1 snow vs. Polar Vortex distinction if needed)
    *   Change: Apply all minor cross-doc clarifications, scaffold notes, and comment/heading cleanups.
