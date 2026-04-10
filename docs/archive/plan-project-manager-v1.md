# Project Manager Feature Plan — JOSH What-If Analysis

**Prepared:** 2026-04-09  
**Updated:** 2026-04-09 — revised persistence strategy (FSAPI primary, localStorage session cache, YAML export)  
**Feature branch:** `feat/project-manager`

---

## 1. Data Model

### 1.1 Saved Project Record

Each saved project is a flat JSON object stored in an array:

```json
{
  "id":         "string — crypto.randomUUID()",
  "schema_v":   1,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "name":       "string — required",
  "address":    "string — optional free text",
  "notes":      "string — optional free text",
  "units":      "integer >= 1",
  "stories":    "integer >= 0",
  "lat":        "number | null",
  "lng":        "number | null",
  "result":     "object | null"
}
```

The `result` field stores the verbatim return value of `WhatIfEngine.evaluateProject()` — `tier`, `hazard_zone`, `max_delta_t_minutes`, `built_at`, and the `paths` array (including `delta_t_minutes`, `threshold_minutes`, `flagged`, `path_coords`, `bottleneck_coords`). Storing the full result means the list view can render tier badges without re-running the engine on every page load.

### 1.2 Session Cache (localStorage)

```
josh_projects_v1_{city_slug}
```

Example: `josh_projects_v1_berkeley`

localStorage is a **session convenience cache only** — not the source of truth. It is written on every mutation so that a page refresh within the same browser session restores state without requiring the user to reopen their file. It does not survive a cache clear. The file on disk (§6.1) is the authoritative store. `city_slug` is read from `window.JOSH_DATA.city_slug` (new field — see §3). Falls back to `"unknown"` if absent.

### 1.3 JSON File Format

Primary on-disk format for saving and loading all projects for a city:

```json
{
  "export_schema_v": 1,
  "city_slug":       "berkeley",
  "saved_at":        "ISO-8601",
  "projects":        [ ...project records... ]
}
```

Default filename: `josh-projects-{city_slug}.json` (no date suffix — this is a living file, not a snapshot export).

### 1.4 YAML Export Format

Secondary export that produces a drop-in `{city_slug}_demo.yaml` for the josh-pipeline. This closes the loop from client-side exploration → official Python pipeline determination.

```yaml
# Exported from JOSH Project Manager — 2026-04-09
# Drop into josh-pipeline/projects/ and run:
#   JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Berkeley"

- name: "Acton St Apartments"
  address: "2525 Acton St, Berkeley"
  lat: 37.8651
  lng: -122.2743
  units: 75
  stories: 4
  notes: "What-if analysis exported 2026-04-09"

- name: "Telegraph Highrise"
  address: ""
  lat: 37.8702
  lng: -122.2595
  units: 120
  stories: 12
  notes: ""
```

Only projects with a pinned location (`lat`/`lng` not null) are included. Projects without a pin are omitted with a comment. No YAML library needed — these are flat key-value structures trivially serializable in JS.

### 1.5 Schema Versioning

Both `schema_v` (record-level) and `export_schema_v` (file-level) are forward-compatibility sentinels. The importer treats unknown keys as pass-through and never errors on extra fields. A future breaking change bumps the integer and adds a `_migrate_v1_to_v2(record)` function in `static/project_manager.js`. The `_load()` function runs all migrations in sequence on each record after parsing.

---

## 2. Architecture Decision

### Decision: New `static/project_manager.js` — hand-written, not generated

**The key tension:** The drop-pin map interaction is fully encapsulated inside the `_build_whatif_ui_js()` IIFE in `agents/visualization/demo.py`. Private state (`_dropPinActive`, `_markers`, `_wiMarker`, `_lat`, `_lng`) and Leaflet event wiring are not exposed. Can a separate module reuse it or must it duplicate it?

**Answer: reuse via a single new exported entry point, not duplication.**

The correct design is to extend the existing `window.joshWhatIf` export with two new functions — `startDropPinForProject(callback)` and `cancelExternalDropPin()` — and have the project manager call through these rather than wiring its own Leaflet events. This is a small, targeted addition to the generated IIFE in `_build_whatif_ui_js()`. The project manager JS itself lives in `static/project_manager.js` and is hand-written.

