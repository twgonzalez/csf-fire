# JOSH Demo Map — UX Redesign Implementation Plan v2
**Prepared:** 2026-04-09
**Design spec:** `docs/ux-spec-v2.md`
**Supersedes:** `docs/plan-ux-redesign-v1.md` (archived — Phase 1 label changes shipped in
commit 6cf015b; Phases 2–4 replaced by this plan)

---

## What We Are Building

A fixed left sidebar that is the single entry point for all project work. No FABs. No
floating panels. No distinction between "official" and "what-if" projects. Every project
gets full AntPath route animation, per-route ΔT detail, and a determination brief.
Projects persist as JSON files on disk via the OS file system; the app is not a file manager.

---

## What Gets Retired

| Retired | Replaced by |
|---|---|
| `static/project_manager.js` | `static/sidebar.js` |
| What-if FAB + floating panel (in `demo.py`) | Sidebar form state |
| Saved Analyses FAB + floating panel (`project_manager.js`) | Sidebar project list |
| Top-right official project panel (Folium-generated HTML) | Sidebar detail card |
| `window.joshWhatIf`, `window.joshPM` | `window.joshSidebar` |
| localStorage project storage | FSAPI files + IndexedDB handles |

**Not touched:** `brief_renderer.js`, `whatif_utils.js`, `brief_v3.py`, `parameters.yaml`,
all Python analysis code below `agents/export.py`.

---

## Architecture After Redesign

```
demo_map.html
├── window.JOSH_DATA          (inlined — graph+edges+geometry, parameters, FHSZ,
│                              seed projects with full path coords — NEW in Phase 1)
├── window.WhatIfEngine       (inlined — Dijkstra + ΔT + geometry extraction — UPDATED Phase 1)
├── window.BriefRenderer      (inlined from brief_renderer.js — unchanged)
├── window.joshBrief          (inlined from demo.py — modal overlay, unchanged)
└── window.joshSidebar        (inlined from sidebar.js — NEW Phase 2, replaces joshWhatIf + joshPM)
    ├── Project list (all projects, compact rows)
    ├── Detail card (selected project — tier, routes, ΔT, buttons)
    ├── Form (New/Edit — name, units, stories, pin)
    └── FSAPI I/O (open, save, IndexedDB handle storage)

Folium-generated map content (Phase 3 — partially retired):
  - Road network heatmap FeatureGroups          ← KEPT
  - FHSZ GeoJSON overlay                        ← KEPT
  - Seed project AntPath FeatureGroups          ← RETIRED (sidebar draws all routes)
  - Top-right project panel + dropdown          ← RETIRED (sidebar replaces)
  - Both FAB buttons                            ← RETIRED (sidebar always visible)
```

---

## Phased Build Plan

### Phase 1 — Data Foundation (export.py + WhatIfEngine)

**Goal:** Two parallel changes that everything else depends on:

1. Add edge geometry to `JOSH_DATA.graph` so the JS engine can draw real road curves
2. Add `JOSH_DATA.projects` so the sidebar can initialize with seed project data

**Why first:** Phase 2 (sidebar module) needs `JOSH_DATA.projects` to write S1 tests
against real data. Phase 3 (map integration) needs `path_coords` to draw AntPaths.
Neither can be properly built or tested without this foundation.

**Files:** `agents/export.py`, `static/whatif_engine.js` (algorithm strings live in
`agents/export.py` — editing one regenerates the other)

---

#### 1a. Add `geom` to JOSH_DATA graph edges

**What was found:** `export.py` serializes edges with `u`, `v`, `osmid`, `len_m`,
`speed_mph`, `eff_cap_vph`, `fhsz_zone`, `haz_deg`, `name`, `road_type`, `lanes` only.
Shapely LineString geometry is not included. The WhatIfEngine builds `path_coords` from
node positions only (confirmed at lines 231–233: `pathNodes.map(id => [p.lat, p.lon])`).
All JS routes are currently straight lines.

**Change in export.py — edge serialization loop:**

