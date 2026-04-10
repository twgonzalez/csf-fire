# JOSH Demo Map — UX Spec v2
**Version 2.0 — April 2026**
**Status: Active design spec**
**Supersedes:** `docs/ux-spec-project-workflow-v1.md` (archived)

---

## 1. Design Principles

Three principles govern every decision in this spec.

**One class of project.** There is no distinction between a project that came from the
Python pipeline and one a city planner created in the browser. Both get the same full
analysis — AntPath route animations, per-route ΔT, determination brief, FHSZ lookup.
The pipeline is a city-setup tool, not an analysis tool. Analysis is the browser's job.

**The OS is the file manager.** Projects are files. The app does not maintain a database,
a "saved projects" list, or any internal archive. Sorting, searching, organizing, sharing,
and backing up projects are the OS's job — Finder or Explorer does this better than any
in-app UI ever will. The sidebar shows what is loaded in the current session, nothing more.

**Sidebar + map, always split.** The sidebar is always visible. The map is always visible.
There are no floating buttons, no hidden panels, no modals for primary workflow actions.
The pattern is Google Maps / Felt: the sidebar is the workspace; the map is the context.

---

## 2. Who Uses This

**City planner or city attorney.** Needs to produce a legally defensible written record.
Arrives at the map with a proposed project in hand. Wants to reach a determination letter
with minimum friction. Not technical.

**Housing applicant or consultant.** Pre-screening before submission. Wants a quick answer
and an exportable record. Will iterate — change units, move the pin, compare locations.

**CSA analyst.** Sets up the initial project set for a city presentation. Manages the
pipeline-seeded projects, adds new ones, verifies results. The only user who interacts
regularly with Save As… and Export for pipeline.

---

