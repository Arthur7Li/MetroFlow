# YEG Transit Architect (Working Title: *MetroFlow*)
## High-Level Game Design Document (GDD)

---

## 1. Executive Vision & Core Pillars

**Elevator Pitch:**  
A Steam-grade, endlessly replayable urban transit strategy and automation game built natively for the modern web. Combining the tactile visual clarity of *Mini Metro*, the authentic infrastructure physics of *NIMBY Rails*, and the addictive *"the network must grow"* automation scaling of *Factorio*, players transform sprawling cities—starting with **Edmonton, Alberta (YEG)**—into thriving, high-frequency transit metropolises.

### Core Design Pillars
1. **Casual Accessibility, Meaningful Realism:** Anyone can drag a line between two neighborhoods in 5 seconds, but mastering the system requires solving real transit engineering puzzles: bus bunching, river-valley grade separation, park-and-ride capture, and trunk-and-feeder hierarchy.
2. **"The Network Must Grow" (Zero Late-Game Micromanagement):** Early game is hands-on route drawing and vehicle purchasing. Mid-to-late game unlocks **Automated Dispatchers, Headway Controllers, Blueprint Interchanges, and Autonomous Feeder Loops**, shifting the player from a bus scheduler into a macro-level Chief Transit Architect.
3. **Transit Shapes the City (Dynamic TOD):** Transit isn't built on a static map. High-frequency stations catalyze **Transit-Oriented Development (TOD)**—organically densifying low-density suburbs into vibrant mixed-use hubs, which in turn generates new commuter demand and tax revenue.
4. **Global City Modularity:** Engineered from day one around a data-driven city schema. **Edmonton (YEG)** serves as the flagship proving ground, followed by cities with distinct geographic and cultural transit doctrines (Montreal, Vancouver, Tokyo, London, Amsterdam).

---

## 2. Core Gameplay Loop & Meaningful Realism

### 2.1 The 4-Step Commuter Demand Pulse
Instead of spawning random abstract shapes at uniform intervals, the city breathes through a realistic **24-Hour / 7-Day Rhythm** compressed into digestible 3-minute game days:
* **Morning Peak (06:30–09:30):** Massive outflow from **Residential ($\text{R}$)** zones toward **Commercial/Downtown ($\text{C}$)**, **Industrial ($\text{I}$)**, and **Campus/Medical ($\text{U}$)** hubs.
* **Midday & Off-Peak (09:30–15:30):** Bi-directional errands, hospital visits, shopping trips (e.g., West Edmonton Mall, Southgate), and inter-campus travel.
* **Evening Peak (15:30–18:30):** Reverse commute back to Residential suburbs, plus secondary flows toward **Entertainment & Nightlife** districts (e.g., Whyte Ave, ICE District).
* **Special Event Surges:** Dynamic stadium games, concerts, festivals, and severe weather fronts test network resilience.

The travel demand $D_{ij}(t)$ between origin neighborhood $i$ and destination hub $j$ at time $t$ follows a real-world **Transit Gravity Model**:

$$D_{ij}(t) = \frac{P_i(t) \cdot A_j(t)}{\left(C_{ij}\right)^{\gamma}}$$

Where:
* $P_i(t)$ is the time-of-day departure production of zone $i$.
* $A_j(t)$ is the attractiveness weight of destination $j$.
* $C_{ij}$ is the **Generalized Travel Cost** (in-vehicle travel time + waiting time + transfer penalty).
* $\gamma$ is the friction factor. **Crucial Gameplay Hook:** As you lower $C_{ij}$ by building faster LRT lines and seamless transfers, *latent demand is unlocked*—people abandon their cars for transit, boosting your Mode Share %!

---

### 2.2 Infrastructure Tiers & Right-of-Way (ROW) Physics
Players progress through five distinct transit modes, each with authentic trade-offs in Capital Expenditure ($\text{CapEx}$), Operating Expenditure ($\text{OpEx}$), speed, capacity, and weather resilience:

| Tier | Mode | ROW Type | Capacity / Unit | Speed | Realism Mechanic & Strategic Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Local ETS Bus** | Mixed Traffic | $1\times$ | Slow | Cheap to deploy anywhere; suffers from road congestion, traffic lights, and $-30^\circ\text{C}$ snow slowdowns. |
| **2** | **Articulated BRT** | Dedicated Paint / Priority Lanes | $2.2\times$ | Medium | Requires road-lane conversion; immune to regular car traffic; ideal for crosstown arteries (Whitemud, Whyte Ave). |
| **3** | **Low-Floor Tram (Valley Line)** | At-Grade Urban LRT | $4\times$ | Med-Fast | Smooth urban integration and lower construction cost, but slowed by major arterial intersections unless upgraded with TSP (Transit Signal Priority). |
| **4** | **High-Floor LRT (Capital Line)** | Grade-Separated / Trench / Tunnel | $6\times$ | Fast | High CapEx (especially crossing the River Valley or tunneling downtown), immune to weather and traffic, supports multi-car consists. |
| **5** | **Regional Rail & Automated Metro** | Fully Grade-Separated | $10\times$ | Ultra-Fast | Late-game regional connectors linking outer satellite towns (St. Albert, Sherwood Park, Leduc / YEG Airport) into the core. |

