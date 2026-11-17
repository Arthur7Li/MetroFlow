# Goldfish Review Report — Stage 7: Critic Review

**Targets (`FeatureRange`):**
* [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md) (`Lines 1-141`)
* [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md) (`Lines 1-151`)

**Applied Document Standards:**
* `egm-design` $\rightarrow$ `resources/document_standards/feature-spec-standard.md`
* `egm-structural` $\rightarrow$ `resources/document_standards/feature-spec-standard.md`
* `egm-style` $\rightarrow$ Persona Style Audit Vectors

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-design` | completed |
| `egm-structural` | completed |
| `egm-style` | completed |

---

## Prioritized Findings (Blockers $\rightarrow$ Major $\rightarrow$ Nits)

### 1. Missing Mandatory Feature Spec Sections (`Problem Statement`, `Goals & Non-Goals`, `Alternatives Considered`, `Risks & Mitigations`) - Severity: 🔴 Blocker
* **Finding ID:** `critic-r1-01`
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:**
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L1-L141) (Full `FeatureRange`, specifically `## 1. Executive Vision & Core Pillars`, lines 6–16)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L1-L151) (Full `FeatureRange`, specifically `## 1. Architectural Philosophy`, lines 6–15, and `## 2. Recommended Tech Stack`, lines 18–29)
* **Discrepancy Description**:
  Both documents fail mandatory structural and content requirements of `feature-spec-standard.md`:
  1. **The Alternatives Rule (`Alternatives Considered`)**: Neither document includes an evaluation of rejected alternatives with concrete technical or gameplay trade-offs (e.g., in `game_design_document.md`: Origin-Destination Gravity Model vs. abstract shape-matching demand or individual household schedules, headway-based automation vs. block-signaling timetables; in `technical_stack_architecture.md`: TypeScript SoA vs. Rust/Wasm, All-Pairs Dijkstra vs. RAPTOR/Connection Scan, `SharedArrayBuffer` vs. transferable `ArrayBuffer` swaps, PixiJS v8 vs. Deck.gl/Three.js). Furthermore, lines 25 and 27 of `technical_stack_architecture.md` leave core stack selections undecided inline (`bitECS (or custom SoA TypedArrays)` and `Web Audio API + Tone.js / Howler.js`).
  2. **Risks & Limits (`Risks & Mitigations`)**: Neither document calls out operational constraints, security/deployment failure modes, or scalability limits (e.g., `SharedArrayBuffer` COOP/COEP header blocks, `MAX_AGENTS = 100,000` saturation behavior, worker stall latency during graph rebuilds, WebGPU-to-WebGL2 shader fallback, or runaway economic/TOD feedback loops).
  3. **`Problem Statement` and `Goals & Non-Goals`**: Neither document defines explicit **Non-Goals** to bound project scope (e.g., excluding private-car traffic microsimulation, 3D mesh authoring, multiplayer, or mobile browser memory constraints).
* **Rationale & Recommendation**:
  Add dedicated **Problem Statement**, **Goals & Non-Goals**, **Alternatives Considered**, and **Risks & Mitigations** sections to both documents, and commit to a single choice per row in the Tech Stack table while moving rejected options into `Alternatives Considered`.

---

