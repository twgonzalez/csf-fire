# JOSH Demo Map — Project Workflow UX Spec
**Version 1.0 — April 2026**
**Status: Design spec — not yet implemented**

---

## 1. Who Uses This and What Their Job-to-be-Done Is

There are three user groups, each with a different job-to-be-done.

**The city planner or city attorney** opens the demo map to understand whether a proposed project qualifies for ministerial (as-of-right) approval under California housing law. Their job is not to explore numbers — it is to produce a legally defensible written record. They need to arrive at a determination letter they can attach to a staff report or send to an applicant. They are not technical users. The map is the entry point, but the determination letter is the deliverable that matters. Every UI decision should shorten the path from "here is a proposed project" to "here is the letter."

**The housing applicant or their consultant** opens the map to pre-screen a project before submitting to the city. Their job is to find out quickly whether the city will have discretion to deny the project. If the analysis shows MINISTERIAL, they want proof they can email to their attorney. If it shows DISCRETIONARY, they want to understand exactly which road segment is the bottleneck and whether changing the project size or location changes the answer. They will iterate — adjust units, move the pin, check again.

**The CSA analyst or JOSH administrator** uses the map to set up and validate official projects before a city presentation. Their job is to run the pipeline analysis on pre-baked projects, verify the outputs look correct, and hand the map file to a city. They are the only user who interacts with the YAML export feature or cares about localStorage persistence across sessions.

---

## 2. The Core Mental Model Problem with the Current Design

The current design has two separate panels that both let a user analyze a project: the **What-If Analysis** panel (bottom-left floating button) and the **Saved Projects** panel (a second floating button, location varies). They look like siblings. They are not.

The mental model the user actually needs is:

> **One workflow. Two modes: quick-explore or save-and-report.**

Instead, the current design presents them as two parallel tools with overlapping capability. Both let you set units, stories, and a pin location. Both run the WhatIfEngine. The difference — that "Saved Projects" persists the result and produces a brief, while "What-If Analysis" is ephemeral — is not communicated anywhere in the UI. A user who wants a report has no obvious reason to know they should use "Saved Projects" rather than "What-If Analysis." The button label "What-If" implies exploration, not a workflow dead-end. The button label "Saved Projects" implies a filing cabinet, not an analysis tool.

The second problem is that the primary trigger for the entire workflow is a small floating button labeled **"+ What-If Project"** in the bottom-left corner. On a busy street map, this is nearly invisible. New users do not see it, do not understand what it means, and do not know it leads to an analysis tool at all.

The third problem is that the determination brief — the legally significant output — is buried behind a small document icon (`📄`) in a list row inside the Saved Projects panel. There is no moment in the workflow where the user is told "this is where you are going." The brief is an afterthought, not a destination.

Fourth: the disclaimer at the bottom of the What-If panel reads `Run main.py evaluate for a binding audit trail.` This is developer language. City attorneys do not run Python commands. This disclaimer tells the wrong user the wrong thing, in the wrong place.

---

## 3. The Right Mental Model and Information Architecture

**The right mental model for users:** JOSH is a **determination tool**. You describe a project (location, size, height), JOSH analyzes it against the road network, and JOSH produces a **determination** — a formal document stating whether the project is ministerial, ministerial with conditions, or discretionary. The map is context. The determination letter is the point.

**The right information architecture:**

```
demo_map.html
├── LEFT PANEL — Official Projects (pipeline-baked, read-only)
│   └── Project selector + detail cards (existing, keep as-is)
│
├── MAP — Folium base layer
│   └── Official project markers (solid, color-coded)
│   └── Analysis pin (dashed circle, draggable) when active
│
└── RIGHT PANEL — Analyze a Project (replaces both current panels)
    ├── MODE A: Quick Analysis (ephemeral — no save, result clears on close)
    └── MODE B: Saved Analysis (persists — name it, save it, get a report)
```

The single right-side panel has two tabs or modes. It is opened by one clearly labeled primary action button. The workflow is linear: describe → locate → analyze → (optionally) save → get report.

There is no "Saved Projects" panel that is separate from the analysis workflow. Saving is an optional step inside the analysis workflow, not a parallel tool.

---

## 4. The Interaction Flow

### 4.1 Opening State

The map loads showing official project markers and the road network heatmap. The left demo panel shows the official project list (unchanged). There is a single button in the bottom-left:

**"Analyze a Project"**

That button is the only entry point to the what-if workflow.

---

### 4.2 Step 1 — The Analysis Panel Opens

Clicking "Analyze a Project" opens a right-anchored panel (or bottom-left, but distinct from the official project panel). The panel opens to a single unified form. There is no "quick" vs. "saved" distinction yet — that comes later.