## 3. Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  JOSH  ·  Jurisdictional Objective Standards for Housing       BETA  │
└──────────────────────────────────────────────────────────────────────┘
┌───────────────────────┐  ┌───────────────────────────────────────────┐
│  Berkeley, CA         │  │                                           │
│  [+ New]   [Open…]    │  │                                           │
│  ─────────────────── │  │                                           │
│  ● Pine St Apts  DISC │  │              MAP                          │
│  ○ Ashby Small   MIN  │  │                                           │
│  ○ Oak Ave Mixed MIN  │  │    ◎ ← active pin                        │
│  ○ Elm Village   COND │  │    ╌╌ AntPath routes                     │
│  ─────────────────── │  │                                           │
│                       │  │                                           │
│  PINE ST APTS         │  │                                           │
│  ██ DISCRETIONARY     │  │                                           │
│  Very High FHSZ       │  │                                           │
│  125 vehicles         │  │                                           │
│                       │  │                                           │
│  Route A  3.41 min ▲  │  │                                           │
│    > 2.25 min max     │  │                                           │
│  Route B  1.22 min ✓  │  │                                           │
│                       │  │                                           │
│  [View Report]        │  │                                           │
│  [Edit]   [Delete]    │  │                                           │
│  ─────────────────── │  │                                           │
│  [Save]  [Save As…]   │  │                                           │
│  [Export for pipeline]│  │                                           │
└───────────────────────┘  └───────────────────────────────────────────┘
```

**Sidebar width:** ~320px, fixed. Not resizable.
**Map:** Takes remaining width. Always interactive — scrolling, zooming, clicking all work
while the sidebar is open.
**Top bar:** City name + version. Static. Not interactive.

---

## 4. The Sidebar in Detail

### 4.1 Header

```
│  Berkeley, CA         │
│  [+ New]   [Open…]    │
```

- **City name:** From `JOSH_DATA.city_name`. Not editable.
- **+ New:** Opens the project form in the sidebar (§5.2). Map immediately enters
  pin-awaiting mode. No secondary click required.
- **Open…:** FSAPI file picker (`showOpenFilePicker`), accepts `.json`, multiple files
  allowed. Each selected file is loaded, analyzed if result is stale, and added to the
  project list. Blob-input fallback for browsers without FSAPI.

### 4.2 Project List

```
│  ● Pine St Apts  DISC │  ← selected (filled dot)
│  ○ Ashby Small   MIN  │
│  ○ Oak Ave Mixed MIN  │
│  ○ Elm Village   COND │
```

Each row:
- **Dot:** Filled when selected, hollow otherwise. Color matches tier
  (green = MIN, orange = COND, red = DISC). Gray dot if no analysis result yet.
- **Project name:** Truncated with ellipsis if too long. Full name in tooltip.
- **Tier badge:** Right-aligned abbreviation, colored. MIN / COND / DISC.

**Interaction:**
- Click a row → selects the project. Detail card updates. Map draws that project's routes.
- Clicking the selected row again → deselects. Detail card hides. Routes clear.
- No drag-to-reorder. Order is insertion order (pipeline seeds first, then opened files).

**Population:**
- On load: pipeline-seeded projects from `JOSH_DATA.projects` appear first.
- Opening a file appends it to the list.
- Creating a new project appends it after save.
- Deleting removes it from the list and clears its routes from the map.

### 4.3 Detail Card

Appears below the project list when a project is selected. Hidden when nothing is selected.

```
│  PINE ST APTS               │
│  ████████ DISCRETIONARY     │
│  Very High FHSZ  ·  50 units│
│  125 vehicles               │
│                             │
│  Route A  3.41 min  ▲       │
│    Bottleneck: Telegraph Ave │
│    > 2.25 min threshold      │
│  Route B  1.22 min  ✓       │
│    Bottleneck: Ashby Ave     │
│                             │
│  [View Report]              │
│  [Edit]        [Delete]     │
```

**Tier block:** Full-width colored banner. Color: green / orange / red. Text: full tier
name (`MINISTERIAL`, `MINISTERIAL WITH STANDARD CONDITIONS`, `DISCRETIONARY`).

**Summary line:** FHSZ zone label · unit count.

**Vehicle count:** `project_vehicles = units × 2.5 × 0.90`, shown as "N vehicles."
Egress penalty shown if `egress_minutes > 0`: "+ 4.5 min egress penalty (3 stories)."

**Route rows:** One per serving path. Shows route label (A, B, C…), ΔT in minutes, and
pass (✓) or fail (▲) indicator. On fail: shows threshold. On either: shows bottleneck
road name on a sub-line.

**View Report:** Primary action. Opens the determination brief in a full-screen modal.
Always available if a result exists.

**Edit:** Switches sidebar to form view (§5.3) pre-populated with this project's values.
Pin is placed on the map at the existing coordinates.

**Delete:** Inline confirmation ("Delete Pine St Apts? [Yes] [Cancel]") — no alert() dialog.
Removes from list, clears routes from map. Does not delete the file from disk.

### 4.4 Footer

```
│  [Save]  [Save As…]         │
│  [Export for pipeline]      │
```

Visible when a project is selected and has a result.

**Save:** Writes to the existing file handle (if opened from file or previously saved with
Save As…). If no handle exists (project was created with + New and not yet saved), behaves
as Save As….

**Save As…:** FSAPI `showSaveFilePicker`. Default filename: `{city_slug}_{project_slug}.json`.
On success, the project is associated with the new handle for future Save operations.
Blob download fallback for non-FSAPI browsers.

**Export for pipeline:** Writes a YAML file suitable for `{city}_demo.yaml` in josh-pipeline.
Same as current YAML export. Power-user feature; not prominent.

---

## 5. Interaction Flows

### 5.1 Selecting a Project

1. User clicks a project row.
2. Sidebar: detail card appears below the list with that project's data.
3. Map: previous route layers clear. New AntPath routes draw for the selected project.
   Routes are color-coded by tier. Bottleneck segment draws as a thick overlay line.
4. Map pans to fit the project's routes in view if they are off-screen.

### 5.2 Creating a New Project (+ New)

```
│  ─────────────────── │
│  NEW PROJECT          │
│  Name (optional)      │
│  ┌─────────────────┐  │
│  │                 │  │
│  └─────────────────┘  │
│                       │
│  Units      Stories   │
│  ┌───────┐  ┌───────┐ │
│  │  50   │  │   4   │ │
│  └───────┘  └───────┘ │
│                       │
│  Location             │
│  Click map to locate  │  ← crosshair cursor active on map
│                       │
│  [Cancel]             │
```

1. User clicks **+ New**.
2. Sidebar: project list scrolls up (or collapses) to make room. Form appears in the
   lower portion of the sidebar.
3. Map: cursor immediately becomes crosshair. Instruction text in Location field:
   **"Click map to locate."** No button required — pin mode is active on open.
4. User clicks the map → pin placed (dashed circle marker). Analysis runs immediately.
   Location field shows coordinates. Result appears below the form:

```
│  Location             │
│  37.8695° N           │
│  122.2685° W  [Move]  │
│                       │
│  ████ DISCRETIONARY   │
│  Route A  3.41 ▲      │
│  Route B  1.22 ✓      │
│                       │
│  [Save]  [Save As…]   │
│  [Cancel]             │
```

5. User can change Units or Stories — analysis re-runs with 300ms debounce.
6. User can click **Move** → re-enters crosshair mode. Next map click replaces pin,
   re-runs analysis.
7. **Save / Save As…:** Project is written to file, added to the project list, form
   closes, new project is selected in the list, detail card shows.
8. **Cancel:** Form closes. No project added. Map clears pin and routes.

Name is optional throughout. If blank at save time, project is named by coordinates:
`37.8695° N, 122.2685° W`. User can rename via Edit later.

### 5.3 Editing a Project

1. User clicks **Edit** in the detail card.
2. Form opens pre-populated with name, units, stories, coordinates. Pin is placed on map
   at existing location. Routes remain visible.
3. User makes changes. Analysis re-runs on any input change (debounced) or pin move.
4. **Save:** Overwrites existing file. Project list row updates. Form closes. Detail card
   shows updated result.
5. **Save As…:** Saves to a new file. Original file is unchanged. New project added to
   list.
6. **Cancel:** Reverts to saved values. Detail card returns without changes.

### 5.4 Opening a File (Open…)

1. User clicks **Open…**.
2. FSAPI file picker opens. User selects one or more `.json` files.
3. Each file is validated (schema_v, city_slug match).
4. If `result` is present in the file and `analyzed_at` + `josh_version` match current:
   result is used as-is, routes can be drawn immediately.
5. If result is stale or absent: analysis runs automatically, result is written back to
   the file (via stored file handle).
6. Project(s) added to list. First opened file is auto-selected.

### 5.5 Viewing a Report

1. User clicks **View Report** in the detail card.
2. `BriefRenderer.render()` generates the determination brief HTML from the stored result.
3. Brief opens in full-screen modal overlay (same as current implementation).
4. Modal has: **Print** button (`iframe.contentWindow.print()`), **Download** button
   (Blob download), **← Back** button to close.
5. Modal is not tied to Save — a report can be viewed before saving to file.

### 5.6 Session Restore on Reload

1. Page loads. Pipeline-seeded projects from `JOSH_DATA.projects` populate the list.
2. IndexedDB is checked for stored `FileSystemFileHandle` objects from the previous session.
3. If handles exist: banner appears at top of sidebar: **"Restore previous session? [Yes]
   [No]"**. "Yes" attempts to reload each file (browser may prompt for permission re-grant
   on `file://` origin). "No" dismisses without loading.