**Why not put the project manager inside the generated app.js pipeline?**

The generated `static/v1/app.js` is regenerated on every `demo` run and should not be edited. The project manager has zero city-specific content — it is pure client-side storage logic that is identical for Berkeley, Paradise, or any future city. Generating it from Python adds unnecessary coupling and makes the JS harder to iterate on independently. It belongs in `static/` alongside `whatif_utils.js` as a hand-written module.

**How it reaches the HTML:**

`_inject_josh_data_bundle()` in `agents/visualization/demo.py` currently inlines `static/v1/app.js` verbatim. A second inline `<script id="josh-pm">` block is added immediately after, reading from `static/project_manager.js`. If the file is absent, the block is omitted and the rest of the map works normally (graceful degradation).

**Ownership table:**

| File | Type | How to modify |
|------|------|---------------|
| `static/project_manager.js` | Hand-written | Edit directly |
| `static/v1/app.js` | Generated | Edit `agents/visualization/demo.py`, then regenerate |
| `static/whatif_utils.js` | Hand-written | Edit directly |
| `static/whatif_engine.js` | Generated | Edit `agents/export.py`, then regenerate |

---

## 3. JOSH_DATA Changes

### 3.1 New field: `city_slug`

`window.JOSH_DATA` gains one new field: `city_slug`. This is the only change to the data bundle.

**Python change — `_inject_josh_data_bundle()` in `agents/visualization/demo.py`:**

Add `city_slug: str = "unknown"` to the function signature. Add `"city_slug": city_slug` to the `josh_data` dict. The updated call site inside `create_demo_map()` derives the slug from `output_path.parent.name` — the same pattern already used in `agents/visualization/brief_v3.py` (`city_slug = output_path.parent.name`).

### 3.2 No schema_version bump

`schema_version` stays at `1`. The `city_slug` field is additive — the existing schema compatibility guard in `app.js` (`if (d.schema_version !== 1)`) is not triggered. `project_manager.js` handles an absent `city_slug` with a fallback.

### 3.3 No other JOSH_DATA changes

All other existing fields remain unchanged. The project manager reads only `window.JOSH_DATA.city_slug`.

---

## 4. UI Design

### 4.1 Panel placement

The project manager lives in a **separate panel**, not a tab inside the what-if panel. The what-if panel's DOM, sizing, and behavior are untouched.

The project manager panel (`#josh-pm-panel`) is:
- Fixed bottom-right, same corner as the what-if panel
- 340 px wide (slightly wider to accommodate the project list comfortably)
- Draggable using the same drag-handle + mouse event pattern as the what-if panel
- Two-view internal layout: **List view** (default) and **Edit/New form view** (replaces list in-place, no modal)

A second FAB (`#josh-pm-open-btn`, "Saved Projects") is positioned at `bottom: 72px, right: 16px` — just above the existing what-if FAB. The two panels are mutually exclusive: opening one closes the other (§5, Task 5).

### 4.2 List view

```
╔═══════════════════════════════════════════════╗
║  Saved Projects (3)  [● unsaved]      [✕]     ║  ← dark header, draggable
╠═══════════════════════════════════════════════╣
║  [+ New]   [↓ Save File]   [↑ Load File]      ║  ← toolbar
╠═══════════════════════════════════════════════╣
║  ● Acton St Apts          MIN  [▶] [✏] [🗑]  ║
║  ● Telegraph Highrise    DISC  [▶] [✏] [🗑]  ║
║  ○ Untitled 2026-04-09     —   [▶] [✏] [🗑]  ║  ← no result yet
╠═══════════════════════════════════════════════╣
║  [⬇ Export YAML for pipeline]                 ║  ← footer
╚═══════════════════════════════════════════════╝
```

- **Tier color dot**: green/orange/red for MIN/COND/DISC; gray if `result` is null
- **[● unsaved]** indicator: shown in header when in-memory state differs from file on disk (see §6.3)
- **[▶] Run**: re-evaluates, updates `result`, saves
- **[✏] Edit**: opens the edit form
- **[🗑] Delete**: removes immediately; auto-saves
- **Export YAML**: footer button; always available; generates `{city_slug}_demo.yaml`

