# Project Manager + Brief Renderer — Full Phased Plan

**Prepared:** 2026-04-09  
**Supersedes:** `docs/plan-project-manager.md` (v1 — archived for reference)  
**Repos affected:** `josh` (public) + `josh-pipeline` (private)

---

## Guiding Principles

1. **JS is the single source of truth for brief HTML.** `static/brief_renderer.js` is the template. Python calls it via Node subprocess; the browser uses it directly. No parallel Python/JS templates to keep in sync.
2. **BriefInput is the contract.** A versioned JSON schema is the interface between the Python adapter and the JS renderer. Both sides must agree on it. Schema changes are explicit and versioned.
3. **Each phase ships working software.** No phase leaves the pipeline broken or the demo map missing features it had before.
4. **Both repos stay in sync.** Every phase that touches rendering ends with a full rebuild of all active cities in josh-pipeline.

---

## Architecture: Before vs. After

### Before

```
Python audit dict
  └─ brief_v3.py (~1,400 lines Python HTML templates)
       └─ brief_v3_*.html (output)

Browser
  └─ WhatIfEngine result
       └─ compact summary only (no brief)
```

### After

```
Python audit dict
  └─ brief_v3.py (~150 lines — schema adapter + Node caller)
       └─ BriefInput JSON ──────────────────────────────────┐
                                                             ▼
Browser                                          static/brief_renderer.js
  └─ WhatIfEngine result                           (single JS template)
       └─ project_manager.js builds BriefInput ──────────────┘
            └─ BriefRenderer.render() → HTML
                 └─ joshBrief.show() → modal
```

---

## The BriefInput Contract

This is the interface that must not change without bumping `brief_input_version`.
Python builds it from the audit dict. The browser builds it from WhatIfEngine result + project manager fields.

```json
{
  "brief_input_version": 1,
  "source": "pipeline",
  "city_name": "Berkeley",
  "city_slug": "berkeley",
  "case_number": "JOSH-2026-ACTON-37_8651-122_2743",
  "eval_date": "2026-04-09",
  "project": {
    "name": "Acton St Apartments",
    "address": "2525 Acton St, Berkeley",
    "lat": 37.8651,
    "lon": -122.2743,
    "units": 75,
    "stories": 4,
    "apn": ""
  },
  "result": {
    "tier": "DISCRETIONARY",
    "hazard_zone": "vhfhsz",
    "project_vehicles": 168.75,
    "max_delta_t_minutes": 8.5,
    "serving_paths_count": 2,
    "parameters_version": "4.0",
    "analyzed_at": "2026-04-09T10:30:00Z",
    "paths": [
      {
        "path_id": "project_origin_49171047_0",
        "bottleneck_osmid": "12345",
        "bottleneck_name": "Telegraph Ave",
        "bottleneck_fhsz_zone": "vhfhsz",
        "bottleneck_hcm_capacity_vph": 1800,
        "bottleneck_eff_cap_vph": 630.0,
        "bottleneck_road_type": "two_lane",
        "bottleneck_speed_mph": 35,
        "bottleneck_lanes": 2,
        "delta_t_minutes": 8.5,
        "threshold_minutes": 2.25,
        "safe_egress_window_minutes": 45.0,
        "max_project_share": 0.05,
        "flagged": true,
        "project_vehicles": 168.75,
        "egress_minutes": 6.0
      }
    ]
  },
  "parameters": { }
}
```

**`source` field drives the brief watermark:**
- `"pipeline"` → full official brief, no disclaimer
- `"whatif"` → yellow banner at top: "What-If Estimate — Not a Legal Determination"

**Optional fields:** `apn`, `bottleneck_name`, `bottleneck_hcm_capacity_vph`, `bottleneck_road_type`, `bottleneck_speed_mph`, `bottleneck_lanes` may be `null` or absent. `brief_renderer.js` degrades gracefully (omits the legal authority HCM detail row if raw capacity unavailable; shows osmid if name is null).

---

## Phase 0: Data Foundation

**Goal:** Add the fields all later phases depend on. No new UX. Pipeline output is functionally identical.

### josh (public) changes

**`agents/export.py` — `export_graph_json()`**

Add three fields to each exported edge by joining from `roads_gdf` on `osmid` (same pattern as the existing `eff_cap_vph` / `fhsz_zone` join):

