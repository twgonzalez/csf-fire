"""
Agent 3: Objective Standards Engine

Provides zero-discretion, three-tier determination for proposed development
projects in California cities:

  DISCRETIONARY        — size threshold met + capacity exceeded (Standard 4)
                         Fire zone location is a severity modifier in the audit trail
                         but does NOT gate entry to DISCRETIONARY (any large project
                         that pushes already-stressed arterials over v/c 0.80 triggers
                         discretionary review, regardless of project location).
                         Legal basis: AB 747 (Gov. Code §65302.15) + HCM 2022
  CONDITIONAL MINISTERIAL — city has FHSZ zones + size threshold met
                         Ministerial approval with mandatory evacuation conditions (city-defined).
                         Legal basis: General Plan Safety Element + AB 1600 nexus
  MINISTERIAL          — below size threshold or no FHSZ in city

All standards are algorithmic — no professional judgment, no discretion.
Every calculation is stored for a complete audit trail.
"""
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from models.project import Project

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
) -> tuple[Project, dict]:
    """
    Run all objective standards and produce a final three-tier determination.

    Tier logic (all algorithmic, zero discretion):
      DISCRETIONARY        if: project_in_fire_zone AND size_met AND capacity_exceeded
      CONDITIONAL MINISTERIAL if: city_has_fhsz AND size_met AND serving_routes_exist
                                  (and NOT DISCRETIONARY)
      MINISTERIAL          otherwise

    Returns:
        (updated Project, audit_trail dict)
    """
    # Resolve per-tier thresholds from config (fall back to top-level defaults)
    tiers_cfg = config.get("determination_tiers", {})
    disc_cfg  = tiers_cfg.get("discretionary", {})
    cond_cfg  = tiers_cfg.get("conditional_ministerial", {})
    min_cfg   = tiers_cfg.get("ministerial", {})

    disc_unit_threshold = disc_cfg.get("unit_threshold",  config.get("unit_threshold", 50))
    disc_vc_threshold   = disc_cfg.get("vc_threshold",    config.get("vc_threshold", 0.80))
    cond_unit_threshold = cond_cfg.get("unit_threshold",  config.get("unit_threshold", 50))

    audit = {
        "evaluation_date": datetime.now().isoformat(),
        "project": project.to_dict(),
        "parameters_used": {
            "discretionary_unit_threshold": disc_unit_threshold,
            "discretionary_vc_threshold":   disc_vc_threshold,
            "conditional_unit_threshold":   cond_unit_threshold,
            "vehicles_per_unit":            config.get("vehicles_per_unit", 2.5),
            "peak_hour_mobilization":       config.get("peak_hour_mobilization", 0.57),
            "evacuation_route_radius_miles": config.get("evacuation_route_radius_miles", 0.5),
        },
        "standards": {},
    }

    # ------------------------------------------------------------------
    # Standard 1 (Citywide Applicability): Does the city have FHSZ zones?
    # ------------------------------------------------------------------
    city_has_fhsz, std1_detail = check_citywide_fhsz(fhsz_gdf)
    audit["standards"]["standard_1_citywide_fhsz"] = std1_detail

    # ------------------------------------------------------------------
    # Severity Modifier: Is the project itself in FHSZ Zone 2 or 3?
    # (determines DISCRETIONARY vs CONDITIONAL when other criteria are met)
    # ------------------------------------------------------------------
    project_in_fire_zone, fire_zone_detail = check_fire_zone(
        (project.location_lat, project.location_lon),
        fhsz_gdf,
    )
    project.in_fire_zone = project_in_fire_zone
    project.fire_zone_level = fire_zone_detail.get("zone_level", 0)
    audit["standards"]["fire_zone_severity_modifier"] = fire_zone_detail

    # ------------------------------------------------------------------
    # Standard 2: Size Threshold (per tier — both tiers use same default)
    # ------------------------------------------------------------------
    # Use the DISCRETIONARY threshold for the primary check; CONDITIONAL
    # uses its own threshold below.
    disc_size_met, std2_disc_detail = check_size_threshold(
        project.dwelling_units, disc_unit_threshold, label="DISCRETIONARY"
    )
    cond_size_met, std2_cond_detail = check_size_threshold(
        project.dwelling_units, cond_unit_threshold, label="CONDITIONAL MINISTERIAL"
    )
    # Expose both; standard fields use DISCRETIONARY threshold
    project.meets_size_threshold = disc_size_met
    project.size_threshold_used  = disc_unit_threshold
    audit["standards"]["standard_2_size_threshold"] = {
        "discretionary_check": std2_disc_detail,
        "conditional_check":   std2_cond_detail,
    }

    # ------------------------------------------------------------------
    # Standard 3: Serving Evacuation Routes
    # ------------------------------------------------------------------
    radius = config.get("evacuation_route_radius_miles", 0.5)
    analysis_crs = city_config.get("analysis_crs", "EPSG:26910")
    serving_ids, std3_detail = identify_serving_routes(
        (project.location_lat, project.location_lon),
        roads_gdf,
        radius,
        analysis_crs,
    )
    serving_routes_exist = len(serving_ids) > 0
    project.serving_route_ids  = serving_ids
    project.search_radius_miles = radius
    audit["standards"]["standard_3_serving_routes"] = std3_detail

    # ------------------------------------------------------------------
    # Standard 4: Capacity Threshold (v/c) — uses DISCRETIONARY threshold
    # ------------------------------------------------------------------
    capacity_exceeded, project_vph, std4_detail = check_capacity_threshold(
        serving_ids,
        project.dwelling_units,
        roads_gdf,
        config,
        vc_threshold_override=disc_vc_threshold,
    )
    project.exceeds_capacity_threshold  = capacity_exceeded
    project.project_vehicles_peak_hour  = project_vph
    project.flagged_route_ids           = std4_detail.get("flagged_route_ids", [])
    audit["standards"]["standard_4_capacity_threshold"] = std4_detail

    # ------------------------------------------------------------------
    # Three-Tier Determination Logic (100% algorithmic)
    # ------------------------------------------------------------------
    disc_legal  = disc_cfg.get("legal_basis", "AB 747 (Gov. Code §65302.15) and HCM 2022 v/c capacity threshold — project adds vehicles to evacuation routes operating at or above LOS E/F (citywide evacuation scenario)")
    cond_legal  = cond_cfg.get("legal_basis", "General Plan Safety Element consistency and AB 1600 nexus")
    min_legal   = min_cfg.get("legal_basis",  "Project below applicable significance threshold; ministerial approval eligible without evacuation conditions")

    # CRITICAL: capacity impact (Standard 4) gates DISCRETIONARY — NOT fire zone location.
    # A project anywhere in the city that pushes already-stressed arterials over v/c 0.80
    # has the same measurable impact regardless of whether it sits in a fire zone.
    # Fire zone location is recorded as a severity modifier in the audit trail (affects
    # the conditions required, not the tier determination).
    #
    # Standard 3 (serving routes) informs Standard 4 but does NOT gate
    # CONDITIONAL MINISTERIAL — AB 1600 nexus applies to any project in a
    # FHSZ-applicable city that meets the size threshold.
    if disc_size_met and capacity_exceeded:
        tier = "DISCRETIONARY"
        fire_zone_note = (
            f"The project is located in FHSZ Zone {project.fire_zone_level} "
            f"(severity modifier — fire zone designation affects conditions required). "
            if project_in_fire_zone else
            "The project is not within a designated FHSZ zone "
            "(fire zone severity modifier is NOT a gate for DISCRETIONARY — "
            "capacity impact alone triggers this determination). "
        )
        reason = (
            f"Project meets the {disc_unit_threshold}-unit size threshold (Standard 2) "
            f"and at least one serving evacuation route exceeds the v/c threshold of "
            f"{disc_vc_threshold:.2f} under the citywide evacuation demand scenario (Standard 4). "
            f"{fire_zone_note}"
            f"Discretionary review is required. "
            f"Legal basis: {disc_legal}."
        )

    elif city_has_fhsz and cond_size_met:
        tier = "CONDITIONAL MINISTERIAL"
        route_note = (
            f"has {len(serving_ids)} serving evacuation route segment(s) within {radius} miles"
            if serving_routes_exist else
            f"has no serving routes within {radius} miles but adds vehicles to the citywide evacuation network"
        )
        reason = (
            f"The city contains FHSZ zones (Standard 1 citywide applicability). "
            f"Project meets the {cond_unit_threshold}-unit size threshold (Standard 2) and "
            f"{route_note}. "
            f"Evacuation route v/c threshold ({disc_vc_threshold:.2f}) is not exceeded "
            f"(Standard 4 not triggered); therefore DISCRETIONARY review is not required. "
            f"Ministerial approval is eligible with mandatory evacuation-related conditions "
            f"(specific conditions to be defined by the city). "
            f"Legal basis: {cond_legal}."
        )

    else:
        tier = "MINISTERIAL"
        reasons = []
        if not city_has_fhsz:
            reasons.append("city has no FHSZ zones (Standard 1 citywide applicability not triggered — framework not applicable)")
        if not cond_size_met:
            reasons.append(f"project has fewer than {cond_unit_threshold} dwelling units (Standard 2 not triggered)")
        reason = "Ministerial approval eligible without evacuation conditions because: " + "; ".join(reasons) + f". Legal basis: {min_legal}."

    project.determination       = tier
    project.determination_tier  = tier
    project.determination_reason = reason

    audit["determination"] = {
        "result":                   tier,
        "tier":                     tier,
        "standard_1_citywide":      city_has_fhsz,
        "fire_zone_modifier":       project_in_fire_zone,
        "standard_2_disc_triggered": disc_size_met,
        "standard_2_cond_triggered": cond_size_met,
        "standard_3_triggered":     serving_routes_exist,
        "standard_4_triggered":     capacity_exceeded,
        "logic": (
            "DISCRETIONARY if std2_disc AND std4 (capacity exceeded); "
            "fire_zone_modifier is a severity modifier only (NOT a gate for DISCRETIONARY); "
            "CONDITIONAL MINISTERIAL if std1_citywide AND std2_cond; "
            "else MINISTERIAL"
        ),
        "reason": reason,
    }

    return project, audit