### 2. Broken $O(1)$ All-Pairs Routing Algorithm (Transfer Alighting Failure, Line-Unaware State Collapse & Parallel Line Starvation) - Severity: 🔴 Blocker
* **Finding ID:** `critic-r1-02`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L76-L110) (`### 4.1 Structure-of-Arrays (SoA) Memory Layout`, `### 4.2 The O(1) All-Pairs Next-Hop Routing Table`, and `### 4.3 Edge-Cost Formulation for Realistic Pathfinding`, lines 76–110)
* **Discrepancy Description**:
  The proposed routing table lookup and edge-cost formulation contain three mathematical flaws:
  1. **Alighting Check Fails at the Transfer Station Itself (Line 97)**:
     Suppose the optimal path from station $A$ to $D$ transfers at station $C$ ($A \xrightarrow{L_1} C \xrightarrow{L_2} D$). At origin $A$, `transferStationTable[A * N + D]` is $C$. However, `AgentStoreSoA` (lines 76–83) does not store the agent's target transfer station. Instead, line 97 states that when Vehicle $V$ arrives at Station $S$, each riding passenger checks `transferStationTable[S * N + p.dest]`. When the vehicle reaches the transfer station $S = C$, `transferStationTable[C * N + D]` looks up the path *from $C$ to $D$*—which is a direct ride on $L_2$ with destination $D$ (not $C$). Thus `S === transferStationTable[S * N + p.dest]` evaluates to `C === D` (`false`), and the passenger never alights at transfer station $C$.
  2. **Graph State-Space Collapse in Edge Weight $W(u, v, L)$ (Line 103)**:
     Line 103 adds $\delta_{\text{transfer}} \cdot (\frac{H(L)}{2} + P_{\text{concourse}}(u))$ to the edge cost between adjacent stations $u$ and $v$ on line $L$. In standard Floyd-Warshall or station-node Dijkstra over $N$ stations, node $u$ does not track which incoming line $L_{\text{prev}}$ reached $u$, making it impossible to evaluate whether $\delta_{\text{transfer}}$ is $0$ (continuing on line $L$) or $1$ (transferring to line $L$).
  3. **All-or-Nothing Parallel Line Starvation**:
     Where two lines share a trunk corridor (e.g., Capital and Metro lines between Churchill and Health Sciences, or Local vs. Express lines), a deterministic scalar `nextLineTable[S * N + dest]` assigns 100% of riders to whichever line is marginally faster, leaving parallel lines empty while the primary line overflows.
* **Rationale & Recommendation**:
  1. Formulate pathfinding over a **Route-Segment / Transfer-Expanded Graph** where riding line $L$ from boarding station $u$ to alighting station $w$ is a single direct leg with cost $\sum_{e \in u \to w} (t_{\text{travel}}(e) + \tau_{\text{dwell}}) + \frac{H(L)}{2} + P_{\text{concourse}}(u)$.
  2. Store `nextLineTable[u * N + d]` (line $L$ to board at $u$) and `alightStationTable[u * N + d]` (downstream station $w$ on line $L$ where the rider must alight).
  3. Upon boarding at station $u$, copy `alightStationTable[u * N + d]` into an `alightStationId: Uint16Array` field in `AgentStoreSoA` so alighting at station $S$ is an $O(1)$ equality check (`agent.alightStationId === S`).
  4. Support logit-weighted or top-2 line selection when parallel lines serve the same segment.

---

### 3. Unconstrained Gravity Model Singularity & Runaway TOD Positive Feedback Loop - Severity: 🔴 Blocker
* **Finding ID:** `critic-r1-03`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L28-L37) (`### 2.1 The 4-Step Commuter Demand Pulse`, lines 28–37), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L95-L95) (`### Act III`, line 95), and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L106-L107) (`### 4.1`, lines 106–107)
* **Discrepancy Description**:
  The unconstrained Gravity Model $D_{ij}(t) = \frac{P_i(t) \cdot A_j(t)}{(C_{ij})^\gamma}$ (line 30) has two mathematical failure modes:
  1. **Unconnected Graph vs. Small-$C_{ij}$ Explosion**: When zones $i$ and $j$ have no transit link ($C_{ij} = \infty$), $D_{ij}(t) = 0$ without defining baseline car travel cost $C_{ij,\text{car}}$ or how `Mode Share %` (line 36) is calculated. Conversely, when policies grant free pedway transfers (line 107), 75% transfer penalty reductions (line 66), and high-speed Tier 5 rail (line 49), small $C_{ij}$ causes $(C_{ij})^{-\gamma}$ to grow without bound so that $\sum_j D_{ij}(t)$ exceeds the total population of origin zone $i$.
  2. **Unbounded Positive Feedback with TOD**: Lowering $C_{ij}$ increases ridership, which drives TOD density growth (line 14, line 95) and Land Value Capture revenue (line 95), increasing $P_i(t)$ and $A_j(t)$ without a saturation cap and rapidly exhausting `MAX_AGENTS = 100,000`.
