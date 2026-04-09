// Copyright (C) 2026 Thomas Gonzalez
// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of JOSH (Jurisdictional Objective Standards for Housing).
// See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

// ============================================================================
// GENERATED FILE — DO NOT EDIT
// Source:   agents/export.py  (export_app_js)
//           agents/visualization/demo.py  (_build_whatif_ui_html, _build_whatif_ui_js)
//           static/whatif_engine.js  (embedded verbatim)
// Regenerate:  uv run python main.py demo --city "Berkeley"
// ============================================================================

// ── Schema compatibility check ────────────────────────────────────────────────
// Emits console.warn if window.JOSH_DATA.schema_version does not match v1.
(function () {
  var d = window.JOSH_DATA;
  if (!d) { console.warn('JOSH app.js: window.JOSH_DATA not found'); return; }
  if (d.schema_version !== 1) {
    console.warn(
      'JOSH app.js v1: schema_version mismatch (got ' + d.schema_version + '). ' +
      'Regenerate demo_map.html with a matching version of app.js.'
    );
  }
})();

// ── WhatIfEngine IIFE (from static/whatif_engine.js) ──────────────────────────

// Copyright (C) 2026 Thomas Gonzalez
// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of JOSH (Jurisdictional Objective Standards for Housing).
// See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

// ============================================================================
// GENERATED FILE — DO NOT EDIT
// Source:   agents/export.py  (algorithm JS strings)
//           static/whatif_utils.js  (drift-free utilities)
// Regenerate:  uv run python main.py analyze --city "Berkeley"
// ============================================================================

/**
 * JOSH What-If Evaluation Engine (feat/whatif-browser)
 *
 * Pure JavaScript implementation of the JOSH v4.0 ΔT evacuation clearance
 * algorithm.  Mirrors agents/scenarios/wildland.py + agents/scenarios/base.py
 * exactly — same Dijkstra weights, same deduplication logic, same ΔT formula.
 *
 * The algorithm sections of this file are defined as Python string constants
 * in agents/export.py, directly adjacent to the Python source they mirror.
 * Utility functions (MinHeap, haversine, etc.) live in static/whatif_utils.js
 * and contain no algorithm constants — they cannot drift from Python.
 *
 * Entry point:  WhatIfEngine.evaluateProject(lat, lon, units, stories)
 * No external dependencies.  Works from file:// (all data inlined into HTML).
 */