| New field | Source column | Fallback |
|---|---|---|
| `name` | `roads_gdf["name"]` (OSM name tag) | `null` |
| `road_type` | `roads_gdf["road_type"]` | `null` |
| `lanes` | `roads_gdf["lane_count"]` | `null` |

`speed_mph` is already on the edge. These three additions give `brief_renderer.js` (Phase 2) enough data to populate the legal authority HCM detail row without back-derivation.

**`agents/visualization/demo.py` — `_inject_josh_data_bundle()` and `create_demo_map()`**

Add `city_name` and `city_slug` to `window.JOSH_DATA`:

```python
# In create_demo_map(), derive from city_config and output_path:
city_slug = output_path.parent.name
city_name = city_config.get("city_name", city_config.get("name", city_config.get("city", "City")))

# Pass both to _inject_josh_data_bundle()
```

Add to the `josh_data` dict:
```python
"city_slug": city_slug,
"city_name": city_name,
```

No `schema_version` bump — both fields are additive. `project_manager.js` (Phase 1) and `brief_renderer.js` (Phase 2) both read these.

### josh-pipeline (private) changes

Rebuild all active cities to pick up the new edge fields and JOSH_DATA keys:

```bash
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Berkeley"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Encinitas"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Del Mar"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Solana Beach"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "RSF Fire"
```

**Verification:** Open `output/berkeley/demo_map.html`, run in browser console:
```javascript
JOSH_DATA.city_name      // "Berkeley"
JOSH_DATA.city_slug      // "berkeley"
JOSH_DATA.graph.edges[0] // check for .name, .road_type, .lanes fields
```

Briefs and map behavior are unchanged.

---

## Phase 1: Project Manager — CRUD + File Persistence

**Goal:** Users can create, save, edit, delete, and persist what-if projects as local files across browser sessions. Determination results shown as compact inline summaries (tier + ΔT). No full brief yet — that is Phase 3.

### josh (public) changes

**`agents/visualization/demo.py` — `_build_whatif_ui_js()`**

Add two functions to the what-if controller IIFE and export them on `window.joshWhatIf`:

```javascript
function startDropPinForProject(onPlaced) {
  cancelDropPin();
  _dropPinActive = true;
  var map = _getMap();
  if (!map) return;
  _origCursor = map.getContainer().style.cursor;
  map.getContainer().style.cursor = 'crosshair';
  map.once('click', function(e) {
    _dropPinActive = false;
    map.getContainer().style.cursor = _origCursor;
    onPlaced(e.latlng.lat, e.latlng.lng);
  });
}
function cancelExternalDropPin() { cancelDropPin(); }
```

Ensure `closePanel` is also in the export (needed for mutual-hide).

In `openPanel()`, add before showing the panel:
```javascript
if (window.joshPM && window.joshPM.closePanel) { window.joshPM.closePanel(); }
```

**`agents/visualization/demo.py` — `_inject_josh_data_bundle()`**

After `app_block`, load and inline `static/project_manager.js`:
```python
pm_path = STATIC_DIR / "project_manager.js"
pm_js = pm_path.read_text(encoding="utf-8") if pm_path.exists() else ""
pm_block = f'<script id="josh-pm">\n{pm_js}\n</script>' if pm_js else ""
# Insert pm_block after app_block in injection string
```

Graceful degradation: if `project_manager.js` does not exist, `pm_block` is empty and the map works normally.

**`static/project_manager.js`** — NEW hand-written file

Single IIFE exposing `window.joshPM`. Sections:

```
1. Constants      SCHEMA_V=1, STORAGE_KEY_PREFIX
2. State          _projects=[], _fileHandle=null, _dirty=false, _editingId=null, _pmMarker=null
3. localStorage   _saveToCache(), _loadFromCache()
4. FSAPI          _saveToFile(), _loadFromFile(), _linkOrSaveFile()
5. Fallback       Blob download / <input file> for non-FSAPI browsers
6. CRUD           createProject(), updateProject(), deleteProject(), getProject()
7. YAML           _toYaml(), _downloadYaml()
8. Import         _importFromJson() — dedup by id, city-slug warning, schema migration
9. Map markers    _showPmMarker(), _clearPmMarker() — solid circle L.divIcon
10. Analysis      _runAnalysis(id) — calls WhatIfEngine.evaluateProject(), saves result
11. UI            _renderPanel(), _renderListView(), _renderFormView(id)
12. Events        Drop-pin routes through joshWhatIf.startDropPinForProject()
13. Mutual-hide   openPanel() calls joshWhatIf?.closePanel?.()
14. Init          DOMContentLoaded: _renderPanel(), _loadFromCache(), _renderListView()
15. Public API    window.joshPM = { openPanel, closePanel, getProjects }
```

