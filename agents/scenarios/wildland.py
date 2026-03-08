"""
Scenario A: Wildland Evacuation Capacity (Standards 1–4) — JOSH v3.0

Legal basis: AB 747 (California Government Code §65302.15), HCM 2022,
Zhao et al. (2022) GPS-empirical mobilization rates.

ΔT Standard (v3.0):
  Standard 1 — Project Size:       units >= threshold (scale gate)
  Standard 2 — Evac Routes Served: network buffer → identifies serving EvacuationPaths
  Standard 3 — FHSZ Modifier:      GIS point-in-polygon; sets hazard_zone string which
                                    controls mobilization_rate and ΔT threshold
  Standard 4 — ΔT Test:            ΔT = (project_vehicles / bottleneck_effective_capacity) × 60 + egress
                                    Project is DISCRETIONARY if ΔT > threshold for hazard_zone
                                    threshold = safe_egress_window(zone) × max_project_share

Key v3.0 changes from v2.0:
  - No baseline precondition: routes already at LOS F are tested equally
  - Tiered mobilization rates from Zhao et al. 2022 GPS data (vhfhsz=0.75, high=0.57, moderate=0.40, non=0.25)
  - Hazard-aware capacity degradation (HCM composite factors) applied upstream by Agent 2
  - Building egress penalty (NFPA 101/IBC) added to ΔT for buildings ≥ 4 stories
  - Returns EvacuationPath objects (not osmid lists) from identify_routes()

Three-tier output:
  DISCRETIONARY           — size threshold met AND ΔT > threshold (safe_egress_window × max_project_share) on any serving path
  CONDITIONAL MINISTERIAL — size threshold met AND ΔT within threshold on all paths
  MINISTERIAL             — below size threshold
"""
import logging

import geopandas as gpd
from shapely.geometry import Point

from models.project import Project
from models.evacuation_path import EvacuationPath
from .base import EvacuationScenario, Tier

logger = logging.getLogger(__name__)

_LEGAL_BASIS = (
    "AB 747 (California Government Code §65302.15) — General Plan Safety Element "
    "mandatory update for evacuation route capacity analysis; "
    "HCM 2022 (Highway Capacity Manual, 7th Edition) — effective capacity with hazard degradation; "
    "Zhao, X., et al. (2022) — GPS-empirical mobilization rates (44M records, Kincade Fire)"
)

# HAZ_CLASS integer → canonical hazard_zone key (matches mobilization_rates and safe_egress_window)
_HAZ_CLASS_TO_ZONE = {
    3: "vhfhsz",
    2: "high_fhsz",
    1: "moderate_fhsz",
    0: "non_fhsz",
}


