# Session Prompt: Evaluation Map UX Redesign

## Context
Please review CLAUDE.md and MEMORY.md before starting. This is a continuation of
the csf-fire project — a legally-focused fire evacuation capacity analysis system.

## Task: Rewrite `agents/visualization/evaluation.py`

Redesign the evaluation map UX to reflect a city planner's actual workflow. A planner
receives a project packet (location + unit count), runs the evaluation, and needs one
clear answer: ministerial or discretionary? And if discretionary, which standard triggered it?

### What to DELETE from the current evaluation map
- The Scenario A / Scenario B toggle (A/B selector dropdown)
- Per-scenario route coloring (routes colored by which scenario identified them)
- Separate wildland vs. local5 route layers — replace with one unified layer

### What the New Map Must Have

**Left panel — Standards Checklist:**
```
PROJECT: 37.87°N, -122.268°W
75 units · Berkeley, CA

████ CONDITIONAL MINISTERIAL          ← big, color-coded pill
                                        (green=MINISTERIAL, amber=CONDITIONAL, red=DISCRETIONARY)
Standards Evaluation:
✓ Std 1  City in FHSZ zone            ← pass/fail icon + short label
✓ Std 2  75 ≥ 50 units
✓ Std 3  75 serving routes found
✗ Std 4  0 routes flagged
✗ Std 5  disabled

[Std 4 note if not triggered]:
No serving route was pushed across v/c 0.95
by this project. (74 routes already failing
at baseline — pre-existing congestion.)

Peak-hour vehicles added: 107 vph
```

**Map — Two route states, one unified layer:**
- **Serving routes** (steel blue / #4A90D9, weight 3): all routes identified by any active standard
- **Flagged routes** (orange-red / #E84040, weight 5): routes where THIS project causes `baseline_vc < 0.95 AND proposed_vc >= 0.95`
- FHSZ zones (existing layer, unchanged)
- Project pin (existing, color-coded by tier)
- City boundary (existing)

**Bottom-right Standards Legend with eye toggles:**
Each standard gets one row. Clicking the eye shows/hides that standard's map elements.
This is a Leaflet layer-visibility toggle only — no recalculation.

```
EVACUATION STANDARDS
━━━━━━━━━━━━━━━━━━━━
● Serving routes    [👁]   ← toggles the unified serving routes layer
● Flagged routes    [👁]   ← toggles the flagged routes layer
──────────────────────
✓ Std 1 · FHSZ zone       [👁]   ← toggles fhsz layer
  Std 2 · Scale (75≥50)   [—]   ← no map element; show "—" not [👁]
✓ Std 3 · Wildland routes (0.5 mi) [👁] ← toggles wildland-identified routes subset
✗ Std 4 · V/C threshold   [👁]   ← toggles flagged routes layer
✗ Std 5 · Local routes (0.25 mi)  [👁] ← toggles local5-identified routes subset
```

For Std 3 and Std 5 toggles: these hide/show the subset of serving routes that
each standard identified. A route identified by BOTH Std 3 and Std 5 stays visible
if either is toggled on (use separate FeatureGroup layers per standard, all showing
the same color — the unified serving color).

### Data Available in the `audit` Dict
The audit dict passed to `create_evaluation_map()` already contains per-scenario
step results. Key paths:

```python
# Wildland scenario (Standards 1–4)
audit["scenarios"]["wildland_ab747"]["steps"]["step3_routes"]["serving_routes"]
audit["scenarios"]["wildland_ab747"]["steps"]["step5_ratio_test"]["flagged_route_ids"]
audit["scenarios"]["wildland_ab747"]["steps"]["step5_ratio_test"]["already_failing_at_baseline"]
audit["scenarios"]["wildland_ab747"]["steps"]["step1_applicability"]["city_in_fhsz"]
audit["scenarios"]["wildland_ab747"]["steps"]["step2_scale"]["result"]

# Local density scenario (Standard 5)
audit["scenarios"]["local_density_sb79"]["steps"]["step3_routes"]["serving_routes"]
audit["scenarios"]["local_density_sb79"]["steps"]["step5_ratio_test"]["flagged_route_ids"]
```

The final tier is at `audit["final_tier"]` and per-scenario tiers at
`audit["scenarios"][name]["tier"]`.

### Files to Touch
1. **`agents/visualization/evaluation.py`** — primary rewrite target
   - `create_evaluation_map()` — drop A/B toggle, build unified layers + std-keyed sublayers
   - `_build_project_card_html()` — replace scenario dropdown with standards checklist
   - `_build_legend_html()` — replace static legend with toggleable rows per standard

2. **`agents/visualization/popups.py`** — minor update
   - `_build_project_popup()` — already works; remove any A/B references if present
   - Route popup: add `already_failing_at_baseline` note so planner sees "74 routes pre-congested"

3. **`agents/visualization/themes.py`** — minor update
   - Add unified serving route color constant: `SERVING_ROUTE_COLOR = "#4A90D9"`
   - Flagged route color already exists as `_TIER_ROUTE_COLOR_FLAGGED`

### Do NOT change
- `agents/visualization/demo.py` — the demo map has different UX; keep as-is
- `agents/visualization/helpers.py` — no changes needed
- `main.py` — audit is already passed to `create_evaluation_map()`

### Folium Layer Pattern for Toggleable Standards
Use a FeatureGroup per logical layer, pass `show=True/False`:
```python
serving_wildland_group = folium.FeatureGroup(name="Std 3 · Wildland routes", show=True)
serving_local5_group   = folium.FeatureGroup(name="Std 5 · Local routes", show=True)
flagged_group          = folium.FeatureGroup(name="Flagged routes", show=True)
fhsz_group             = folium.FeatureGroup(name="Std 1 · FHSZ zone", show=True)
```

Add each to the map. The legend eye icons use JS to call `.getLayers()` on the
LayerControl and toggle visibility directly — same pattern already used in demo.py
for `local5_group`.

### Test Command
```bash
export PATH="$HOME/.local/bin:$PATH"
uv run python main.py evaluate --city "Berkeley" --lat 37.87 --lon -122.268 --units 75 --map
# Should produce output/berkeley/evaluation_37_8700_n122_2680.html
```

Open the HTML and verify:
1. Left panel shows standards checklist (not A/B dropdown)
2. Routes are one color (serving) with flagged routes a different color
3. Legend has eye toggle rows per standard
4. Clicking a toggle shows/hides the correct layer
5. Route popup shows baseline vs proposed v/c + whether it's pre-congested

### Keep File Under 700 Lines
Current evaluation.py is ~580 lines. The rewrite should stay under 700.
If it exceeds that, split helpers into existing helper files.