const WhatIfEngine = (() => {
  // ── Module-level state (initialised once from globals) ─────────────────────
  let _graph     = null;   // parsed graph.json
  let _params    = null;   // parsed parameters.json
  let _fhsz      = null;   // parsed fhsz GeoJSON FeatureCollection
  let _adjacency = null;   // Map<nodeId, [{v, osmid, len_m, speed_mph, ...}]>
  let _nodeMap   = null;   // Map<nodeId, {lon, lat}>
  let _exitSet   = null;   // Set<nodeId>
  let _ready     = false;

  // MPH → m/s conversion — exact, matches wildland.py _MPH_TO_MPS
  const MPH_TO_MPS    = 0.44704;
  const EARTH_RADIUS_M = 6_371_000;

  // ── Init ─────────────────────────────────────────────────────────────────────

  /**
   * Initialise the engine from the three global data objects.
   * Called automatically on first evaluateProject() call, or explicitly by tests.
   */
  function init(graph, params, fhsz) {
    _graph = graph;
    _params = params;
    _fhsz = fhsz;
    _nodeMap = new Map();
    for (const n of _graph.nodes) {
      _nodeMap.set(n.id, { lon: n.lon, lat: n.lat });
    }
    _adjacency = _buildAdjacency(_graph.edges);
    _exitSet = new Set(_graph.exit_nodes);
    _ready = true;
  }

  function _ensureReady() {
    if (!_ready) {
      var d = window.JOSH_DATA;
      if (d && d.graph && d.parameters && d.fhsz) {
        init(d.graph, d.parameters, d.fhsz);
      } else {
        throw new Error(
          "WhatIfEngine: window.JOSH_DATA not loaded. " +
          "Ensure JOSH_DATA is inlined before app.js."
        );
      }
    }
  }

  // ── Utilities (from static/whatif_utils.js) ────────────────────────────────

  // ── Min-heap (binary heap) for Dijkstra ───────────────────────────────────────
  // Pure data structure — no algorithm parameters.

  class MinHeap {
    constructor() { this._h = []; }
    push(cost, id) {
      this._h.push([cost, id]);
      this._bubbleUp(this._h.length - 1);
    }
    pop() {
      const top = this._h[0];
      const last = this._h.pop();
      if (this._h.length > 0) { this._h[0] = last; this._siftDown(0); }
      return top;
    }
    get size() { return this._h.length; }
    _bubbleUp(i) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this._h[p][0] <= this._h[i][0]) break;
        [this._h[p], this._h[i]] = [this._h[i], this._h[p]];
        i = p;
      }
    }
    _siftDown(i) {
      const n = this._h.length;
      while (true) {
        let m = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && this._h[l][0] < this._h[m][0]) m = l;
        if (r < n && this._h[r][0] < this._h[m][0]) m = r;
        if (m === i) break;
        [this._h[m], this._h[i]] = [this._h[i], this._h[m]];
        i = m;
      }
    }
  }

  // ── Haversine distance ─────────────────────────────────────────────────────────
  // Pure geometry — no algorithm parameters.
  // Used for nearest-node lookup and radius cutoffs.

  /** Haversine distance in metres between two WGS84 points. */
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
  }

  // ── Point-in-polygon (ray-casting) ────────────────────────────────────────────
  // Pure geometry — handles GeoJSON Polygon and MultiPolygon with holes.

  /**
   * Ray-casting point-in-polygon test for a single GeoJSON ring
   * (array of [lon, lat] coordinate pairs).
   */
  function _pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect =
        yi > lat !== yj > lat &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Test a [lon, lat] point against a GeoJSON Feature (Polygon or MultiPolygon). */
  function _pointInFeature(lon, lat, feature) {
    const geom = feature.geometry;
    if (!geom) return false;
    if (geom.type === "Polygon") {
      if (!_pointInRing(lon, lat, geom.coordinates[0])) return false;
      for (let h = 1; h < geom.coordinates.length; h++) {
        if (_pointInRing(lon, lat, geom.coordinates[h])) return false;
      }
      return true;
    }
    if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        if (!_pointInRing(lon, lat, poly[0])) continue;
        let inHole = false;
        for (let h = 1; h < poly.length; h++) {
          if (_pointInRing(lon, lat, poly[h])) { inHole = true; break; }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }

  // ── Graph adjacency builder ────────────────────────────────────────────────────
  // Builds undirected adjacency list — mirrors nx.to_undirected() in wildland.py.
  // No algorithm constants: just graph topology.

  /**
   * Build undirected adjacency list from edges array.
   * Map<nodeId, Array<{v, osmid, len_m, speed_mph, eff_cap_vph, fhsz_zone, haz_deg}>>
   */
  function _buildAdjacency(edges) {
    const adj = new Map();
    const addEdge = (from, to, attrs) => {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from).push({ v: to, ...attrs });
    };
    for (const e of edges) {
      const attrs = {
        osmid:        e.osmid,
        len_m:        e.len_m,
        speed_mph:    e.speed_mph,
        eff_cap_vph:  e.eff_cap_vph,
        fhsz_zone:    e.fhsz_zone,
        haz_deg:      e.haz_deg,
      };
      addEdge(e.u, e.v, attrs);
      addEdge(e.v, e.u, attrs);  // undirected — mirrors nx.to_undirected()
    }
    return adj;
  }

  // ── Nearest node ───────────────────────────────────────────────────────────────
  // Uses module-level _nodeMap (set during init).
  // Mirrors ox.distance.nearest_nodes() in wildland.py.

  /**
   * Find the graph node closest to (lat, lon) by Haversine distance.
   * Linear scan — Berkeley has ~8K nodes, runs in < 5 ms.
   */
  function nearestNode(lat, lon) {
    let bestId = null, bestDist = Infinity;
    for (const [id, pos] of _nodeMap) {
      const d = haversineMeters(lat, lon, pos.lat, pos.lon);
      if (d < bestDist) { bestDist = d; bestId = id; }
    }
    return bestId;
  }

  // ── Reachable nodes (radius-cutoff Dijkstra) ───────────────────────────────────
  // Uses module-level _adjacency (set during init).
  // Mirrors nx.single_source_dijkstra_path_length(..., weight="length") in wildland.py.
  // No algorithm constants — radius is passed as a parameter from params at call site.

  /**
   * Return Set of node IDs reachable from startNode within radiusMeters,
   * weighted by edge length (len_m).
   */
  function reachableNodes(startNode, radiusMeters) {
    const dist = new Map([[startNode, 0]]);
    const heap = new MinHeap();
    heap.push(0, startNode);
    while (heap.size > 0) {
      const [cost, u] = heap.pop();
      if (cost > dist.get(u)) continue;
      if (cost > radiusMeters) continue;
      for (const edge of (_adjacency.get(u) ?? [])) {
        const newCost = cost + edge.len_m;
        if (newCost <= radiusMeters && newCost < (dist.get(edge.v) ?? Infinity)) {
          dist.set(edge.v, newCost);
          heap.push(newCost, edge.v);
        }
      }
    }
    return new Set(dist.keys());
  }

  // ── FHSZ classification ───────────────────────────────────────────────────────
  // Mirrors: agents/scenarios/wildland.py _classify_fhsz_zone()
  // HAZ_CLASS thresholds: 3 → vhfhsz, 2 → high_fhsz, 1 → moderate_fhsz.

  /**
   * Return "vhfhsz" | "high_fhsz" | "moderate_fhsz" | "non_fhsz".
   * Iterates FHSZ features sorted by HAZ_CLASS descending — most severe zone wins.
   */
  function classifyFhsz(lat, lon) {
    if (!_fhsz || !_fhsz.features) return "non_fhsz";
    const sorted = [..._fhsz.features].sort(
      (a, b) => (b.properties?.HAZ_CLASS ?? 0) - (a.properties?.HAZ_CLASS ?? 0)
    );
    for (const feat of sorted) {
      if (_pointInFeature(lon, lat, feat)) {
        const haz = feat.properties?.HAZ_CLASS ?? 0;
        if (haz >= 3) return "vhfhsz";
        if (haz === 2) return "high_fhsz";
        if (haz === 1) return "moderate_fhsz";
      }
    }
    return "non_fhsz";
  }

  // ── Full Dijkstra from origin ─────────────────────────────────────────────────
  // Mirrors: agents/scenarios/wildland.py Pass 1 Dijkstra
  // Weight: travel_time_s = len_m / (speed_mph × MPH_TO_MPS).
  // Speed is from graph.json speed_defaults — NOT OSM maxspeed — matching wildland.py.

  /**
   * Run Dijkstra from startNode to all reachable exit nodes, weighted by
   * travel_time_s.  Returns Map<exitNodeId, {cost_s, path_edges, path_nodes, path_coords}>.
   */
  function _dijkstraFromOrigin(startNode) {
    const INF = Infinity;
    const dist = new Map([[startNode, 0]]);
    const prev = new Map();   // nodeId → {from: nodeId, edge: edgeAttrs}
    const heap = new MinHeap();
    heap.push(0, startNode);

    while (heap.size > 0) {
      const [cost, u] = heap.pop();
      if (cost > (dist.get(u) ?? INF)) continue;
      for (const edge of (_adjacency.get(u) ?? [])) {
        const spd_mps = edge.speed_mph * MPH_TO_MPS;
        const tt      = spd_mps > 0 ? edge.len_m / spd_mps : edge.len_m;
        const newCost = cost + tt;
        if (newCost < (dist.get(edge.v) ?? INF)) {
          dist.set(edge.v, newCost);
          prev.set(edge.v, { from: u, edge });
          heap.push(newCost, edge.v);
        }
      }
    }

    // Reconstruct paths for all reachable exit nodes
    const results = new Map();
    for (const exitNode of _exitSet) {
      if (!dist.has(exitNode)) continue;
      const pathNodes = [];
      const pathEdges = [];
      let cur = exitNode;
      while (prev.has(cur)) {
        const { from, edge } = prev.get(cur);
        pathEdges.unshift(edge);
        pathNodes.unshift(cur);
        cur = from;
      }
      pathNodes.unshift(startNode);

      const pathCoords = pathNodes
        .map(id => { const p = _nodeMap.get(id); return p ? [p.lat, p.lon] : null; })
        .filter(c => c !== null);

      results.set(exitNode, {
        cost_s:      dist.get(exitNode),
        path_edges:  pathEdges,
        path_nodes:  pathNodes,
        path_coords: pathCoords,   // [[lat, lon], ...]
      });
    }
    return results;
  }

  // ── Serving path identification ───────────────────────────────────────────────
  // Mirrors: agents/scenarios/wildland.py identify_routes()
  // Routes to ALL exit nodes (no radius filter on exits — matches Python).
  // max_path_length_ratio filter, bottleneck = argmin(eff_cap_vph), dedup by osmid.

  /**
   * Identify EvacuationPath objects for a project at (lat, lon).
   * Returns array of path objects with bottleneck + coord data for rendering.
   */
  function identifyServingPaths(lat, lon) {
    const maxRatio = _params.max_path_length_ratio;

    const origin = nearestNode(lat, lon);
    if (origin === null) return [];

    // Dijkstra to ALL exit nodes — mirrors wildland.py (no radius filter on exits)
    const dijkstra = _dijkstraFromOrigin(origin);

    const candidates = [];
    for (const [exitNode, info] of dijkstra) {
      if (!_exitSet.has(exitNode)) continue;
      candidates.push({ exitNode, cost_s: info.cost_s, path_edges: info.path_edges,
                        path_coords: info.path_coords });
    }
    if (candidates.length === 0) return [];

    // max_path_length_ratio filter — keep only paths within ratio × fastest
    const minCost   = Math.min(...candidates.map(c => c.cost_s));
    const maxAllowed = minCost * maxRatio;
    const filtered  = candidates.filter(c => c.cost_s <= maxAllowed);

    // Bottleneck = edge with minimum eff_cap_vph.
    // Dedup: per unique bottleneck osmid, keep the path with highest bottleneck cap.
    const bottleneckMap = new Map(); // osmid → best candidate
    for (const cand of filtered) {
      if (cand.path_edges.length === 0) continue;
      let bn = cand.path_edges[0];
      for (const e of cand.path_edges) {
        if (e.eff_cap_vph < bn.eff_cap_vph) bn = e;
      }
      const existing = bottleneckMap.get(bn.osmid);
      if (!existing || bn.eff_cap_vph > existing.bottleneck.eff_cap_vph) {
        bottleneckMap.set(bn.osmid, {
          exitNode:       cand.exitNode,
          cost_s:         cand.cost_s,
          path_edges:     cand.path_edges,
          path_coords:    cand.path_coords ?? [],
          bottleneck:     bn,
          bottleneck_idx: cand.path_edges.indexOf(bn),
        });
      }
    }

    return Array.from(bottleneckMap.values()).map((c, i) => {
      const bi = c.bottleneck_idx;
      const bnCoords = (bi >= 0 && bi < c.path_coords.length - 1)
        ? [c.path_coords[bi], c.path_coords[bi + 1]]
        : [];
      return {
        pathId:               `project_origin_${c.exitNode}_${i}`,
        exitNodeId:           c.exitNode,
        bottleneckOsmid:      c.bottleneck.osmid,
        bottleneckEffCapVph:  c.bottleneck.eff_cap_vph,
        bottleneckFhszZone:   c.bottleneck.fhsz_zone,
        cost_s:               c.cost_s,
        path_edges:           c.path_edges,
        path_coords:          c.path_coords,
        bottleneck_coords:    bnCoords,
      };
    });
  }

  // ── ΔT calculation ────────────────────────────────────────────────────────────
  // Mirrors: agents/scenarios/base.py compute_delta_t()
  // All constants read from _params — no hardcoded values here.
  //   project_vehicles = units × vehicles_per_unit × mobilization_rate
  //   egress_minutes   = 0 if stories < threshold; else min(stories × mps, max_min)
  //   ΔT               = (project_vehicles / bottleneck_eff_cap_vph) × 60 + egress_minutes
  //   threshold        = safe_egress_window[hazard_zone] × max_project_share

  function computeDeltaT(servingPaths, units, stories, hazardZone) {
    const p = _params;
    const projectVehicles = units * p.vehicles_per_unit * p.mobilization_rate;

    const ep = p.egress_penalty;
    const egressMinutes =
      stories < ep.threshold_stories
        ? 0
        : Math.min(stories * ep.minutes_per_story, ep.max_minutes);

    const threshold = p.safe_egress_window[hazardZone] * p.max_project_share;

    return servingPaths.map(path => {
      const delta_t = (projectVehicles / path.bottleneckEffCapVph) * 60 + egressMinutes;
      return {
        pathId:              path.pathId,
        bottleneckOsmid:     path.bottleneckOsmid,
        bottleneckFhszZone:  path.bottleneckFhszZone,
        bottleneckEffCapVph: path.bottleneckEffCapVph,
        delta_t_minutes:     delta_t,
        threshold_minutes:   threshold,
        flagged:             delta_t > threshold,
        project_vehicles:    projectVehicles,
        egress_minutes:      egressMinutes,
        path_coords:         path.path_coords     ?? [],
        bottleneck_coords:   path.bottleneck_coords ?? [],
      };
    });
  }

  // ── Tier determination ────────────────────────────────────────────────────────
  // Mirrors: agents/objective_standards.py most-restrictive-wins logic.
  // Tier strings must match Python Determination enum values EXACTLY.

  function _determineTier(units, deltaResults) {
    const p = _params;
    if (units < p.unit_threshold) return "MINISTERIAL";
    if (deltaResults.some(d => d.flagged)) return "DISCRETIONARY";
    return "MINISTERIAL WITH STANDARD CONDITIONS";
  }

  // ── Top-level evaluateProject ─────────────────────────────────────────────────
  // Mirrors: agents/objective_standards.py evaluate() orchestration.

  /**
   * Evaluate a hypothetical project at (lat, lon).
   * @param {number} lat     WGS84 latitude
   * @param {number} lon     WGS84 longitude
   * @param {number} units   Dwelling units
   * @param {number} stories Above-grade stories (NFPA 101 egress penalty)
   * @returns {Object}       Evaluation result
   */
  function evaluateProject(lat, lon, units, stories) {
    _ensureReady();

    const hazardZone    = classifyFhsz(lat, lon);
    const servingPaths  = identifyServingPaths(lat, lon);
    const deltaResults  = computeDeltaT(servingPaths, units, stories, hazardZone);
    const tier          = _determineTier(units, deltaResults);

    // Sort by bottleneck osmid for stable ordering (matches test vectors)
    deltaResults.sort((a, b) => a.bottleneckOsmid.localeCompare(b.bottleneckOsmid));

    const maxDeltaT = deltaResults.length > 0
      ? Math.max(...deltaResults.map(d => d.delta_t_minutes))
      : 0;

    return {
      tier,
      hazard_zone:          hazardZone,
      project_vehicles:     deltaResults[0]?.project_vehicles ?? 0,
      serving_paths_count:  deltaResults.length,
      paths:                deltaResults,
      max_delta_t_minutes:  maxDeltaT,
      built_at:             _graph?.built_at ?? "unknown",
      parameters_version:   _params?.parameters_version ?? "unknown",
    };
  }

  // ── Module exports ────────────────────────────────────────────────────────────
  return {
    init,
    evaluateProject,
    // Expose internals for testing
    _internal: {
      classifyFhsz,
      nearestNode,
      reachableNodes,
      identifyServingPaths,
      computeDeltaT,
      haversineMeters,
    },
  };
})();

