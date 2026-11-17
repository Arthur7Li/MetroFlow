# YEG Transit Architect (Working Title: *MetroFlow*)
*High-Level Game Design Document (GDD) — Companion Technical Architecture: [technical_stack_architecture.md](./technical_stack_architecture.md)*

---

## 1. Executive Vision & Core Pillars

### 1.1 Problem Statement
Urban transit strategy games often split into two extremes: abstract puzzle games that omit real-world geography and vehicle capacity physics, or complex rail dispatch simulators that overwhelm players with manual timetable micromanagement once a network exceeds a few dozen lines. *YEG Transit Architect* solves this tension by pairing accessible point-and-drag line creation and grounded transit engineering constraints (grade separation, transfer friction, headway stability) with tiered automation modules that shift player focus from manual vehicle dispatching to macro network architecture as the city grows.

### 1.2 Core Design Pillars
1. **Accessible Controls, Meaningful Engineering Constraints:** Players draw routes between neighborhoods with a single drag interaction, while optimal performance depends on solving grounded transit problems: vehicle bunching, river-valley grade separation, park-and-ride land limits, and trunk-and-feeder hierarchy.
2. **Tiered Automation ("The Network Must Grow"):** Early gameplay focuses on hands-on route drawing and vehicle purchasing. Mid-to-late gameplay unlocks Operations Control Centre (OCC) modules—the **Auto-Headway Dispatcher**, **Suburban Feeder AI**, and **Blueprint Interchanges**—automating routine fleet sizing so the player acts as a macro-level transit planner.
3. **Transit Shapes the City (Dynamic TOD):** High-frequency stations catalyze **Transit-Oriented Development (TOD)**, increasing residential and commercial density weights within station catchment zones up to local carrying capacity and generating new commuter demand and tax revenue.
4. **Modular City Architecture:** Starting with **Edmonton, Alberta (YEG)** as the primary campaign map, city geography, node distributions, and climate profiles are stored as data-driven City Packs, with post-launch expansion cities (Montreal, Vancouver, Amsterdam, Tokyo) layering city-specific rules via modular capability traits.

### 1.3 Goals & Non-Goals
* **Goals (MVP — Edmonton YEG):**
  * Deliver the single-player **Career Architect** campaign in Edmonton across 5 Ridership Milestones and 3 progression Acts.
  * Simulate 24-hour / 7-day commuter demand pulses using a bounded Singly-Constrained Gravity and Logit Mode Split model.
  * Support 5 transit mode tiers, contextual river-valley crossings, station concourse upgrades, OCC automation modules, TOD density growth, and City Council Policy drafts.
* **Post-MVP Scope:**
  * Additional global cities (Montreal, Vancouver, Amsterdam, Tokyo) with city-specific capability traits (ferries, underground-only rules, through-running rail, station retail).
  * **Crisis Scenarios** and **Endless Creative Sandbox** game modes.
  * Advanced Act III corridor mechanics (quad-track express bypass lines, construction replacement bus shuttles, and Land Value Capture real-estate leasing).
* **Non-Goals:**
  * Individual private-car street-level traffic microsimulation or turn-by-turn road intersections.
  * Free-form 3D camera movement or manual 3D terrain/building mesh authoring.
  * Real-time or turn-based multiplayer modes.
  * Per-minute manual departure timetable authoring (scheduling operates on target headways and load policies).

---

## 2. Core Gameplay Loop & Meaningful Realism

### 2.1 The 24-Hour / 7-Day Commuter Demand Pulse & Mode Split
Each simulated 24-hour day runs over **12 real-time minutes at 1x speed** ($1\text{ real second} = 2\text{ simulated minutes}$), with player-selectable **1x, 2x, and 4x** speed controls and pause. City demand follows a weekly 7-day rhythm across four zone classifications—**Residential ($\text{R}$)**, **Commercial ($\text{C}$, including Entertainment & Nightlife sub-nodes)**, **Industrial ($\text{I}$)**, and **Campus/Medical ($\text{U}$)**:
* **Morning Peak (06:30–09:30):** High outflow from $\text{R}$ zones toward $\text{C}$, $\text{I}$, and $\text{U}$ hubs.
* **Midday & Off-Peak (09:30–15:30):** Lower-volume bidirectional errands, hospital visits, shopping trips (West Edmonton Mall, Southgate), and inter-campus travel.
* **Evening Peak (15:30–18:30):** Return commute from $\text{C}/\text{I}/\text{U}$ hubs to $\text{R}$ zones, plus secondary flows toward Commercial Entertainment & Nightlife districts (Whyte Ave, ICE District).
* **Evening & Overnight Off-Peak (18:30–06:30):** Social and dining return trips tapering after `23:00` into a **nighttime lull** consisting of sparse $\text{R} \leftrightarrow \text{I}$ and hospital shift traffic.
* **Weekend Rhythm (Sat–Sun) & Special Event Surges:** Weekends flatten morning/evening $\text{C}$ and $\text{I}$ office peaks while amplifying midday shopping and evening entertainment trips. Dynamic stadium games, festivals, and severe weather fronts apply temporary production/attraction spikes on top of the baseline schedule.