**Persistence model:**
- **FSAPI** (Chrome/Edge): user picks a file once per session; all mutations write silently. `_fileHandle` held in memory — not persisted to localStorage (browser security constraint; user re-links each session via "Load File").
- **Fallback** (Firefox/Safari): "Save File" triggers a Blob download; "Load File" uses `<input type=file>`.
- **localStorage**: session-restore cache only. Written on every mutation. `_dirty` flag drives the `[● unsaved]` header indicator.

**Panel layout:**

```
╔════════════════════════════════════════════╗
║  Saved Projects (3)  [● unsaved]   [✕]    ║  ← draggable header
╠════════════════════════════════════════════╣
║  [+ New]   [↓ Save File]  [↑ Load File]   ║
╠════════════════════════════════════════════╣
║  ● Acton St Apts       MIN  [▶] [✏] [🗑] ║
║  ● Telegraph Highrise DISC  [▶] [✏] [🗑] ║
║  ○ Untitled             —   [▶] [✏] [🗑] ║
╠════════════════════════════════════════════╣
║  [⬇ Export YAML for pipeline]             ║
╚════════════════════════════════════════════╝
```

Result display after running analysis (compact — no brief modal yet):
- Tier badge (colored)
- Max ΔT / threshold / FHSZ zone / flagged path count
- Disclaimer: "What-if estimate only"

**`tests/test_project_manager.js`** — NEW test file

Shims for `window`, `localStorage`, `crypto.randomUUID`, `JOSH_DATA`. Tests:
1. Storage key uses `JOSH_DATA.city_slug`
2. `createProject` → `_loadFromCache` round-trip
3. `updateProject` merges fields and updates `updated_at`
4. `deleteProject` removes record
5. `_importFromJson` deduplicates by `id`
6. `_importFromJson` warns but continues on city_slug mismatch
7. `_migrate` is no-op for `schema_v: 1`
8. `_toYaml` omits projects with `lat: null`
9. `_toYaml` maps `lng` → `lon`

Run: `node --test tests/test_project_manager.js`

### josh-pipeline (private) changes

Rebuild all cities to pick up the new panel JS.

**Smoke test checklist:**
1. "Saved Projects" FAB visible; opening it closes what-if panel (and vice versa).
2. New project: drop pin → run analysis → tier badge appears.
3. Saved project survives page reload (localStorage cache).
4. Save File (FSAPI in Chrome): native dialog → file written → `[● unsaved]` clears.
5. Load File: round-trip from file restores all projects.
6. Export YAML: downloads, opens cleanly in text editor, `lon` not `lng`.

---

## Phase 2: Brief Renderer — JS as Single Source of Truth

**Goal:** Eliminate the ~1,400-line Python HTML template in `brief_v3.py`. Replace with `static/brief_renderer.js` (JS template). Python becomes a thin adapter that builds BriefInput and calls Node. Browser uses the same JS file directly. One template, two callers.

### josh (public) changes

**`static/brief_renderer.js`** — NEW hand-written file

UMD module (works in browser and Node):

```javascript
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node CLI: read BriefInput from stdin, write HTML to stdout
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    var raw = '';
    process.stdin.on('data', function(d) { raw += d; });
    process.stdin.on('end', function() {
      process.stdout.write(factory().render(JSON.parse(raw)));
    });
  } else {
    root.BriefRenderer = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {

  function render(inp) { /* ... */ }

  // Internal renderers — direct ports of brief_v3.py functions:
  // _buildCss(tier)
  // _buildHeader(inp)
  // _buildSummaryStats(inp)
  // _buildControllingFinding(inp)
  // _buildStandardsAnalysis(inp)
  // _buildDeterminationBox(inp)
  // _buildConditions(inp)        — static text by tier + fhsz_level
  // _buildLegalAuthority(inp)    — citation table, dynamic values from inp.parameters
  // _buildAppealRights(inp)      — static text, city_name interpolated
  // _buildWhatIfBanner(inp)      — shown if inp.source === "whatif"
  // _wrapHtml(title, body)

  return { render };
}));
```

This is a line-for-line port of `brief_v3.py`'s render functions. All static text (conditions, citations, appeal rights boilerplate) lives here and nowhere else.