# ---------------------------------------------------------------------------
# Standard 1: Citywide FHSZ Applicability
# ---------------------------------------------------------------------------

def check_citywide_fhsz(fhsz_gdf: gpd.GeoDataFrame) -> tuple[bool, dict]:
    """
    Standard 1 (Citywide Applicability): Does this city have any FHSZ zones?

    Method: Non-empty GeoDataFrame check
    Discretion: Zero — presence/absence of data

    If the city has no FHSZ zones, the CONDITIONAL MINISTERIAL and DISCRETIONARY
    tiers are not applicable; all projects default to MINISTERIAL.
    """
    has_fhsz = not fhsz_gdf.empty
    zone_count = len(fhsz_gdf) if has_fhsz else 0

    return has_fhsz, {
        "result": has_fhsz,
        "fhsz_polygon_count": zone_count,
        "method": "Non-empty check on city-intersected FHSZ GeoDataFrame",
        "triggers_standard": has_fhsz,
        "note": (
            "City contains FHSZ zones — three-tier framework applies citywide."
            if has_fhsz else
            "City has no FHSZ zones — framework not applicable; all projects are MINISTERIAL."
        ),
    }


# ---------------------------------------------------------------------------
# Fire Zone Severity Modifier (project location check)
# ---------------------------------------------------------------------------

