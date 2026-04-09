# JOSH v1.0.0 — Two-Repo Refactor Plan

**Status:** Ready to execute  
**Decided:** 2026-04-08  
**Target:** Merge to `main` on both repos before next city delivery

---

## Decisions Made

| Question | Decision |
|---|---|
| Pipeline → engine interface | Subprocess (`uv run python build.py ...`) |
| Berkeley in public repo | Yes — stays as live schema example + demo output |
| `config/parameters.yaml` canonical location | `josh` (public) — it's the legal methodology spec |
| `josh-private` fate | Dissolved — absorbed into `josh-pipeline` |
| Three-repo → two-repo | `josh` (public) + `josh-pipeline` (private) |

---

## Version Scheme

Two independent version numbers, both embedded in every deliverable:

| Version | Current | Bumps when | Stored in |
|---|---|---|---|
| **Software** `JOSH_VERSION` | `0.1.0` → **`1.0.0`** at merge | Engine or builder changes | `pyproject.toml` → exported to `graph.json` + map footer |
| **Methodology** `PARAMETERS_VERSION` | `3.4` | Legal standard changes | `agents/export.py` + `config/parameters.yaml` |
| **Schema** `APP_JS_VERSION` | `v1` | Backward-incompatible `JOSH_DATA` changes | `agents/export.py` → CDN URL path |

The `1.0.0` bump marks the public release moment. Methodology stays at `3.4`.

---

## Final Repo Topology

```
josh (public — github.com/twgonzalez/josh)
├── models/                    # data structures (no internal deps)
├── agents/
│   ├── capacity_analysis.py   # HCM graph builder
│   ├── objective_standards.py # determination engine
│   ├── export.py              # graph.json + whatif_engine.js serializer
│   ├── scenarios/             # ΔT + SB79 logic
│   ├── visualization/         # Folium map renderer
│   └── analysis/              # clearance time, SB99
├── static/                    # JS whatif engine + app.js
├── config/
│   ├── parameters.yaml        # CANONICAL — legal methodology spec
│   └── cities/
│       └── berkeley.yaml      # live schema example
├── output/
│   └── berkeley/              # live demo output
├── tests/                     # anti-divergence + unit tests
├── build.py                   # NEW CLI (replaces main.py)
└── docs/                      # specs, methodology, this plan

josh-pipeline (private — github.com/twgonzalez/josh-pipeline)
├── agents/
│   └── data_acquisition.py    # OSM, FHSZ, Census, Caltrans, road overrides
├── acquire.py                 # NEW CLI (acquire + geocode commands)
├── cities/                    # ALL city configs (Berkeley source + all clients)
│   ├── berkeley.yaml
│   ├── encinitas.yaml
│   ├── rsf_fire.yaml
│   ├── solana_beach.yaml
│   ├── boundaries/            # pre-built boundary GeoJSONs
│   └── *_road_overrides.yaml  # all road override files
├── projects/                  # ALL demo project YAMLs
│   ├── berkeley_demo.yaml
│   ├── encinitas_demo.yaml
│   └── rsf_fire_demo.yaml
├── data/                      # cached downloads — gitignored
└── output/                    # client deliverables — tracked
    ├── berkeley/
    ├── encinitas/
    └── rsf_fire/
```

---

## Branch Strategy

**`josh` (public):**
- `main` — untouched until refactor is complete
- `feat/refactor-v1.0` — all work; PR → main when validated

**`josh-pipeline` (private, new):**
- `main` — initialized at repo creation; this IS the first commit
- No feature branch needed; it's a new repo

---

## Phase 1 — Branch and Initialize

- [ ] Create branch `feat/refactor-v1.0` on `josh`
- [ ] Create new private repo `josh-pipeline` on GitHub
- [ ] Initialize `josh-pipeline/main` with: `pyproject.toml`, `.gitignore`, `README.md`

---

## Phase 2 — Build `josh-pipeline`

### 2a. Copy files from `josh` into `josh-pipeline`

| Source (josh) | Destination (josh-pipeline) |
|---|---|
| `agents/data_acquisition.py` | `agents/data_acquisition.py` |
| `config/cities/*.yaml` | `cities/*.yaml` |
| `config/cities/*_road_overrides.yaml` | `cities/*_road_overrides.yaml` |
| `config/cities/boundaries/` | `cities/boundaries/` |
| `config/projects/*_demo.yaml` | `projects/*_demo.yaml` |
| `config/private/cities/` | `cities/` (merge flat) |
| `config/private/cities/boundaries/` | `cities/boundaries/` (merge) |
| `config/private/projects/` | `projects/` (merge) |
| `config/private/output/` | `output/` |

### 2b. Create `acquire.py` CLI

Commands to implement:

```
acquire --city CITY [--state CA] [--refresh]
    Calls acquire_data() from data_acquisition.py
    Outputs to: ./data/{city}/

geocode --city CITY [--state CA] [--apply] [--threshold 0.5]
    Moves from main.py verbatim
    Reads project YAMLs from: ./projects/

run --city CITY [--state CA] [--refresh]
    Chains: acquire → subprocess build.py analyze → subprocess build.py demo
    Convenience wrapper for full pipeline
```

Subprocess call pattern for `run`:
```python
import subprocess, sys
subprocess.run([
    "uv", "run", "--directory", str(JOSH_DIR),
    "python", "build.py", "analyze",
    "--city", city,
    "--data-dir", str(data_dir),
    "--config", str(Path("cities") / f"{city_slug}.yaml"),
    "--params", "config/parameters.yaml",  # reads from josh public repo
], check=True)
```