class WildlandScenario(EvacuationScenario):
    """
    Evaluates wildland evacuation capacity impact (Standards 1–4) using v3.0 ΔT metric.

    Standard 1 (size) gates the analysis.
    Standard 3 (FHSZ modifier) sets project.hazard_zone which controls:
      - mobilization_rate (Zhao et al. 2022 GPS-empirical tiered lookup)
      - ΔT threshold (safe_egress_window × max_project_share by hazard zone)
      - capacity degradation factor (applied upstream in Agent 2 to road segments)
    Standard 4 (ΔT test) uses compute_delta_t() from base class.
    """

    @property
    def name(self) -> str:
        return "wildland_ab747"

    @property
    def legal_basis(self) -> str:
        return _LEGAL_BASIS

    @property
    def unit_threshold(self) -> int:
        return int(self.config.get("unit_threshold", 15))

    @property
    def fallback_tier(self) -> Tier:
        return Tier.CONDITIONAL_MINISTERIAL

    # ------------------------------------------------------------------
    # Step 1: Applicability — always applicable; sets FHSZ hazard zone
    # ------------------------------------------------------------------

    def check_applicability(self, project: Project, context: dict) -> tuple[bool, dict]:
        """
        Standard 3 (FHSZ Modifier): Sets project.hazard_zone based on site location.

        This scenario is ALWAYS applicable — the citywide FHSZ gate was removed in v3.0.

        The GIS point-in-polygon test determines project.hazard_zone, which controls:
          - mobilization_rate via config["mobilization_rates"][hazard_zone]
          - ΔT threshold via config["safe_egress_window"][hazard_zone] × config["max_project_share"]
          - (capacity degradation already applied to roads upstream in Agent 2)

        Method: GIS point-in-polygon test against CAL FIRE FHSZ zones.
        Discretion: Zero — binary spatial result with deterministic zone mapping.
        """
        fhsz_gdf = context.get("fhsz_gdf", gpd.GeoDataFrame())

        fire_zone_result, fire_zone_detail = check_fire_zone(
            (project.location_lat, project.location_lon), fhsz_gdf
        )

        # Set project fire zone fields
        project.in_fire_zone    = fire_zone_result
        project.fire_zone_level = fire_zone_detail.get("zone_level", 0)
        project.hazard_zone     = fire_zone_detail.get("hazard_zone", "non_fhsz")

        # Set mobilization_rate on project for audit display
        mob_rates = self.config.get("mobilization_rates", {})
        project.mobilization_rate = mob_rates.get(project.hazard_zone, 0.25)

        return True, {
            "result":                    True,
            "method":                    "Always applicable; site FHSZ check via GIS point-in-polygon",
            "std3_fhsz_flagged":         fire_zone_result,
            "std3_zone_level":           project.fire_zone_level,
            "std3_zone_desc":            fire_zone_detail.get("zone_description", "Not in FHSZ"),
            "std3_hazard_zone":          project.hazard_zone,
            "std3_mobilization_rate":    project.mobilization_rate,
            "fire_zone_severity_modifier": fire_zone_detail,
            "note": (
                f"Standard 3: project in FHSZ Zone {project.fire_zone_level} "
                f"({project.hazard_zone}) — mobilization rate {project.mobilization_rate:.2f} "
                f"(Zhao et al. 2022 GPS-empirical, Kincade Fire)."
                if fire_zone_result else
                f"Standard 3: project not in FHSZ — hazard_zone=non_fhsz, "
                f"mobilization rate {project.mobilization_rate:.2f} "
                f"(shadow evacuation, Zhao et al. 2022)."
            ),
        }

    # ------------------------------------------------------------------
    # Step 3: Route Identification — serving EvacuationPath objects
    # ------------------------------------------------------------------

    def identify_routes(
        self,
        project: Project,
        roads_gdf: gpd.GeoDataFrame,
        context: dict,
    ) -> tuple[list, dict]:
        """
        Standard 2 (Evac Routes Served): Which EvacuationPaths serve this project?

        Method:
          1. Buffer project location by evacuation.serving_route_radius_miles.
          2. Find all evacuation route segment osmids within the buffer.
          3. Filter context["evacuation_paths"] to those whose bottleneck_osmid
             or exit_segment_osmid is within the buffer.
          4. If no paths match proximity filter, use all paths (conservative fallback).

        Returns list[EvacuationPath] for consumption by compute_delta_t().
        Discretion: Zero — algorithmic spatial query.
        """
        evac_cfg     = self.config.get("evacuation", {})
        radius       = evac_cfg.get(
            "serving_route_radius_miles",
            self.config.get("evacuation_route_radius_miles", 0.5),
        )
        analysis_crs = self.city_config.get("analysis_crs", "EPSG:26910")

        lat, lon = project.location_lat, project.location_lon
        project_pt = gpd.GeoDataFrame(
            {"geometry": [Point(lon, lat)]}, crs="EPSG:4326"
        ).to_crs(analysis_crs)

        roads_proj    = roads_gdf.to_crs(analysis_crs)
        radius_meters = radius * 1609.344
        buffer        = project_pt.geometry.iloc[0].buffer(radius_meters)

        # Find nearby evacuation route segments
        if "is_evacuation_route" not in roads_proj.columns:
            evac_nearby = roads_proj[roads_proj.geometry.intersects(buffer)]
        else:
            evac_only   = roads_proj[roads_proj["is_evacuation_route"] == True]
            evac_nearby = evac_only[evac_only.geometry.intersects(buffer)]

        # Build set of nearby osmids (handle list-type osmid columns)
        nearby_osmids: set[str] = set()
        for osmid_val in evac_nearby["osmid"].tolist():
            if isinstance(osmid_val, list):
                for o in osmid_val:
                    nearby_osmids.add(str(o))
            else:
                nearby_osmids.add(str(osmid_val))

        # Update project display fields
        project.serving_route_ids   = list(nearby_osmids)
        project.search_radius_miles = radius

        # Filter EvacuationPaths from context by proximity of bottleneck/exit
        all_evac_paths: list = context.get("evacuation_paths", [])
        serving_paths: list[EvacuationPath] = [
            p for p in all_evac_paths
            if (
                str(getattr(p, "bottleneck_osmid", "")) in nearby_osmids
                or str(getattr(p, "exit_segment_osmid", "")) in nearby_osmids
            )
        ]

        fallback_used = False
        if not serving_paths and all_evac_paths:
            # Conservative: if no proximity match, evaluate against all paths
            serving_paths = list(all_evac_paths)
            fallback_used = True
            logger.warning(
                f"  No evacuation paths matched proximity filter for "
                f"({lat:.4f}, {lon:.4f}) — using all {len(all_evac_paths)} paths (conservative)"
            )

        detail = {
            "project_lat":          lat,
            "project_lon":          lon,
            "radius_miles":         radius,
            "radius_meters":        round(radius_meters, 1),
            "method":               (
                "Buffer project location + filter EvacuationPath objects "
                "by bottleneck/exit osmid proximity"
            ),
            "serving_route_count":  len(evac_nearby),
            "serving_paths_count":  len(serving_paths),
            "fallback_all_paths":   fallback_used,
            "triggers_standard":    len(serving_paths) > 0,
            "serving_routes": [
                {
                    "osmid":                  str(row["osmid"]),
                    "name":                   row.get("name", ""),
                    "fhsz_zone":              row.get("fhsz_zone", "non_fhsz"),
                    "hazard_degradation":     row.get("hazard_degradation", 1.0),
                    "effective_capacity_vph": round(
                        row.get("effective_capacity_vph", row.get("capacity_vph", 0)), 0
                    ),
                    "vc_ratio":               round(row.get("vc_ratio", 0), 4),
                    "los":                    row.get("los", ""),
                }
                for _, row in evac_nearby.iterrows()
            ],
        }
        return serving_paths, detail

    # ------------------------------------------------------------------
    # Override reason builders to include fire zone / ΔT context
    # ------------------------------------------------------------------

    def _reason_discretionary(self, project: Project, step5: dict) -> str:
        max_dt    = step5.get("max_delta_t_minutes", 0.0)
        threshold = step5.get("threshold_minutes", 0.0)
        hz        = step5.get("hazard_zone", "non_fhsz")
        mob       = step5.get("mobilization_rate", 0.25)
        n_paths   = sum(1 for r in step5.get("path_results", []) if r.get("flagged"))
        fire_note = (
            f"Standard 3: FHSZ Zone {project.fire_zone_level} ({hz}), mob rate {mob:.2f}. "
            if project.in_fire_zone else
            f"Standard 3: not in FHSZ (hazard_zone={hz}), mob rate {mob:.2f}. "
        )
        return (
            f"Project meets the {self.unit_threshold}-unit size threshold (Standard 1) and "
            f"{n_paths} serving path(s) exceed the ΔT threshold of {threshold:.2f} min "
            f"(max ΔT: {max_dt:.1f} min). "
            f"{fire_note}"
            f"Discretionary review required. Legal basis: {self.legal_basis}."
        )

    def _reason_fallback(self, project: Project, step3: dict, step5: dict) -> str:
        n_paths   = step3.get("serving_paths_count", 0)
        max_dt    = step5.get("max_delta_t_minutes", 0.0)
        threshold = step5.get("threshold_minutes", 0.0)
        hz        = step5.get("hazard_zone", "non_fhsz")
        mob       = step5.get("mobilization_rate", 0.25)
        fire_note = (
            f"Standard 3: FHSZ Zone {project.fire_zone_level} ({hz}), mob {mob:.2f}. "
            if project.in_fire_zone else
            f"Standard 3: not in FHSZ (hazard_zone={hz}), mob {mob:.2f}. "
        )
        return (
            f"Project meets the {self.unit_threshold}-unit size threshold and "
            f"has {n_paths} serving path(s). "
            f"Max ΔT {max_dt:.1f} min within threshold ({threshold:.2f} min). "
            f"{fire_note}"
            f"Ministerial approval eligible with mandatory evacuation conditions. "
            f"Legal basis: {self.legal_basis}."
        )