def check_fire_zone(
    location: tuple[float, float],
    fhsz_gdf: gpd.GeoDataFrame,
) -> tuple[bool, dict]:
    """
    Severity Modifier: Is the project in FHSZ Zone 2 or Zone 3?

    When True, combined with Standard 2 (size) and Standard 4 (capacity),
    this elevates the determination to DISCRETIONARY.
    When False, the project may still reach CONDITIONAL MINISTERIAL if the
    city has FHSZ zones, size threshold is met, and serving routes exist.

    Method: GIS point-in-polygon test
    Discretion: Zero — binary result from spatial query
    """
    lat, lon = location
    project_point = gpd.GeoDataFrame(
        {"geometry": [Point(lon, lat)]},
        crs="EPSG:4326",
    )

    if fhsz_gdf.empty:
        return False, {
            "result": False,
            "zone_level": 0,
            "note": "FHSZ data unavailable — defaulting to not in fire zone",
        }

    fhsz_wgs84 = fhsz_gdf.to_crs("EPSG:4326")
    joined = gpd.sjoin(project_point, fhsz_wgs84, how="left", predicate="within")

    detail = {
        "input_lat": lat,
        "input_lon": lon,
        "method": "GIS point-in-polygon (shapely/geopandas)",
        "data_source": "CAL FIRE FHSZ",
        "role": "Severity modifier — elevates to DISCRETIONARY when True + std2 + std4",
    }

    if joined.empty or joined["HAZ_CLASS"].isna().all():
        detail.update({"result": False, "zone_level": 0, "zone_description": "Not in FHSZ"})
        return False, detail

    zone_level = int(joined["HAZ_CLASS"].dropna().max())
    in_trigger = zone_level >= 2

    detail.update({
        "result": in_trigger,
        "zone_level": zone_level,
        "zone_description": {
            0: "Not in FHSZ",
            1: "Zone 1 (Moderate)",
            2: "Zone 2 (High)",
            3: "Zone 3 (Very High)",
        }.get(zone_level, f"Zone {zone_level}"),
        "triggers_discretionary_path": in_trigger,
    })
    return in_trigger, detail