```python
# After existing edge fields, add:
geom_coords = None
if "geometry" in edge_data:
    geom = edge_data["geometry"]
    # Transform from graph CRS to WGS84 in-place (reuse existing _to_wgs84 transformer)
    geom_coords = [
        [round(lat, 5), round(lon, 5)]
        for lon, lat in (_to_wgs84.transform(x, y) for x, y in geom.coords)
    ]
edge_entry["geom"] = geom_coords  # None when no geometry stored on this edge
```

Coordinates stored at 5-decimal precision (~1m accuracy). `None` for edges without
stored geometry (rare — OSMnx stores geometry on all non-trivial edges).

**Size estimate:** ~1.5 MB per city added to JOSH_DATA. Acceptable for a self-contained
file delivered to city planners on desktop browsers.

---

#### 1b. Update WhatIfEngine `path_coords` to use `edge.geom`

**What was found:** The JS engine already returns `path_coords: [[lat, lon], ...]` on
each path object (field exists, flows through the full result chain). It just needs to be
built from `edge.geom` instead of node positions.

**Change in WhatIfEngine JS (in `agents/export.py` JS string):**

Replace the node-map lookup at lines 231–233:
```js
// BEFORE (node positions only — straight lines):
const pathCoords = pathNodes
  .map(id => { const p = _nodeMap.get(id); return p ? [p.lat, p.lon] : null; })
  .filter(c => c !== null);
```

With geometry-aware chaining (mirrors `wildland.py` lines 518–561):
```js
// AFTER (full edge geometry — follows actual road):
const pathCoords = [];
for (let i = 0; i < pathEdges.length; i++) {
  const edge = pathEdges[i];
  if (!edge.geom) {
    // Fallback: node endpoints only
    if (i === 0) {
      const u = _nodeMap.get(pathNodes[i]);
      if (u) pathCoords.push([u.lat, u.lon]);
    }
    const v = _nodeMap.get(pathNodes[i + 1]);
    if (v) pathCoords.push([v.lat, v.lon]);
    continue;
  }
  // Direction check: is geom[0] closer to the source node or dest node?
  const src = _nodeMap.get(pathNodes[i]);
  let coords = edge.geom;
  if (src) {
    const d0 = (coords[0][0]-src.lat)**2 + (coords[0][1]-src.lon)**2;
    const dN = (coords[coords.length-1][0]-src.lat)**2 + (coords[coords.length-1][1]-src.lon)**2;
    if (dN < d0) coords = [...coords].reverse();
  }
  // Chain: skip first point (duplicate junction) except on first segment
  const start = pathCoords.length > 0 ? 1 : 0;
  for (let j = start; j < coords.length; j++) pathCoords.push(coords[j]);
}
```

**`pathEdges`** is already tracked during Dijkstra path reconstruction (`prev.set(edge.v,
{ from: u, edge })`). The `edge` object now has `edge.geom` from step 1a.

---

#### 1c. Add `JOSH_DATA.projects` array

**What was found:** JOSH_DATA currently has no `projects` field. Seed projects are baked
as Folium FeatureGroup calls (AntPath JS, popup HTML, markers) directly in the HTML.
No project data is available to JS at runtime. The sidebar cannot initialize from it.

**Change in `export.py` / `demo.py` — add projects to JOSH_DATA bundle:**

```python
# In the function that builds the JOSH_DATA dict (currently in demo.py):
josh_data["projects"] = [
    _build_josh_data_project(project, scenario_result, path_results)
    for project, scenario_result, path_results in seed_project_triples
]
```