* **Rationale & Recommendation**:
  Replace the unconstrained formula with a **Singly-Constrained Gravity + Logit Mode Split Model**, where total zone trip departures $P_i(t)$ are conserved across destinations ($T_{ij}(t) = P_i(t) \cdot \frac{A_j(t) C_{ij}^{-\gamma}}{\sum_k A_k(t) C_{ik}^{-\gamma}}$) and transit mode share is bounded in $[0, 1]$ via $M_{ij} = \frac{1}{1 + \exp(\beta (C_{ij,\text{transit}} - C_{ij,\text{car}}))}$. Add a minimum generalized cost floor $C_{\min} > 0$ and a logistic carrying capacity cap $K_i$ on TOD station density.

---

### 4. Unsynchronized `SharedArrayBuffer` Concurrency (Torn Reads, 30Hz/120Hz Render Judder & Missing Vehicle/Station SoA Schemas) - Severity: 🔴 Blocker
* **Finding ID:** `critic-r1-04`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L34-L84) (`## 3. High-Level System Architecture Diagram`, lines 34–63, and `### 4.1 Structure-of-Arrays (SoA) Memory Layout`, lines 69–84)
* **Discrepancy Description**:
  1. **Mid-Tick Torn Reads**: Lines 45–55 specify that the Main Thread reads directly from `SharedArrayBuffer` at 60–120Hz while the Simulation Web Worker mutates the same buffer at 30–60Hz. Without double-buffered state slices or `Atomics` sequence locks, the renderer reads partially updated records mid-tick.
  2. **30Hz Simulation vs. 120Hz Render Judder**: If the Simulation Worker ticks at 30Hz (line 55) and only exposes current discrete positions, a 120Hz WebGPU renderer reading the same position across 4 consecutive display frames will visibly stutter at 30 FPS unless both `prevPos` and `currPos` (plus tick interpolation alpha) are provided.
  3. **Missing Render State Schemas**: Section 4.1 defines `AgentStoreSoA` (which has no spatial coordinates and is not directly drawn as world-space sprites), but omits `VehicleStoreSoA` and `StationStoreSoA`—the actual buffers read by `VehicleLayer` and `StationLayer`. `AgentStoreSoA` also omits `originStationId`, which is required to associate `tripStartTime` (line 82) with an origin-destination pair $(i, j)$ for realized $C_{ij}$.
* **Rationale & Recommendation**:
  Keep internal commuter routing/timer arrays private to the Simulation Worker, and expose a double-buffered **Render Snapshot Buffer** in `SharedArrayBuffer` containing `VehicleRenderSoA` (`prevX`, `prevY`, `currX`, `currY`, `bearing`, `loadRatio`) and `StationRenderSoA` (`waitingCount`, `todLevel`), synchronized via an atomic buffer-index swap at tick completion.

---

### 5. $O(\text{MAX\_AGENTS})$ Linear Scan Bottleneck Masked as $O(1)$ Boarding/Alighting - Severity: 🟡 Major
* **Finding ID:** `critic-r1-05`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L76-L99) (`### 4.1` & `### 4.2`, lines 76–99)
* **Discrepancy Description**:
  Lines 97–98 state that when Vehicle $V$ arrives at Station $S$, riding and waiting passengers are processed in $O(1)$ time. However, `AgentStoreSoA` (lines 76–83) stores all 100,000 agents in flat arrays indexed by `agentId` (`0..99,999`) where location is only recorded as a scalar `currentNodeId: Uint16Array`. Without a per-station and per-vehicle passenger index (or destination-bucketed queues), finding which agents currently have `currentNodeId === S` or `currentNodeId === V` requires scanning all 100,000 elements of `currentNodeId` on every vehicle arrival ($2,500$ vehicles $\rightarrow$ tens of millions of array checks per second).
* **Rationale & Recommendation**:
  Either maintain intrusive linked-list indices (`headAgentByVehicle[MAX_VEHICLES]`, `headAgentByStation[MAX_STATIONS]`, `nextAgentInNode[MAX_AGENTS]`) or replace individual waiting agents with a destination-bucketed station queue matrix `stationQueue[S * MAX_STATIONS + dest]`.

---