# ---------------------------------------------------------------------------
# Standard 2: Project Size Threshold
# ---------------------------------------------------------------------------

def check_size_threshold(
    units: int,
    threshold: int,
    label: str = "",
) -> tuple[bool, dict]:
    """
    Standard 2: Does the project include >= threshold dwelling units?

    Method: Integer comparison
    Discretion: Zero
    """
    result = units >= threshold
    return result, {
        "tier": label,
        "dwelling_units": units,
        "threshold": threshold,
        "result": result,
        "method": f"{units} >= {threshold}",
        "triggers_standard": result,
    }


# ---------------------------------------------------------------------------
# Standard 3: Serving Evacuation Routes
# ---------------------------------------------------------------------------

def identify_serving_routes(
    location: tuple[float, float],
    roads_gdf: gpd.GeoDataFrame,
    radius_miles: float,
    analysis_crs: str,
) -> tuple[list, dict]:
    """
    Standard 3: Which evacuation routes serve this project?

    Method: Buffer project location by radius, find intersecting evacuation routes.
    Discretion: Zero — algorithmic spatial query.

    Returns:
        (list of segment osmids, detail dict)
    """
    lat, lon = location
    project_point = gpd.GeoDataFrame(
        {"geometry": [Point(lon, lat)]},
        crs="EPSG:4326",
    ).to_crs(analysis_crs)

    roads_proj = roads_gdf.to_crs(analysis_crs)

    radius_meters = radius_miles * 1609.344
    buffer = project_point.geometry.iloc[0].buffer(radius_meters)

    if "is_evacuation_route" not in roads_proj.columns:
        nearby = roads_proj[roads_proj.geometry.intersects(buffer)]
        evac_nearby = nearby
    else:
        evac_only = roads_proj[roads_proj["is_evacuation_route"] == True]
        evac_nearby = evac_only[evac_only.geometry.intersects(buffer)]

    serving_ids = evac_nearby["osmid"].tolist()

    detail = {
        "project_lat": lat,
        "project_lon": lon,
        "radius_miles": radius_miles,
        "radius_meters": round(radius_meters, 1),
        "method": "Buffer + intersect with evacuation route segments",
        "serving_route_count": len(evac_nearby),
        "triggers_standard": len(evac_nearby) > 0,
        "serving_routes": [
            {
                "osmid": str(row["osmid"]),
                "name": row.get("name", ""),
                "vc_ratio": round(row.get("vc_ratio", 0), 4),
                "los": row.get("los", ""),
                "capacity_vph": round(row.get("capacity_vph", 0), 0),
                "baseline_demand_vph": round(row.get("baseline_demand_vph", 0), 1),
            }
            for _, row in evac_nearby.iterrows()
        ],
    }
    return serving_ids, detail


# ---------------------------------------------------------------------------
# Standard 4: Capacity Threshold Test
# ---------------------------------------------------------------------------

