"""
Agent 3: Objective Standards Engine — Orchestrator — JOSH v3.0

Runs all applicable evacuation capacity scenarios against a proposed project
and returns the most restrictive tier determination.

Architecture (v3.0):
  Each scenario implements the universal 5-step algorithm:
    1. Applicability check
    2. Scale gate
    3. Route identification (returns list[EvacuationPath])
    4. Demand calculation
    5. ΔT test (project_vehicles / bottleneck_effective_capacity) × 60 + egress)

  The orchestrator runs all scenarios, then applies "most restrictive wins":
    DISCRETIONARY (3) > CONDITIONAL MINISTERIAL (2) > MINISTERIAL (1)

  Sb79TransitScenario always returns NOT_APPLICABLE — informational flag only.

Active scenarios:
  A. WildlandScenario     — Standards 1–4 (AB 747, Gov. Code §65302.15)
  B. Sb79TransitScenario  — Standard 5 (SB 79 transit proximity, informational only)

Key v3.0 changes from v2.0:
  - LocalDensityScenario replaced by Sb79TransitScenario (informational only)
  - evaluate_project() accepts and passes evacuation_paths list to context
  - Audit trail shows ΔT per path (not v/c comparison)
  - _update_project_from_wildland() updated for new Project fields

Public API:
  evaluate_project(project, roads_gdf, fhsz_gdf, config, city_config,
                   evacuation_paths=None) -> (Project, audit)
  generate_audit_trail(project, audit, output_path) -> str
"""
import logging
from datetime import datetime
from pathlib import Path

import geopandas as gpd

from models.project import Project
from agents.scenarios.base import ScenarioResult, Tier, TIER_RANK
from agents.scenarios.wildland import WildlandScenario
from agents.scenarios.sb79_transit import Sb79TransitScenario

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def evaluate_project(
    project: Project,
    roads_gdf: gpd.GeoDataFrame,
    fhsz_gdf: gpd.GeoDataFrame,
    config: dict,
    city_config: dict,
    evacuation_paths: list = None,
) -> tuple:
    """
    Run all objective standards scenarios and produce a final determination.

    Args:
        evacuation_paths: Pre-computed EvacuationPath objects from Agent 2.
                         If None, WildlandScenario.identify_routes() will use
                         an empty list and conservative fallback behavior.

    Returns:
        (updated Project, audit_trail dict)
    """
    context = {
        "fhsz_gdf":         fhsz_gdf,
        "evacuation_paths": evacuation_paths or [],
    }

    scenarios = [
        WildlandScenario(config, city_config),
        Sb79TransitScenario(config, city_config),
    ]

    results: list[ScenarioResult] = [
        s.evaluate(project, roads_gdf, context)
        for s in scenarios
    ]

    final_tier = _most_restrictive(results)

    wildland_result = next(r for r in results if r.scenario_name == "wildland_ab747")
    _update_project_from_wildland(project, wildland_result, config)

    project.determination        = final_tier.value
    project.determination_reason = _build_combined_reason(results, final_tier)

    audit = {
        "evaluation_date": datetime.now().isoformat(),
        "project":         project.to_dict(),
        "algorithm": {
            "name":        "Universal 5-Step Evacuation Capacity Algorithm",
            "version":     "3.0 (ΔT Standard)",
            "description": (
                "Each scenario applies: (1) applicability check, (2) scale gate, "
                "(3) route identification (EvacuationPath objects with bottleneck tracking), "
                "(4) demand calculation (zone-based mobilization rate × vpu × units), "
                "(5) ΔT test (project_vehicles / bottleneck_effective_capacity × 60 + egress). "
                "Most restrictive tier across all applicable scenarios is the final determination."
            ),
            "legal_doc":   "See legal.md for full legal basis and defense reference.",
        },
        "scenarios": {
            r.scenario_name: {
                "legal_basis":     r.legal_basis,
                "tier":            r.tier.value,
                "triggered":       r.triggered,
                "reason":          r.reason,
                "steps":           r.steps,
                "delta_t_results": r.delta_t_results,
                "max_delta_t":     r.max_delta_t,
            }
            for r in results
        },
        "determination": {
            "result":         final_tier.value,
            "tier":           final_tier.value,
            "scenario_tiers": {r.scenario_name: r.tier.value for r in results},
            "logic":          "Most restrictive tier across all applicable scenarios wins.",
            "tier_rank":      "DISCRETIONARY(3) > CONDITIONAL MINISTERIAL(2) > MINISTERIAL(1) > NOT_APPLICABLE(0)",
            "reason":         project.determination_reason,
        },
    }

    return project, audit


