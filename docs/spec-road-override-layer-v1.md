# Road Override Layer — Client-Side City Edits

## Problem

Cities receiving a JOSH demo map may have local knowledge about their road network
that differs from OSM data: construction zones, gated roads, incorrect capacity
estimates, or roads that should be excluded from evacuation routing entirely.

Today, correcting road data requires modifying `{city}_road_overrides.yaml` in
josh-pipeline and re-running the full pipeline. Cities cannot make corrections
themselves — they must send feedback and wait for a rebuild.

## Goal

Let city planners edit road segment capacity directly in the browser. Changes
persist locally, trigger automatic ΔT recalculation for all projects, and can
be exported as a file to send back for pipeline integration.

## Target User

City planning staff. Not engineers — the interface must be simple. A planner
clicks a road, types a VPH number (or excludes the road), and sees the impact
on all project determinations immediately.

## Design Principles

1. **VPH is the only editable capacity value.** Cities determine their own VPH.
   We do not expose component fields (speed, lanes, road type) — the HCM formula
   stays as the default, and overrides replace the result directly.

2. **Base JOSH_DATA is never mutated.** Overrides are a separate runtime layer
   applied before each WhatIfEngine evaluation. Removing all overrides restores
   the original pipeline state.

3. **Pipeline overrides are invisible.** `road_overrides.yaml` corrections are
   baked into `eff_cap_vph` at export time — they ARE the base truth. City
   overrides layer on top. No double-override confusion.

4. **Same persistence pattern as projects.** FSAPI (Chrome/Edge) for background
   save, Blob download fallback (Firefox/Safari), localStorage for session restore.

---

## Override Data Model

### Per-segment override

```json
{
  "eff_cap_vph": 450,
  "excluded": false,
  "note": "Construction zone — one lane closed through Aug 2026",
  "source": "Public Works Dept",
  "date": "2026-04-15",
  "temporary": true
}
```

Only `eff_cap_vph` and/or `excluded` are required. Everything else is annotation
for audit trail and round-trip export.

### Override file (full)

```json
{
  "override_version": 1,
  "city_slug": "encinitas",
  "created_at": "2026-04-15T10:30:00Z",
  "modified_at": "2026-04-15T14:22:00Z",
  "overrides": {
    "12345678": {
      "eff_cap_vph": 450,
      "excluded": false,
      "note": "Construction zone — one lane closed through Aug 2026",
      "source": "Public Works Dept",
      "date": "2026-04-15",
      "temporary": true
    },
    "87654321": {
      "excluded": true,
      "note": "Gated — no public evacuation access",
      "source": "Fire Marshal inspection 2026-03"
    }
  }
}
```

Keyed by `osmid` (string) — matches `JOSH_DATA.graph.edges[].osmid`.

---

## Engine Integration

### How WhatIfEngine uses edges today

`init()` (whatif_engine.js:50-62) runs once:
1. Builds `_adjacency` Map from `JOSH_DATA.graph.edges` — each entry copies
   `eff_cap_vph`, `speed_mph`, `len_m`, `fhsz_zone`, `haz_deg` per edge
2. Builds `_edgeMap` (osmid → edge object) for bottleneck lookups
3. Builds `_exitSet` from `JOSH_DATA.graph.exit_nodes`

`evaluateProject()` calls `dijkstraFromOrigin()` which reads `_adjacency` for
travel time weights, then `identifyServingPaths()` which reads `eff_cap_vph`
from each edge to find bottlenecks.

### Override application: `applyOverrides(overrideMap)`

New exported function on `WhatIfEngine`:

```js
function applyOverrides(overrideMap) {
  // overrideMap: Map<osmid_string, {eff_cap_vph?, excluded?}>
  // Rebuild adjacency from base edges with overrides applied.
  
  const patched = _graph.edges.filter(e => {
    const ov = overrideMap.get(e.osmid);
    return !(ov && ov.excluded);  // drop excluded edges
  }).map(e => {
    const ov = overrideMap.get(e.osmid);
    if (!ov || ov.excluded) return e;
    return { ...e, eff_cap_vph: ov.eff_cap_vph ?? e.eff_cap_vph };
  });

  _adjacency = _buildAdjacency(patched);
  // Rebuild edgeMap for bottleneck lookups
  _edgeMap = new Map();
  for (const e of patched) _edgeMap.set(e.osmid, e);
}

function clearOverrides() {
  _adjacency = _buildAdjacency(_graph.edges);
  _edgeMap = new Map();
  for (const e of _graph.edges) _edgeMap.set(e.osmid, e);
}
```

**Cost:** Rebuilding adjacency for Berkeley (~12K edges) takes <5ms. Acceptable
on every override change since the user is clicking individual roads, not
bulk-editing.

**Base data preserved:** `_graph.edges` (the original `JOSH_DATA.graph.edges`
array) is never modified. `applyOverrides` builds a new adjacency from a
filtered/patched copy. `clearOverrides` restores the original.

### Auto-recalculation

When overrides change, sidebar.js re-evaluates all projects:

```js
function _onOverridesChanged(overrideMap) {
  WhatIfEngine.applyOverrides(overrideMap);
  for (const project of getProjects()) {
    if (project.lat != null && project.lng != null) {
      _runAnalysis(project.id);
    }
  }
  _render();
}
```