---

### 2.3 Casual-Friendly Realism Mechanics
To make the simulation feel authentically grounded without requiring a civil engineering degree, complex real-world phenomena are distilled into intuitive visual mechanics:

1. **Headway Stability & Bus Bunching:**
   * *The Problem:* If a line has heavy boarding delays at one busy stop, vehicles behind it catch up, creating a "conga line" of buses while commuters wait forever in the gap.
   * *The Gameplay Solution:* Players unlock **Automated Headway Spacing** and **Smart Boarding (All-Door ARC Tap)** upgrades, visually snapping bunched vehicles back into an evenly spaced rhythm round the loop.
2. **Elevation & River Valley Crossings:**
   * Crossing Edmonton's deep **North Saskatchewan River Valley** isn't a flat line draw. When dragging a line across the river, a sleek contextual toggle lets the player choose:
     * **Shared Road Bridge:** Free/Cheap, speed-limited, affected by traffic.
     * **Dedicated High-Level Transit Bridge:** Moderate CapEx, scenic bonus, medium grade slope.
     * **Deep Bored Tunnel & Portal:** High CapEx, zero slope penalty, maximum LRT speed.
3. **Transfer Friction & Unified Concourses:**
   * Commuters hate walking across 6 lanes of freezing slush to transfer from a bus to a train.
   * Clicking a station allows upgrading it from a **Curbside Stop** $\rightarrow$ **Heated Transit Centre** $\rightarrow$ **Multi-Modal Concourse with Pedways**, slashing transfer time penalties by $75\%$ and boosting rider happiness.
4. **Park-and-Ride vs. Feeder Network:**
   * At suburban termini (e.g., Clareview, Century Park, Lewis Farms), players face a real urban planning choice: build cheap **Park-and-Ride Lots** (instant commuter capture, but caps out quickly and hogs land) or invest in **Autonomous Neighborhood Feeder Loops** that gather riders sustainably from surrounding blocks.

---

## 3. "The Network Must Grow" — Scaling Without Late-Game Fatigue

A common flaw in transit games is that having 40 lines in the late game means 10x more repetitive clicking. We solve this using a **3-Stage Automation Progression** inspired by *Factorio* and *Rail Route*:

```
[ACT I: TACTICAL MICRO]        [ACT II: SYSTEMIC MESO]          [ACT III: METROPOLITAN MACRO]
Manual Lines & Vehicles  --->  Auto-Headway & Feeder AI   --->  Express Corridors, TOD & Regional Rail
(1 - 5 Lines, ~500 Riders)     (6 - 20 Lines, ~10k Riders)      (20+ Lines, 100k+ Riders, Multi-City)
```

### Act I: Tactical Micro (Weeks 1–4)
* Hands-on drawing of core spine lines and manually purchasing individual buses/LRVs.
* Every dollar of ARC fare revenue matters. You manually respond to rush hours and Oilers game surges.

### Act II: Systemic Meso & Automation Unlocks (Weeks 5–12)
Once the player hits ridership milestones, they unlock **Operations Control Centre (OCC) Modules** that permanently eliminate repetitive chores:
* **Auto-Headway Dispatcher:** Instead of manually clicking "+1 Bus" or "+1 Train" on 15 different lines, you set a line's policy to **"Target 80% Load"** or **"3-Minute Peak Headway."** Your central garage automatically dispatches extra vehicles from the reserve pool at 07:00 AM and recalls them at 10:00 AM to save operating costs.
* **Suburban Feeder AI (Micro-Transit Zones):** Instead of drawing 30 tiny spaghetti bus routes through every cul-de-sac in Terwillegar or Mill Woods, you designate a **Transit Centre Catchment Zone**. The AI automatically runs dynamic On-Demand Feeder Shuttles within that radius, funneling riders directly to your trunk LRT station!
* **Line Templates & One-Click Upgrading:** Convert an overcrowded BRT corridor into a Light Rail line with a single **"Upgrade Corridor"** action while buses continue running as replacement shuttles during construction.

### Act III: Metropolitan Macro (Weeks 13+)
* With local feeders and vehicle dispatching automated, your focus elevates to **Macro Architecture**:
  * **Quad-Tracking & Express Bypass Lines:** Run Local and Express LRT services on the same corridor (e.g., Express from Century Park $\rightarrow$ Southgate $\rightarrow$ University $\rightarrow$ Churchill).
  * **Transit-Oriented Development (TOD) Real Estate:** Partner with city planners to upzone land around your major stations. Your transit agency earns recurring **Land Value Capture** lease revenue, funding mega-projects like an Anthony Henday Ring Rail or the High-Speed Rail link to YEG International Airport.