# ---------------------------------------------------------------------------
# Tier aggregation
# ---------------------------------------------------------------------------

def _most_restrictive(results: list) -> Tier:
    applicable = [r for r in results if r.tier != Tier.NOT_APPLICABLE]
    if not applicable:
        return Tier.MINISTERIAL
    return max(applicable, key=lambda r: TIER_RANK[r.tier]).tier


def _update_project_from_wildland(
    project: Project,
    result: ScenarioResult,
    config: dict,
) -> None:
    """Populate Project fields from the wildland scenario's step results."""
    steps = result.steps

    # Scale check
    s2 = steps.get("step2_scale", {})
    project.meets_size_threshold = s2.get("result", False)
    project.unit_threshold_used  = s2.get("threshold", config.get("unit_threshold", 15))

    # ΔT test results
    s5 = steps.get("step5_delta_t", {})
    if s5:
        project.delta_t_results            = result.delta_t_results
        project.capacity_exceeded          = result.triggered
        project.project_vehicles_peak_hour = s5.get("project_vehicles", 0.0)
        project.egress_minutes             = s5.get("egress_minutes", 0.0)


def _build_combined_reason(results: list, final_tier: Tier) -> str:
    triggered  = [r for r in results if r.triggered]
    applicable = [r for r in results if r.tier != Tier.NOT_APPLICABLE]

    if triggered:
        parts = [r.reason for r in triggered]
        if len(parts) == 1:
            return parts[0]
        return " | ".join(f"[{r.scenario_name}] {r.reason}" for r in triggered)

    if applicable:
        best = max(applicable, key=lambda r: TIER_RANK[r.tier])
        return best.reason

    return f"No applicable scenarios triggered. Tier: {final_tier.value}."


# ---------------------------------------------------------------------------
# Output: Audit Trail
# ---------------------------------------------------------------------------