```
┌─────────────────────────────────────┐
│  Analyze a Project            [✕]   │
├─────────────────────────────────────┤
│  Project name (optional)            │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  Dwelling units      Stories        │
│  ┌───────────┐       ┌───────────┐  │
│  │    50     │       │     4     │  │
│  └───────────┘       └───────────┘  │
│                                     │
│  Location                           │
│  ┌─────────────────────────────┐    │
│  │  No location set            │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ⊕  Click map to place pin  │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

The panel enters **pin-awaiting mode** immediately when it opens — the cursor changes to crosshair, the map is ready to receive a click. The user does not need to click a separate "Drop Pin" button first. The primary action on open IS dropping the pin.

The instruction text reads: **"Click anywhere on the map to locate the project."**

---

### 4.3 Step 2 — Pin Placed, Analysis Runs

On map click, the pin is placed, the analysis runs synchronously (WhatIfEngine is fast), and the result appears in the panel below the inputs. The pin icon turns the tier color (green/orange/red). Route polylines appear on the map.

```
┌─────────────────────────────────────┐
│  Analyze a Project            [✕]   │
├─────────────────────────────────────┤
│  Name (optional)  [______________]  │
│  Units [ 50 ]    Stories [ 4 ]      │
│  Location  37.8695° N, 122.2685° W  │
│            [Move pin]               │
├─────────────────────────────────────┤
│  ● DISCRETIONARY                    │
│  Very High FHSZ · 125 vehicles      │
│                                     │
│  Route A  ΔT 3.41 min  ▲ 3.00 max  │
│  Route B  ΔT 1.22 min  ✓           │
│                                     │
│  Max ΔT exceeds threshold on        │
│  1 of 2 serving routes.             │
├─────────────────────────────────────┤
│  [Save & Get Report]  [Start Over]  │
└─────────────────────────────────────┘
```

Changing units or stories triggers a 300ms debounced re-evaluation automatically. Dragging the pin triggers re-evaluation on dragend. The result area updates in place.

The two bottom buttons:
- **"Save & Get Report"** — saves the project to the persistent list and immediately opens the determination brief in a modal. This is the primary action when the result is ready.
- **"Start Over"** — clears pin, routes, and result; returns to pin-awaiting state. Does NOT close the panel.

---

### 4.4 Step 3 — Save & Get Report

Clicking "Save & Get Report":
1. If the project has no name, the name field gets a gentle highlight and a placeholder like "Name this project to save it" — but does NOT block the brief from opening. Name is optional.
2. The project is written to localStorage immediately.
3. The determination brief opens in a full-page modal overlay.
4. The brief has a **"Download as PDF"** or **"Print"** button prominent at the top.

The modal brief is a complete standalone document. It is the end of the workflow.

---

### 4.5 Step 4 — After Brief Closes

The modal closes. The panel is still visible showing the saved project's result. Two new buttons appear:

- **"View Report"** — reopens the brief modal for this project.
- **"Edit"** — returns to the input form with the existing values pre-filled.

At the bottom of the panel, a secondary link: **"View all saved analyses →"** expands an inline list of previously saved projects (if any exist in localStorage). This replaces the current separate "Saved Projects" panel entirely.

---

### 4.6 The Saved Analyses List (Inline)

The saved list is not a separate panel. It is a collapsible section at the bottom of the same panel. When collapsed, it shows only a count badge: "3 saved analyses." When expanded:

```
┌─────────────────────────────────────┐
│  ▾ Saved analyses (3)               │
│                                     │
│  ● Pine St Apts    DISC   [Report]  │
│  ● Oak Ave Mixed   MIN    [Report]  │
│  ● Elm Village     COND   [Report]  │
│                                     │
│  [Export YAML]  [Save session]      │
└─────────────────────────────────────┘
```

Each row shows: colored tier dot, project name, tier abbreviation, and a "Report" button that reopens the brief. There is no separate analyze button in the list — to re-analyze, the user clicks the project name to load it into the form.

The "Export YAML" and "Save session" (FSAPI/blob) buttons live here, clearly labeled for what they do. These are power-user features; they should not be prominent at the top level.

---

## 5. UI Layout — Key Screens

### 5.1 Map with Panel Open (Pin Placed)

```
┌──────────────────────────────────────────────────────────────────┐
│  JOSH  ·  Jurisdictional Objective Standards for Housing   BETA  │  ← top bar
└──────────────────────────────────────────────────────────────────┘
┌────────────────┐                            ┌─────────────────────┐
│ Official       │                            │ Analyze a Project ✕ │
│ Projects       │   [map / road network]     ├─────────────────────┤
│                │                            │ Name: [_______]     │
│ ○ Pine St · D  │    ◎ ←pin (red)            │ Units:50 Stories:4  │
│ ○ Elm Ave · M  │    ↑ routes                │ Location: 37.86°N   │
│                │                            │ [Move pin]          │
│                │                            ├─────────────────────┤
│                │                            │ ● DISCRETIONARY     │
│                │                            │ Very High FHSZ      │
│                │                            │ Route A  3.41 ▲     │
│                │                            │ Route B  1.22 ✓     │
│                │                            ├─────────────────────┤
│                │                            │ [Save & Get Report] │
│                │                            │ [Start Over]        │
└────────────────┘                            └─────────────────────┘
  [Analyze a Project]  ← floating FAB, bottom-left