**`agents/visualization/brief_v3.py`** — REFACTORED (~150 lines, down from ~1,400)

```python
# Keeps only:

def create_determination_brief_v3(project, audit, config, city_config, output_path):
    """Public API — unchanged signature."""
    brief_input = _build_brief_input(project, audit, config, city_config)
    html = _call_brief_renderer(brief_input)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
    return output_path

def _build_brief_input(project, audit, config, city_config) -> dict:
    """Adapter: Python audit dict → BriefInput schema.
    This is the only place that knows about the Python audit dict structure."""
    # Maps audit["scenarios"]["wildland_ab747"]["steps"]["step5_delta_t"]["path_results"][i]
    # → BriefInput["result"]["paths"][i] flat schema
    ...

def _call_brief_renderer(brief_input: dict) -> str:
    """Run static/brief_renderer.js via Node, pipe BriefInput JSON in, return HTML."""
    import subprocess, json
    result = subprocess.run(
        ["node", str(_BRIEF_RENDERER_PATH)],
        input=json.dumps(brief_input),
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"brief_renderer.js failed: {result.stderr}")
    return result.stdout

_BRIEF_RENDERER_PATH = Path(__file__).parent.parent.parent / "static" / "brief_renderer.js"
```

The `_build_brief_input()` function contains all the schema mapping logic — it is the adapter. The `_call_brief_renderer()` function is ~10 lines and never changes.

**`agents/visualization/demo.py` — `_inject_josh_data_bundle()`**

Inline `static/brief_renderer.js` before `project_manager.js`. This makes it available to `project_manager.js` in Phase 3:

```python
br_path = STATIC_DIR / "brief_renderer.js"
br_js = br_path.read_text(encoding="utf-8") if br_path.exists() else ""
br_block = f'<script id="josh-br">\n{br_js}\n</script>' if br_js else ""
# Insert: app_block → br_block → pm_block → footer_block
```

**`agents/visualization/demo.py` — `_build_brief_modal_js()` or `app.js` generation**

`joshBrief.show()` currently expects a filename to look up in `JOSH_DATA.briefs`. Extend it to also accept an HTML string directly (for Phase 3 project manager use):

```javascript
show: function(filenameOrHtml) {
  // If it looks like HTML (starts with < or is not a key in JOSH_DATA.briefs), treat as HTML string
  var html = (window.JOSH_DATA && window.JOSH_DATA.briefs && window.JOSH_DATA.briefs[filenameOrHtml])
    ? window.JOSH_DATA.briefs[filenameOrHtml]
    : filenameOrHtml;
  iframe.srcdoc = html;
  overlay.style.display = 'block';
}
```

Existing behavior (filename lookup) is unchanged. New behavior (direct HTML string) adds Phase 3 capability.

**`.github/workflows/deploy-demo.yml`**

Add Node setup before the Python steps:

```yaml
- name: Set up Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
```

Required because `build.py demo` now calls `brief_v3.py` → `node static/brief_renderer.js`.

**`tests/test_brief_renderer.js`** — NEW test file

Tests (no DOM shim needed — brief_renderer.js has no DOM dependencies):
1. `render()` does not throw for tier = MINISTERIAL
2. `render()` does not throw for tier = MINISTERIAL WITH STANDARD CONDITIONS
3. `render()` does not throw for tier = DISCRETIONARY
4. MINISTERIAL output omits the ΔT stats block
5. DISCRETIONARY output contains the flagged path table
6. `source: "whatif"` adds the what-if banner; `source: "pipeline"` does not
7. `city_name` appears in header output
8. Missing optional fields (apn, bottleneck_name, bottleneck_hcm_capacity_vph) do not throw
9. Case number appears in `<title>` tag

Run: `node --test tests/test_brief_renderer.js`

**Regression test during Phase 2:**

Before deleting the old `brief_v3.py` template code, run the pipeline for Berkeley and diff the generated brief against the pre-Phase-2 version:

```bash
# Capture old output first (before refactor)
cp output/berkeley/brief_v3_*.html /tmp/brief_before.html

# After refactor and rebuild:
uv run python build.py analyze --city "Berkeley" --data-dir data/berkeley
uv run python build.py demo --city "Berkeley" --data-dir data/berkeley --projects projects/berkeley_demo.yaml

# Diff
diff /tmp/brief_before.html output/berkeley/brief_v3_*.html
```

Structural differences are acceptable (whitespace, minor formatting). Content differences in determination text, ΔT values, or legal citations are not. Resolve all content diffs before committing.