def generate_audit_trail(
    project: Project,
    audit: dict,
    output_path: Path,
) -> str:
    """
    Write a human-readable audit trail document for legal compliance.

    v3.0 format: shows ΔT per path (not v/c comparison), bottleneck data,
    hazard degradation, mobilization rate, egress penalty.

    Returns the text content (also written to output_path).
    """
    det = project.determination
    det_label = {
        "DISCRETIONARY":           "DISCRETIONARY REVIEW REQUIRED",
        "CONDITIONAL MINISTERIAL": "CONDITIONAL MINISTERIAL APPROVAL",
        "MINISTERIAL":             "MINISTERIAL APPROVAL ELIGIBLE",
    }.get(det, det)

    lines = [
        "=" * 70,
        "FIRE EVACUATION CAPACITY ANALYSIS — PROJECT DETERMINATION",
        "JOSH v3.0 (ΔT Standard)",
        "=" * 70,
        f"Date:           {audit['evaluation_date']}",
        f"Project:        {project.project_name or 'Unnamed'}",
        f"Address:        {project.address or 'Not provided'}",
        f"APN:            {project.apn or 'Not provided'}",
        f"Location:       {project.location_lat}, {project.location_lon}",
        f"Dwelling Units: {project.dwelling_units}",
        f"Stories:        {getattr(project, 'stories', 0)}",
        "",
        "ALGORITHM",
        "-" * 40,
    ]
    alg = audit.get("algorithm", {})
    lines.append(f"  {alg.get('name', '')} v{alg.get('version', '')}")
    lines.append(f"  {alg.get('description', '')}")
    lines.append(f"  Reference: {alg.get('legal_doc', '')}")

    for scenario_name, scenario_data in audit.get("scenarios", {}).items():
        tier      = scenario_data["tier"]
        triggered = scenario_data["triggered"]
        steps     = scenario_data.get("steps", {})

        lines += [
            "",
            "=" * 70,
            f"SCENARIO: {scenario_name.upper()}",
            f"  Legal Basis: {scenario_data['legal_basis']}",
            f"  Result: {tier}  |  Triggered: {'YES' if triggered else 'NO'}",
            "=" * 70,
        ]

        if tier == "NOT_APPLICABLE":
            note = scenario_data.get("reason", steps.get("note", "Not applicable"))
            lines.append(f"  NOT APPLICABLE: {note}")
            sb79_flag = steps.get("near_transit")
            if sb79_flag is not None:
                lines.append(
                    f"  SB 79 Transit Proximity: "
                    f"{'WITHIN transit buffer' if sb79_flag else 'outside transit buffer'}"
                )
            continue

        # Step 1
        s1 = steps.get("step1_applicability", {})
        lines += [
            "",
            "  STEP 1 — APPLICABILITY CHECK (Standard 3: FHSZ Modifier)",
            "  " + "-" * 38,
            f"  Method: {s1.get('method', '')}",
            f"  Result: {'APPLICABLE' if s1.get('result') else 'NOT APPLICABLE'}",
        ]
        if "note" in s1:
            lines.append(f"  Note: {s1['note']}")
        if "fire_zone_severity_modifier" in s1:
            fz = s1["fire_zone_severity_modifier"]
            lines.append(
                f"  Standard 3 (FHSZ): {fz.get('zone_description', 'Not in FHSZ')} "
                f"(hazard_zone={fz.get('hazard_zone', 'non_fhsz')}) "
                f"({'IN FIRE ZONE' if fz.get('result') else 'not in FHSZ'})"
            )
            lines.append(
                f"  Mobilization Rate: {s1.get('std3_mobilization_rate', 0.25):.2f} "
                f"(Zhao et al. 2022 GPS-empirical, Kincade Fire)"
            )

        # Step 2
        s2 = steps.get("step2_scale", {})
        if s2:
            lines += [
                "",
                "  STEP 2 — SCALE GATE (Standard 1)",
                "  " + "-" * 38,
                f"  {s2.get('method', '')} → {'TRIGGERED' if s2.get('result') else 'not triggered'}",
                f"  ({s2.get('dwelling_units')} units vs. {s2.get('threshold')} threshold)",
            ]

        if tier == "MINISTERIAL" and not s2.get("result"):
            lines.append(f"  -> Determination: MINISTERIAL (below scale threshold)")
            lines.append(f"  Reason: {scenario_data['reason']}")
            continue

        # Step 3
        s3 = steps.get("step3_routes", {})
        if s3:
            lines += [
                "",
                "  STEP 3 — ROUTE IDENTIFICATION (Standard 2)",
                "  " + "-" * 38,
                f"  Method: {s3.get('method', '')}",
                f"  Radius: {s3.get('radius_miles')} miles ({s3.get('radius_meters')} m)",
                f"  Serving route segments found: {s3.get('serving_route_count', 0)}",
                f"  Serving EvacuationPaths identified: {s3.get('serving_paths_count', 0)}",
            ]
            if s3.get("fallback_all_paths"):
                lines.append(
                    "  [Conservative fallback: no paths matched proximity — all city paths used]"
                )
            _name_seen: set = set()
            for r in s3.get("serving_routes", []):
                rname = r.get("name") or str(r["osmid"])
                if rname in _name_seen:
                    continue
                _name_seen.add(rname)
                lines.append(
                    f"    - {rname}: "
                    f"eff_cap={r.get('effective_capacity_vph', 0):.0f} vph, "
                    f"fhsz={r.get('fhsz_zone', 'non_fhsz')}, "
                    f"deg={r.get('hazard_degradation', 1.0):.2f}, "
                    f"vc={r.get('vc_ratio', 0):.3f} (informational)"
                )

        # Step 4
        s4 = steps.get("step4_demand", {})
        if s4:
            lines += [
                "",
                "  STEP 4 — DEMAND CALCULATION",
                "  " + "-" * 38,
                f"  Formula: {s4.get('formula', '')}",
                f"  Hazard Zone: {s4.get('hazard_zone', 'non_fhsz')}",
                f"  Mobilization Rate: {s4.get('mobilization_rate', 0.25):.2f}",
                f"  Project vehicles (peak hour): {s4.get('project_vehicles_peak_hour', 0):.1f} vph",
                f"  Source (vehicles/unit): {s4.get('source_vehicles_per_unit', '')}",
                f"  Source (mobilization): {s4.get('source_mobilization', '')}",
            ]

        # Step 5: ΔT
        s5 = steps.get("step5_delta_t", {})
        if s5:
            safe_win  = s5.get("safe_egress_window_minutes", "")
            share_pct = s5.get("max_project_share", 0.05)
            threshold = s5.get("threshold_minutes", "")
            threshold_str = (
                f"{threshold:.2f} min "
                f"({safe_win} min window × {share_pct * 100:.0f}%, NIST TN 2135)"
                if safe_win else f"{threshold} min"
            )
            lines += [
                "",
                "  STEP 5 — ΔT TEST (Standard 4)",
                "  " + "-" * 38,
                f"  Method: {s5.get('method', '')}",
                f"  Hazard Zone: {s5.get('hazard_zone', 'non_fhsz')}",
                f"  Mobilization Rate: {s5.get('mobilization_rate', 0.25):.2f}",
                f"  Project Vehicles: {s5.get('project_vehicles', 0):.1f} vph",
                f"  Egress Penalty: {s5.get('egress_minutes', 0):.1f} min "
                f"(NFPA 101/IBC; applies to buildings >= 4 stories)",
                f"  Safe Egress Window: {safe_win} min ({s5.get('hazard_zone', 'non_fhsz')}, NIST TN 2135)",
                f"  Max Project Share:  {share_pct * 100:.0f}%",
                f"  ΔT Threshold:       {threshold_str}",
                f"  Paths Evaluated: {s5.get('paths_evaluated', 0)}",
                f"  Max ΔT: {s5.get('max_delta_t_minutes', 0):.2f} min",
                f"  Triggered: {'YES — DISCRETIONARY' if s5.get('triggered') else 'NO'}",
                "",
                "  Per-Path Results (deduplicated by bottleneck name):",
            ]
            _bn_seen: set = set()
            for r in s5.get("path_results", []):
                bn_name = r.get("bottleneck_name") or r.get("bottleneck_osmid", "Unknown")
                if bn_name in _bn_seen:
                    continue
                _bn_seen.add(bn_name)
                flag = (
                    " *** ΔT EXCEEDS THRESHOLD — DISCRETIONARY ***"
                    if r.get("flagged") else " [within threshold]"
                )
                r_safe_win = r.get("safe_egress_window_minutes", "")
                r_share    = r.get("max_project_share", 0.05)
                r_thresh   = r.get("threshold_minutes", "")
                r_thresh_str = (
                    f"{r_thresh:.2f} min ({r_safe_win} min × {r_share * 100:.0f}%)"
                    if r_safe_win else f"{r_thresh} min"
                )
                lines.append(
                    f"    Bottleneck: {bn_name}{flag}"
                )
                lines.append(
                    f"      HCM cap: {r.get('bottleneck_hcm_capacity_vph', 0):.0f} vph  "
                    f"x degradation {r.get('bottleneck_hazard_degradation', 1.0):.2f} "
                    f"({r.get('bottleneck_fhsz_zone', 'non_fhsz')})  "
                    f"= eff cap {r.get('bottleneck_effective_capacity_vph', 0):.0f} vph"
                )
                lines.append(
                    f"      ΔT = ({r.get('project_vehicles', 0):.1f} vph / "
                    f"{r.get('bottleneck_effective_capacity_vph', 0):.0f} vph) x 60 "
                    f"+ {r.get('egress_minutes', 0):.1f} min egress "
                    f"= {r.get('delta_t_minutes', 0):.2f} min  "
                    f"(threshold: {r_thresh_str})"
                )

        lines += [
            "",
            f"  -> Scenario Tier: {tier}",
            f"  Reason: {scenario_data['reason']}",
        ]

    # ── Final Determination ───────────────────────────────────────────
    d   = audit.get("determination", {})
    hz  = getattr(project, "hazard_zone", "non_fhsz")
    max_dt = project.max_delta_t() if hasattr(project, "max_delta_t") else 0.0

    tier_explanation = {
        "DISCRETIONARY": (
            "DISCRETIONARY REVIEW REQUIRED\n\n"
            "  At least one scenario triggered DISCRETIONARY: the project meets the\n"
            "  dwelling unit size threshold and at least one serving path's ΔT exceeds\n"
            "  the applicable threshold for the project's hazard zone.\n\n"
            "  ΔT = (project_vehicles / bottleneck_effective_capacity) x 60 + egress_penalty\n"
            "  The baseline state of the road is irrelevant — projects in already-failing\n"
            "  zones are tested equally (key v3.0 correction from v2.0 marginal causation test).\n\n"
            "  NOTE: Fire zone location (Standard 3) affects mobilization rate and ΔT threshold;\n"
            "  it does not independently gate the determination."
        ),
        "CONDITIONAL MINISTERIAL": (
            "CONDITIONAL MINISTERIAL APPROVAL\n\n"
            "  The project meets the dwelling unit size threshold and serves evacuation routes.\n"
            "  No serving path's ΔT exceeds the applicable threshold for the project's\n"
            "  hazard zone. Ministerial approval eligible with mandatory evacuation-related\n"
            "  conditions defined by the city pursuant to its General Plan Safety Element."
        ),
        "MINISTERIAL": (
            "MINISTERIAL APPROVAL ELIGIBLE\n\n"
            "  Project is below the dwelling unit size threshold (Standard 1 not met).\n"
            "  No evacuation capacity analysis is required."
        ),
    }.get(det, det)

    # Extract threshold derivation from wildland scenario step5 for PARAMETERS APPLIED
    _wl_s5 = (
        audit.get("scenarios", {})
             .get("wildland_ab747", {})
             .get("steps", {})
             .get("step5_delta_t", {})
    )
    _safe_win  = _wl_s5.get("safe_egress_window_minutes", "")
    _share_pct = _wl_s5.get("max_project_share", 0.05)
    _threshold = _wl_s5.get("threshold_minutes", "")

    lines += [
        "",
        "=" * 70,
        "FINAL DETERMINATION",
        "=" * 70,
        f"  RESULT: {det_label}",
        "",
        f"  {project.determination_reason}",
        "",
        "  PARAMETERS APPLIED",
        "  " + "-" * 38,
        f"  Hazard Zone:        {hz}",
        f"  Mobilization Rate:  {getattr(project, 'mobilization_rate', 0.0):.2f} "
        f"(Zhao et al. 2022 GPS-empirical)",
        f"  Vehicles per Unit:  2.5 (U.S. Census ACS B25044)",
        f"  Egress Penalty:     {getattr(project, 'egress_minutes', 0.0):.1f} min "
        f"(NFPA 101/IBC — {getattr(project, 'stories', 0)} stories)",
        f"  Safe Egress Window: {_safe_win} min ({hz}, per NIST TN 2135)",
        f"  Max Project Share:  {_share_pct * 100:.0f}%",
        f"  ΔT Threshold:       {_threshold:.2f} min ({_safe_win} × {_share_pct * 100:.0f}%)"
        if _safe_win and _threshold else f"  ΔT Threshold:       {_threshold} min",
        f"  Max ΔT (project):   {max_dt:.2f} min",
        "",
        "  Determination Tier:",
        f"    {tier_explanation}",
        "",
        "  Scenario Tier Summary:",
    ]
    for sname, stier in d.get("scenario_tiers", {}).items():
        lines.append(f"    {sname}: {stier}")

    lines += [
        "",
        f"  Aggregation Logic: {d.get('logic', '')}",
        f"  Tier Ranking: {d.get('tier_rank', '')}",
        "",
        "  This determination is based solely on objective, verifiable criteria.",
        "  No professional discretion was applied. All calculations are reproducible.",
        "  See legal.md for full legal basis and defense reference.",
        "=" * 70,
    ]

    text = "\n".join(lines)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text)
    logger.info(f"Audit trail written to: {output_path}")
    return text