Each project entry:
```python
def _build_josh_data_project(project, scenario_result, path_results):
    return {
        "id":         _make_slug(project.name),
        "name":       project.name,
        "address":    project.address or "",
        "lat":        project.lat,
        "lng":        project.lon,   # note: project uses .lon, file format uses .lng
        "units":      project.units,
        "stories":    project.stories,
        "source":     "pipeline",
        "city_slug":  project.city_slug,
        "parameters_version": params["parameters_version"],
        "result": {
            "tier":               scenario_result.tier,
            "hazard_zone":        scenario_result.hazard_zone,
            "in_fire_zone":       scenario_result.in_fire_zone,
            "project_vehicles":   round(scenario_result.project_vehicles, 1),
            "egress_minutes":     round(scenario_result.egress_minutes, 1),
            "delta_t_threshold":  round(scenario_result.delta_t_threshold, 4),
            "paths": [
                {
                    "route_id":                   p["path_id"],
                    "delta_t":                    p["delta_t_minutes"],
                    "flagged":                    p["flagged"],
                    "bottleneck_osmid":           p["bottleneck_osmid"],
                    "bottleneck_name":            p["bottleneck_name"],
                    "bottleneck_road_type":       p["bottleneck_road_type"],
                    "bottleneck_lanes":           p["bottleneck_lane_count"],
                    "bottleneck_speed":           p["bottleneck_speed_limit"],
                    "effective_capacity_vph":     p["bottleneck_effective_capacity_vph"],
                    "hazard_degradation_factor":  p["bottleneck_hazard_degradation"],
                    "coordinates":                p["path_wgs84_coords"],  # [lat,lon] list
                }
                for p in path_results
            ],
        },
        "brief_cache": brief_html_string,  # pre-rendered by BriefRenderer at pipeline time
    }
```

`path_wgs84_coords` is already computed by `wildland.py` and present in every
`path_result` dict from `base.py compute_delta_t()`. No new Python analysis required.

---

#### 1d. Surface bottleneck metadata in WhatIfEngine return

**What was found:** The JS engine currently returns only `bottleneckOsmid`,
`bottleneckEffCapVph`, `bottleneckFhszZone` per path. The detail card and brief need
`name`, `road_type`, `lanes`, `speed`, `hazard_degradation_factor` — all available
from `JOSH_DATA.graph.edges` by osmid lookup.

**Change in WhatIfEngine serving-path object:**

```js
// After identifying bottleneck edge:
const bnEdge = _edgeMap.get(String(bottleneckOsmid)); // Map built at init
return {
  ...existing fields...,
  path_coords:                pathCoords,           // renamed from path_coords (no change)
  bottleneck_name:            bnEdge?.name ?? '',
  bottleneck_road_type:       bnEdge?.road_type ?? '',
  bottleneck_lanes:           bnEdge?.lanes ?? 0,
  bottleneck_speed:           bnEdge?.speed_mph ?? 0,
  hazard_degradation_factor:  bnEdge?.haz_deg ?? 1.0,
};
```

`_edgeMap` (a `Map<osmid_string, edge>`) is built once at engine init from
`JOSH_DATA.graph.edges` — same pattern already used in `project_manager.js`
`_buildEdgeMap()`.

---

#### Phase 1 Tests

Update `tests/test_whatif_engine.js`:
- T_GEOM_1: `path_coords` has ≥ 2 points per path (more than just 2 nodes)
- T_GEOM_2: coordinates are `[lat, lon]` pairs (lat < 90, lon < 0 for California)
- T_GEOM_3: chain is continuous — last point of segment N equals first point of
  segment N+1 within 1e-5 tolerance
- T_GEOM_4: `bottleneck_name`, `bottleneck_road_type`, `bottleneck_lanes`,
  `bottleneck_speed`, `hazard_degradation_factor` present and typed correctly
- T_GEOM_5: geometry fallback — when `edge.geom` is null, falls back to node endpoints

Update anti-divergence test: verify `path_coords` point count matches `path_wgs84_coords`
from Python test vectors within ±2 points (Python and JS may differ slightly at
freeway truncation cutoff).

**Rebuild required:** Yes — `analyze` regenerates `whatif_engine.js`; `demo` regenerates
`app.js` and `demo_map.html`. Run for all 5 cities.

---

### Phase 2 — Sidebar Module

**Goal:** Build `static/sidebar.js` — the new unified project panel module. No map
integration yet; this phase produces a working sidebar with project list, detail card,
and form backed by real data, but routes are not drawn.

**File:** `static/sidebar.js` (new)

#### Module structure