### josh-pipeline (private) changes

1. **Confirm Node in CI** — check josh-pipeline's GitHub Actions workflow. Add `actions/setup-node@v4` if absent (same pattern as josh public).
2. Rebuild all cities. This exercises `brief_v3.py → Node → brief_renderer.js` for every project in every city.
3. Diff at least one brief per city (pre/post) to confirm content parity.
4. Commit all regenerated output files.

---

## Phase 3: Brief Integration in Project Manager + YAML Export

**Goal:** "View Report" button in project manager opens a full brief in the existing modal. YAML export for pipeline integration.

### josh (public) changes

**`static/project_manager.js`** — MODIFIED

1. After running analysis, replace the compact summary with a compact summary **plus** a "View Report" button.

2. Button handler:
   ```javascript
   function _openBrief(project, result) {
     var briefInput = _buildBriefInput(project, result);
     var html = window.BriefRenderer.render(briefInput);
     window.joshBrief.show(html);
   }

   function _buildBriefInput(project, result) {
     var citySlug = (window.JOSH_DATA || {}).city_slug || 'unknown';
     var cityName = (window.JOSH_DATA || {}).city_name || 'City';
     var latStr = project.lat.toFixed(4).replace('.','_').replace('-','n');
     var lonStr = project.lng.toFixed(4).replace('.','_').replace('-','n');
     var projSlug = (project.name || '').toUpperCase().replace(/\s+/g,'-').slice(0,20);
     var caseNum = projSlug
       ? 'JOSH-' + new Date().getFullYear() + '-' + projSlug + '-' + latStr + '-' + lonStr
       : 'JOSH-' + new Date().getFullYear() + '-' + latStr + '-' + lonStr;

     // Enrich paths with edge name/road_type/lanes from graph if available
     var edgeMap = _buildEdgeMap();   // Map<osmid, {name, road_type, lanes, speed_mph, eff_cap_vph}>
     var enrichedPaths = (result.paths || []).map(function(p) {
       var edge = edgeMap.get(String(p.bottleneckOsmid)) || {};
       return Object.assign({}, p, {
         bottleneck_osmid:          p.bottleneckOsmid,
         bottleneck_name:           edge.name || null,
         bottleneck_fhsz_zone:      p.bottleneckFhszZone,
         bottleneck_eff_cap_vph:    p.bottleneckEffCapVph,
         bottleneck_road_type:      edge.road_type || null,
         bottleneck_speed_mph:      edge.speed_mph || null,
         bottleneck_lanes:          edge.lanes || null,
         delta_t_minutes:           p.delta_t_minutes,
         threshold_minutes:         p.threshold_minutes,
         safe_egress_window_minutes: p.threshold_minutes / ((window.JOSH_DATA.parameters || {}).max_project_share || 0.05),
         max_project_share:         (window.JOSH_DATA.parameters || {}).max_project_share || 0.05,
         flagged:                   p.flagged,
         project_vehicles:          p.project_vehicles,
         egress_minutes:            p.egress_minutes,
       });
     });

     return {
       brief_input_version: 1,
       source:              'whatif',
       city_name:           cityName,
       city_slug:           citySlug,
       case_number:         caseNum,
       eval_date:           new Date().toISOString().slice(0,10),
       project: {
         name:    project.name    || '',
         address: project.address || '',
         lat:     project.lat,
         lon:     project.lng,
         units:   project.units,
         stories: project.stories,
         apn:     '',
       },
       result: {
         tier:                  result.tier,
         hazard_zone:           result.hazard_zone,
         project_vehicles:      result.project_vehicles,
         max_delta_t_minutes:   result.max_delta_t_minutes,
         serving_paths_count:   result.serving_paths_count,
         parameters_version:    result.parameters_version,
         analyzed_at:           result.built_at,
         paths:                 enrichedPaths,
       },
       parameters: (window.JOSH_DATA || {}).parameters || {},
     };
   }

   function _buildEdgeMap() {
     var map = new Map();
     ((window.JOSH_DATA || {}).graph || {edges:[]}).edges.forEach(function(e) {
       map.set(String(e.osmid), e);
     });
     return map;
   }
   ```

3. YAML export — "Export YAML for pipeline" footer button. Already in Phase 1 plan for the data model; implement the actual download handler here. Generates `{city_slug}_demo.yaml` with a header comment showing the `acquire.py run` command.