# ---------------------------------------------------------------------------
# Helper functions (module-level — reusable and independently testable)
# ---------------------------------------------------------------------------

def check_fire_zone(
    location: tuple[float, float],
    fhsz_gdf: gpd.GeoDataFrame,
) -> tuple[bool, dict]:
    """
    Standard 3 (FHSZ Modifier): Is the project site in FHSZ Zone 2 or 3?

    Returns (in_trigger_zone: bool, detail: dict).
    detail["hazard_zone"] contains the canonical zone key for mobilization_rate lookup.

    HAZ_CLASS mapping:
      3 → "vhfhsz" (Very High)
      2 → "high_fhsz" (High) — trigger zone
      1 → "moderate_fhsz" (Moderate)
      0 → "non_fhsz"

    in_trigger_zone is True for HAZ_CLASS >= 2 (High and Very High).
    Moderate FHSZ (HAZ_CLASS=1) sets hazard_zone="moderate_fhsz" but returns False
    (does not trigger FHSZ status; mobilization_rate applied via hazard_zone lookup).
    Discretion: Zero — binary spatial result.
    """
    lat, lon = location
    project_pt = gpd.GeoDataFrame(
        {"geometry": [Point(lon, lat)]}, crs="EPSG:4326"
    )

    detail = {
        "input_lat":   lat,
        "input_lon":   lon,
        "method":      "GIS point-in-polygon (shapely/geopandas sjoin)",
        "data_source": "CAL FIRE FHSZ",
        "role":        "Sets hazard_zone for mobilization_rate and ΔT threshold lookup",
    }

    if fhsz_gdf.empty:
        detail.update({
            "result":       False,
            "zone_level":   0,
            "hazard_zone":  "non_fhsz",
            "note":         "FHSZ data unavailable",
        })
        return False, detail

    fhsz_wgs84 = fhsz_gdf.to_crs("EPSG:4326")
    joined     = gpd.sjoin(project_pt, fhsz_wgs84, how="left", predicate="within")

    if joined.empty or joined["HAZ_CLASS"].isna().all():
        detail.update({
            "result":           False,
            "zone_level":       0,
            "hazard_zone":      "non_fhsz",
            "zone_description": "Not in FHSZ",
        })
        return False, detail

    zone_level  = int(joined["HAZ_CLASS"].dropna().max())
    in_trigger  = zone_level >= 2
    hazard_zone = _HAZ_CLASS_TO_ZONE.get(zone_level, "non_fhsz")

    detail.update({
        "result":           in_trigger,
        "zone_level":       zone_level,
        "hazard_zone":      hazard_zone,
        "zone_description": {
            0: "Not in FHSZ",
            1: "Zone 1 (Moderate)",
            2: "Zone 2 (High)",
            3: "Zone 3 (Very High)",
        }.get(zone_level, f"Zone {zone_level}"),
    })
    return in_trigger, detail