```
(function() {
  // ── State ──────────────────────────────────────────────────────────────────
  let _projects    = [];   // { id, name, lat, lng, units, stories, result,
                           //   source, handle?, created_at, analyzed_at }
  let _selectedId  = null;
  let _formMode    = null; // null | 'new' | 'edit'
  let _formLat     = null;
  let _formLng     = null;

  // ── 1. Initialization ──────────────────────────────────────────────────────
  // Load pipeline-seeded projects from JOSH_DATA.projects
  // Check IndexedDB for stored file handles (session restore)

  // ── 2. Project CRUD ────────────────────────────────────────────────────────
  // createProject(), updateProject(), deleteProject(), getProject()

  // ── 3. Analysis ───────────────────────────────────────────────────────────
  // _runAnalysis(id) — calls WhatIfEngine.evaluateProject(), updates result,
  //   generates brief_cache via BriefRenderer.render()

  // ── 4. FSAPI I/O ──────────────────────────────────────────────────────────
  // openFile()     — showOpenFilePicker → load → validate → add to list
  // saveFile(id)   — write to existing handle (or fall back to saveAsFile)
  // saveAsFile(id) — showSaveFilePicker → write → store handle in IndexedDB
  // _serialize(project) → JSON string (project file format per spec §7)
  // _deserialize(json)  → project object + validation

  // ── 5. IndexedDB handle storage ───────────────────────────────────────────
  // _storeHandle(id, handle), _loadHandles() → Map<id, handle>
  // _clearHandle(id)

  // ── 6. UI rendering ───────────────────────────────────────────────────────
  // _render()           — full sidebar re-render
  // _renderList()       — project list section
  // _renderDetailCard() — selected project detail
  // _renderForm()       — new/edit form
  // _renderFooter()     — save / export buttons
  // _showError(msg)     — inline error (no alert())

  // ── 7. Form interactions ──────────────────────────────────────────────────
  // openNewForm()   — switches to form, notifies map to enter pin-awaiting mode
  // openEditForm(id)
  // cancelForm()
  // saveForm()

  // ── 8. Map bridge ─────────────────────────────────────────────────────────
  // These are called BY demo.py map code when events occur:
  //   onPinPlaced(lat, lng)  — called when user clicks map in pin-awaiting mode
  //   onProjectSelected(id)  — called when a project row is clicked
  // And called ON the map from sidebar:
  //   _drawRoutes(id)  — tells map to draw this project's AntPaths
  //   _clearRoutes()   — tells map to clear all route layers
  //   _enterPinMode()  — tells map to activate crosshair cursor
  //   _exitPinMode()   — tells map to restore cursor

  // ── 9. Public API ─────────────────────────────────────────────────────────
  window.joshSidebar = {
    init,            // called by demo.py on DOMContentLoaded
    onPinPlaced,     // called by map click handler
    getProjects,
    selectProject,
  };
})();
```

#### DOM structure

The sidebar is a `<div id="josh-sidebar">` injected by `demo.py` as a fixed-position
left panel. It is NOT generated by Folium — it is pure JS-rendered HTML, same approach
as `project_manager.js` today.

```html
<div id="josh-sidebar" style="
  position: fixed; top: 0; left: 0; width: 320px; height: 100vh;
  background: #fff; box-shadow: 2px 0 12px rgba(0,0,0,0.12);
  display: flex; flex-direction: column;
  font-family: system-ui, sans-serif; font-size: 13px; z-index: 1000;
">
  <div id="josh-sb-header">   <!-- City name, + New, Open… -->
  <div id="josh-sb-list">     <!-- Scrollable project rows -->
  <div id="josh-sb-detail">   <!-- Detail card or form -->
  <div id="josh-sb-footer">   <!-- Save, Save As…, Export -->
</div>
```

The Folium map container needs its left margin adjusted to `320px` so the map doesn't
render under the sidebar. This is a CSS override injected by `demo.py`.

#### FSAPI fallback detection

```js
const _hasFSAPI = typeof window !== 'undefined' &&
                  typeof window.showOpenFilePicker === 'function';
```

When `_hasFSAPI` is false, Open uses `<input type="file">` and Save uses Blob download.
IndexedDB handle storage is skipped (no handles to store). Session restore banner is
suppressed.

#### Tests (`tests/test_sidebar.js` — new file)