```

When the analysis panel is open, the "Analyze a Project" FAB is hidden.

### 5.2 Brief Modal

```
┌──────────────────────────────────────────────────────────────────┐
│                      ← Back to Map           [Print / Save PDF]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│         DETERMINATION LETTER                                     │
│         JOSH-2026-PINE-ST-APTS-37_8695-N122_2685                │
│                                                                  │
│  ╔══════════════════════════════════════════════════════════╗   │
│  ║  DISCRETIONARY REVIEW REQUIRED                          ║   │
│  ╚══════════════════════════════════════════════════════════╝   │
│                                                                  │
│  Criterion A: Applicability  ✓ met (50 units ≥ 15)              │
│  Criterion B: Fire Zone      ✓ Very High FHSZ                   │
│  Criterion C: ΔT Analysis    ✗ Exceeds threshold (3.41 > 3.00)  │
│                                                                  │
│  [full brief content ...]                                        │
│                                                                  │
│  NOTE: This analysis is a what-if estimate. It is based on the   │
│  same methodology as the official pipeline but has not been      │
│  validated by a licensed engineer. Use for preliminary          │
│  screening only.                                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Terminology Corrections

| Current label | Problem | Correct label |
|---|---|---|
| "What-If Project" | Sounds like a toy, not a tool. Hides that it produces a legal document. | "Analyze a Project" |
| "What-If Analysis" (panel header) | Same problem. | "Project Analysis" |
| "Saved Projects" (panel header) | Sounds like a filing cabinet, not an action. | "Saved Analyses" |
| "Drop Pin" (button) | Jargon. Users say "place" or "locate," not "drop." | "Click map to locate" (instruction) / "Move pin" (after pin is placed) |
| "Drop New Pin" (button after pin placed) | Confusing — implies deleting the existing pin. | "Move pin" |
| "Run analysis" (▶ icon in list) | Icon-only, no label. | Row click loads project into form; run is implicit. |
| "Export YAML for pipeline" | Developer language. Meaningless to city planners. | "Export for pipeline" with tooltip explaining what this is. |
| `Run main.py evaluate for a binding audit trail.` | Completely wrong audience. | "What-if estimates only. Official determinations require a licensed analysis." |
| "MIN / COND / DISC" (tier abbreviations) | COND is ambiguous. | "MIN / STD / DISC" is acceptable; better: show full label wherever space allows. |
| "Ministerial w/ Conditions" | Too long. | "Ministerial — Standard Conditions" in brief; "Conditional" in compact list. |
| "📄" (brief button icon) | Icon alone is invisible in a list row. | Labeled button: "Report" or "View Report" |

---

## 7. What to Keep, What to Cut, What to Change

### Keep

- The draggable pin with crosshair-mode entry. This interaction is correct and intuitive.
- Auto re-evaluation on input change (300ms debounce). This is a good live-update pattern.
- Route polylines with color ramp (green/yellow/orange/red). Clear and useful.
- Bottleneck segment highlight (thick line). Correctly draws attention to the constraint.
- The tier color system (green/orange/red). Consistent across all views.
- `BriefRenderer.render()` producing a complete standalone HTML document. The architecture is right.
- The yellow "what-if estimate" banner in the brief. The disclaimer is correct — it just needs to be in the brief, not in the panel footer.
- localStorage persistence across sessions. Keep, but make it invisible — users should not manage it manually.
- FSAPI save/load. Keep as a power-user feature in the collapsed "Saved analyses" section.
- YAML export. Keep. Move to the collapsed section with a clearer label.

### Cut

- The separate "Saved Projects" panel as a sibling to the What-If panel. The two-panel architecture is the root of the mental model problem. Merge into one panel.
- The separate "Saved Projects" floating button. One entry point only.
- The `main.py evaluate` disclaimer. Wrong audience, wrong context. Replace entirely.
- The `▶` (analyze) icon button in the saved list. Re-analyzing from the list is confusing — load the project into the form instead.
- The `📄` icon-only brief button. Replace with a labeled "Report" button.
- The "New" button at the top of the saved list. There is no separate "new" action — opening the panel already starts a new analysis.

### Change