4. If no handles: sidebar shows pipeline-seeded projects only. No banner.

---

## 6. Map Behavior

### Route Rendering

All projects — pipeline-seeded and browser-created — get identical route rendering:

- **AntPath animation:** Animated dashed flow line indicating direction of travel.
  Color by tier: green (MIN), orange (COND), red (DISC).
- **Bottleneck segment:** Thick solid overlay on the single worst-capacity segment.
  Same tier color, higher opacity, `weight: 6` (vs AntPath `weight: 3`).
- **Coordinates:** Full OSM edge geometry (10–100+ points per segment), extracted from
  `JOSH_DATA.graph.edges` at analysis time. Never straight-line node-to-node construction.

### Pin Marker

- Style: dashed circle DivIcon (same as current what-if marker).
- Color: tier color after analysis; blue/neutral before analysis.
- Draggable: `true`. `dragend` event triggers debounced re-analysis (300ms).
- Visible only in New/Edit form states. Removed on Cancel or after Save when returning
  to list view (selected project's official pin takes over).

### Layer Management

- Only the selected project's routes are drawn. All others are hidden.
- Deselecting clears all route layers from the map.
- Switching projects: previous layers removed, new layers added in one operation (no flash).

### Crosshair Mode

- Active when: New form is open and no pin placed yet; user clicks Move in form.
- Visual: `map.getContainer().style.cursor = 'crosshair'`.
- Text: "Click map to locate" in Location field (visible text, not just cursor change).
- Exits on: map click (pin placed), Cancel, or Escape key.

---

## 7. Project File Format

Each project is a single `.json` file. This is the canonical record for a browser-created
project. It is self-contained — loading the file into any JOSH map for the same city
produces the full analysis view with no re-computation required.

```json
{
  "schema_v": 1,
  "city_slug": "berkeley",
  "josh_version": "1.0.0",
  "parameters_version": "4.0",
  "name": "Pine St Apts",
  "address": "123 Pine St, Berkeley CA",
  "lat": 37.8695,
  "lng": -122.2685,
  "units": 50,
  "stories": 4,
  "source": "browser",
  "created_at": "2026-04-09T19:45:00Z",
  "analyzed_at": "2026-04-09T19:45:12Z",
  "result": {
    "tier": "DISCRETIONARY",
    "hazard_zone": "vhfhsz",
    "in_fire_zone": true,
    "project_vehicles": 112,
    "egress_minutes": 0,
    "delta_t_threshold": 2.25,
    "paths": [
      {
        "route_id": "A",
        "delta_t": 3.41,
        "flagged": true,
        "bottleneck_osmid": "12345678",
        "bottleneck_name": "Telegraph Ave",
        "bottleneck_road_type": "secondary",
        "bottleneck_lanes": 2,
        "bottleneck_speed": 35,
        "effective_capacity_vph": 1976,
        "hazard_degradation_factor": 0.65,
        "coordinates": [[37.869, -122.268], [37.870, -122.267]]
      }
    ]
  },
  "brief_cache": "<!DOCTYPE html>..."
}
```

**`source`:** `"browser"` for user-created; `"pipeline"` for projects seeded from
`JOSH_DATA`. Used only for internal auditability — no visible distinction in the UI.

**`brief_cache`:** Full brief HTML string. Stored so View Report works offline after
reload without re-running `BriefRenderer`. Regenerated on any re-analysis.

**`coordinates`:** Full WGS84 geometry chain for each path, extracted from
`JOSH_DATA.graph.edges` by the WhatIfEngine at analysis time. Stored here so routes
redraw from file without re-running Dijkstra.

**Stale result detection:** Compare `parameters_version` in file to current
`JOSH_DATA.parameters_version`. If different, re-analyze automatically on open.

---

## 8. FSAPI and Persistence

### File handle lifecycle

1. **+ New → Save As…:** `showSaveFilePicker()` → `FileSystemFileHandle`. Handle stored
   in IndexedDB keyed by project ID.
2. **Open…:** `showOpenFilePicker()` → `FileSystemFileHandle`. Handle stored in IndexedDB.
3. **Save (existing handle):** `handle.createWritable()` → write → close. No picker shown.
4. **Reload:** IndexedDB yields handle objects. Browser may require permission re-grant
   (`handle.requestPermission({ mode: 'readwrite' })`). This is an OS security behavior,
   not an app bug.

### Fallback (no FSAPI or file:// restriction)

- **Save:** Blob download to `~/Downloads`. No persistent handle. Future saves use
  download again (no overwrite-in-place).
- **Open:** `<input type="file" accept=".json">` element triggered programmatically.
- **Session restore:** Not available without FSAPI. Sidebar shows pipeline-seeded
  projects only on reload.

The fallback is fully functional for the primary workflow (create, analyze, view report,
download). Only session restore and in-place overwrite require FSAPI.

---

## 9. States and Edge Cases

### No projects loaded

```
│  Berkeley, CA         │
│  [+ New]   [Open…]    │
│  ─────────────────── │
│  No projects yet.     │
│  Create one with      │
│  + New or open a      │
│  saved file.          │
```

Export and Save buttons are hidden. Detail card is hidden.

### Analysis error — no routes found

Result area in form shows:
> **No evacuation routes found near this location.**
> This location may be outside the road network. Try moving the pin to a road.

Tier block does not appear. Save is disabled. Pin remains on map — user can drag it.

### Analysis error — engine exception

> **Analysis error:** [error message]
> Try moving the pin to a different location.

### Project below threshold (< 15 units)

Result shows MINISTERIAL in green:
> **MINISTERIAL — Below size threshold.**
> Fewer than 15 units. No evacuation capacity analysis required.

View Report and Save are available. A ministerial determination letter is a valid output.

### Stale result on file open

If `parameters_version` in file does not match current `JOSH_DATA.parameters_version`:
- Analysis re-runs automatically on open.
- Brief cache is regenerated.
- File is written back to disk (via stored handle) with updated result.
- A one-line notice appears in the detail card: "Re-analyzed: parameters updated."

### City slug mismatch on file open

If `city_slug` in file does not match `JOSH_DATA.city_slug`:
- File is not loaded.
- Inline error in sidebar: "This project file is for [city] — open it in that city's map."

### Unsaved changes (inputs changed since last save)

- Save button gets a subtle indicator: `●` dot prefix.
- Detail card shows: "Unsaved changes" in small text below the tier block.
- Closing the panel or navigating away does not warn (browser `file://` can't intercept
  unload reliably — don't create a false promise of safety).

---

## 10. Terminology (Final)

| Location | Label |
|---|---|
| Sidebar open button | *(no button — sidebar is always visible)* |
| Create action | **+ New** |
| Load from disk | **Open…** |
| Write to disk | **Save** / **Save As…** |
| Project list header | *(none — city name serves as header)* |
| Tier: ministerial | **MINISTERIAL** (full); **MIN** (compact row) |
| Tier: conditional | **MINISTERIAL WITH STANDARD CONDITIONS** (full); **COND** (compact) |
| Tier: discretionary | **DISCRETIONARY** (full); **DISC** (compact) |
| Pin action (no pin) | **Click map to locate** (instruction text, not button label) |
| Pin action (pin exists) | **Move** (small button next to coordinates) |
| Brief trigger | **View Report** |
| YAML export | **Export for pipeline** |
| Pipeline-seeded indicator | *(none in UI — internal `source` field only)* |

---

## 11. What This Replaces

| Retired element | Reason |
|---|---|
| `+ What-If Project` / `Analyze a Project` FAB | Sidebar is always visible — no entry button needed |
| `What-If Analysis` / `Project Analysis` floating panel | Replaced by sidebar form state |
| `Saved Projects` / `Saved Analyses` FAB | Replaced by sidebar project list |
| `Saved Analyses` floating panel | Replaced by sidebar project list |
| Top-right official project panel (Folium-generated) | Replaced by sidebar detail card |
| Official project dropdown `<select>` | Replaced by sidebar project list rows |
| localStorage project storage | Replaced by OS files (FSAPI) |
| `window.joshWhatIf` global | Replaced by `window.joshSidebar` |
| `window.joshPM` global | Replaced by `window.joshSidebar` |
| `static/project_manager.js` | Replaced by `static/sidebar.js` |

**Not replaced:** `BriefRenderer`, `WhatIfEngine` (algorithm), `brief_renderer.js`,
`whatif_utils.js`, the brief modal (joshBrief), the Python pipeline, `parameters.yaml`.

---

## 12. Technical Findings — Pre-Implementation Verification

These findings were confirmed by reading the actual source files before writing the
implementation plan. They correct assumptions made during design.

### 12.1 Edge geometry is not in JOSH_DATA

`agents/export.py` serializes graph edges with these fields only:
`u`, `v`, `osmid`, `len_m`, `speed_mph`, `eff_cap_vph`, `fhsz_zone`, `haz_deg`,
`name`, `road_type`, `lanes`.

The Shapely LineString geometry (the actual road curve — 10–100+ intermediate points per
segment) is **not serialized**. Nodes carry `lat`/`lon` but edges only reference node IDs.

**Impact:** The WhatIfEngine currently builds `path_coords` from node positions only
(confirmed at `export.py` lines 231–233: `pathNodes.map(id => [p.lat, p.lon])`).
All JS-drawn routes are straight lines between intersections, not actual road curves.

**Fix:** Add `geom: [[lat, lon], ...]` to each edge entry in `export.py`. Coordinates
stored at 5-decimal precision (~1m accuracy). Estimated size addition: ~1.5 MB per city
(acceptable for a self-contained file). This enables the JS engine to apply the same
direction-detection + segment-chaining logic as `wildland.py`.

### 12.2 JOSH_DATA has no `projects` field

Pipeline-seeded projects are not passed as data to the browser. Python computes
`path_wgs84_coords` (full geometry) in `wildland.py`; `demo.py` consumes this to bake
Folium FeatureGroup calls (AntPath, popup HTML, markers) directly into the HTML as
static Leaflet JS. No project data is available to JS at runtime via `JOSH_DATA`.

**Impact:** The sidebar cannot initialize with seed projects at page load unless they
are added to `JOSH_DATA`.

**Fix:** Add a `projects` array to `JOSH_DATA` in `export.py`. Each entry contains the
full project result including path coordinates (from Python's `path_wgs84_coords`),
bottleneck metadata, tier, and brief HTML. On load, `sidebar.js` reads
`JOSH_DATA.projects` and populates the initial project list. Folium FeatureGroups
for seed projects are then retired — `sidebar.js` draws their routes via the same
AntPath renderer used for all projects.

### 12.3 WhatIfEngine `path_coords` field exists but is node-only

The JS engine already returns `path_coords: [[lat, lon], ...]` on each serving path
object (confirmed in `export.py` JS strings). The field exists and flows through the
entire result chain. It only needs to be rebuilt using `edge.geom` once geometry is
added to JOSH_DATA edges (§12.1). No schema additions required — only the construction
logic changes.

### 12.4 wildland.py geometry logic is directly portable to JS

The Python algorithm (`wildland.py` lines 518–561) is clean and translatable:
1. Get `edge.geom` (array of `[lat, lon]` after WGS84 conversion in export.py)
2. Direction check: compare `geom[0]` and `geom[-1]` to source node position
   (Euclidean distance in lat/lon space — sufficient at city scale)
3. Reverse array if `geom[-1]` is closer to the source node than `geom[0]`
4. Chain: skip `geom[0]` of each segment when path is non-empty (avoids duplicate
   junction point)
5. Fallback: if `edge.geom` is absent, use `[node.lat, node.lon]` endpoints

No CRS transform needed in JS — `export.py` stores geometry already in WGS84.

### 12.5 Bottleneck metadata in base.py, not yet in WhatIfEngine return

Python `base.py compute_delta_t()` produces full bottleneck metadata per path:
`bottleneck_name`, `bottleneck_road_type`, `bottleneck_lane_count`,
`bottleneck_speed_limit`, `bottleneck_hazard_degradation`, etc.

The WhatIfEngine JS currently returns only `bottleneckOsmid`, `bottleneckEffCapVph`,
`bottleneckFhszZone` per path. The remaining fields need to be added to the JS serving
path object by looking up the bottleneck edge in `JOSH_DATA.graph.edges` by osmid.
These are needed by the detail card (§4.3) and the brief renderer.

---

## 13. Out of Scope for This Spec

- **Mobile / narrow viewport.** Desktop-first. Below 600px the sidebar collapses
  to a bottom drawer — design separately.
- **Multi-city in one session.** Each map file is one city. Cross-city comparison
  is a separate product question.
- **Cumulative load analysis.** Adding the ΔT contributions of multiple projects
  simultaneously. Tracked in methodology backlog.
- **Cloud sync.** Projects are local files. No server, no account, no sync.
  Out of scope until a hosted product decision is made.