---

## 4. Replayability Engine: No Two Runs Play the Same

To achieve 100+ hours of Steam-level replayability, each run blends deterministic geography with procedural urban evolution and roguelite policy choices:

### 4.1 The City Council Policy Deck (Election Milestones)
Every 4 in-game weeks (an Election Cycle), if your Public Approval exceeds the Council target, you draft **1 of 3 City Bylaws / Transit Doctrines** that fundamentally alter the rules of your run:
* *Examples of Transformative Policies:*
  * **"Abolish Parking Minimums"**: All stations immediately gain $+25\%$ organic TOD density growth, but suburban car-commuter patience drops by $15\%$.
  * **"Winter City Heated Pedway Network"**: Adjacent downtown stations within $300\text{m}$ automatically link via underground pedways, allowing instant free passenger transfers.
  * **"U-Pass Universal Expansion"**: Campus hubs (U of A, NAIT, MacEwan) generate $2\times$ ridership volume; fare revenue per student is reduced by $30\%$, but you receive a guaranteed $\$1,500$ semesterly lump-sum grant.
  * **"24/7 Night Owl Industrial Shift"**: Eliminates the nighttime lull; industrial and hospital nodes operate at $100\%$ demand overnight, doubling off-peak revenue.

### 4.2 Dynamic Urban Boom Seeds
While Edmonton's river and arterial roads remain authentic, each new game rolls a **Metropolitan Growth Seed**:
* *Seed A ("Tech & Med Supercluster"):* University, Blatchford/NAIT, and Research Park explode in density early.
* *Seed B ("Suburban Annexation"):* Massive population booms outside Anthony Henday Drive (Windermere, Lewis Farms, Horse Hill) requiring long-distance express commuter strategies.
* *Seed C ("Festival & Arena Megacity"):* Constant high-intensity event surges at ICE District, Exhibition Lands, and Old Strathcona.

### 4.3 Game Modes
1. **Career Architect (Standard Campaign):** Grow the city across 5 Milestones from a fledgling bus network to an automated regional rail empire.
2. **Crisis Scenarios (20-Minute Puzzle Challenges):** E.g., *"The -40°C Polar Vortex Breakdown"* (50% of the bus fleet freezes; reroute the city onto the LRT spine before approval hits zero) or *"Stanley Cup Finals Game 7"* (Move 25,000 fans out of Churchill Station in 4 minutes).
3. **Endless Creative / Real-Scale Sandbox:** Unlimited or custom budget to build your dream fantasy map of Edmonton or any global city.

---

## 5. Multi-City Expansion Framework

The game is built around a **City Pack Manifest** architecture. After perfecting the core mechanics on **Map 01: Edmonton**, adding new cities requires zero engine rewrites—only a new GeoJSON map package and a city modifier profile.

| Map # | City | Signature Geographic Puzzle | Unique Mechanics & Local Flavor |
| :--- | :--- | :--- | :--- |
| **01** | **Edmonton (YEG)** *(Flagship)* | Deep North Saskatchewan River Valley & wide ring-road sprawl. | **Extreme Seasons ($+30^\circ\text{C}$ to $-35^\circ\text{C}$)**, High-Floor vs. Low-Floor LRT network split, ARC Card & TOD upzoning. |
| **02** | **Montreal (YUL)** | Island geography bounded by the St. Lawrence & Mount Royal at the center. | **100% Underground Rubber-Tired Metro** (cannot run outdoors!), REM automated light metro conversion, heavy winter snow. |
| **03** | **Vancouver (YVR)** | Burrard Inlet, False Creek & Fraser River peninsulas. | **100% Automated SkyTrain** (short trains running every 90 seconds), **SeaBus Passenger Ferries**, B-Line articulated buses. |
| **04** | **Amsterdam (AMS)** | Concentric historic canal rings & IJ waterfront. | **Bike-Transit Integration** (giant underground bicycle parking garages multiply station catchment radius), dense tram priorities, ferries. |
| **05** | **Tokyo (TYO)** | Polycentric mega-hubs (Shinjuku, Shibuya, Tokyo) & Yamanote Loop. | **Through-Running Commuter Rail** (suburban trains run directly into subway tunnels), **Station Department Store Retail** as primary revenue. |

---

## 6. Visual & Audio Direction ("Tactile Modernist")

* **Visual Style:** Inspired by classic Vignelli transit diagrams and modern dark-mode GIS dashboards. Clean vector lines with subtle neon bloom on active tracks, smooth zoom transitions from a macro satellite view down to seeing individual articulated buses leaning into turns and LRV doors opening with glowing boarding indicators.
* **Procedural Audio Landscape:** Every station zone and transit line is mapped to a pentatonic or modal harmonic scale. When commuters tap their ARC cards and trains chime at stations, it generates an ambient, relaxing polyrhythmic soundtrack (reminiscent of *Mini Metro* and *SimCity 4*).