- S1: init loads pipeline-seeded projects from JOSH_DATA.projects
- S2: createProject → serialize → deserialize round-trip preserves all fields
- S3: updateProject merges fields, updates analyzed_at
- S4: deleteProject removes from list
- S5: _serialize produces valid JSON matching project file schema (§7 of spec)
- S6: _deserialize rejects wrong city_slug with error
- S7: _deserialize rejects schema_v > 1 with error
- S8: _buildBriefInput maps result fields to BriefInput v1 schema (migrated from
  test_project_manager.js tests 11–15)
- S9: stale result detection (parameters_version mismatch → re-analyze flag set)
- S10: project below threshold produces MINISTERIAL tier, Save still enabled
- S11: no-routes-found state sets Save disabled flag

**Rebuild required:** Yes. All 5 cities.

---

### Phase 3 — demo.py Sidebar Integration

**Goal:** Wire the sidebar into the Folium-generated map. Replace the top-right official
project panel, both FABs, and both floating panels with the left sidebar. Implement
AntPath rendering for all projects.

**Files:** `agents/visualization/demo.py` (significant), `static/sidebar.js` (map bridge)

#### demo.py changes

**Remove:**
- `_build_whatif_html()` — the floating what-if panel HTML
- `_build_whatif_ui_js()` — the what-if panel JS state machine
- `_inject_project_panel()` — the top-right Folium-rendered official project panel
- Both FAB `<button>` elements
- `project_manager.js` inline block (replaced by `sidebar.js`)

**Add:**
- `<div id="josh-sidebar">` (empty container — JS populates it)
- CSS: `#map { margin-left: 320px; }` or equivalent Folium container override
- Inline `sidebar.js` in the `<head>` block (alongside `brief_renderer.js`)
- Map initialization JS: `joshSidebar.init()` on DOMContentLoaded

**Route rendering (all projects):**

By Phase 3, `JOSH_DATA.projects` is populated (Phase 1c) and the WhatIfEngine returns
full `path_coords` geometry (Phase 1b). All routes — seed and browser-created — are
drawn identically by `sidebar.js._drawRoutes()`:

```js
// In sidebar.js _drawRoutes(id):
function _drawRoutes(id) {
  _clearRoutes();
  const project = getProject(id);
  if (!project || !project.result) return;
  const map = window._joshMap;
  const color = TIER_COLOR[project.result.tier] || '#888';

  project.result.paths.forEach(path => {
    // AntPath for the full route (uses path_coords from engine or JOSH_DATA.projects)
    L.antPath(path.path_coords || path.coordinates, {
      color, weight: 3, opacity: 0.8,
      delay: 1200, dashArray: [10, 20],
    }).addTo(map);

    // Thick overlay on bottleneck segment
    // Extract the bottleneck segment coords from the path geometry
    // using bottleneck_osmid to find the matching edge coords in JOSH_DATA.graph
    const bkEdge = _edgeMap.get(String(path.bottleneck_osmid));
    if (bkEdge?.geom) {
      L.polyline(bkEdge.geom, { color, weight: 6, opacity: 0.9 }).addTo(map);
    }
  });
}
```

`L.antPath` is already available — the Leaflet.AntPath plugin is loaded by Folium and
remains in the page even after the Folium FeatureGroups are retired.

**Pin-awaiting mode bridge:**

```js
// demo.py injects this after Folium map init:
window._joshMap = /* Folium map object */;
window._joshMap.on('click', function(e) {
  if (window._joshPinModeActive) {
    window.joshSidebar.onPinPlaced(e.latlng.lat, e.latlng.lng);
  }
});
```

`sidebar.js` sets `window._joshPinModeActive = true` on entering pin-awaiting mode.
`demo.py` forwards the click event — it does not need to know why the map was clicked.

#### Retiring the Folium project panel

The current top-right panel is generated by `_inject_project_panel()` in `demo.py`.
It adds a Folium `MacroElement` with:
- A project selector `<select>` dropdown
- Per-project detail card `<div>` elements (toggled by JS)
- Per-project FeatureGroup route layers (Folium-baked AntPath calls)