`JOSH_DIR` — path to the `josh` repo checkout. Set via env var `JOSH_DIR` or a `.env` file in `josh-pipeline`.

### 2c. `pyproject.toml` for `josh-pipeline`

```toml
[project]
name = "josh-pipeline"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    # same deps as josh: geopandas, osmnx, requests, etc.
]
```

### 2d. Commit `josh-pipeline` initial state to `main`

---

## Phase 3 — Refactor `josh` Public Repo (on `feat/refactor-v1.0`)

### 3a. Create `build.py` from `main.py`

**Keep these commands (rename/update as noted):**

| Command | Change |
|---|---|
| `analyze` | Remove `acquire_data()` call. Add `--data-dir` required flag. Fail with clear message if data files missing. |
| `evaluate` | No change — pure graph operation |
| `demo` | Update path resolution: reads `--data-dir`, `--city-config` flags instead of private detection |
| `report` | Same path update as demo |

**Remove from `build.py`:**
- `geocode` command → moves to `acquire.py`
- `_is_private_city()` helper
- `_resolve_data_dir()` helper
- `_resolve_output_dir()` helper
- `_resolve_config()` helper
- All `config/private/` path logic

**New `analyze` signature:**
```
build.py analyze --city CITY --data-dir PATH [--city-config PATH] [--output-dir PATH]
```

### 3b. Remove from `josh`

- `agents/data_acquisition.py`
- `main.py`
- `config/cities/` — all except `berkeley.yaml`
- `config/projects/` — directory removed (YAMLs live in pipeline)
- `config/private/` — directory removed

### 3c. Versioning changes

**`pyproject.toml`:**
```toml
version = "1.0.0"
```

**`agents/export.py`:** Add:
```python
from importlib.metadata import version
JOSH_VERSION = version("csf-fire")   # reads from pyproject.toml
```

Add `josh_version` field to `graph.json` export:
```json
{
  "josh_version": "1.0.0",
  "parameters_version": "3.4",
  ...
}
```

**`config/parameters.yaml`:** Add explicit field (not just a comment):
```yaml
parameters_version: "3.4"
```

**`agents/visualization/demo.py`:** Add footer to `demo_map.html`:
```
JOSH v1.0.0 · Methodology v3.4 · © 2026 Thomas Gonzalez · AGPL-3.0
```

### 3d. Keep in `josh` (no changes)

- `config/cities/berkeley.yaml` — schema example, stays canonical here
- `config/parameters.yaml` — canonical legal methodology, stays here
- `output/berkeley/` — live demo, regenerated during validation
- `static/` — JS engine, unchanged
- `tests/` — anti-divergence tests, unchanged
- `docs/` — all methodology docs, unchanged

### 3e. Update docs

- `CLAUDE.md` — rewrite: run commands, directory structure, private city section, two-repo setup
- `README.md` — update setup instructions (clone josh, clone josh-pipeline separately)
- Remove `ARCHITECTURE.md` private city infrastructure section (now in josh-pipeline docs)

---

## Phase 4 — Validation

Run full pipeline end-to-end before merging:

```bash
# Step 1: Acquire (josh-pipeline)
cd josh-pipeline
uv run python acquire.py --city "Berkeley" --refresh

# Step 2: Build graph (josh, feat/refactor-v1.0)
cd ../josh
uv run python build.py analyze \
  --city "Berkeley" \
  --data-dir ../josh-pipeline/data/berkeley

# Step 3: Generate demo map
uv run python build.py demo --city "Berkeley"

# Step 4: Anti-divergence test
node --test tests/test_whatif_engine.js

# Step 5: Verify outputs
# - output/berkeley/demo_map.html opens, works, shows footer
# - Footer: "JOSH v1.0.0 · Methodology v3.4"
# - graph.json contains josh_version + parameters_version fields
# - No broken imports, no references to data_acquisition in josh
```

Also validate a private city through `josh-pipeline`:
```bash
cd josh-pipeline
uv run python acquire.py --city "Encinitas"
uv run python acquire.py --city "rsf_fire"
# Confirm both produce valid data/ directories
```

---

## Phase 5 — Merge and Publish

1. PR `feat/refactor-v1.0` → `main` on `josh`
2. Tag `v1.0.0` on `josh` after merge: `git tag v1.0.0 && git push origin v1.0.0`
3. Push `josh-pipeline` to GitHub (already on `main`)
4. Archive `josh-private` repo on GitHub (Settings → Archive)
5. Verify GitHub Pages still serves `static/v1/app.js` from `josh`
6. Regenerate all city demo maps through `josh-pipeline` run command

---

## What Does NOT Change

- `static/whatif_engine.js` generation logic
- `static/v1/app.js` content or CDN URL
- `_APP_JS_VERSION = "v1"` — no schema change
- Existing `demo_map.html` files already delivered to cities — still work
- The methodology, parameters, or any ΔT calculations
- Berkeley demo output path (`output/berkeley/demo_map.html`)

---

## Post-Refactor Run Commands (CLAUDE.md update)

### Public repo (`josh`)
```bash
# Build graph from pre-acquired data
uv run python build.py analyze --city "Berkeley" --data-dir /path/to/data/berkeley

# Generate demo map
uv run python build.py demo --city "Berkeley"

# Evaluate a project
uv run python build.py evaluate --city "Berkeley" --lat 37.87 --lon -122.27 --units 75

# Anti-divergence test
node --test tests/test_whatif_engine.js
```

### Private repo (`josh-pipeline`)
```bash
# Download city data
uv run python acquire.py --city "Berkeley"

# Geocode project coordinates
uv run python acquire.py geocode --city "Berkeley" --apply

# Full pipeline (acquire + build + demo)
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Berkeley"
```
