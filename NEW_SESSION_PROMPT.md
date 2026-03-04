# New Session Prompt — Phase 2b Implementation

## Context

You are continuing development of the **Fire Evacuation Capacity Analysis System** — a legally-focused AI agent system that determines ministerial vs. discretionary review for proposed housing developments in California cities, based on their impact on evacuation route capacity. The codebase is in `/Users/twgonzalez/Dropbox/Code Projects/csf/csf-fire/`.

Run commands with: `export PATH="$HOME/.local/bin:$PATH" && uv run python main.py ...`

## What Exists (Working, Verified)

All code is functional and has been live-tested on Berkeley, CA.

**Agents:**
- `agents/data_acquisition.py` — Downloads FHSZ, OSM roads, Census TIGER boundary, Census ACS B25001 housing units (block groups). Caches to `data/{city}/`.
- `agents/capacity_analysis.py` — HCM 2022 capacity + network-path-based evacuation route ID + catchment-based demand.
- `agents/objective_standards.py` — Three-tier determination: DISCRETIONARY / CONDITIONAL MINISTERIAL / MINISTERIAL.
- `agents/visualization.py` — Folium map with three-tier coloring.
- `main.py` — Click CLI: `analyze` (downloads + runs capacity analysis) and `evaluate` (runs objective standards for a proposed project).

**Current three-tier logic:**
- DISCRETIONARY: `fire_zone_modifier AND disc_size_met AND capacity_exceeded`
- CONDITIONAL MINISTERIAL: `city_has_fhsz AND cond_size_met`
- MINISTERIAL: below size threshold

**Verified test cases (Berkeley):**
- FHSZ Zone 3 (37.8914, -122.2494), 75 units → CONDITIONAL MINISTERIAL
- Downtown (37.87, -122.27), 75 units → CONDITIONAL MINISTERIAL
- Downtown (37.87, -122.27), 10 units → MINISTERIAL

## What Is Wrong (Phase 2b Problem Statement)

The current demand model is fundamentally incorrect. It was discovered by reading the official Berkeley AB 747 study commissioned from KLD Engineering, P.C. (March 2024, KLD TR-1381).

**Current (wrong) approach:**
- Uses only 23 FHSZ-zone housing units as evacuation demand origins
- Uses network paths from those 2 block group centroids only
- Baseline demand = 31 vph (trivially low)
- Only identifies evacuation routes in the NE hills (FHSZ paths)
- Downtown streets appear to have 0 evacuation demand — so Standard 4 never fires for any project there

**KLD Berkeley study approach (correct):**
- Uses ALL city residents + ALL in-commuting employees as demand
- Assigns demand to each road segment via **quarter-mile buffer** around the segment
- Identifies evacuation routes from ALL block group centroids (not just FHSZ zones) to city exits
- Result: Most Berkeley arterials operate at **LOS E–F** during max demand evacuation
- This means any large project anywhere in the city that adds vehicles to already-stressed routes has a measurable impact

**Consequence for determination logic:**
- The `fire_zone_modifier` gate for DISCRETIONARY is incorrect: a 400-unit SB 79 project near Downtown Berkeley BART that pushes already-LOS-F arterials further over capacity is just as impactful as a hills project
- DISCRETIONARY should be gated on **capacity impact** (Standard 4), not fire zone location
- Fire zone location remains a severity modifier (determines conditions within DISCRETIONARY) but should NOT be the entry gate

## What Needs to Be Implemented (Phase 2b)

Read `specs.md` in the project root for the complete architecture. Below is the implementation task list.

### Task 1: Add employee and student demand to data acquisition

**File:** `agents/data_acquisition.py`

Add to `block_groups.geojson` output (new columns alongside existing `housing_units_in_city`, `housing_units_in_fhsz`):
- `employee_count` — in-commuting employees per block group
- `student_count` — university student vehicles per block group (from city config)

**Employee demand — try LEHD first, fall back to ACS B08301:**

Option A (preferred): Census LEHD OnTheMap API
```
GET https://onthemap.ces.census.gov/api/v1/lodes?
  state={state_fips}&year=2020&type=JT01&sa=C000&
  geography={county_fips}&geography_type=county
```
This returns jobs (C000 = all jobs) by census block. Aggregate to block group by first 12 chars of geocode.

Option B (fallback): ACS B08301 (means of transportation to work) gives total workers in city. Distribute proportionally to block group population. Add `lehd_available` flag to metadata.

**Student demand (from city config `universities` list):**
For each university in city config:
- Assign students to block groups within 0.5 miles of university lat/lon
- `student_count` = enrollment × student_vehicle_rate × (block_group_area_in_buffer / total_buffer_area)

**City config additions needed (add to `config/cities/berkeley.yaml`):**
```yaml
employment_rate: 0.62
commute_in_fraction: 0.45
universities:
  - name: "UC Berkeley"
    enrollment: 45057
    student_vehicle_rate: 0.08
    location_lat: 37.8724
    location_lon: -122.2595
```

### Task 2: Replace FHSZ-path demand with quarter-mile buffer demand

**File:** `agents/capacity_analysis.py`

Replace the current `_identify_evacuation_routes()` demand component and `_apply_baseline_demand()` catchment logic with a new `_apply_buffer_demand()` function:

```python
def _apply_buffer_demand(roads_proj, block_groups_proj, config):
    """
    Assign demand to each road segment from all residents + employees + students
    within a quarter-mile buffer. Matches KLD Engineering AB 747 methodology.
    """
    buffer_m = config['demand']['buffer_radius_miles'] * 1609.344  # 0.25 mi → ~402 m
    res_mob  = config['demand']['resident_mobilization']      # 0.57
    emp_mob  = config['demand']['employee_mobilization_day']  # 1.00
    stu_mob  = config['demand']['employee_mobilization_day']  # 1.00 (same for max scenario)
    vpu      = config['demand']['vehicles_per_unit']          # 2.5

    for idx, segment in roads_proj.iterrows():
        buf = segment.geometry.buffer(buffer_m)
        bg_nearby = block_groups_proj[block_groups_proj.geometry.intersects(buf)]

        hu  = bg_nearby['housing_units_in_city'].sum()
        emp = bg_nearby.get('employee_count', pd.Series([0])).sum()
        stu = bg_nearby.get('student_count',  pd.Series([0])).sum()

        res_vph = hu  * vpu * res_mob
        emp_vph = emp * 1.0 * emp_mob
        stu_vph = stu * 1.0 * stu_mob

        roads_proj.at[idx, 'catchment_hu']        = hu
        roads_proj.at[idx, 'catchment_employees']  = emp
        roads_proj.at[idx, 'resident_demand_vph']  = res_vph
        roads_proj.at[idx, 'employee_demand_vph']  = emp_vph
        roads_proj.at[idx, 'student_demand_vph']   = stu_vph
        roads_proj.at[idx, 'baseline_demand_vph']  = res_vph + emp_vph + stu_vph
        roads_proj.at[idx, 'demand_source']        = 'census_buffer'
    return roads_proj
```

Note: The buffer approach is applied to ALL roads, not just evacuation routes. Evacuation route identification (Dijkstra from block group centroids) still runs separately to set `is_evacuation_route` and `connectivity_score` — but should now use **all block group centroids**, not just FHSZ ones.

**Change to `_identify_evacuation_routes()`:**
- Remove the FHSZ filter on origins. Use ALL block groups.
- Keep the existing Dijkstra / virtual sink node structure — just change the origin pool.
- Keep the `catchment_units` accumulation (still useful for connectivity weighting).

### Task 3: Fix determination logic — capacity gates DISCRETIONARY, not fire zone

**File:** `agents/objective_standards.py`

Change the three-tier logic from:
```python
# WRONG — fire zone modifier gates DISCRETIONARY
if project_in_fire_zone and disc_size_met and capacity_exceeded:
    tier = "DISCRETIONARY"
```

To:
```python
# CORRECT — capacity impact gates DISCRETIONARY; fire zone is severity modifier
if disc_size_met and capacity_exceeded:
    tier = "DISCRETIONARY"
    # fire_zone_modifier recorded in audit trail — drives condition language
```

Update the CONDITIONAL MINISTERIAL reason string to reflect that DISCRETIONARY was not triggered because capacity is not exceeded (not because the project isn't in a fire zone).

Update all audit trail text and tier logic reminder strings in `main.py` to match.

Update `config/parameters.yaml` `determination_tiers.discretionary.legal_basis` to:
```
"AB 747 (Gov. Code §65302.15) and HCM 2022 v/c capacity threshold — project adds
vehicles to evacuation routes operating at or above LOS E/F (citywide evacuation scenario)"
```

### Task 4: Add demand config block to parameters.yaml

**File:** `config/parameters.yaml`

Add:
```yaml
demand:
  buffer_radius_miles: 0.25
  resident_mobilization: 0.57
  employee_mobilization_day: 1.00
  employee_mobilization_night: 0.10
  student_mobilization_day: 1.00
  vehicles_per_unit: 2.5        # default; overridden by city ACS data
  employee_vehicle_occupancy: 1.0
  scenario: "maximum"           # "maximum" | "minimum"
```

### Task 5: Validate against Berkeley AB 747 study results

After implementing, run:
```bash
uv run python main.py analyze --city "Berkeley" --state "CA" --refresh
```

**Expected results (matching KLD study Figure 24):**
- Major arterials (Shattuck, University, Telegraph, Sacramento, San Pablo): v/c ≥ 0.60 (LOS E or F)
- Hills roads (Park Hills, Overlook, Middlefield): Lower v/c due to fewer residents in buffer
- Connectivity score: Shattuck, Sacramento, MLK Jr Way should be highest (most O-D paths)

Then test determination cases:
```bash
# Should now be DISCRETIONARY if Shattuck/University already at LOS F (std4 = true)
uv run python main.py evaluate --city "Berkeley" --lat 37.8700 --lon -122.2680 --units 75

# SB 79 project near Ashby BART — check if pushes LOS F roads to DISCRETIONARY
uv run python main.py evaluate --city "Berkeley" --lat 37.8528 --lon -122.2699 --units 300

# Small project — should remain MINISTERIAL
uv run python main.py evaluate --city "Berkeley" --lat 37.87 --lon -122.27 --units 10
```

## Reference Documents

- **Spec:** `specs.md` in project root — complete architecture with all parameters
- **AB 747 study:** `/Users/twgonzalez/Dropbox/Clients/Saving California/Evacuation Route Safety, Capacity, and Viability Analysis - AB 747 Report.pdf`
  - Key methodology: pages 1–11 (demand, capacity, viability sections)
  - Table 2: HCM capacity by speed (matches our table)
  - Figure 12: Mobilization curve (57% resident peak hour)
  - Figure 24: Maximum demand congestion (target validation output)

## Key Parameters to Never Hardcode

All in `config/parameters.yaml` or city YAML:
- `vc_threshold` (0.80 default)
- `unit_threshold` (50 default)
- `demand.buffer_radius_miles` (0.25)
- `demand.resident_mobilization` (0.57)
- `demand.employee_mobilization_day` (1.00)
- `demand.vehicles_per_unit` (2.5)

## Legal Constraints (Unchanged)

- All standards 100% algorithmic — never add "professional judgment"
- Every output must include full audit trail (inputs + intermediates + outputs)
- Cite AB 747, city AB 747 study, HCM 2022, Census data vintage in every determination
