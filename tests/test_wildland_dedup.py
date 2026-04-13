# Copyright (C) 2026 Thomas Gonzalez
# SPDX-License-Identifier: AGPL-3.0-or-later
# This file is part of JOSH (Jurisdictional Objective Standards for Housing).
# See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

"""Unit tests for extracted wildland routing functions.

Tests the pure functions that were extracted from identify_routes():
- _filter_by_travel_time: travel-time ratio filter
- _dedup_by_label: label-based bottleneck dedup
- _identify_and_enrich: bottleneck ID + cross-street enrichment
- SegmentIndex: single-object road attribute lookup
"""
import sys
from pathlib import Path

# Ensure the project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import unittest

import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString

from agents.scenarios.routing import RawCandidate, CandidateWithBottleneck
from agents.scenarios.segment_index import SegmentIndex, SegmentInfo
from agents.scenarios.wildland import _filter_by_travel_time, _dedup_by_label


def _make_raw(travel_time_s=100.0, exit_node=1, osmids=None, exit_osmid="100"):
    """Helper: build a minimal RawCandidate."""
    return RawCandidate(
        travel_time_s=travel_time_s,
        exit_node_id=exit_node,
        path_osmids=osmids or ["100", "200", "300"],
        exit_osmid=exit_osmid,
        path_length_m=500.0,
        path_wgs84_coords=[[37.0, -122.0], [37.1, -122.1]],
        osmid_to_uv={"100": (1, 2), "200": (2, 3), "300": (3, 4)},
    )


def _make_enriched(
    travel_time_s=100.0,
    bn_name="Main St",
    cross_a="1st Ave",
    cross_b="2nd Ave",
    dedup_key=None,
):
    """Helper: build a CandidateWithBottleneck."""
    key = dedup_key or (bn_name, cross_a, cross_b)
    return CandidateWithBottleneck(
        travel_time_s=travel_time_s,
        exit_node_id=1,
        path_osmids=["100", "200"],
        exit_osmid="200",
        path_length_m=400.0,
        path_wgs84_coords=[[37.0, -122.0]],
        osmid_to_uv={"100": (1, 2), "200": (2, 3)},
        bottleneck_osmid="100",
        bottleneck_eff_cap=900.0,
        bottleneck_name=bn_name,
        cross_street_a=cross_a,
        cross_street_b=cross_b,
        distance_mi=0.3,
        bearing="NE",
        dedup_key=key,
    )


class TestFilterByTravelTime(unittest.TestCase):
    """Tests for _filter_by_travel_time."""

    def test_empty_input(self):
        self.assertEqual(_filter_by_travel_time([], 2.0), [])

    def test_all_within_ratio(self):
        c1 = _make_raw(travel_time_s=100.0, exit_node=1)
        c2 = _make_raw(travel_time_s=150.0, exit_node=2)
        result = _filter_by_travel_time([c1, c2], 2.0)
        self.assertEqual(len(result), 2)

    def test_excludes_beyond_ratio(self):
        c1 = _make_raw(travel_time_s=100.0, exit_node=1)
        c2 = _make_raw(travel_time_s=250.0, exit_node=2)  # 2.5× → excluded at 2.0
        result = _filter_by_travel_time([c1, c2], 2.0)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].exit_node_id, 1)

    def test_boundary_exactly_at_ratio(self):
        c1 = _make_raw(travel_time_s=100.0, exit_node=1)
        c2 = _make_raw(travel_time_s=200.0, exit_node=2)  # exactly 2.0×
        result = _filter_by_travel_time([c1, c2], 2.0)
        self.assertEqual(len(result), 2)