### 6. Synchronous Pathfinding Rebuilds & $O(N^2)$ Demand Spawner Exceeding the 16.6ms Worker Tick Budget - Severity: 🟡 Major
* **Finding ID:** `critic-r1-06`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L55-L62) (`## 3`, lines 55–62) and [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L89-L110) (`### 4.2` & `### 4.3`, lines 89–110)
* **Discrepancy Description**:
  1. Running $O(N^3)$ Modified Floyd-Warshall for $N = 512$ stations ($1.34 \times 10^8$ inner-loop operations, ~150–400ms in JS) synchronously inside the Simulation Worker whenever a player edits a line or when the Auto-Dispatcher / weather system modifies headways $H(L)$ or $\eta_{\text{weather}}$ stalls the 60Hz loop for 10–25 frames.
  2. Running the Demand Spawner across all $512 \times 512 = 262,144$ OD pairs at 60Hz requires $1.57 \times 10^7$ exponentiations $(C_{ij})^{-\gamma}$ per second.
* **Rationale & Recommendation**:
  Use sparse All-Pairs Dijkstra ($O(N(E + N \log N))$) time-sliced across ticks into a shadow routing table, and evaluate Gravity Model OD demand weights at a lower tick division (e.g., 1Hz or time-sliced at $N/60$ origin stations per 60Hz tick).

---

### 7. Time-Compression Distortion (3-Minute Game Day vs. Headways, Travel Speeds, and Scenario Timers) - Severity: 🟡 Major
* **Finding ID:** `critic-r1-07`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L22-L27) (`### 2.1`, lines 22–26), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L88-L88) (`### Act II`, line 88), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L119-L119) (`### 4.3`, line 119), and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L132-L132) (`## 5`, line 132)
* **Discrepancy Description**:
  Compressing a 24-hour ($1,440\text{ min}$) cycle into a **3-minute real-time day** ($180\text{ real seconds}$, line 22) produces a $480\times$ clock ratio ($1\text{ real second} = 8\text{ simulated minutes}$) that conflicts with stated headways and trip durations:
  * A *"3-Minute Peak Headway"* (line 88) equals **$375\text{ ms}$** of real time, and Vancouver's *"short trains running every 90 seconds"* (line 132) equals **$187.5\text{ ms}$** ($5.3\text{ trains/sec}$).
  * Morning Peak (`06:30–09:30`, line 23) lasts only **$22.5\text{ real seconds}$**, which is shorter than the visual screen traversal time of a single crosstown LRT trip.
  * Line 119 (*"20-Minute Puzzle Challenges... Move 25,000 fans out of Churchill Station in 4 minutes"*) mixes real-time minutes with simulated minutes without specifying which clock governs vehicle kinematics and passenger wait timers.
* **Rationale & Recommendation**:
  Define an explicit **Dual-Time-Scale Specification** (decoupling visual vehicle kinematics/headway seconds from the macro diurnal clock, or lengthening the base 24-hour day cycle to 10–15 real minutes with $1\times / 2\times / 4\times$ speed controls) and state all headways, dwell times, and scenario timers in unambiguous real-time vs. simulated-time units.

---

### 8. Unquantified Economic Loop & Act I Bankruptcy / Soft-Lock Risk - Severity: 🟡 Major
* **Finding ID:** `critic-r1-08`
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L39-L50) (`### 2.2`, lines 39–50), [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L82-L84) (`### Act I`, lines 82–84), and [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L108-L108) (`### 4.1`, line 108)
* **Discrepancy Description**:
  Section 2.2 lists relative capacity multipliers ($1\times$ to $10\times$) and qualitative cost labels (`Cheap`, `Moderate CapEx`, `High CapEx`), while line 108 specifies a `$1,500 semesterly lump-sum grant` without defining base passenger capacity per $1\times$ unit, starting capital, fare price, or CapEx/OpEx rates. Additionally, in Act I (line 84), if a player spends initial capital on an unprofitable line or suffers a $-30^\circ\text{C}$ snow slowdown (line 45) that pushes net cash flow negative at $\$0$ treasury, no recovery mechanism (line demolition refund, overdraft, or municipal bond) is defined to prevent a soft-lock.
