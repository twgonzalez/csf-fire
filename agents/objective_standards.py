# Copyright (C) 2026 Thomas Gonzalez
# SPDX-License-Identifier: AGPL-3.0-or-later
# This file is part of JOSH (Jurisdictional Objective Standards for Housing).
# See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

"""
Agent 3: Objective Standards Engine — Orchestrator — JOSH v4.0

Runs all applicable evacuation capacity scenarios against a proposed project
and returns the most restrictive tier determination.

Architecture (v3.1):
  Each scenario implements the universal 5-step algorithm:
    1. Applicability check
    2. Scale gate
    3. Route identification (returns list[EvacuationPath])
    4. Demand calculation
    5. ΔT test (project_vehicles / bottleneck_effective_capacity) × 60 + egress)
       Threshold derived at runtime: safe_egress_window[zone] × max_project_share

  The orchestrator runs all scenarios, then applies "most restrictive wins":
    DISCRETIONARY (3) > MINISTERIAL WITH STANDARD CONDITIONS (2) > MINISTERIAL (1)

  Sb79TransitScenario always returns NOT_APPLICABLE — informational flag only.

Active scenarios:
  A. WildlandScenario     — Standards 1–4 (AB 747, Gov. Code §65302.15)
  B. Sb79TransitScenario  — Standard 5 (SB 79 transit proximity, informational only)

Key v3.1 changes from v3.0:
  - max_marginal_minutes config key removed; thresholds derived at runtime
  - safe_egress_window × max_project_share replaces static 3/5/8/10 values
  - Audit trail shows derivation chain (window × share = threshold) per path

Key v3.0 changes from v2.0:
  - LocalDensityScenario replaced by Sb79TransitScenario (informational only)
  - evaluate_project() accepts and passes evacuation_paths list to context
  - Audit trail shows ΔT per path (not v/c comparison)
  - _update_project_from_wildland() updated for new Project fields

Public API:
  evaluate_project(project, roads_gdf, fhsz_gdf, config, city_config,
                   evacuation_paths=None) -> (Project, audit)

Note: generate_audit_trail() was removed in v4.11. Audit trail text is now
generated client-side by sidebar.js _buildAuditText() and downloaded via
_downloadDetermination(). See static/sidebar.js lines 399-681.
"""
import logging
from datetime import datetime

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
    graph_path: str | None = None,
) -> tuple:
    """
    Run all objective standards scenarios and produce a final determination.

    Args:
        evacuation_paths: Pre-computed EvacuationPath objects from Agent 2.
                         If None, WildlandScenario.identify_routes() will use
                         an empty list and conservative fallback behavior.
        graph_path: Path to data/{city}/graph.graphml saved by Agent 2.
                    If provided, WildlandScenario uses network-distance proximity
                    (v3.3) instead of Euclidean buffer — respects road barriers.

    Returns:
        (updated Project, audit_trail dict)
    """
    context = {
        "fhsz_gdf":         fhsz_gdf,
        "evacuation_paths": evacuation_paths or [],
        "graph_path":       str(graph_path) if graph_path else None,
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
            "version":     "4.0 (ΔT Standard — constant mobilization)",
            "description": (
                "Each scenario applies: (1) applicability check, (2) scale gate, "
                "(3) route identification (EvacuationPath objects with bottleneck tracking), "
                "(4) demand calculation (mobilization rate 0.90 × vpu × units — NFPA 101 design basis), "
                "(5) ΔT test (project_vehicles / bottleneck_effective_capacity × 60 + egress). "
                "FHSZ affects road capacity degradation only — not mobilization. "
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
            "tier_rank":      "DISCRETIONARY(3) > MINISTERIAL WITH STANDARD CONDITIONS(2) > MINISTERIAL(1) > NOT_APPLICABLE(0)",
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
# Audit trail generation removed in v4.11 — now client-side only.
# See static/sidebar.js _buildAuditText() for the JS implementation.
# ---------------------------------------------------------------------------