### 4.3 Edit / New form view

Replaces the list view in-place.

```
╔══════════════════════════════════════════╗
║  ← Back   New Project                   ║
╠══════════════════════════════════════════╣
║  Name *   [_______________________]     ║
║  Address  [_______________________]     ║
║  Notes    [_______________________]     ║
║  Units *  [50 ]     Stories  [4  ]     ║
║                                          ║
║  Location: no pin placed                 ║
║  [⊕ Drop Pin]                           ║
║                                          ║
║  Result: not yet run                     ║
║  [▶ Run Analysis]    [Save]   [Cancel]  ║
╚══════════════════════════════════════════╝
```

When editing an existing project, the saved lat/lng marker is restored on the map and the stored result summary is displayed. "Run Analysis" places a pin at the saved location, calls `WhatIfEngine.evaluateProject()`, displays the result, and auto-saves. "Save" persists whatever is in the form including any result already present.

### 4.4 Result display in the form

A compact inline block appears after running: tier badge (colored), max ΔT, FHSZ zone, and count of flagged paths. The full per-path ΔT table belongs to the what-if panel (exploratory UX). The project manager result display is intentionally minimal — it is a record of a determination, not a tool for exploration.

---

## 5. Drop-Pin Coordination

### 5.1 The problem

There is one Leaflet map and one `_dropPinActive` flag inside the what-if IIFE. Both the what-if panel and the project manager need to trigger a "click to place pin" flow. If both register independent `map.once('click', ...)` handlers, they race. Duplicating `_dropPinActive` across two modules creates two independent flags that can conflict.

### 5.2 Solution: route all drop-pin operations through the what-if IIFE

Add two new functions to `_build_whatif_ui_js()` and export them on `window.joshWhatIf`:

**`startDropPinForProject(onPlaced)`** — Cancels any active what-if drop-pin, sets `_dropPinActive = true`, applies the crosshair cursor, registers a `map.once('click', ...)` handler that — instead of calling `_placePin` — invokes `onPlaced(lat, lng)` and restores the cursor. The project manager supplies a callback that does its own marker placement and analysis.

**`cancelExternalDropPin()`** — Public alias for `cancelDropPin()`, used by the project manager to abort the flow if the edit form is closed mid-session.

The project manager never registers its own Leaflet click handlers. It always routes through `joshWhatIf.startDropPinForProject`. This keeps `_dropPinActive` as the single source of truth for "is someone waiting for a map click?".

### 5.3 Project manager markers

While in edit mode with a pinned location, the project manager renders a solid circle marker (distinct from the what-if "?" dashed circle) using `L.divIcon`. These are tracked in `_pmMarkers` inside `project_manager.js`. The module calls `joshWhatIf.clearWhatIf()` before showing its own pin, and clears its own pins before the user returns to the list view.

---

## 6. Persistence Strategy

**Model: file-first, localStorage as session cache.**

localStorage is cleared with browser cache and is therefore not reliable as a primary store. A named file on the user's disk — written via the File System Access API — is the authoritative source of truth. localStorage is a convenience layer that restores state across a page refresh within the same session without requiring the user to reload their file.

### 6.1 File System Access API — primary store

`window.showSaveFilePicker` / `window.showOpenFilePicker` (Chrome/Edge, including `file://` origins). The user is prompted to pick or create a file **once per session**. The browser remembers the `FileSystemFileHandle` in a module-level variable (`_fileHandle`). All subsequent saves write to the same file silently — no download dialog on every save.

**First-use flow (new session, no file loaded):**
1. User clicks "Save File" in the toolbar for the first time.
2. `showSaveFilePicker({ suggestedName: "josh-projects-{city_slug}.json" })` opens a native Save dialog.
3. User picks a location. `_fileHandle` is stored.
4. JSON is written to the file via `FileSystemWritableFileStream`.
5. The `[● unsaved]` indicator disappears.

**Subsequent saves (same session, `_fileHandle` set):**
- Every create/update/delete calls `_saveToFile()` silently (no dialog).