// CommonJS export for Node.js test runner
if (typeof module !== "undefined" && module.exports) {
  module.exports = { WhatIfEngine };
}

// ────────────────────────────────────────────────────────────────────────────

// ── What-If UI panel injector ────────────────────────────────────────────────

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var _tmp = document.createElement('div');
    _tmp.innerHTML = `
<div id="josh-whatif-panel" style="
    position: fixed;
    bottom: 32px;
    right: 16px;
    width: 300px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.22);
    z-index: 10000;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    overflow: hidden;
    display: none;
">
  <div style="background:#1c4a6e;color:#fff;padding:10px 14px;display:flex;align-items:center;gap:8px;cursor:move;" id="josh-whatif-drag-handle">
    <span style="font-size:15px;">&#9654;</span>
    <span style="font-weight:600;font-size:13px;letter-spacing:0.02em;">What-If Analysis</span>
    <span style="margin-left:auto;cursor:pointer;font-size:16px;opacity:0.7;" onclick="joshWhatIf.closePanel();" title="Close">&#10005;</span>
  </div>
  <div style="padding:12px 14px;">
    <div id="josh-whatif-instructions" style="color:#555;font-size:12px;margin-bottom:10px;line-height:1.5;">
      Set units &amp; stories, then drop a pin.
    </div>
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <label style="flex:1;">
        <div style="font-size:11px;color:#777;margin-bottom:3px;">Units</div>
        <input id="josh-wi-units" type="number" min="1" max="999" value="50" style="width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;padding:5px 7px;font-size:13px;">
      </label>
      <label style="flex:1;">
        <div style="font-size:11px;color:#777;margin-bottom:3px;">Stories</div>
        <input id="josh-wi-stories" type="number" min="0" max="60" value="4" style="width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:4px;padding:5px 7px;font-size:13px;">
      </label>
    </div>
    <div id="josh-whatif-result" style="display:none;margin-top:10px;border-top:1px solid #eee;padding-top:10px;"></div>
    <div style="margin-top:10px;display:flex;gap:6px;">
      <button id="josh-wi-btn-pin" onclick="joshWhatIf.startDropPin()" style="
          flex:1;background:#1c4a6e;color:#fff;border:none;border-radius:5px;
          padding:7px 0;font-size:12px;cursor:pointer;font-weight:600;">
        &#x2316; Drop Pin
      </button>
      <button id="josh-wi-btn-clear" onclick="joshWhatIf.clearWhatIf()" style="
          flex:0 0 auto;background:#f5f5f5;color:#555;border:1px solid #ccc;
          border-radius:5px;padding:7px 10px;font-size:12px;cursor:pointer;
          display:none;">
        &#x2715; Clear
      </button>
    </div>
    <div style="margin-top:10px;color:#999;font-size:10px;line-height:1.4;border-top:1px solid #f0f0f0;padding-top:8px;" id="josh-wi-disclaimer">
      What-if estimates only &mdash; not a legal determination.<br>
      Run <code>main.py evaluate</code> for a binding audit trail.
    </div>
  </div>
</div>

<style>
.josh-wi-tooltip {
  font-family: system-ui, sans-serif;
  font-size: 11px;
  padding: 4px 8px;
  background: rgba(28,74,110,0.92);
  color: #fff;
  border: none;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  white-space: nowrap;
}
.josh-wi-tooltip::before { display: none; }
</style>

<button id="josh-whatif-open-btn" onclick="joshWhatIf.openPanel()" style="
    position: fixed;
    bottom: 32px;
    right: 16px;
    z-index: 10000;
    background: #1c4a6e;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 9px 15px;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 3px 12px rgba(0,0,0,0.25);
    letter-spacing: 0.01em;
">&#43; What-If Project</button>
`;
    while (_tmp.firstChild) document.body.appendChild(_tmp.firstChild);
  });
})();