* **Rationale & Recommendation**:
  Add a baseline **Economic & Unit Table** (passengers per $1\times$ unit, starting budget, base fare, CapEx per km/station/vehicle, OpEx per vehicle-day) and specify a line-decommissioning refund percentage or municipal bond facility to prevent Act I soft-locks.

---

### 9. Unmitigated `SharedArrayBuffer` Cross-Origin Isolation (`COOP`/`COEP`) Deployment Requirement - Severity: 🟡 Major
* **Finding ID:** `critic-r1-09`
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:** [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L12-L29) (`## 1`, line 12; `## 2`, lines 22–25; `## 3`, line 49)
* **Discrepancy Description**:
  Browsers disable `SharedArrayBuffer` unless the document is served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers. Static hosts without custom header configuration or third-party portal iframes will throw a runtime error on initialization.
* **Rationale & Recommendation**:
  Document the required `COOP`/`COEP` headers in the Vite server and production deployment specifications, and specify a fallback transport (transferable `ArrayBuffer` ping-pong over `postMessage`) when `self.crossOriginIsolated === false`.

---

### 10. Structural Layout, Heading Hierarchy & JSON Syntax Violations - Severity: 🟡 Major
* **Finding ID:** `critic-r1-10`
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:**
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L1-L96) (lines 1–4, 6–16, 72–96)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L1-L149) (lines 1–4, 113–149)
* **Discrepancy Description**:
  1. **Empty H2 Subtitle Nodes**: Both documents place an `##` (H2) subtitle on line 2 (`## High-Level Game Design Document (GDD)` and `## High-Performance Web Game Engine for *YEG Transit Architect*`) followed immediately by `---` on line 4 with no body text, placing an empty unnumbered H2 node at the same hierarchy level as numbered top-level sections (`## 1.`, `## 2.`).
  2. **Asymmetric H3 Numbering**: In `game_design_document.md`, Sections 2 and 4 use decimal-numbered H3s (`### 2.1`–`2.3`, `### 4.1`–`4.3`), whereas Section 1 uses an un-headed bold paragraph (`**Elevator Pitch:**`, line 8) plus an unnumbered H3 (`### Core Design Pillars`, line 11) and Section 3 uses unnumbered H3s (`### Act I...`, lines 82, 86, 92). In `technical_stack_architecture.md`, Section 4 uses numbered H3s (`### 4.1`–`4.3`), while Section 5 places `manifest.json` directly under H2 and uses an unnumbered H3 at line 144 (`### Offline GIS-to-Game Map Converter Script`).
  3. **Invalid Comment in `json` Code Block**: In `technical_stack_architecture.md` lines 117–142, the code fence is tagged ```` ```json ```` but line 118 includes a `// src/cities/edmonton/manifest.json` comment, which is invalid RFC 8259 JSON (move the file path outside the fence or use `jsonc`).
  4. **Missing Cross-Document Links**: Neither document links to the other (`[game_design_document.md](./game_design_document.md)` / `[technical_stack_architecture.md](./technical_stack_architecture.md)`), and `technical_stack_architecture.md` lines 157–158 reference non-existent filenames `GAME_DESIGN.md` and `ARCHITECTURE.md`.
* **Rationale & Recommendation**:
  Convert line 2 subtitles to italicized lead lines or blockquotes under H1, apply consistent `### X.Y` numbering across all H3 subsections, remove the `//` comment from the `json` block (or tag it `jsonc`), and add explicit cross-document Markdown links using the actual repository filenames.

---