**Loading a file:**
1. User clicks "Load File" in the toolbar.
2. `showOpenFilePicker({ types: [{accept: {"application/json": [".json"]}}] })` opens a native Open dialog.
3. File is read via `FileReader`, parsed, migrated, loaded into `_projects`.
4. `_fileHandle` is set to the opened handle (future saves go back to the same file).
5. localStorage is updated to mirror the loaded state.

**Browser compatibility fallback:** Detect `window.showSaveFilePicker` at runtime. If absent (Firefox, Safari), fall back to §6.2. The toolbar buttons still appear and work — they just trigger download/upload instead of FSAPI.

```javascript
const _fsapiSupported = typeof window.showSaveFilePicker === 'function';
```

### 6.2 Blob download / file input — fallback

When FSAPI is unavailable:

- **Save File**: constructs the JSON wrapper object → `JSON.stringify` → `Blob({type: "application/json"})` → temporary `<a download="...">` → programmatic click → `revokeObjectURL`. Standard `file://`-compatible download.
- **Load File**: hidden `<input type="file" accept=".json">` → `FileReader.readAsText()` → parse → load.

In fallback mode, every "Save File" is a new download to the user's Downloads folder. The `[● unsaved]` indicator encourages the user to save regularly.

### 6.3 localStorage — session cache

Written on every mutation (`_saveToCache()`). Read on `DOMContentLoaded` to restore state if no file has been loaded yet that session.

**Load order on page open:**
1. Check localStorage for `josh_projects_v1_{city_slug}`.
2. If found: parse, migrate, populate `_projects`, render list. Show `[● unsaved]` indicator to remind user to reload or re-link their file.
3. If absent: start with empty list.

**"Unsaved" indicator logic:** `_dirty` boolean flag. Set to `true` on every mutation. Cleared to `false` after a successful `_saveToFile()`. The `[● unsaved]` indicator in the panel header reflects `_dirty`.

Parse errors in cache load are caught silently: delete the corrupt key, start with empty list, log to console.

### 6.4 YAML export — pipeline integration

The "Export YAML for pipeline" footer button generates a `{city_slug}_demo.yaml` file that can be dropped directly into `josh-pipeline/projects/` and used with `acquire.py run`.

**Generation rules:**
- Only projects with `lat !== null` are included (unpinned projects are skipped with a comment).
- Field mapping: `name`, `address`, `lat`, `lng` → `lon` (pipeline uses `lon`), `units`, `stories`, `notes`.
- Serialized as plain-text YAML without a library — flat key-value structures with `"` quoting and `null` for missing optionals.
- Header comment includes city name, export date, and the `acquire.py run` command to use it.
- Delivered as a Blob download (`{city_slug}_demo.yaml`). No FSAPI needed — this is always a one-time export.

**Workflow this enables:**
```
User explores in demo_map.html
  → saves projects to josh-projects-berkeley.json (FSAPI)
  → clicks "Export YAML for pipeline"
  → drops berkeley_demo.yaml into josh-pipeline/projects/
  → JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Berkeley"
  → gets official determination briefs + full regenerated map
```

---

## 7. Step-by-Step Implementation Tasks

Tasks are ordered by dependency.

---

**Task 1 — Add `city_slug` to `window.JOSH_DATA`**

File: `agents/visualization/demo.py`, functions `_inject_josh_data_bundle()` and `create_demo_map()`

Add `city_slug: str = "unknown"` parameter to `_inject_josh_data_bundle`. Derive it in `create_demo_map` as `output_path.parent.name`. Pass it through. Add `"city_slug": city_slug` to the `josh_data` dict built inside `_inject_josh_data_bundle`.

No rebuild needed yet — Tasks 1–3 are all Python-side changes that feed into the same rebuild in Task 4.

---

**Task 2 — Add `startDropPinForProject` and `cancelExternalDropPin` to the what-if controller**

File: `agents/visualization/demo.py`, function `_build_whatif_ui_js()`

Inside the controller IIFE, before the `window.joshWhatIf = {...}` export line, define:

```javascript
function startDropPinForProject(onPlaced) {
  cancelDropPin();                        // abort any active what-if drop-pin
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

function cancelExternalDropPin() {
  cancelDropPin();
}
```

Add both to the `window.joshWhatIf` exported object.

Also add `closePanel` to the export if it is not already exported (needed for mutual-hide in Task 5).

---

**Task 3 — Inline `project_manager.js` in the HTML injection**

File: `agents/visualization/demo.py`, function `_inject_josh_data_bundle()`

After `app_block` is built, add:

```python
pm_path = Path(__file__).parent.parent.parent / "static" / "project_manager.js"
pm_js = pm_path.read_text(encoding="utf-8") if pm_path.exists() else ""
pm_block = f'<script id="josh-pm">\n{pm_js}\n</script>' if pm_js else ""
```

Insert `pm_block` into the injection string immediately after `app_block`. If the file does not exist, `pm_block` is empty and the rest of the map works normally.

---

**Task 4 — Rebuild demo for all active cities**

After Tasks 1–3 are committed:

```bash
# In josh-pipeline:
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Berkeley"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Encinitas"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Del Mar"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Solana Beach"
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "RSF Fire"
```

Confirm `window.JOSH_DATA.city_slug` is present in the output HTML (open dev tools → console → `JOSH_DATA.city_slug`).

---

**Task 5 — Write `static/project_manager.js`**

New hand-written file. Implement as a single IIFE that exposes `window.joshPM`. Structure:

```
(function() {
  // 1. Constants
  //    SCHEMA_V = 1, STORAGE_KEY_PREFIX, DIRTY_CLASS

  // 2. State
  //    _projects = [], _fileHandle = null, _dirty = false, _editingId = null, _pmMarker = null

  // 3. Storage — localStorage cache
  //    _saveToCache(), _loadFromCache(), _clearCache()

  // 4. Storage — File System Access API
  //    _saveToFile()         — FSAPI write if _fileHandle set, else Blob download
  //    _loadFromFile()       — showOpenFilePicker or <input type=file>
  //    _linkOrSaveToFile()   — showSaveFilePicker on first save, then silent write

  // 5. CRUD
  //    createProject(fields), updateProject(id, fields), deleteProject(id), getProject(id)
  //    All call _saveToCache() + set _dirty=true. Save to file is explicit user action.

  // 6. YAML serialization
  //    _toYaml(projects) → string
  //    _downloadYaml()   → Blob download of {city_slug}_demo.yaml

  // 7. JSON import
  //    _importFromJson(text) — parse, validate schema_v, warn on city_slug mismatch,
  //                           deduplicate by id, append, _saveToCache, _dirty=true

  // 8. Map marker helpers
  //    _showPmMarker(lat, lng), _clearPmMarker()
  //    Uses L.divIcon — solid circle, distinct from what-if "?" marker

  // 9. Analysis runner
  //    _runAnalysis(id) — calls WhatIfEngine.evaluateProject(lat, lng, units, stories),
  //                       updateProject(id, {result}), re-renders

  // 10. Panel / view rendering
  //    _renderPanel()    — injects #josh-pm-panel + FAB if not present
  //    _renderList()     — list view HTML
  //    _renderForm(id)   — edit/new form HTML; null id = new project
  //    _updateDirtyIndicator()

  // 11. Event wiring
  //    Drop Pin → joshWhatIf.startDropPinForProject(callback)
  //    ← Back  → joshWhatIf.cancelExternalDropPin() + _clearPmMarker() + _renderList()
  //    Panel close → joshWhatIf.cancelExternalDropPin() + _clearPmMarker()

  // 12. Mutual-hide
  //    openPanel()  → joshWhatIf?.closePanel?.()
  //    closePanel() → joshWhatIf?.cancelExternalDropPin?.()

  // 13. Init
  //    DOMContentLoaded: _renderPanel(), _loadFromCache(), _renderList()

  // 14. Public API
  window.joshPM = { openPanel, closePanel, getProjects: () => _projects };
})();
```

Dependencies: `window.joshWhatIf`, `WhatIfEngine`, `window.JOSH_DATA`, `localStorage`, `L` (Leaflet), standard DOM + File APIs. No external libraries.