**All three are removed.** `JOSH_DATA.projects` (added in Phase 1c) replaces the data
layer. `sidebar.js._drawRoutes()` replaces the route rendering. The sidebar detail card
replaces the per-project `<div>` elements.

The Folium FeatureGroup route layers are removed because:
- They are redundant once sidebar draws routes from `JOSH_DATA.projects`
- They would conflict (two sets of AntPaths drawn for the same project on load)
- Removing them reduces HTML size significantly

#### Map left-margin fix

Folium renders the map as a `position: absolute; top: 0; left: 0; width: 100%; height: 100%`
div. Injecting a fixed left sidebar without adjusting the map means the sidebar overlaps
the map. Fix:

```python
# In demo.py, after m.get_root().html.add_child():
m.get_root().html.add_child(folium.Element(
    '<style>#map { left: 320px !important; width: calc(100% - 320px) !important; }</style>'
))
```

The Folium map id is always `map` for single-map pages. Verify against rendered output.

**Rebuild required:** Yes. All 5 cities. Run full JS test suite before rebuild.

---

### Phase 4 — Polish and Session Restore

**Goal:** Session restore, stale-result detection, edge case states (no routes found,
below threshold, city mismatch), and removal of all remaining `alert()` calls.

**Files:** `static/sidebar.js` (additions only), `agents/visualization/demo.py` (minor)

#### Session restore

```js
// On init, after loading pipeline seeds:
async function _attemptSessionRestore() {
  const handles = await _loadHandles(); // from IndexedDB
  if (handles.size === 0) return;
  _showRestoreBanner(handles.size); // "Restore N projects from last session? [Yes] [No]"
}

// On "Yes":
for (const [id, handle] of handles) {
  try {
    await handle.requestPermission({ mode: 'readwrite' });
    const file = await handle.getFile();
    const text = await file.text();
    _importProject(JSON.parse(text), handle);
  } catch (e) {
    _showError(`Could not reopen ${handle.name}: ${e.message}`);
  }
}
```

#### Stale result detection

On file open and session restore:
```js
if (project.parameters_version !== JOSH_DATA.parameters_version) {
  _runAnalysis(project.id);
  await saveFile(project.id); // write updated result back to file
  project._reanalyzed = true; // detail card shows notice
}
```

#### Detail card notice

When `project._reanalyzed` is true, show below tier block:
> ℹ Re-analyzed — parameters updated from v3.4 → v4.0.

#### Export for pipeline (YAML)

The YAML export (currently `joshPM_downloadYaml`) moves to `sidebar.js` as `exportYaml()`.
Format is unchanged — compatible with `{city}_demo.yaml` in josh-pipeline.

#### Tests

Add to `tests/test_sidebar.js`:
- S12: session restore banner shown when IndexedDB has handles
- S13: city_slug mismatch on open shows inline error, does not add to list
- S14: parameters_version mismatch triggers re-analysis flag
- S15: _exportYaml omits projects with lat: null (migrated from test_project_manager.js T8)
- S16: _exportYaml maps lng → lon (migrated from test_project_manager.js T9)

**Rebuild required:** Yes. All 5 cities.

---

## File Change Summary

| File | Phase | Change |
|---|---|---|
| `agents/export.py` | 1 | (1a) Add `geom: [[lat,lon],...]` to each edge entry. (1c) Add `JOSH_DATA.projects` array with full path data including `path_wgs84_coords`, bottleneck metadata, brief_cache. (1d) Build `_edgeMap` init in WhatIfEngine JS string |
| `agents/export.py` WhatIfEngine JS string | 1 | (1b) Replace node-only `pathCoords` build with geometry-chaining logic mirroring `wildland.py`. (1d) Add `bottleneck_name/road_type/lanes/speed/hazard_degradation_factor` to serving-path return object |
| `agents/visualization/demo.py` | 3 | Remove: what-if panel HTML+JS, Saved Analyses FAB, top-right project panel `_inject_project_panel()`, Folium FeatureGroup route layers. Add: sidebar `<div>` container, CSS margin fix, `sidebar.js` inline block, map click bridge, `joshSidebar.init()` call |
| `static/sidebar.js` | 2, 4 | New module — project list, detail card, form, FSAPI I/O, IndexedDB handles, `_drawRoutes()` with AntPath + bottleneck overlay |
| `static/project_manager.js` | 3 | Retired. Replace file content with `/* retired in Phase 3 — see static/sidebar.js */` |
| `static/whatif_engine.js` | (generated) | Regenerated by `build.py analyze` from JS strings in `agents/export.py` |
| `static/v1/app.js` | (generated) | Rebuilt each phase via `build.py demo` |
| `tests/test_sidebar.js` | 2, 4 | New — 16 tests: CRUD, serialize/deserialize, FSAPI, BriefInput mapping, session restore, stale detection, YAML export |
| `tests/test_whatif_engine.js` | 1 | Add 5 geometry + metadata tests (T_GEOM_1–5); update anti-divergence test for `path_coords` point count |
| `tests/test_project_manager.js` | 3 | Retired after tests 8–9, 11–15 migrated to `test_sidebar.js` |