Total origin-destination trip volume $T_{ij}(t)$ from zone $i$ to destination $j$ at time $t$ is governed by a **Singly-Constrained Gravity Model** that conserves total zone departure production $P_i(t)$, while transit ridership $D_{ij}(t)$ is bounded in $[0, T_{ij}(t)]$ by a **Binary Logit Mode Split** comparing transit against baseline private car travel:

$$T_{ij}(t) = P_i(t) \cdot \frac{A_j(t) \cdot \left(\max(C_{ij,\text{transit}}, C_{\min})\right)^{-\gamma}}{\sum_{k} A_k(t) \cdot \left(\max(C_{ik,\text{transit}}, C_{\min})\right)^{-\gamma}}, \quad D_{ij}(t) = T_{ij}(t) \cdot \frac{1}{1 + \exp\left(\beta \cdot (C_{ij,\text{transit}} - C_{ij,\text{car}})\right)}$$

Where:
* $P_i(t)$ is the time-of-day total departure production of zone $i$, and $A_j(t)$ is the attractiveness weight of destination $j$.
* $C_{ij,\text{transit}}$ is the **Generalized Transit Travel Cost** (in-vehicle travel time + expected wait time + transfer penalty), clamped below by $C_{\min} = 1.0\text{ min}$ to prevent zero-cost singularities. When no transit path connects $i$ and $j$, $C_{ij,\text{transit}} = \infty$ and $D_{ij}(t) = 0$, while $T_{ij}(t)$ remains visible in map overlays as unmet car demand.
* $C_{ij,\text{car}}$ is baseline private automobile generalized cost (road distance speed + arterial congestion + downtown parking fee).
* $\gamma$ is the spatial friction exponent and $\beta$ is mode-choice sensitivity. Lowering $C_{ij,\text{transit}}$ through faster lines or lower transfer penalties shifts car commuters onto transit, raising city-wide **Mode Share %** $= \frac{\sum_{i,j} D_{ij}(t)}{\sum_{i,j} T_{ij}(t)} \times 100\%$.

### 2.2 Infrastructure Tiers & Right-of-Way (ROW) Physics
Players deploy five transit tiers with distinct Capital Expenditure ($\text{CapEx}$), Operating Expenditure ($\text{OpEx}$), unit passenger capacity (where $1\times = 50\text{ riders}$), cruise speed, and **Right-of-Way (ROW)** behavior:

| Tier | Mode | ROW Type | Capacity / Unit | Cruise Speed | CapEx (Track / Vehicle) | Daily OpEx / Unit | Strategic Role & Constraints |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Local ETS Bus** (Edmonton Transit Service) | Mixed Traffic | $50$ ($1\times$) | $25\text{ km/h}$ | $\$100\text{/km}$ / $\$250$ | $\$45$ | Deploys on existing streets without track cost; slowed by road congestion, signals, routine $-30^\circ\text{C}$ winter snow, and $-40^\circ\text{C}$ Polar Vortex cold-snap events. |
| **2** | **Articulated BRT** (Bus Rapid Transit) | Dedicated Priority Lanes | $110$ ($2.2\times$) | $35\text{ km/h}$ | $\$600\text{/km}$ / $\$550$ | $\$80$ | Converts existing arterial lanes to bus-only priority; bypasses car traffic along crosstown corridors (Whitemud, Whyte Ave). |
| **3** | **Low-Floor Tram** (Valley Line LRT) | At-Grade Urban Light Rail Transit (LRT) | $200$ ($4\times$) | $45\text{ km/h}$ | $\$1,800\text{/km}$ / $\$1,100$ | $\$130$ | Runs along arterial street medians without expensive grade separation, but incurs intersection delays unless upgraded with **Transit Signal Priority (TSP)**. |
| **4** | **High-Floor LRT** (Capital Line) | Grade-Separated / Trench / Tunnel | $300$/car ($6\times$, multi-car consists) | $65\text{ km/h}$ | $\$4,200\text{/km}$ / $\$1,800$ | $\$190$ | Immune to surface weather and traffic; supports multi-car Light Rail Vehicle (**LRV**) consists with higher river-crossing and tunnel CapEx. |
| **5** | **Regional Rail & Automated Metro** | Fully Grade-Separated | $500$ ($10\times$) | $90\text{ km/h}$ | $\$6,500\text{/km}$ / $\$2,800$ | $\$280$ | Late-game high-capacity corridor mode connecting outer municipalities (St. Albert, Sherwood Park, Leduc / YEG Airport) into the urban core. |