def check_capacity_threshold(
    serving_route_ids: list,
    dwelling_units: int,
    roads_gdf: gpd.GeoDataFrame,
    config: dict,
    vc_threshold_override: Optional[float] = None,
) -> tuple[bool, float, dict]:
    """
    Standard 4: Do any serving routes exceed the v/c threshold?

    Two tests (either triggers the DISCRETIONARY path):
    A) Baseline test: does any route have baseline_vc >= threshold?
    B) Proposed test: after adding project vehicles, does any route exceed threshold?

    Vehicle distribution: project vehicles distributed equally across all serving routes.

    Returns:
        (exceeds_threshold: bool, project_vph: float, detail dict)
    """
    vc_threshold    = vc_threshold_override if vc_threshold_override is not None else config.get("vc_threshold", 0.80)
    vehicles_per_unit = config.get("vehicles_per_unit", 2.5)
    peak_hour_factor  = config.get("peak_hour_mobilization", 0.57)

    project_vph      = dwelling_units * vehicles_per_unit * peak_hour_factor
    vehicles_per_route = project_vph / max(len(serving_route_ids), 1)

    serving_routes = roads_gdf[
        roads_gdf["osmid"].apply(lambda o: o in serving_route_ids or
            (isinstance(o, list) and any(x in serving_route_ids for x in o)))
    ].copy()

    route_results    = []
    baseline_flagged = []
    proposed_flagged = []

    for _, row in serving_routes.iterrows():
        baseline_vc   = row.get("vc_ratio", 0.0)
        capacity      = row.get("capacity_vph", 0.0)
        baseline_demand = row.get("baseline_demand_vph", 0.0)

        proposed_demand = baseline_demand + vehicles_per_route
        proposed_vc     = calculate_proposed_vc(proposed_demand, capacity)

        baseline_exceeds = baseline_vc >= vc_threshold
        proposed_exceeds = proposed_vc > vc_threshold

        if baseline_exceeds:
            baseline_flagged.append(str(row.get("osmid", "")))
        if proposed_exceeds:
            proposed_flagged.append(str(row.get("osmid", "")))

        route_results.append({
            "osmid": str(row.get("osmid", "")),
            "name": row.get("name", ""),
            "capacity_vph": round(capacity, 0),
            "baseline_demand_vph": round(baseline_demand, 1),
            "baseline_vc": round(baseline_vc, 4),
            "baseline_exceeds": baseline_exceeds,
            "vehicles_added": round(vehicles_per_route, 1),
            "proposed_demand_vph": round(proposed_demand, 1),
            "proposed_vc": round(proposed_vc, 4),
            "proposed_exceeds": proposed_exceeds,
        })

    any_flagged = bool(baseline_flagged or proposed_flagged)
    flagged_ids = list(set(baseline_flagged + proposed_flagged))

    detail = {
        "vc_threshold": vc_threshold,
        "vehicles_per_unit": vehicles_per_unit,
        "peak_hour_mobilization": peak_hour_factor,
        "project_vehicles_formula": f"{dwelling_units} units × {vehicles_per_unit} veh/unit × {peak_hour_factor} peak factor",
        "project_vehicles_peak_hour": round(project_vph, 1),
        "vehicles_per_route": round(vehicles_per_route, 1),
        "serving_routes_evaluated": len(serving_routes),
        "baseline_test_flagged": baseline_flagged,
        "proposed_test_flagged": proposed_flagged,
        "flagged_route_ids": flagged_ids,
        "result": any_flagged,
        "triggers_standard": any_flagged,
        "route_details": route_results,
    }

    return any_flagged, project_vph, detail