**No changes to:**
- `static/brief_renderer.js`
- `static/whatif_utils.js`
- `agents/visualization/brief_v3.py`
- `agents/capacity_analysis.py`
- `agents/scenarios/`
- `config/parameters.yaml`
- `models/`
- `build.py`

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `edge.geom` is None for some edges (rare but possible) | Fallback implemented in 1b: use node endpoint positions. Path still draws; quality degrades only on that segment. |
| JOSH_DATA size increase from edge geometry (~1.5 MB/city) | Verified acceptable for desktop `file://` delivery. Monitor at first Phase 1 rebuild; if >5 MB total, add gzip comment for server deployment path. |
| JOSH_DATA size increase from `projects` array with `brief_cache` HTML | Brief HTML is ~20 KB per project × 5 projects = 100 KB. Acceptable. If a city has 20+ projects, consider omitting `brief_cache` from JOSH_DATA and generating at view time from BriefRenderer. |
| `path_coords` vs `coordinates` field name collision (engine vs file format) | Standardize on `path_coords` everywhere. Spec §7 already says `coordinates` in the file format — reconcile before coding Phase 2. |
| Folium map container CSS conflicts with `margin-left: 320px` | Inspect rendered HTML before Phase 3. Folium map div id is `map` but wrapper class may differ. Use `!important` if needed; verify on all 5 cities. |
| `L.antPath` constructor not in scope when sidebar calls it | Folium loads the AntPath plugin unconditionally. Verify `window.L.AntPath` exists after plugin script runs; add defensive check in `_drawRoutes()`. |
| Retiring Folium FeatureGroups removes popup HTML for seed projects | Seed project popups are replaced by the sidebar detail card. Verify no road-segment popup HTML is lost (road network segment popups from heatmap FeatureGroups are separate and untouched). |
| IndexedDB not available in `file://` in some browsers | Feature-detect before use; fall back silently to no session restore. Session restore is a convenience, not a primary workflow requirement. |
| Retiring `joshWhatIf` / `joshPM` breaks tests that reference them | Audit all test files before Phase 3 starts; migrate references to `joshSidebar` before deleting the old globals. |
| Phase 3 is the largest single change | Break into two sub-phases: 3a (add sidebar + CSS, keep old panels), 3b (retire old panels once sidebar is verified). Never leave a city with both panels visible simultaneously. |

---

## Rebuild Order Per Phase

After each phase, before committing:
```bash
# Run all JS tests
node --test tests/test_whatif_engine.js
node --test tests/test_brief_renderer.js
node --test tests/test_sidebar.js      # replaces test_project_manager.js from Phase 2

# Rebuild all 5 cities
cd /path/to/josh-pipeline
JOSH_DIR=/path/to/csf-josh uv run python acquire.py run --city "Berkeley"
JOSH_DIR=/path/to/csf-josh uv run python acquire.py run --city "Encinitas"
JOSH_DIR=/path/to/csf-josh uv run python acquire.py run --city "Del Mar"
JOSH_DIR=/path/to/csf-josh uv run python acquire.py run --city "Solana Beach"
JOSH_DIR=/path/to/csf-josh uv run python acquire.py run --city "RSF Fire"
```