### 11. Uncalibrated Claims, Promotional Hyperbole & Subjective Fluff Across Both Specifications (`CALIBRATE` / `DROP`) - Severity: 🟡 Major
* **Finding ID:** `critic-r1-11`
* **Reviewer Lens:** `egm-style`
* **Affected Scope:**
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L8-L135) (lines 8–15, 22, 36, 41, 47, 54–68, 74, 87–89, 99–105, 120, 126–134, 141)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L8-L149) (lines 8–14, 18, 22–28, 70, 73, 87, 89, 93, 115, 145–147)
* **Discrepancy Description**:
  1. **Uncalibrated Technical & Scope Claims (`CALIBRATE`)**:
     * `technical_stack_architecture.md` line 93 claims *"For a $512$-station network, $512 \times 512 \times 2\text{ bytes} = 512\text{ KB}$—fitting entirely inside the CPU L2 cache!"*, overlooking that lines 90–91 define **two** `Uint16` tables totaling $1\text{ MB}$ ($2 \times 512\text{ KB}$) and L2 cache size varies by CPU.
     * `technical_stack_architecture.md` line 8 states *"runs natively in a browser at a locked $60\text{--}120\text{ FPS}$"* as an unconditional fact rather than a target performance budget, and line 12 claims *"eliminating garbage collection (GC) pauses"* rather than reducing simulation-loop allocation pressure.
     * `technical_stack_architecture.md` line 22 cites *"zero-config WebAssembly support"* even though WebAssembly is not used in the architecture (`DROP`).
     * `technical_stack_architecture.md` line 115 claims adding a new city *"requires only three files"*, contradicting Section 6 (lines 174–177) which lists four files (`manifest.json`, `geometry.json`, `nodes.json`, `events.ts`).
     * `game_design_document.md` line 126 claims *"adding new cities requires zero engine rewrites—only a new GeoJSON map package and a city modifier profile"*, contradicting the bespoke mechanics in lines 131–134 (ferries, underground-only rules, through-running rail, retail revenue).
  2. **Promotional Hyperbole & Colloquial Filler (`DROP` / `CALIBRATE`)**:
     * Replace marketing adjectives and hyperbolic idioms across both documents: *"Steam-grade, endlessly replayable"* (GDD line 9), *"Zero Late-Game Micromanagement"* (GDD line 13), *"wait forever in the gap"* (GDD line 57), *"sleek contextual toggle"* (GDD line 60), *"Commuters hate walking across 6 lanes of freezing slush..."* (GDD line 65, `DROP`), *"slashing transfer time penalties"* (GDD line 66), *"30 tiny spaghetti bus routes"* (GDD line 89), *"100+ hours of Steam-level replayability"* (GDD line 101), *"dream fantasy map"* (GDD line 120), *"four uncompromising engineering principles"* (TSA line 10), *"Ultra-fast"* (TSA line 25), and *"would melt any CPU"* (TSA line 87), as well as exclamation marks in prose and code comments (GDD lines 36, 89, 131; TSA lines 73, 93).
* **Rationale & Recommendation**:
  Rewrite promotional and colloquial phrasing into dry, factual engineering prose, calibrate performance and modularity claims to match actual math and file schemas, and remove unused technology justifications.

---

### 12. Minor Formatting & Serialization Nits (Code Fence Tags, Horizontal Rules, URL Share Size, Bullet Formatting) - Severity: 🟢 Nit
* **Finding ID:** `critic-r1-12`
* **Reviewer Lens:** `egm-design`, `egm-structural`
* **Affected Scope:**
  * [game_design_document.md](file:///Users/arthurli/MetroFlow/game_design_document.md#L38-L115) (lines 38, 51, 76, 113–115)
  * [technical_stack_architecture.md](file:///Users/arthurli/MetroFlow/technical_stack_architecture.md#L24-L63) (lines 24, 28, 34)
* **Discrepancy Description**:
  1. **Unlabeled Code Fences**: The ASCII diagrams at `game_design_document.md` line 76 and `technical_stack_architecture.md` line 34 use bare ```` ``` ```` without a `text` language identifier.
  2. **Inconsistent H3 Horizontal Rules & Bullet Styles**: `game_design_document.md` inserts `---` between H3 subsections in Section 2 (lines 38, 51) but not in Sections 3 or 4, and uses italic bullet lead-ins in Section 4.2 (lines 113–115) instead of bold lead-ins. In `technical_stack_architecture.md` line 24, `| **Vector Curves & shaders** |` uses lowercase `shaders`.
  3. **URL Share String Scope (TSA Line 28)**: Compressing full simulation state via `LZ-String` for URL sharing would exceed browser URL length limits; clarify that URL strings serialize only the compact network/policy blueprint ($<4\text{ KB}$) while full saves use IndexedDB.
* **Rationale & Recommendation**:
  Add `text` tags to bare code fences, remove intra-section H3 horizontal rules, standardize bold bullet lead-ins and table capitalization, and clarify `LZ-String` URL payload scope.
