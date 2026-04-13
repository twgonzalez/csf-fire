# Copyright (C) 2026 Thomas Gonzalez
# SPDX-License-Identifier: AGPL-3.0-or-later
# This file is part of JOSH (Jurisdictional Objective Standards for Housing).
# See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

"""SegmentIndex — single-object road segment attribute lookup.

Replaces 10 parallel osmid→attribute dicts with a single SegmentIndex
that maps osmid → SegmentInfo.  Built once from roads_gdf at the start
of identify_routes().
"""
from dataclasses import dataclass

import geopandas as gpd


# HAZ_CLASS integer ← canonical zone key
_ZONE_TO_HAZ_CLASS = {
    "vhfhsz": 3,
    "high_fhsz": 2,
    "moderate_fhsz": 1,
    "non_fhsz": 0,
}


@dataclass(frozen=True, slots=True)
class SegmentInfo:
    """All attributes for a single road segment, looked up by osmid."""

    name: str
    effective_capacity_vph: float
    hcm_capacity_vph: float
    road_type: str
    fhsz_zone: str
    hazard_degradation: float
    lane_count: int
    speed_limit: int
    haz_class: int


class SegmentIndex:
    """osmid → SegmentInfo lookup, built once from roads_gdf."""

    __slots__ = ("_index",)

    def __init__(self, roads_gdf: gpd.GeoDataFrame) -> None:
        self._index: dict[str, SegmentInfo] = {}
        for _, row in roads_gdf.iterrows():
            oid = row.get("osmid")
            if oid is None:
                continue
            eff = float(row.get("effective_capacity_vph", row.get("capacity_vph", 1000.0)))
            fz = str(row.get("fhsz_zone", "non_fhsz"))
            rt = str(row.get("road_type", "two_lane"))
            hcm = float(row.get("capacity_vph", 0.0))
            dg = float(row.get("hazard_degradation", 1.0))
            nm = str(row.get("name", ""))
            lc = int(row.get("lane_count", 0) or 0)
            sp = int(row.get("speed_limit", 0) or 0)
            hc = _ZONE_TO_HAZ_CLASS.get(fz, 0)
            info = SegmentInfo(
                name=nm,
                effective_capacity_vph=eff,
                hcm_capacity_vph=hcm,
                road_type=rt,
                fhsz_zone=fz,
                hazard_degradation=dg,
                lane_count=lc,
                speed_limit=sp,
                haz_class=hc,
            )
            for o in (oid if isinstance(oid, list) else [oid]):
                key = str(o)
                existing = self._index.get(key)
                if existing is None or eff > existing.effective_capacity_vph:
                    self._index[key] = info

    def get(self, osmid: str) -> SegmentInfo | None:
        """Return SegmentInfo for an osmid, or None if not found."""
        return self._index.get(osmid)

    def eff_cap(self, osmid: str) -> float:
        """Shortcut: effective capacity for an osmid (0.0 if missing)."""
        info = self._index.get(osmid)
        return info.effective_capacity_vph if info else 0.0