// ────────────────────────────────────────────────────────────────────────────

// ── What-If UI controller ────────────────────────────────────────────────────


(function () {
  const TIER_COLOR = {
    'MINISTERIAL':                         '#27ae60',
    'MINISTERIAL WITH STANDARD CONDITIONS': '#e67e22',
    'DISCRETIONARY':                        '#e74c3c',
  };
  const TIER_LABEL = {
    'MINISTERIAL':                         'Ministerial',
    'MINISTERIAL WITH STANDARD CONDITIONS': 'Ministerial w/ Conditions',
    'DISCRETIONARY':                        'Discretionary',
  };
  const ZONE_LABEL = {
    'vhfhsz':        'Very High FHSZ',
    'high_fhsz':     'High FHSZ',
    'moderate_fhsz': 'Moderate FHSZ',
    'non_fhsz':      'Non-FHSZ',
  };

  // ── Module state ────────────────────────────────────────────────────────────
  let _dropPinActive = false;
  let _markers       = [];        // all map layers owned by the what-if UI
  let _wiMarker      = null;      // the draggable L.marker (kept separate for setIcon/drag)
  let _mapObj        = null;
  let _origCursor    = '';
  let _lat           = null;      // last placed pin latitude  (null = no pin)
  let _lng           = null;      // last placed pin longitude
  let _debounce      = null;      // setTimeout handle for input debounce

  // ── Map discovery ───────────────────────────────────────────────────────────
  function _getMap() {
    if (_mapObj) return _mapObj;
    for (const k in window) {
      if (window[k] && window[k]._leaflet_id && window[k].getCenter) {
        _mapObj = window[k]; return _mapObj;
      }
    }
    const el = document.querySelector('.folium-map');
    if (el && el._leaflet_id) { _mapObj = window['map_' + el._leaflet_id] || null; }
    return _mapObj;
  }

  // ── DivIcon factory — dashed circle with "?" label, colour-coded by tier ─────
  // Uses L.divIcon instead of L.circleMarker so the marker is draggable.
  // 28px gives a comfortable drag target and stands out on a busy street map.
  // The "?" reinforces the exploratory / what-if nature of the pin.
  function _wiIcon(color) {
    return L.divIcon({
      className: '',   // suppress Leaflet's default white square
      html: `<div style="
        width: 28px; height: 28px;
        border: 2.5px dashed ${color};
        border-radius: 50%;
        background: ${color};
        opacity: 0.75;
        box-sizing: border-box;
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, sans-serif;
        font-size: 14px; font-weight: 700;
        color: #fff;
        text-shadow: 0 1px 2px rgba(0,0,0,0.4);
        cursor: grab;
      ">?</div>`,
      iconSize:   [28, 28],
      iconAnchor: [14, 14],   // centred on the click/drag point
    });
  }

  // ── Panel open ──────────────────────────────────────────────────────────────
  function openPanel() {
    document.getElementById('josh-whatif-open-btn').style.display = 'none';
    document.getElementById('josh-whatif-panel').style.display    = 'block';
  }

  // ── State transitions ───────────────────────────────────────────────────────

  /** Enter AWAITING state: crosshair cursor, one-time click listener. */
  function startDropPin() {
    const map = _getMap();
    if (!map) { alert('Map not ready \u2014 please wait a moment and try again.'); return; }
    _dropPinActive = true;
    _origCursor = map.getContainer().style.cursor;
    map.getContainer().style.cursor = 'crosshair';
    document.getElementById('josh-whatif-instructions').textContent =
      'Click the map to place a pin\u2026';
    const btn = document.getElementById('josh-wi-btn-pin');
    btn.textContent = '\u2716 Cancel';
    btn.onclick = cancelDropPin;
    map.once('click', _onMapClick);
  }

  /** Cancel AWAITING state without placing a pin. */
  function cancelDropPin() {
    const map = _getMap();
    if (map) {
      map.getContainer().style.cursor = _origCursor;
      map.off('click', _onMapClick);
    }
    _dropPinActive = false;
    _restoreIdleOrPinnedButton();
    document.getElementById('josh-whatif-instructions').textContent =
      _lat !== null
        ? 'Drag pin or adjust inputs to update.'
        : 'Set units & stories, then drop a pin.';
  }

  /**
   * Restore the Drop Pin button to the correct label for the current state:
   *   - PIN PLACED → "Drop New Pin" (re-enter AWAITING to relocate)
   *   - IDLE       → "Drop Pin"
   */
  function _restoreIdleOrPinnedButton() {
    const btn = document.getElementById('josh-wi-btn-pin');
    if (_lat !== null) {
      btn.textContent = '\u2316 Drop New Pin';
    } else {
      btn.textContent = '\u2316 Drop Pin';
    }
    btn.onclick = startDropPin;
  }

  // ── Map click handler (AWAITING → PIN PLACED) ───────────────────────────────
  function _onMapClick(e) {
    _dropPinActive = false;
    const map = _getMap();
    if (map) map.getContainer().style.cursor = _origCursor;
    _placePin(e.latlng.lat, e.latlng.lng);
  }

  /** Hide the currently-selected demo project's FeatureGroup layer.
   *  Called when a what-if pin is placed so the project's roads/markers
   *  don't overlap the what-if route visualisation. */
  function _hideSelectedProjectLayer() {
    var layers = window._joshProjLayers;
    var mapObj = window[window._joshMapName];
    var dd     = document.getElementById('proj-dropdown');
    if (!layers || !mapObj || !dd) return;
    var varName = layers[dd.selectedIndex];
    var layer   = varName && window[varName];
    if (layer && mapObj.hasLayer(layer)) mapObj.removeLayer(layer);
  }

  /** Place (or replace) the draggable marker and evaluate. */
  function _placePin(lat, lng) {
    // Remove existing pin + routes; keep nothing from prior evaluation
    _clearAll();
    _hideSelectedProjectLayer();
    const map = _getMap();
    _lat = lat;
    _lng = lng;

    if (map) {
      _wiMarker = L.marker([lat, lng], {
        icon: _wiIcon('#e67e22'),   // neutral orange while evaluating
        draggable: true,
        zIndexOffset: 500,
      }).addTo(map);
      _wiMarker.on('dragstart', _onDragStart);
      _wiMarker.on('dragend',   _onDragEnd);
      _markers.push(_wiMarker);
    }

    _evaluateAt(lat, lng);
  }

  // ── Drag handlers ───────────────────────────────────────────────────────────

  function _onDragStart() {
    // Dim result and clear old routes while the pin is moving
    const el = document.getElementById('josh-whatif-result');
    if (el) el.style.opacity = '0.3';
    document.getElementById('josh-whatif-instructions').textContent = 'Moving pin\u2026';
    _clearRoutes();
  }

  function _onDragEnd(e) {
    _lat = e.target.getLatLng().lat;
    _lng = e.target.getLatLng().lng;
    _evaluateAt(_lat, _lng);
  }

  // ── Route line color ramp ───────────────────────────────────────────────────
  // Mirrors the AntPath ramp used for official project routes:
  //   < 40% threshold  → green  (ample capacity)
  //   40–75%           → yellow (moderate load)
  //   75–100%          → orange (approaching threshold)
  //   > 100% (flagged) → red    (exceeds threshold)
  function _routeColor(delta_t, threshold) {
    const ratio = threshold > 0 ? delta_t / threshold : 1;
    if (ratio > 1.0)  return '#e74c3c';   // red    — flagged
    if (ratio > 0.75) return '#e67e22';   // orange — approaching
    if (ratio > 0.40) return '#f1c40f';   // yellow — moderate
    return '#27ae60';                      // green  — ample
  }

  // ── Core evaluation ─────────────────────────────────────────────────────────

  /**
   * Run WhatIfEngine.evaluateProject() for the current inputs at (lat, lng),
   * redraw route polylines, update the pin icon colour, and render the result.
   * Called from: initial pin placement, drag end, debounced input change.
   */
  function _evaluateAt(lat, lng) {
    const units   = parseInt(document.getElementById('josh-wi-units').value,   10) || 1;
    const stories = parseInt(document.getElementById('josh-wi-stories').value, 10) || 0;

    let result;
    try {
      result = WhatIfEngine.evaluateProject(lat, lng, units, stories);
    } catch (err) {
      document.getElementById('josh-whatif-instructions').textContent =
        'Error: ' + err.message;
      const el = document.getElementById('josh-whatif-result');
      if (el) el.style.opacity = '1';
      return;
    }

    const map       = _getMap();
    const tierColor = TIER_COLOR[result.tier] || '#888';

    // Update pin icon to tier colour
    if (_wiMarker) _wiMarker.setIcon(_wiIcon(tierColor));

    // Clear stale routes (pin is kept via _wiMarker exclusion in _clearRoutes)
    _clearRoutes();

    if (map) {
      for (const path of result.paths) {
        if (!path.path_coords || path.path_coords.length < 2) continue;
        const lineColor = _routeColor(path.delta_t_minutes, path.threshold_minutes);

        // Full route — thin dashed line
        const routeLine = L.polyline(path.path_coords, {
          color:     lineColor,
          weight:    3,
          opacity:   0.75,
          dashArray: path.flagged ? null : '6,4',
        });
        routeLine.bindTooltip(
          `Evacuation route \u00b7 \u0394T ${path.delta_t_minutes.toFixed(2)} min ` +
          `(threshold ${path.threshold_minutes.toFixed(2)} min)` +
          (path.flagged ? ' \u26a0 EXCEEDS THRESHOLD' : ''),
          { sticky: true, className: 'josh-wi-tooltip' }
        );
        routeLine.addTo(map);
        _markers.push(routeLine);

        // Bottleneck segment — thick highlight
        if (path.bottleneck_coords && path.bottleneck_coords.length === 2) {
          const bnLine = L.polyline(path.bottleneck_coords, {
            color: lineColor, weight: 8, opacity: 0.9,
          });
          bnLine.bindTooltip(
            `Bottleneck \u00b7 ${path.bottleneckOsmid} \u00b7 ${path.bottleneckEffCapVph.toFixed(0)} vph`,
            { sticky: true, className: 'josh-wi-tooltip' }
          );
          bnLine.addTo(map);
          _markers.push(bnLine);
        }
      }
    }

    // Restore result opacity (may have been dimmed during drag)
    const resultEl = document.getElementById('josh-whatif-result');
    if (resultEl) resultEl.style.opacity = '1';

    _renderResult(result);
    _restoreIdleOrPinnedButton();
    // Show the Clear button now that a pin is placed
    document.getElementById('josh-wi-btn-clear').style.display = '';
    document.getElementById('josh-whatif-instructions').textContent =
      'Drag pin or adjust inputs to update.';

  }

  // ── Result renderer ─────────────────────────────────────────────────────────
  function _renderResult(result) {
    const color      = TIER_COLOR[result.tier] || '#888';
    const tierLabel  = TIER_LABEL[result.tier] || result.tier;
    const zoneLabel  = ZONE_LABEL[result.hazard_zone] || result.hazard_zone;
    const maxDT      = result.max_delta_t_minutes;
    const threshold  = result.paths.length > 0 ? result.paths[0].threshold_minutes : null;
    const flaggedCnt = result.paths.filter(p => p.flagged).length;

    let pathRows = '';
    for (const p of result.paths) {
      const dtColor = p.flagged ? '#e74c3c' : '#27ae60';
      pathRows += `<tr>
        <td style="padding:2px 6px;font-size:11px;color:#555;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.bottleneckOsmid}">${p.bottleneckOsmid}</td>
        <td style="padding:2px 6px;font-size:11px;text-align:right;color:${dtColor};font-weight:${p.flagged?'700':'400'};">${p.delta_t_minutes.toFixed(2)}</td>
        <td style="padding:2px 6px;font-size:11px;text-align:right;color:#999;">${p.threshold_minutes.toFixed(2)}</td>
      </tr>`;
    }

    const builtAt    = result.built_at ? result.built_at.slice(0, 10) : '?';
    const threshDisp = threshold !== null ? threshold.toFixed(2) : '\u2014';

    const el = document.getElementById('josh-whatif-result');
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};border:2px dashed ${color};opacity:0.9;flex-shrink:0;"></span>
        <span style="font-weight:700;font-size:13px;color:${color};">${tierLabel}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:11px;color:#555;margin-bottom:8px;">
        <div>Zone: <b>${zoneLabel}</b></div>
        <div>Vehicles: <b>${result.project_vehicles.toFixed(0)} vph</b></div>
        <div>Max &Delta;T: <b style="color:${threshold !== null && maxDT > threshold ? '#e74c3c' : '#333'};">${maxDT.toFixed(2)} min</b></div>
        <div>Threshold: <b>${threshDisp} min</b></div>
        <div>Paths: <b>${result.serving_paths_count}</b></div>
        <div>Flagged: <b style="color:${flaggedCnt > 0 ? '#e74c3c' : '#27ae60'};">${flaggedCnt}</b></div>
      </div>
      ${pathRows ? `
      <div style="font-size:10px;color:#aaa;margin-bottom:2px;">Bottleneck &nbsp; &Delta;T &nbsp; Limit (min)</div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${pathRows}</tbody>
      </table>` : '<div style="font-size:11px;color:#aaa;">No serving paths found.</div>'}
      <div style="margin-top:8px;font-size:10px;color:#bbb;">
        Data: OSM ${builtAt} &middot; v${result.parameters_version}
      </div>
    `;
  }

  // ── Clear helpers ───────────────────────────────────────────────────────────

  /** Remove only route polylines; keep _wiMarker (used during drag + input re-eval). */
  function _clearRoutes() {
    const map = _getMap();
    _markers = _markers.filter(m => {
      if (m === _wiMarker) return true;   // keep the pin
      try { map && map.removeLayer(m); } catch (_) {}
      return false;
    });
  }

  /** Remove everything — pin, routes, and all state. Returns to IDLE. */
  function _clearAll() {
    const map = _getMap();
    for (const m of _markers) { try { map && map.removeLayer(m); } catch (_) {} }
    _markers  = [];
    _wiMarker = null;
  }

  /** Public clear: full reset to IDLE state. */
  function clearWhatIf() {
    clearTimeout(_debounce);
    _clearAll();
    _lat = null;
    _lng = null;
    const resultEl = document.getElementById('josh-whatif-result');
    resultEl.style.display  = 'none';
    resultEl.style.opacity  = '1';
    resultEl.innerHTML      = '';
    document.getElementById('josh-wi-btn-clear').style.display = 'none';
    document.getElementById('josh-whatif-instructions').textContent =
      'Set units & stories, then drop a pin.';
    _restoreIdleOrPinnedButton();
    // Restore the selected project layer that was hidden when the pin was placed.
    var _projDd = document.getElementById('proj-dropdown');
    if (_projDd && typeof window.selectProject === 'function') {
      window.selectProject(_projDd.selectedIndex);
    }
  }

  // ── Input auto-re-evaluate ──────────────────────────────────────────────────
  // Attach listeners once the DOM is ready.  Only fires when a pin is placed.
  document.addEventListener('DOMContentLoaded', () => {
    ['josh-wi-units', 'josh-wi-stories'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        if (_lat === null) return;          // no pin yet — do nothing
        clearTimeout(_debounce);
        document.getElementById('josh-whatif-instructions').textContent = 'Updating\u2026';
        _debounce = setTimeout(() => _evaluateAt(_lat, _lng), 300);
      });
    });
  });

  /** Close the panel and restore the open button. Cancels any active drop-pin mode. */
  function closePanel() {
    cancelDropPin();
    document.getElementById('josh-whatif-panel').style.display    = 'none';
    document.getElementById('josh-whatif-open-btn').style.display = '';
  }

  window.joshWhatIf = { openPanel, closePanel, startDropPin, cancelDropPin, clearWhatIf };
})();

// ────────────────────────────────────────────────────────────────────────────

// ── Brief modal overlay injector ─────────────────────────────────────────────

(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var _tmp = document.createElement('div');
    _tmp.innerHTML = `<div id="josh-brief-modal" style="
    display:none; position:fixed; inset:0; z-index:30000;
    background:rgba(0,0,0,0.55); overflow:hidden;">
  <div style="
      position:absolute; inset:40px 60px;
      background:#fff; border-radius:8px;
      display:flex; flex-direction:column;
      box-shadow:0 8px 40px rgba(0,0,0,0.4);
      overflow:hidden;">
    <div style="
        display:flex; align-items:center; justify-content:space-between;
        padding:11px 16px; border-bottom:1px solid #dee2e6;
        background:#1c4a6e; flex-shrink:0;">
      <span style="
          font-family:system-ui,sans-serif; font-weight:600;
          font-size:13px; color:#fff; letter-spacing:0.02em;">
        Determination Brief
      </span>
      <button onclick="document.getElementById('josh-brief-modal').style.display='none'"
              style="background:none;border:none;font-size:20px;cursor:pointer;
                     color:rgba(255,255,255,0.75);line-height:1;padding:0;">&#10005;</button>
    </div>
    <iframe id="josh-brief-frame"
            style="flex:1;border:none;width:100%;background:#fff;"
            src="about:blank"></iframe>
  </div>
</div>`;
    document.body.appendChild(_tmp.firstElementChild);
  });
})();

// ────────────────────────────────────────────────────────────────────────────

// ── Brief modal controller ───────────────────────────────────────────────────

(function () {
  window.joshBrief = {
    show: function (filename) {
      var briefs = window.JOSH_DATA && window.JOSH_DATA.briefs;
      var html = briefs && briefs[filename];
      if (!html) { console.warn('joshBrief: no data for', filename); return; }
      var frame = document.getElementById('josh-brief-frame');
      frame.srcdoc = html;
      document.getElementById('josh-brief-modal').style.display = 'block';
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a[href^="brief_v3_"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        window.joshBrief.show(link.getAttribute('href'));
      });
    });
    var modal = document.getElementById('josh-brief-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
      });
    }
  });
})();