All projects are re-evaluated because any override could change which path is
the bottleneck for any project. This is fast — Berkeley evaluates 6 projects
in ~80ms total.

---

## Persistence

Same three-tier pattern as project persistence in sidebar.js:

| Tier | Mechanism | Behavior |
|------|-----------|----------|
| localStorage | Automatic | Survives page reload; lost on cache clear |
| FSAPI | User-triggered | Chrome/Edge: silent background save to a picked file |
| Blob download | Fallback | Firefox/Safari: triggers download of `.json` file |

### localStorage key

`josh_overrides_{city_slug}` — JSON string of the override file format.

### FSAPI file

Suggested filename: `{city_slug}_road_overrides.json`

### Import

"Import Overrides" button reads a `.json` file (via `<input type=file>` or FSAPI
`showOpenFilePicker`), validates the schema, checks `city_slug` matches, and
applies.

### Export (round-trip to pipeline)

"Export Overrides" button downloads the override file as JSON. The pipeline
operator can convert this to the `road_overrides.yaml` format for permanent
integration. A future enhancement could export YAML directly.

---

## Map Interaction UX

### Segment click → override panel

1. Add a transparent interactive Leaflet polyline layer from
   `JOSH_DATA.graph.edges[].geom` (full road geometry already available).
   This layer sits on top of the Folium heatmap but is invisible — it only
   captures click events.

2. On click, identify the edge by proximity to click point. Show a panel
   (sidebar section or popover) with:
   - Road name, road type, lanes, current VPH (from JOSH_DATA)
   - Editable VPH field (number input)
   - "Exclude from routing" checkbox
   - Note, source, temporary fields (optional, collapsed by default)
   - "Apply" / "Remove Override" buttons

3. On "Apply": add/update the override in the override map, call
   `_onOverridesChanged()`, persist to localStorage.

### Visual feedback

Overridden segments are highlighted on the map:
- **VPH override:** segment drawn with orange dashed polyline on the
  interactive layer
- **Excluded:** segment drawn with red dashed polyline + strikethrough pattern
- **No override:** transparent (click target only)

A small badge in the sidebar shows the override count: "3 road overrides active".

### Override list panel

A collapsible sidebar section listing all active overrides:
- Road name + osmid
- Original VPH → overridden VPH (or "Excluded")
- Note (truncated)
- "Edit" / "Remove" buttons per entry

---

## Phases

### Phase A — Engine + data model (foundation)

- Add `applyOverrides(overrideMap)` and `clearOverrides()` to WhatIfEngine
- Add override storage to sidebar.js (localStorage + import/export)
- Auto-recalculate all projects on override change
- Add override count badge to sidebar
- **Test:** unit tests for engine override application (excluded edges,
  patched VPH, clearOverrides restores original)

### Phase B — Segment click UI

- Build transparent clickable Leaflet polyline layer from graph edge geometries
- Click handler: identify nearest edge by proximity
- Override edit panel (sidebar section or popover)
- Apply/remove/edit flow
- **Test:** manual browser test — click road, set VPH, verify project ΔT changes

### Phase C — Visual overlay + override list

- Orange/red dashed polyline layer for overridden segments
- Override list panel in sidebar with edit/remove per entry
- Highlight selected override on map
- **Test:** visual verification of overlay rendering

### Phase D — FSAPI persistence + round-trip export

- FSAPI save/load (mirrors project persistence pattern)
- Blob download fallback
- Import from file with validation
- Export as JSON (compatible with pipeline road_overrides.yaml conversion)
- **Test:** save overrides, reload page, verify they persist and re-apply

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `static/whatif_engine.js` | Add `applyOverrides()`, `clearOverrides()` (~30 lines) |
| `agents/export.py` | Add `applyOverrides`, `clearOverrides` to IIFE exports |
| `static/sidebar.js` | Override storage, auto-recalc, import/export, edit panel, click handler |
| `static/v1/app.js` | Regenerated (embeds whatif_engine.js changes) |
| `tests/test_whatif_engine.js` | Override engine tests |
| `tests/test_sidebar.js` | Override persistence + recalc tests |
| `docs/spec-road-override-layer-v1.md` | This spec |

No Python pipeline changes needed — overrides are entirely client-side.

---

## Out of Scope (future)

- **Routing exclusions with time-of-day rules** (e.g., "gated 6pm-6am")
- **Intersection-level overrides** (turn restrictions, signal timing)
- **Bulk overrides by road name** (e.g., "all segments named 'Clark Ave'")
- **Direct YAML export** (currently JSON only; pipeline operator converts)
- **Diff view** showing override impact vs. baseline per project
- **Pipeline round-trip automation** (auto-convert JSON → YAML → PR)

---

## Anti-Divergence

The override layer is JS-only. Python pipeline never sees overrides — it uses
the base `eff_cap_vph` from `roads.gpkg`. This means:

- Pipeline-generated test vectors are always against unoverridden data
- Anti-divergence test (`test_whatif_engine.js`) tests the base engine
- Override tests are separate (test that overrides change results correctly)

There is no Python/JS divergence risk from overrides since Python never applies them.