### 2.3 Casual-Friendly Realism Mechanics
Complex transit engineering trade-offs are exposed through four visual station and corridor controls:

1. **Headway Stability & Vehicle Bunching:**
   * *Problem:* Heavy boarding dwell times at busy stops delay a leading vehicle until trailing vehicles catch up, creating a bunched platoon followed by long platform wait gaps.
   * *Solution:* Players unlock the **Auto-Headway Dispatcher** (Section 3.2) and **All-Door ARC Card Tap Boarding** (Edmonton's smart fare card, cutting dwell time per passenger by $50\%$) to maintain even loop spacing.
2. **Elevation & River Valley Crossings:**
   * Dragging a corridor across Edmonton's **North Saskatchewan River Valley** opens a contextual crossing selector with three options:
     * **Shared Road Bridge:** $1.0\times$ track CapEx, inherits arterial road speed limit and congestion.
     * **Dedicated High-Level Transit Bridge:** $2.4\times$ track CapEx, immune to car traffic, applies a $-15\%$ grade slope speed penalty on valley climbs, and grants a $+5\%$ **Scenic Approval Bonus** to Public Approval for commuters crossing the valley.
     * **Deep Bored Tunnel & Portal:** $3.2\times$ track CapEx, $0\%$ grade slope penalty (full cruise speed), and complete immunity to winter weather slowdowns.
3. **Transfer Friction & Unified Concourses:**
   * Upgrading a station from **Curbside Stop** ($P_{\text{concourse}} = 4.0\text{ min}$) $\rightarrow$ **Heated Transit Centre** ($2.0\text{ min}$) $\rightarrow$ **Multi-Modal Concourse with Pedways** ($1.0\text{ min}$) reduces transfer time penalties by up to $75\%$ and increases rider satisfaction during winter conditions.
4. **Park-and-Ride vs. Suburban Feeder AI:**
   * At outer termini (Clareview, Century Park, Lewis Farms), players choose between low-CapEx **Park-and-Ride Lots** (fixed vehicle parking cap that consumes adjacent buildable land) or investing in **Suburban Feeder AI** catchment zones that continuously gather riders from surrounding blocks without consuming station-front real estate.

### 2.4 Economy, Public Approval & Progression Rules
* **Treasury & Operating Cash Flow:** Players begin Career Architect with **$\$50,000\text{ CAD}$**. Every completed passenger trip collects a **$\$3.50$ base ARC fare** at trip completion, supplemented in Act III by **TOD property-tax bonus revenue** ($+\$25\text{ CAD/day}$ per upzoned station level above tier 0; parcel retail/lease revenue is a Post-MVP extension). Track and station **OpEx** are deducted at the end of each simulated day.
* **Decommissioning & Soft-Lock Protection:** Demolishing unused track segments or stations refunds **$75\%$ of original CapEx**. If cash flow pushes treasury below $\$0$, an automatic **Municipal Bond Overdraft** provides up to **$\$25,000$** in emergency credit (at $5\%$ weekly interest) so players can restructure unprofitable routes rather than hitting an unrecoverable Act I soft-lock.
* **Public Approval ($0\%\text{--}100\%$):** Public Approval updates continuously from weighted average rider satisfaction (boarded wait timer vs. **suburban car-commuter patience** ceiling of $12\text{ simulated minutes}$), city-wide Mode Share %, and active scenic/policy bonuses. At each 4-week Election Cycle, meeting the Council Approval Target unlocks a **City Council Policy Draft**; falling below target skips that cycle's policy draft and triggers a 4-week probation warning. Reaching $0\%$ Public Approval or exceeding the $\$25,000$ bond ceiling at an election cycle ends the run.
* **5 Ridership Milestones (Act & Tier Gating):** Career Architect progresses through 5 Ridership Milestones that govern Act transitions and infrastructure unlocks:
  1. **Milestone 1 ($500$ daily riders):** Starting Act I network; unlocks Tier 1 Bus and Tier 2 Articulated BRT.
  2. **Milestone 2 ($2,500$ daily riders):** Unlocks **Act II**, Tier 3 Low-Floor Tram, **Auto-Headway Dispatcher**, and **All-Door ARC Boarding**.
  3. **Milestone 3 ($10,000$ daily riders):** Unlocks **Suburban Feeder AI**, **Blueprint Interchanges**, and Tier 4 High-Floor LRT.
  4. **Milestone 4 ($35,000$ daily riders):** Unlocks **Act III**, **TOD Upzoning**, and Tier 5 Regional Rail.
  5. **Milestone 5 ($100,000+$ daily riders):** Metropolitan maturity milestone; satisfies Campaign victory target.

---

## 3. "The Network Must Grow" — Scaling Without Late-Game Fatigue

To prevent late-game UI fatigue across 20+ active lines, progression moves through three distinct management layers:

```text
[ACT I: TACTICAL MICRO]        [ACT II: SYSTEMIC MESO]          [ACT III: METROPOLITAN MACRO]
Manual Lines & Vehicles  --->  Auto-Headway & Feeder AI   --->  TOD, Express Corridors & Regional Rail
(1 - 5 Lines, ~500 Riders)     (6 - 20 Lines, ~10k Riders)      (20+ Lines, 100k+ Riders)
```

### 3.1 Act I: Tactical Micro (Milestone 1 — Typical Pacing: Weeks 1–4)
* Manual route drawing for initial trunk corridors and direct purchasing of individual buses or articulated units.
* Tight treasury management around ARC farebox recovery during morning/evening rush hours and stadium event surges.

### 3.2 Act II: Systemic Meso & Automation Unlocks (Milestones 2–3 — Typical Pacing: Weeks 5–12)
Hitting Milestones 2 and 3 unlocks **Operations Control Centre (OCC)** automation modules:
* **Auto-Headway Dispatcher:** Players configure a line policy (e.g., `"Target 80% Load"` or `"3-Minute Simulated Peak Headway"`) instead of manually clicking `+1 Vehicle`. The dispatcher dynamically assigns reserve units from an abstract global **Central Garage / Reserve Pool** (requiring no physical map depot placement) before peak windows and recalls surplus units during off-peak hours. An **OpEx & Corridor Capacity Governor** enforces each mode's minimum safe headway floor and a player-set OpEx budget cap, surfacing a corridor-tier upgrade prompt whenever sustained load exceeds safe headway capacity.
* **Suburban Feeder AI (Micro-Transit Zones):** Players paint a circular **Transit Centre Catchment Zone** around suburban hubs (Terwillegar, Mill Woods). Automated on-demand shuttles dynamically collect local riders inside that radius and feed them directly into the trunk LRT station without requiring manual neighborhood loop routes.
* **Blueprint Interchanges:** Reusable saved templates for multi-line station junctions and grade-separated track crossings that players stamp onto new hubs in one click.
* **One-Click Corridor Upgrading:** Convert an overcrowded BRT corridor into Low-Floor or High-Floor LRT via a single `"Upgrade Corridor"` action *(Post-MVP refinement: automated bus replacement shuttles maintain service during active construction windows)*.

### 3.3 Act III: Metropolitan Macro (Milestones 4–5 — Typical Pacing: Weeks 13+)
With local feeder coverage and headway sizing automated, gameplay focuses on regional architecture:
* **Transit-Oriented Development (TOD):** High-frequency stations trigger automatic zoning upgrades (low-density residential $\rightarrow$ mid-rise $\rightarrow$ high-rise mixed-use), scaling zone production/attraction weights along a bounded **logistic growth curve capped at carrying capacity $K_i$** per district to prevent unbounded demand growth and generating recurring **TOD property-tax bonus revenue**. *(Post-MVP Act III expansion: Land Value Capture real-estate parcel leasing around upzoned stations.)*
* **Regional Rail & Express Corridors:** Deploy Tier 5 Regional Rail links to St. Albert, Sherwood Park, and YEG International Airport. *(Post-MVP Act III expansion: Quad-Tracking & Express Bypass scheduling running local and express consists on shared corridors.)*

---

## 4. Replayability & Game Modes

Replayability across runs comes from procedural **Metropolitan Growth Seeds** and periodic **City Council Policy** drafts rather than fixed scripts.

### 4.1 The City Council Policy Deck (Election Milestones)
Every 4 in-game weeks (an Election Cycle), if Public Approval meets the Council Target, players draft **1 of 3 City Bylaws / Transit Doctrines**:
* **"Abolish Parking Minimums":** Stations gain $+25\%$ TOD logistic growth rate toward carrying capacity $K_i$, while suburban car-commuter patience threshold drops by $15\%$.
* **"Winter City Heated Pedway Network":** Adjacent downtown stations within $300\text{m}$ link via underground pedways, setting inter-station transfer penalty $P_{\text{concourse}} = 0$.
* **"U-Pass Universal Expansion":** Campus hubs (University of Alberta, NAIT, MacEwan) generate $2\times$ ridership volume; ARC fare per student decreases by $30\%$, offset by a guaranteed **$\$1,500$ semesterly grant** (paid every **1 semester = 8 in-game weeks**).
* **"24/7 Night Owl Industrial Shift":** Eliminates the `23:00–06:30` nighttime demand lull at industrial and hospital nodes, keeping them at $100\%$ baseline shift demand overnight.

### 4.2 Dynamic Urban Boom Seeds
While Edmonton's river valley and arterial roads remain geographically fixed, each new run rolls a **Metropolitan Growth Seed** that shifts early population and employment growth weights:
* **Seed A ("Tech & Med Supercluster"):** University, Blatchford/NAIT, and Research Park nodes gain accelerated early density weights.
* **Seed B ("Suburban Annexation"):** Outer districts beyond Anthony Henday Drive (Windermere, Lewis Farms, Horse Hill) grow rapidly, prioritizing long-distance express corridors.
* **Seed C ("Festival & Arena Megacity"):** Increased frequency and magnitude of special event surges at ICE District, Exhibition Lands, and Old Strathcona.

### 4.3 Game Modes
1. **Career Architect (MVP Primary Mode):** Grow Edmonton across all 5 Ridership Milestones from a small bus network to an automated metropolitan rail system.
2. **Crisis Scenarios (Post-MVP — 20 Real-Time Minute Challenges):** Time-boxed scenarios with modified rules and explicit timers, such as *"-40°C Polar Vortex Breakdown"* ($50\%$ of mixed-traffic bus fleet immobilized; preserve Public Approval above $0\%$ for 20 real-time minutes / 40 simulated hours at 1x speed) or *"Stanley Cup Finals Game 7"* (evacuate $25,000$ fans from Churchill Station within **4 real-time minutes**, equivalent to **8 simulated hours** at 1x speed).
3. **Endless Creative Sandbox (Post-MVP):** Configurable starting capital or unlimited budget to design custom transit maps without bankruptcy failure conditions.

---

## 5. Multi-City Expansion Framework

Map geometry, node layouts, and baseline climate/cost parameters are driven by a data-only **City Pack Manifest** (`manifest.json`, `geometry.json`, `nodes.json`, `events.json`). While **Map 01: Edmonton (YEG)** establishes the core engine loop, **Post-MVP expansion cities** layer city-specific transport rules onto the shared engine using declarative **City Capability Traits** (`requireUnderground`, `waterNavigationAllowed`, `bikeCatchmentMultiplier`, `throughRunningPairs`, `stationRetailRevenueModel`) without rewriting core simulation loops:

| Map # | City | Scope | Signature Geographic Puzzle | City-Specific Mechanics & Capability Traits |
| :--- | :--- | :--- | :--- | :--- |
| **01** | **Edmonton (YEG)** | **MVP Flagship** | Deep North Saskatchewan River Valley & ring-road sprawl. | **Extreme Seasons ($+30^\circ\text{C}$ to $-40^\circ\text{C}$)**, High-Floor vs. Low-Floor LRT split, ARC Card & bounded TOD upzoning. |
| **02** | **Montreal (YUL)** | Post-MVP | Island geography bounded by the St. Lawrence River & Mount Royal. | `requireUnderground` constraint for rubber-tired Metro cars (prohibited on surface track), **REM** (*Réseau express métropolitain*) automated light metro conversion, heavy winter snow penalties. |
| **03** | **Vancouver (YVR)** | Post-MVP | Burrard Inlet, False Creek & Fraser River peninsulas. | Fully automated short-train SkyTrain (`90s` simulated peak headway), `waterNavigationAllowed` for **SeaBus Passenger Ferries**, B-Line articulated buses. |
| **04** | **Amsterdam (AMS)** | Post-MVP | Concentric historic canal rings & IJ waterfront. | `bikeCatchmentMultiplier` (underground bicycle parking garages expanding station catchment radius), dense tram TSP priority, canal/harbor ferries. |
| **05** | **Tokyo (TYO)** | Post-MVP | Polycentric mega-hubs (Shinjuku, Shibuya, Tokyo) & Yamanote Loop. | `throughRunningPairs` (suburban commuter trains interlining directly into subway tunnels), `stationRetailRevenueModel` (station department store retail revenue). |

---

## 6. Visual & Audio Direction ("Tactile Modernist")

* **Visual Style:** Styled after Vignelli transit diagrams overlaid on dark-mode GIS cartography. Active corridors render as offset vector lines with subtle bloom, zooming continuously from city-wide network diagrams down to individual vehicles leaning into curves and animated door boarding indicators.
* **Procedural Audio Landscape:** Station zones and transit lines map to notes in a modal pentatonic scale. ARC card tap events and station arrivals trigger soft procedural Web Audio synthesis cues, generating an ambient polyrhythmic soundscape that reflects network activity.

---

## 7. Alternatives Considered

1. **Singly-Constrained Gravity + Logit Mode Split vs. Abstract Shape-Matching (*Mini Metro*) or Household Activity Simulators (*Cities: Skylines*):**
   * *Rejected — Abstract Shape-Matching:* Too divorced from urban geography; ignores travel time, headway reliability, and latent car-to-transit mode shift.
   * *Rejected — Full Household Microsimulation:* Simulating individual car trips and daily agendas across hundreds of thousands of residents forces street-traffic pathfinding overhead and obscures clear transit engineering trade-offs.
   * *Chosen — Constrained Gravity + Binary Logit:* Captures authentic induced demand and corridor economics while preserving $O(1)$ station-to-station lookup performance and strict zone population conservation.
2. **Headway & Load Policy Automation vs. Explicit Timetable & Block-Signaling (*NIMBY Rails*):**
   * *Rejected — Minute-by-Minute Timetables:* Requires heavy UI complexity and punishes players with cascading timetable conflicts as networks scale past 15–20 lines.
   * *Chosen — Tiered OCC Automation:* Lets players engage manually with early lines in Act I and transition to headway/load policies in Act II without per-train scheduling chores.
3. **Data-Driven City Packs + Capability Traits vs. Arbitrary Per-City Code Forks:**
   * *Rejected — Unconstrained City Scripts/Forks:* Creates fragmented engine codebases across cities.
   * *Chosen — Manifest Schema + Declarative Capability Traits:* Keeps Edmonton MVP purely data-driven while enabling post-MVP city mechanics through composable engine flags.

---

## 8. Risks & Mitigations

1. **Runaway Gravity Model & TOD Positive Feedback Loop:**
   * *Risk:* Lowering $C_{ij,\text{transit}}$ drives higher ridership, which accelerates TOD density and Land Value Capture revenue, creating super-exponential demand spikes that overwhelm fleet capacity and memory bounds.
   * *Mitigation:* Enforce a generalized cost floor ($C_{\min} = 1.0\text{ min}$), conserve zone departures $P_i(t)$ via Singly-Constrained Gravity normalization, bound transit share in $[0, 1]$ via Logit split, cap TOD growth at logistic carrying capacity $K_i$, and govern Auto-Headway dispatches with physical minimum headway floors and OpEx limits.
2. **Act I Economic Bankruptcy Soft-Lock:**
   * *Risk:* Early overbuilding or severe winter snow slowdowns drain starting cash to $\$0$ before farebox revenue covers daily OpEx.
   * *Mitigation:* Provide a $75\%$ CapEx refund on demolished infrastructure and an automatic $\$25,000$ Municipal Bond Overdraft credit line so players can restructure unprofitable lines.
3. **Late-Game Visual Clutter & Time-Scale Distortion:**
   * *Risk:* Overlapping routes on trunk corridors become unreadable at 20+ lines, or overly fast day clocks make vehicle travel times mismatch rush-hour windows.
   * *Mitigation:* Use a 12-minute real-time diurnal cycle at 1x speed (with 1x/2x/4x controls), automatic parallel track offsetting on shared corridors, and togglable HUD heatmap layers.