- The "Saved Projects" concept becomes a collapsible section inside the unified panel. Not a separate panel.
- "Drop Pin" as a button action becomes the default state on open (crosshair activated automatically, no button click needed).
- "Save & Get Report" replaces two separate steps (save, then separately open brief). One action, both things happen.
- The panel title changes from "What-If Analysis" to "Analyze a Project."
- The floating trigger button label changes from "+ What-If Project" to "Analyze a Project."
- The disclaimer moves from the panel footer to the brief watermark banner (where it already is in the current brief renderer). Remove it from the panel entirely.

---

## 8. Edge Cases and States

### Empty State (no projects saved)

The "Saved analyses" section shows: *"No saved analyses. Run an analysis above and click 'Save & Get Report' to save it here."*

Do not show the Export YAML or Save session buttons when the list is empty — they are irrelevant.

### No-Pin State (panel open, map not yet clicked)

The panel shows the form with inputs but the result area is absent (not empty — absent). The "Save & Get Report" button is replaced by a disabled state: it is grayed out with a tooltip "Locate the project on the map first." The instruction text reads: "Click anywhere on the map to locate the project." The cursor is crosshair.

Do not show a "Drop Pin" button. The action is already active. Showing a button for an already-active action creates confusion.

### Analysis Error (no serving paths found)

If `WhatIfEngine.evaluateProject()` returns 0 serving paths, the result area shows:

> **No evacuation routes found near this location.**
> This location may be outside the city's road network, or no routes exist within 0.5 miles of the pin. Try moving the pin to a road.

The tier is not shown. "Save & Get Report" is disabled. The pin remains on the map so the user can drag it.

### Analysis Error (engine exception)

If the engine throws, show the error message in the result area with a secondary action: "Try a different location" (triggers move-pin mode). Do not show an `alert()` dialog — those are disruptive and cannot be styled.

### Project Below Threshold (< 15 units)

The result shows "MINISTERIAL" in green. The explanation is brief: *"Below the 15-unit applicability threshold. No evacuation capacity analysis required."* "Save & Get Report" is still available — users may want a record of the ministerial determination.

### Unsaved Changes (pin moved, result changed since last save)

If the user moves the pin or changes inputs after saving, the saved result is stale. Show a subtle indicator: the "View Report" button in the saved list gets a warning dot and a tooltip: "Analysis has changed since this report was saved. Re-run to update."

### Multiple Saved Projects, Switching Between Them

Clicking a saved project name in the collapsed list loads that project into the form (pre-fills name, units, stories, coordinates, and shows the existing result). The pin moves to that project's location. The user can then edit any field — doing so starts a debounced re-evaluation automatically. Clicking "Save & Get Report" overwrites the existing saved project (same ID), not creating a new one.

### Panel vs. Official Project Layer Conflict

When the user places a what-if pin, the currently selected official project's route layer is hidden (this already exists in the code). This is correct. Restore the official layer when:
- The user clicks "Start Over" (clears the what-if analysis), OR
- The user closes the analysis panel.

### Mobile / Narrow Viewport

Not a primary use case (city planners use desktop browsers). However, the panel should not overflow the viewport. At widths below 500px, the panel should collapse to a bottom drawer rather than a right-anchored float. This is out of scope for the current sprint but worth noting.

### File: URL Context

The map is delivered as `file://` with all JS inlined. No server dependency. Blob downloads work. FSAPI may not work on all browsers from `file://` — the blob fallback is correct. No changes needed here.

---

## 9. Accessibility and Non-Functional Notes

- The brief modal needs a focus trap and an `aria-label="Determination letter"` on the dialog container. Currently there is none.
- The tier color alone is not sufficient — the tier label text must always accompany the color dot. Do not rely on color alone to convey determination status.
- The crosshair cursor state needs a visible text indicator in the panel ("Waiting for map click…") because cursor changes alone are not perceivable to all users.
- Print/PDF is the primary export mechanism for the brief. The brief renderer's `_buildPrintCss()` already handles this. Ensure the "Print" button in the modal triggers `window.print()` on the brief's iframe/window, not on the map page.

---

## 10. Implementation Priority Order

This spec covers the full target state. For a phased build:

**Phase 1 (immediate, low-risk):** Rename all button labels and disclaimer text per §6 above. No architectural change, just copy.

**Phase 2 (medium):** Merge the two panels into one. Move saved list to a collapsible section. Remove the separate "Saved Projects" button. Add "Save & Get Report" as a combined action.

**Phase 3 (larger):** Auto-enter pin mode on panel open. Eliminate the "Drop Pin" button as a separate step. Add inline error states (replace alert() calls).

**Phase 4 (polish):** Unsaved-changes indicator. Mobile drawer layout. Accessibility hardening.
