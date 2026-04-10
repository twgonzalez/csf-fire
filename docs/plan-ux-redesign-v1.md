# JOSH Demo Map — UX Redesign Implementation Plan
**Prepared:** 2026-04-09
**Design spec:** `docs/ux-spec-project-workflow-v1.md`
**Supersedes:** nothing — this is a new track running alongside `plan-project-manager-v2.md` (now complete)
**Repos affected:** `josh` (public) only — no pipeline changes required

---

## Problem Statement

The current demo map has two overlapping panels (What-If Analysis + Saved Projects) that both
let users analyze projects, creating a split mental model. The primary entry point is nearly
invisible. The workflow to reach a determination brief is three clicks from the surface with no
clear signposting. Button labels use developer/jargon language. `alert()` dialogs are used for
error states. Full diagnosis in `docs/ux-spec-project-workflow-v1.md`.

---

## Target Architecture (post-redesign)

```
One FAB: "Analyze a Project"
  → One panel (replaces both joshWhatIf + joshPM panels)
      ├── Form: Name / Units / Stories / Location
      ├── Pin mode: auto-active on open (no "Drop Pin" button)
      ├── Result: inline tier + per-route ΔT
      ├── Actions: [Save & Get Report]  [Start Over]
      └── Saved analyses: collapsible section at bottom
            ├── List rows: name · tier · [Report]
            └── Power tools: [Export for pipeline]  [Save session]  [Load session]
```

---

## Phased Build Plan

### Phase 1 — Copy and Labels (zero architectural risk)

**Goal:** Fix every confusing label and remove the wrong-audience disclaimer. No JS architecture
changes. Ships immediately; can be done in 30 minutes.

**Files:** `agents/visualization/demo.py` only (the what-if panel is baked here; the project
manager panel labels are in `static/project_manager.js`).

#### `agents/visualization/demo.py` — what-if panel

| Location | Current text | New text |
|---|---|---|
| FAB button label | `+ What-If Project` | `Analyze a Project` |
| Panel header | `What-If Analysis` | `Project Analysis` |
| Drop-pin button | `Drop Pin` | `Click map to locate` (pre-pin) / `Move pin` (post-pin) |
| Analysis trigger | `▶` icon with title "Analyze" | `Analyze` labeled button |
| Panel footer disclaimer | `Run main.py evaluate...` | *(remove entirely — disclaimer is already in the brief watermark)* |
| Result tier label | `MINISTERIAL` etc. | Unchanged — already correct |

#### `static/project_manager.js` — saved projects panel

| Location | Current text | New text |
|---|---|---|
| Open FAB label | `📋 Saved Projects` | `📋 Saved Analyses` |
| Panel header | `📋 Saved Projects` | `📋 Saved Analyses` |
| `+ New` button | `+ New` | *(will be removed in Phase 2; leave for now)* |
| `↓ Save` button | `↓ Save` | `↓ Save session` |
| `↑ Load` button | `↑ Load` | `↑ Load session` |
| ▶ icon in list row | title="Run analysis" | title="Analyze" |
| 📄 icon in list row | title="View Report" — icon only | Add text label: `Report` (show text next to icon) |
| YAML footer button | `⬇ Export YAML for pipeline` | `⬇ Export for pipeline` |
| `alert()` — no pin | `'Drop a pin first...'` | Inline form validation (red border + message under Location field) |
| `alert()` — analysis fail | `'Analysis failed: ' + e.message` | Inline error below result area |
| `alert()` — BriefRenderer not loaded | `'Brief renderer not loaded.'` | Inline error in result area |

**Rebuild:** `demo` for all 5 cities (picks up new panel labels). Tests unchanged — no logic changed.

---

### Phase 2 — Unified Panel (merge the two panels)

**Goal:** Replace both FABs and both panels with a single "Analyze a Project" panel that has a
collapsible "Saved analyses" section at the bottom. This is the architectural change that resolves
the dual-panel mental model.

**Files:** `agents/visualization/demo.py`, `static/project_manager.js`

#### What-if panel → becomes the primary panel

The `joshWhatIf` panel in `demo.py` becomes the unified panel. It gains:

1. **Auto-pin mode on open** — remove the "Drop Pin" button entirely. Opening the panel sets
   cursor to crosshair and shows instruction text in the Location field. First map click places
   the pin and runs analysis immediately.

2. **"Save & Get Report" combined action** — replaces the current separate save (in PM) and
   brief-open (📄 in PM list). Single button: saves project to PM state + opens brief modal.
   Appears after analysis runs. Name is optional (if blank, uses coordinates as identifier).

3. **"Start Over" button** — clears pin, result, route layers. Returns to pin-awaiting state.
   Does NOT close the panel.

4. **Inline error states** — all `alert()` calls replaced with styled inline messages inside
   the panel. No modal dialogs.

#### Project manager panel → becomes a collapsible section

The `joshPM` panel is folded into the bottom of the unified panel as a collapsible `<details>`
element:

```
▾ Saved analyses (3)
  ● Civic Tower    DISC  [Report]
  ● Acton Apts     COND  [Report]
  ● Elm Village    MIN   [Report]

  [Export for pipeline]  [Save session]  [Load session]
```