**`tests/test_project_manager.js`** — MODIFIED

Add test cases:
- `_buildBriefInput` produces correct `source: "whatif"` and `case_number` format
- `_toYaml` produces valid YAML structure for a multi-project list

### josh-pipeline (private) changes

Rebuild all cities. Smoke-test the "View Report" button on a project manager what-if project in Chrome.

---

## Phase 4: Tests, CI Hardening, and Cleanup

**Goal:** Full test coverage, all cities regenerated, documentation reflects new architecture.

### josh (public) changes

**Full `node --test` suite must pass:**
```bash
node --test tests/test_whatif_engine.js     # existing
node --test tests/test_project_manager.js   # Phase 1
node --test tests/test_brief_renderer.js    # Phase 2
```

**`.github/workflows/deploy-demo.yml`** — add test step:
```yaml
- name: Run JS tests
  run: |
    node --test tests/test_whatif_engine.js
    node --test tests/test_brief_renderer.js
```

(test_project_manager.js has DOM dependencies that are harder to run in CI without a shim — run locally for now; add to CI in a follow-on.)

**`CLAUDE.md`** — update:
- `static/` directory table: add `brief_renderer.js` as hand-written
- "REQUIRED after any change to" list: add `static/brief_renderer.js` (must regenerate all cities)
- Note: `brief_v3.py` is now a thin adapter; edit `static/brief_renderer.js` for template changes
- Setup instructions: Node ≥ 20 required (already implied by test commands)

**`docs/`:**
- Archive old plan: `docs/archive/plan-project-manager-v1.md`
- This document (`plan-project-manager-v2.md`) is the authoritative reference

### josh-pipeline (private) changes

Final rebuild of all cities. Commit all output files. Confirm CI passes (Node available, briefs generate correctly).

---

## File Change Summary

### josh (public)

| File | Phase | Change |
|---|---|---|
| `agents/export.py` | 0 | Add `name`, `road_type`, `lanes` to edge export; add `city_name`/`city_slug` to JOSH_DATA |
| `agents/visualization/demo.py` | 0, 1, 2, 3 | city_name/slug params; drop-pin API; extend `joshBrief.show`; inline 3 JS files |
| `agents/visualization/brief_v3.py` | 2 | Refactor: 1,400 → ~150 lines; becomes adapter + Node caller |
| `static/brief_renderer.js` | 2 | **NEW** — JS-first brief template; single source of truth |
| `static/project_manager.js` | 1, 3 | **NEW** — CRUD, FSAPI persistence, YAML export, brief button |
| `static/v1/app.js` | (generated) | Rebuilt each phase via `demo` command |
| `tests/test_project_manager.js` | 1, 3 | **NEW** — storage, CRUD, import/export, BriefInput tests |
| `tests/test_brief_renderer.js` | 2 | **NEW** — render correctness for all tiers, optional field handling |
| `.github/workflows/deploy-demo.yml` | 2, 4 | Add `setup-node@v4`; add test step in Phase 4 |

### josh-pipeline (private)

| Action | Phase |
|---|---|
| Rebuild all cities | 0 — picks up edge fields + JOSH_DATA fields |
| Rebuild all cities | 1 — picks up project_manager.js |
| Confirm Node in CI workflow | 2 — add `setup-node` if absent |
| Rebuild all cities + diff briefs | 2 — validates brief_v3.py refactor |
| Rebuild all cities | 3, 4 — picks up brief modal + cleanup |

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `brief_renderer.js` output differs from old `brief_v3.py` | Diff test against saved reference output before deleting old Python template code |
| Node not available in josh-pipeline CI | Add `actions/setup-node@v4` in Phase 2; document as hard requirement |
| Edge `name` null for many OSM roads | `brief_renderer.js` falls back to osmid display; brief still renders |
| `_build_brief_input()` mapping errors (Python audit dict schema drift) | The adapter is ~60 lines, well-tested; any Python audit dict changes that break it are surfaced immediately at `demo` time |
| FSAPI not supported in Firefox/Safari | Blob download fallback already in Phase 1 |
| `FileSystemFileHandle` not persisted across sessions | Documented as known behavior (browser security constraint); "Load File" re-links each session |
| `BriefInput` schema changes in future | `brief_input_version` field gates migration; bump and add adapter in `_build_brief_input()` |
| Phase 2 Node subprocess adds latency to `demo` command | `subprocess.run` with `timeout=10`; brief generation is ~50ms per project in practice |