---

**Task 6 — Wire mutual-hide in the what-if controller**

File: `agents/visualization/demo.py`, function `_build_whatif_ui_js()`

In the `openPanel()` function of the what-if controller IIFE, add before showing the panel:

```javascript
if (window.joshPM && window.joshPM.closePanel) { window.joshPM.closePanel(); }
```

This is a forward reference (project_manager.js loads after app.js) so the optional-chaining guard is essential.

After this change, regenerate `static/v1/app.js`:
```bash
JOSH_DIR=/path/to/josh uv run python acquire.py run --city "Berkeley"
```

---

**Task 7 — Write `tests/test_project_manager.js`**

New file following the pattern of `tests/test_whatif_engine.js`. Provide minimal shims for `window`, `localStorage`, `crypto.randomUUID`, and `JOSH_DATA`. Do not shim the DOM or FSAPI — test only the storage and serialization logic.

Test cases:
1. Storage key uses `city_slug` from `JOSH_DATA`
2. `createProject` → `_loadFromCache` round-trip
3. `updateProject` changes `updated_at` and merges fields
4. `deleteProject` removes record from array
5. `_importFromJson` deduplicates by `id` (same record imported twice = one record)
6. `_importFromJson` warns but does not abort on city_slug mismatch
7. `_migrate` is a no-op for `schema_v: 1` records
8. `_toYaml` omits projects with `lat: null`
9. `_toYaml` maps `lng` to `lon` in output

Run with:
```bash
node --test tests/test_project_manager.js
```

---

**Task 8 — Smoke-test `demo_map.html`**

Open `output/berkeley/demo_map.html` as `file://` in Chrome. Verify:

**Panel and FAB:**
1. "Saved Projects" FAB visible at `bottom: 72px`.
2. Opening project manager closes what-if panel; opening what-if closes project manager.

**CRUD:**
3. New project: name, units, stories, drop pin, run analysis — tier badge appears.
4. Saved project appears in list with correct color dot and tier abbreviation.
5. Edit: saved pin restored on map; changing units + re-running updates result.
6. Delete: removed from list immediately.

**Persistence — FSAPI path (Chrome):**
7. Click "Save File" → native save dialog → pick `josh-projects-berkeley.json` → `[● unsaved]` clears.
8. Add another project → `[● unsaved]` reappears → auto-saves silently to same file.
9. Hard-reload page → projects restore from localStorage cache → `[● unsaved]` shown (file not yet re-linked).
10. Click "Load File" → pick same file → list reloads → `[● unsaved]` clears.

**Export:**
11. "Save File" (fallback path test in Firefox if available): file downloads as `.json`.
12. "Export YAML for pipeline": downloads `berkeley_demo.yaml`; open in text editor; confirm `lon` (not `lng`), correct values, no null-lat projects.

**Import:**
13. Round-trip: Save File → delete all projects → Load File → all projects restored.
14. Import duplicate: loading the same file twice does not create duplicate records.

---

## 8. Out of Scope

- **Geocoding** — "Address" is free text only. No address-to-lat/lng without a network call (`file://` constraint). Location is set only by dropping a pin.
- **Sorting or filtering the project list** — Renders in insertion order.
- **Sharing projects between users** — No server, no user accounts, no URL scheme.
- **Persistent project pins on the map** — Pins shown only while a project is open in the edit form; not a persistent layer alongside Folium FeatureGroups.
- **Schema migrations for `schema_v > 1`** — Added when a breaking change is made.
- **Undo / undo-delete** — Deleted projects are gone immediately. The file on disk is the backup.
- **Bulk operations** — No "delete all" or "run all" batch actions.
- **CDN path for `project_manager.js`** — Unlike `app.js`, no CDN URL. If the file is absent during the build, the FAB is simply not injected.
- **Determination brief HTML generation** — The full `brief_v3_*.html` format requires the Python pipeline. Client-side result display is a compact summary only.
- **FSAPI persistence across sessions** — The `FileSystemFileHandle` cannot be serialized to localStorage. The user must re-link their file each session via "Load File". This is a browser security constraint, not a bug.