def calculate_proposed_vc(proposed_demand: float, capacity: float) -> float:
    """Calculate proposed v/c ratio after adding project vehicles."""
    if capacity <= 0:
        return 0.0
    return proposed_demand / capacity


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

    Returns the text content (also written to output_path).
    """
    det = project.determination
    det_label = {
        "DISCRETIONARY":          "DISCRETIONARY REVIEW REQUIRED",
        "CONDITIONAL MINISTERIAL": "CONDITIONAL MINISTERIAL APPROVAL",
        "MINISTERIAL":             "MINISTERIAL APPROVAL ELIGIBLE",
    }.get(det, det)

    lines = [
        "=" * 70,
        "FIRE EVACUATION CAPACITY ANALYSIS — PROJECT DETERMINATION",
        "=" * 70,
        f"Date: {audit['evaluation_date']}",
        f"Project: {project.project_name or 'Unnamed'}",
        f"Address: {project.address or 'Not provided'}",
        f"APN: {project.apn or 'Not provided'}",
        f"Location: {project.location_lat}, {project.location_lon}",
        f"Dwelling Units: {project.dwelling_units}",
        "",
        "PARAMETERS USED",
        "-" * 40,
    ]

    for k, v in audit["parameters_used"].items():
        lines.append(f"  {k}: {v}")

    # ------------------------------------------------------------------
    # Standard 1: Citywide FHSZ Applicability
    # ------------------------------------------------------------------
    lines += [
        "",
        "STANDARD 1: CITYWIDE FHSZ APPLICABILITY",
        "-" * 40,
        "  Question: Does this city contain any FHSZ Zone 2 or 3 polygons?",
        "  (If NO, the three-tier framework is not applicable — all projects are MINISTERIAL.)",
    ]
    s1 = audit["standards"]["standard_1_citywide_fhsz"]
    lines.append(f"  Method: {s1.get('method', '')}")
    lines.append(f"  FHSZ polygons in city: {s1.get('fhsz_polygon_count', 0)}")
    lines.append(f"  Triggers Standard: {'YES — framework applies citywide' if s1.get('result') else 'NO — framework not applicable'}")
    lines.append(f"  Note: {s1.get('note', '')}")

    # ------------------------------------------------------------------
    # Fire Zone Severity Modifier
    # ------------------------------------------------------------------
    lines += [
        "",
        "FIRE ZONE SEVERITY MODIFIER (PROJECT LOCATION)",
        "-" * 40,
        "  Question: Is the project site within FHSZ Zone 2 or 3?",
        "  (YES + Standard 2 + Standard 4 → DISCRETIONARY)",
        "  (NO or capacity OK → CONDITIONAL MINISTERIAL if Standard 1 + 2 + 3 met)",
    ]
    fz = audit["standards"]["fire_zone_severity_modifier"]
    lines.append(f"  Method: {fz.get('method', '')}")
    lines.append(f"  Zone: {fz.get('zone_description', 'Not in FHSZ')}")
    lines.append(f"  Project in FHSZ Zone 2/3: {'YES' if fz.get('result') else 'NO'}")

    # ------------------------------------------------------------------
    # Standard 2: Size Threshold
    # ------------------------------------------------------------------
    lines += [
        "",
        "STANDARD 2: PROJECT SIZE THRESHOLD",
        "-" * 40,
    ]
    s2 = audit["standards"]["standard_2_size_threshold"]
    s2d = s2["discretionary_check"]
    s2c = s2["conditional_check"]
    lines.append(f"  Dwelling Units: {s2d['dwelling_units']}")
    lines.append(f"  DISCRETIONARY path threshold: {s2d['threshold']} units → {s2d['method']} → {'TRIGGERED' if s2d['result'] else 'not triggered'}")
    lines.append(f"  CONDITIONAL path threshold:   {s2c['threshold']} units → {s2c['method']} → {'TRIGGERED' if s2c['result'] else 'not triggered'}")

    # ------------------------------------------------------------------
    # Standard 3: Serving Evacuation Routes
    # ------------------------------------------------------------------
    lines += [
        "",
        "STANDARD 3: SERVING EVACUATION ROUTES",
        "-" * 40,
        "  (Triggers CONDITIONAL MINISTERIAL when serving routes exist)",
    ]
    s3 = audit["standards"]["standard_3_serving_routes"]
    lines.append(f"  Search Radius: {s3['radius_miles']} miles ({s3['radius_meters']} meters)")
    lines.append(f"  Method: {s3['method']}")
    lines.append(f"  Routes Found: {s3['serving_route_count']}")
    lines.append(f"  Triggers Standard: {'YES' if s3.get('triggers_standard') else 'NO'}")
    for r in s3.get("serving_routes", []):
        lines.append(f"    - {r['name'] or r['osmid']}: v/c={r['vc_ratio']}, LOS={r['los']}, "
                     f"cap={r['capacity_vph']:.0f} vph, demand={r['baseline_demand_vph']:.1f} vph")

    # ------------------------------------------------------------------
    # Standard 4: Capacity Threshold
    # ------------------------------------------------------------------
    lines += [
        "",
        "STANDARD 4: CAPACITY THRESHOLD TEST",
        "-" * 40,
        "  (Combined with fire zone modifier and Standard 2 → DISCRETIONARY)",
    ]
    s4 = audit["standards"]["standard_4_capacity_threshold"]
    lines.append(f"  V/C Threshold: {s4['vc_threshold']}")
    lines.append(f"  Project Vehicle Generation: {s4['project_vehicles_formula']}")
    lines.append(f"  Project Vehicles (peak hour): {s4['project_vehicles_peak_hour']}")
    lines.append(f"  Vehicles Added Per Route: {s4['vehicles_per_route']}")
    lines.append("")
    lines.append("  Route-by-Route Results:")
    for r in s4.get("route_details", []):
        flag = " *** FLAGGED ***" if r["baseline_exceeds"] or r["proposed_exceeds"] else ""
        lines.append(f"    {r['name'] or r['osmid']}:{flag}")
        lines.append(f"      Baseline: demand={r['baseline_demand_vph']:.1f} vph, "
                     f"v/c={r['baseline_vc']:.4f} {'[EXCEEDS]' if r['baseline_exceeds'] else '[OK]'}")
        lines.append(f"      Proposed: demand={r['proposed_demand_vph']:.1f} vph (+{r['vehicles_added']:.1f}), "
                     f"v/c={r['proposed_vc']:.4f} {'[EXCEEDS]' if r['proposed_exceeds'] else '[OK]'}")
    lines.append(f"  Triggers Standard: {'YES' if s4['result'] else 'NO'}")

    # ------------------------------------------------------------------
    # Final Determination
    # ------------------------------------------------------------------
    d = audit["determination"]

    tier_explanation = {
        "DISCRETIONARY": (
            "DISCRETIONARY REVIEW REQUIRED\n\n"
            "  The project meets the dwelling unit size threshold and at least one serving\n"
            "  evacuation route exceeds the HCM 2022 v/c capacity threshold under the\n"
            "  citywide evacuation demand scenario. Full discretionary review of the\n"
            "  project's evacuation impacts is required before approval.\n\n"
            "  NOTE: Discretionary review is triggered by capacity impact (Standard 4),\n"
            "  not by fire zone location. Fire zone location is recorded as a severity\n"
            "  modifier in the audit trail and may affect required mitigation conditions.\n\n"
            "  Applicable conditions and mitigation measures are subject to environmental\n"
            "  review under CEQA and fire safety review under AB 747 (Gov. Code §65302.15)."
        ),
        "CONDITIONAL MINISTERIAL": (
            "CONDITIONAL MINISTERIAL APPROVAL\n\n"
            "  The city contains FHSZ zones and the project meets the dwelling unit size\n"
            "  threshold. The v/c threshold is not exceeded (Standard 4 not triggered);\n"
            "  therefore DISCRETIONARY review is not required.\n\n"
            "  The project is eligible for ministerial (by-right) approval subject to\n"
            "  mandatory evacuation-related conditions. Specific conditions are to be\n"
            "  defined by the city pursuant to its General Plan Safety Element and\n"
            "  AB 1600 nexus documentation. This system flags the trigger; it does not\n"
            "  prescribe the specific conditions."
        ),
        "MINISTERIAL": (
            "MINISTERIAL APPROVAL ELIGIBLE\n\n"
            "  The project does not meet the criteria for DISCRETIONARY review or\n"
            "  CONDITIONAL MINISTERIAL treatment. No evacuation-related conditions\n"
            "  are flagged by this analysis."
        ),
    }.get(det, det)

    lines += [
        "",
        "=" * 70,
        "FINAL DETERMINATION",
        "=" * 70,
        f"  RESULT: {det_label}",
        "",
        f"  {project.determination_reason}",
        "",
        "  Determination Tier:",
        f"    {tier_explanation}",
        "",
        "  Three-Tier Logic Applied:",
        "    DISCRETIONARY         if: std2_disc AND std4 (capacity impact gates DISCRETIONARY)",
        "    fire_zone_modifier     = severity modifier only (NOT a gate — recorded for condition language)",
        "    CONDITIONAL MINISTERIAL if: std1_citywide AND std2_cond",
        "    MINISTERIAL           otherwise (below size threshold or no FHSZ in city)",
        "",
        f"  Standard 1 (citywide FHSZ):        {'YES' if d['standard_1_citywide'] else 'NO'}",
        f"  Fire zone modifier (project in zone): {'YES' if d['fire_zone_modifier'] else 'NO'}",
        f"  Standard 2 (DISCRETIONARY path):   {'YES' if d['standard_2_disc_triggered'] else 'NO'}",
        f"  Standard 2 (CONDITIONAL path):     {'YES' if d['standard_2_cond_triggered'] else 'NO'}",
        f"  Standard 3 (serving routes exist):  {'YES' if d['standard_3_triggered'] else 'NO'}",
        f"  Standard 4 (capacity exceeded):     {'YES' if d['standard_4_triggered'] else 'NO'}",
        "",
        "  This determination is based solely on objective, verifiable criteria.",
        "  No professional discretion was applied. All calculations are reproducible.",
        "=" * 70,
    ]

    text = "\n".join(lines)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text)
    logger.info(f"Audit trail written to: {output_path}")

    return text
