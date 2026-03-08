# Fire Evacuation Capacity Analysis System

## Project Purpose

AI agent system that analyzes fire evacuation route capacity for California cities to:
1. Establish **objective development standards** (ministerial vs. discretionary review)
2. Generate **impact fee nexus studies** (AB 1600 compliant)
3. Enable **what-if analysis** for proposed developments

This is a legally-focused system. All standards must be objective (no engineering judgment, no discretion).

## Tech Stack

- **Python 3.11** via uv (`uv run python ...`)
- **GeoPandas** — spatial operations
- **OSMnx** — road network download and analysis
- **NetworkX** — graph/routing algorithms
- **Pandas** — tabular data
- **Click + Rich** — CLI
- **PyYAML** — configuration

## Run Commands

```bash
# Analyze a city (downloads data + calculates capacity)
uv run python main.py analyze --city "Berkeley" --state "CA"

# Evaluate a specific project
uv run python main.py evaluate --city "Berkeley" --lat 37.87 --lon -122.27 --units 75

# Force refresh cached data
uv run python main.py analyze --city "Berkeley" --state "CA" --refresh

# Regenerate the primary demo map (REQUIRED after any visualization code change)
uv run python main.py demo --city "Berkeley"
# → output/berkeley/demo_map.html
```

## Primary UX Artifact

**`output/{city}/demo_map.html`** is the primary stakeholder-facing UX — the interactive
multi-project comparison map used for demos, city attorney review, and planning presentations.
This is the ONLY output file external users need to open.

**After ANY change to `agents/visualization/`**, regenerate it:
```bash
export PATH="$HOME/.local/bin:$PATH"
uv run python main.py demo --city "Berkeley"
# → output/berkeley/demo_map.html
```

The `output/` directory is git-ignored. Share `output/{city}/demo_map.html` directly with
stakeholders. Do NOT leave a stale demo map — always regenerate before sharing.

## Directory Structure

```
agents/
  data_acquisition.py   # Agent 1: fetch FHSZ, roads, boundary, traffic
  capacity_analysis.py  # Agent 2: HCM calculations, evacuation route ID
  objective_standards.py # Agent 3: ministerial/discretionary determination

models/
  road_network.py       # RoadSegment dataclass
  project.py            # Project dataclass

config/
  parameters.yaml       # All thresholds and HCM factors (never hardcode these)
  cities/
    berkeley.yaml       # City-specific config and overrides

data/{city}/            # Cached source data (git-ignored, 90-day TTL)
  fhsz.geojson
  roads.gpkg
  boundary.geojson
  metadata.yaml

output/{city}/          # Results (git-ignored)
  routes.csv
  determination_{id}.txt
```

## Key Parameters (from config/parameters.yaml) — v3.0 ΔT Standard

| Parameter | Default | Source |
|-----------|---------|--------|
| `unit_threshold` | 15 | ITE de minimis; SB 330 statutory anchor |
| `vehicles_per_unit` | 2.5 | U.S. Census ACS B25044 |
| `mobilization_rates.vhfhsz` | 0.75 | Zhao et al. 2022 GPS (44M records, Kincade Fire) |
| `mobilization_rates.high_fhsz` | 0.57 | Zhao et al. 2022 |
| `mobilization_rates.moderate_fhsz` | 0.40 | Zhao et al. 2022 |
| `mobilization_rates.non_fhsz` | 0.25 | Zhao et al. 2022 (shadow evacuation) |
| `hazard_degradation.vhfhsz` | 0.35 | HCM Exhibit 10-15/10-17 + NIST Camp Fire |
| `hazard_degradation.high_fhsz` | 0.50 | HCM composite |
| `hazard_degradation.moderate_fhsz` | 0.75 | HCM composite |
| `max_marginal_minutes.vhfhsz` | 3 | ΔT threshold for Very High FHSZ |
| `max_marginal_minutes.high_fhsz` | 5 | ΔT threshold for High FHSZ |
| `max_marginal_minutes.moderate_fhsz` | 8 | ΔT threshold for Moderate FHSZ |
| `max_marginal_minutes.non_fhsz` | 10 | ΔT threshold for non-FHSZ |
| `egress_penalty.threshold_stories` | 4 | NFPA 101 / IBC |
| `egress_penalty.minutes_per_story` | 1.5 | NFPA 101 |
| `egress_penalty.max_minutes` | 12 | NFPA 101 cap |
| Evacuation route radius | 0.5 miles | per Standard 2 |
| `vc_threshold` | 0.95 | Informational only — HCM LOS E/F boundary |

## HCM 2022 Capacity Table

| Road Type | Capacity (pc/h/lane) |
|-----------|----------------------|
| Freeway | 2,250 × lanes |
| Multilane | 1,900 × lanes |
| Two-lane ≤20 mph | 900 |
| Two-lane 25 mph | 1,125 |
| Two-lane 30 mph | 1,350 |
| Two-lane 35 mph | 1,575 |
| Two-lane ≥40 mph | 1,700 |