class TestDedupByLabel(unittest.TestCase):
    """Tests for _dedup_by_label."""

    def test_collapses_same_label(self):
        """Three candidates with same (name, cross_a, cross_b) → 1 output."""
        c1 = _make_enriched(travel_time_s=120.0)
        c2 = _make_enriched(travel_time_s=100.0)  # fastest
        c3 = _make_enriched(travel_time_s=150.0)
        result = _dedup_by_label([c1, c2, c3])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].travel_time_s, 100.0)

    def test_keeps_distinct_labels(self):
        """Three candidates with different names → 3 outputs."""
        c1 = _make_enriched(bn_name="Main St", dedup_key=("Main St", "1st", "2nd"))
        c2 = _make_enriched(bn_name="Oak Ave", dedup_key=("Oak Ave", "3rd", "4th"))
        c3 = _make_enriched(bn_name="Elm Dr", dedup_key=("Elm Dr", "5th", "6th"))
        result = _dedup_by_label([c1, c2, c3])
        self.assertEqual(len(result), 3)

    def test_empty_input(self):
        self.assertEqual(_dedup_by_label([]), [])

    def test_fastest_wins_per_group(self):
        """Two groups: each keeps only fastest."""
        c1 = _make_enriched(travel_time_s=200.0, bn_name="A", dedup_key=("A", "", ""))
        c2 = _make_enriched(travel_time_s=100.0, bn_name="A", dedup_key=("A", "", ""))
        c3 = _make_enriched(travel_time_s=300.0, bn_name="B", dedup_key=("B", "", ""))
        c4 = _make_enriched(travel_time_s=150.0, bn_name="B", dedup_key=("B", "", ""))
        result = _dedup_by_label([c1, c2, c3, c4])
        self.assertEqual(len(result), 2)
        by_name = {r.bottleneck_name: r.travel_time_s for r in result}
        self.assertEqual(by_name["A"], 100.0)
        self.assertEqual(by_name["B"], 150.0)


class TestSegmentIndex(unittest.TestCase):
    """Tests for SegmentIndex construction from roads_gdf."""

    def _make_roads_gdf(self):
        """Build a minimal roads GeoDataFrame."""
        return gpd.GeoDataFrame({
            "osmid": ["100", "200", "300"],
            "name": ["Main St", "Oak Ave", ""],
            "effective_capacity_vph": [900.0, 1800.0, 500.0],
            "capacity_vph": [1200.0, 1900.0, 700.0],
            "road_type": ["two_lane", "multilane", "two_lane"],
            "fhsz_zone": ["vhfhsz", "non_fhsz", "high_fhsz"],
            "hazard_degradation": [0.35, 1.0, 0.50],
            "lane_count": [2, 4, 2],
            "speed_limit": [25, 45, 30],
            "geometry": [
                LineString([(0, 0), (1, 1)]),
                LineString([(1, 1), (2, 2)]),
                LineString([(2, 2), (3, 3)]),
            ],
        }, crs="EPSG:4326")

    def test_basic_lookup(self):
        idx = SegmentIndex(self._make_roads_gdf())
        info = idx.get("100")
        self.assertIsNotNone(info)
        self.assertEqual(info.name, "Main St")
        self.assertEqual(info.effective_capacity_vph, 900.0)
        self.assertEqual(info.fhsz_zone, "vhfhsz")
        self.assertEqual(info.haz_class, 3)
        self.assertEqual(info.lane_count, 2)
        self.assertEqual(info.speed_limit, 25)

    def test_eff_cap_shortcut(self):
        idx = SegmentIndex(self._make_roads_gdf())
        self.assertEqual(idx.eff_cap("200"), 1800.0)
        self.assertEqual(idx.eff_cap("missing"), 0.0)

    def test_missing_osmid(self):
        idx = SegmentIndex(self._make_roads_gdf())
        self.assertIsNone(idx.get("999"))

    def test_haz_class_mapping(self):
        idx = SegmentIndex(self._make_roads_gdf())
        self.assertEqual(idx.get("100").haz_class, 3)  # vhfhsz
        self.assertEqual(idx.get("200").haz_class, 0)  # non_fhsz
        self.assertEqual(idx.get("300").haz_class, 2)  # high_fhsz


if __name__ == "__main__":
    unittest.main()