- The separate `josh-pm-panel` DOM element and `josh-pm-open-btn` FAB are removed.
- `window.joshPM.openPanel()` / `closePanel()` redirect to the unified panel.
- CRUD (edit/delete) still supported: clicking a project name loads it into the form;
  a small ✏/🗑 appear on hover or in an expanded row.
- The separate "Saved Projects" FAB button is removed.

#### Entry point

One FAB only: **"Analyze a Project"** (bottom-left, same position as current what-if FAB).
When the unified panel is open, FAB is hidden. When closed, FAB is visible.

#### Mutual-hide

The left demo panel (official project cards) and the unified right panel follow the same
mutual-hide logic that currently exists between the what-if and project manager panels.

**Tests:** `test_project_manager.js` — CRUD and persistence tests are unaffected (data model
unchanged). UI render tests (if any) need updating for new DOM structure. Add test: "collapsible
saved section renders project list."

**Rebuild:** All 5 cities.

---

### Phase 3 — Result Card and Map Feedback

**Goal:** The result display after analysis is currently minimal (just a tier badge and a list).
Improve it to show the key numbers inline, and give better map feedback.

#### Inline result card (in the unified panel)

After pin placed and analysis runs:

```
┌─────────────────────────────────────┐
│  ● DISCRETIONARY                    │
│  Very High FHSZ · 125 vehicles      │
│                                     │
│  Route A  ΔT 3.41 min  ▲ exceeds   │
│  Route B  ΔT 1.22 min  ✓ within    │
│                                     │
│  Max ΔT exceeds threshold on        │
│  1 of 2 serving routes.             │
└─────────────────────────────────────┘
```

Current state: only the tier badge appears. Route ΔT values are only visible inside the full
brief. This card shows enough for users to understand the result without opening the brief.

The card reads directly from `WhatIfEngine.evaluateProject()` result:
- `result.tier` → tier badge + color
- `result.hazard_zone` → FHSZ label
- `result.project_vehicles` → vehicle count
- `result.paths[]` → per-route ΔT and flagged status

#### Draggable pin re-analysis

Currently, moving the pin requires clicking "Move pin" then clicking the map. Phase 3 adds:
- The placed pin marker is `draggable: true` in Leaflet
- `dragend` event triggers debounced re-analysis (300ms)
- Route layers update in place

**Note:** This requires the PM marker to be set `draggable: true` and wired to `_runAnalysis`.

#### Below-threshold state

When `units < 15`, show:
> **Ministerial — Below threshold**
> This project has fewer than 15 units and does not require an evacuation capacity analysis.

"Save & Get Report" still available (a ministerial determination letter is still useful).

**Tests:** Add test vectors for below-threshold and no-paths-found cases.

---

### Phase 4 — Accessibility and Polish

**Goal:** Make the tool usable without color vision; add keyboard support; harden the modal.

- Brief modal: add focus trap (`Tab` cycles within modal), `Escape` closes, `aria-label="Determination letter"` on dialog container.
- Tier display: color is always paired with text label. Never color alone.
- Pin-awaiting state: show "Waiting for map click…" as visible text in the Location field, not just cursor change.
- Unsaved-changes indicator: when inputs change after a save, "Report" button in saved list shows a `⚠` tooltip: "Analysis has changed since this report was saved."
- Replace all remaining `alert()` / `confirm()` calls with styled inline confirmations.
- Error recovery: "No evacuation routes found" state shows "Try moving the pin to a road" with Move Pin button (not a disabled form).

---

## File Change Summary

| File | Phase | Change |
|---|---|---|
| `agents/visualization/demo.py` | 1 | Label fixes, disclaimer removal |
| `agents/visualization/demo.py` | 2 | Auto-pin mode, unified panel, "Save & Get Report" |
| `agents/visualization/demo.py` | 3 | Result card, draggable pin |
| `agents/visualization/demo.py` | 4 | Accessibility hardening |
| `static/project_manager.js` | 1 | Label fixes, inline errors replace alert() |
| `static/project_manager.js` | 2 | Saved analyses → collapsible section, remove separate FAB |
| `static/project_manager.js` | 3 | Draggable pin dragend handler |
| `static/project_manager.js` | 4 | Unsaved-changes indicator |
| `tests/test_project_manager.js` | 2 | Update for new DOM structure if needed |
| `static/v1/app.js` | (generated) | Rebuilt each phase via `demo` command |

No changes to: `static/brief_renderer.js`, `static/whatif_engine.js`, `static/whatif_utils.js`,
`agents/visualization/brief_v3.py`, `agents/export.py`, `config/parameters.yaml`.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Removing "Drop Pin" button breaks users who don't know to click map | Instruction text in Location field on open: "Click anywhere on the map to locate the project." Cursor crosshair is a secondary signal. |
| "Save & Get Report" creates a project with a blank name | Name field highlights (optional); project saved with coordinates as fallback identifier. Never blocked. |
| Collapsing PM into what-if panel changes `window.joshPM` API | Keep `joshPM.openPanel()` / `closePanel()` / `getProjects()` as stubs that redirect. Existing brief link intercepts (`joshBrief.show`) unchanged. |
| Phase 2 requires rebuilding all cities | Already established pattern — takes ~10 min parallel via josh-pipeline. |
| Draggable pin in Phase 3 conflicts with Leaflet's default drag behavior | Use `L.marker({ draggable: true })` and prevent propagation on `dragstart`. Standard Leaflet pattern. |