## LOS Table (v/c → Level of Service)

| v/c Range | LOS |
|-----------|-----|
| 0.00–0.10 | A |
| 0.10–0.20 | B |
| 0.20–0.40 | C |
| 0.40–0.60 | D |
| 0.60–0.95 | E |
| 0.95+ | F |

## Objective Standards — v3.0 ΔT Standard (Agent 3)

All standards are algorithmic — zero discretion allowed. Do NOT add "professional judgment" language.

1. **Standard 1**: `units >= 15` (integer comparison — universal size gate)
2. **Standard 2**: Buffer project location 0.5 mi → filter `EvacuationPath` objects by bottleneck/exit osmid proximity
3. **Standard 3**: GIS point-in-polygon test against CAL FIRE FHSZ; sets `project.hazard_zone` string which controls mobilization_rate and ΔT threshold; `in_fire_zone=True` for HAZ_CLASS ≥ 2
4. **Standard 4 (ΔT Test)**: `ΔT = (project_vehicles / bottleneck_effective_capacity_vph) × 60 + egress_penalty`
   - `project_vehicles = units × vpu × mobilization_rate(hazard_zone)`
   - `egress_penalty = 0` for stories < 4; `min(stories × 1.5, 12)` for ≥ 4 stories
   - Flagged when `ΔT > max_marginal_minutes(hazard_zone)`
   - **No baseline precondition** — routes already at LOS F are tested equally
5. **Standard 5**: SB 79 transit proximity flag — **informational only**, never raises tier

**Final determination:**
```
DISCRETIONARY           — Std 1 met AND any serving path ΔT > threshold
CONDITIONAL MINISTERIAL — Std 1 met AND all paths ΔT within threshold
MINISTERIAL             — below size threshold (Std 1 not met)
```

**ΔT engine** (`agents/scenarios/base.py`): `compute_delta_t()` iterates `list[EvacuationPath]` from Agent 2.
**Routing** (`agents/scenarios/wildland.py`): `identify_routes()` returns `EvacuationPath` objects filtered by proximity.
**Orchestration** (`agents/objective_standards.py`): most-restrictive-wins across WildlandScenario only (Sb79TransitScenario never contributes to tier).

## Data Sources

| Dataset | Source | Format |
|---------|--------|--------|
| FHSZ Zones | CAL FIRE OSFM ArcGIS REST API | GeoJSON |
| Road Network | OpenStreetMap via OSMnx | GeoPackage |
| City Boundary | U.S. Census TIGER | GeoJSON |
| Traffic Volumes | Caltrans AADT (PeMS) — fallback: road class estimate | CSV |

## Caching Policy

All downloaded data is cached in `data/{city}/` with a 90-day TTL. Use `--refresh` to force re-download. `metadata.yaml` records source URLs and download dates for every file (required for legal audit trail).

## Current MVP Phase

Phase 1 (MVP): Agents 1–3 only. CLI output to CSV + text. No web UI, no fee calculator, no PDF reports.

Phase 2 (next): Agent 4 (impact fee calculator) + Agent 6 (Folium maps).
Phase 3 (later): Agent 5 (Flask what-if web app) + Agent 7 (Word/PDF reports).

## v3.0 Migration Status (branch: feat/v3-delta-t)

✅ Replaced v/c marginal causation test with ΔT (marginal evacuation clearance time).
✅ Tiered mobilization rates from Zhao et al. 2022 GPS data (vhfhsz=0.75, high=0.57, moderate=0.40, non=0.25).
✅ Hazard-aware capacity degradation applied by Agent 2 (HCM composite + NIST Camp Fire validation).
✅ Building egress penalty (NFPA 101/IBC) for buildings ≥ 4 stories.
✅ `EvacuationPath` dataclass with per-path bottleneck tracking (argmin effective_capacity_vph).
✅ `Sb79TransitScenario` replaces `LocalDensityScenario` (informational flag, no tier impact).
✅ Audit trail v3.0: shows ΔT per path, bottleneck details, hazard degradation, egress penalty.
✅ `data/{city}/evacuation_paths.json` persisted by Agent 2 after routing.

## Pending Methodology Work

1. **Physical site access standard (new Standard 6)** — no file yet
   The Clark Street (Encinitas) problem — 200 units at end of an 18' wide dead-end street —
   is not a v/c ratio problem. It is a physical access problem governed by IFC §503
   (fire apparatus access roads). Objective thresholds already exist in adopted fire code:
   - Minimum road width: 20 ft one-way, 26 ft two-way
   - Dead-end without turnaround: flag if > 150 ft serving > N units
   - Single access point: flag for large projects (city-adopted N)
   This should be a new scenario subclass (`agents/scenarios/site_access.py`) using OSM
   `width` tags and road geometry as inputs.
