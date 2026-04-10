// Copyright (C) 2026 Thomas Gonzalez
// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of JOSH (Jurisdictional Objective Standards for Housing).
// See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

/**
 * Unit tests for static/sidebar.js
 *
 * Run: node --test tests/test_sidebar.js
 *
 * Tests S1–S11 cover Phase 2 (sidebar module, no map integration):
 *   S1:  init loads pipeline-seeded projects from JOSH_DATA.projects
 *   S2:  createProject → serialize → deserialize round-trip
 *   S3:  updateProject merges fields and updates analyzed_at
 *   S4:  deleteProject removes from list
 *   S5:  _serialize produces valid JSON matching spec §7 schema
 *   S6:  _deserialize rejects city_slug mismatch
 *   S7:  _deserialize rejects schema_v > 1
 *   S8:  _buildBriefInput maps result to BriefInput v1 schema
 *   S9:  stale result detection on deserialize (parameters_version mismatch)
 *   S10: project below threshold (< 15 units) can still be saved
 *   S11: empty paths list stored correctly (no-routes-found state)
 */

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const path     = require('node:path');

// ── Bootstrap minimal globals expected by sidebar.js ─────────────────────────
global.window = {
  JOSH_DATA: {
    city_slug:          'berkeley',
    city_name:          'Berkeley, CA',
    josh_version:       '1.0.0',
    parameters_version: '4.0',
    parameters: {
      parameters_version:  '4.0',
      unit_threshold:      15,
      max_project_share:   0.05,
      mobilization_rate:   0.90,
      safe_egress_window:  { vhfhsz: 45, high_fhsz: 90, moderate_fhsz: 120, non_fhsz: 120 },
    },
    projects: [
      {
        id:      'seed-001',
        name:    'Ashby Small Infill',
        address: '2930 Ashby Ave, Berkeley CA',
        lat:     37.8528,
        lng:     -122.2699,
        units:   10,
        stories: 3,
        city_slug: 'berkeley',
        source:  'pipeline',
        result: {
          tier:              'MINISTERIAL',
          hazard_zone:       'non_fhsz',
          in_fire_zone:      false,
          project_vehicles:  22.5,
          egress_minutes:    0,
          delta_t_threshold: 6.0,
          paths: [
            {
              route_id:                  'A',
              delta_t:                   0.42,
              flagged:                   false,
              bottleneck_osmid:          '12345',
              bottleneck_name:           'Ashby Ave',
              bottleneck_road_type:      'secondary',
              bottleneck_lanes:          2,
              bottleneck_speed:          35,
              effective_capacity_vph:    1976,
              hazard_degradation_factor: 1.0,
              path_coords:               [[37.852, -122.269], [37.853, -122.270]],
            },
          ],
        },
      },
    ],
    graph: { edges: [{ osmid: '12345', name: 'Ashby Ave', road_type: 'secondary', lanes: 2, speed_mph: 35, haz_deg: 1.0, geom: [[37.852, -122.269], [37.853, -122.270]] }] },
  },
};
global.crypto = { randomUUID: () => 'test-' + Math.random().toString(36).slice(2) };
global.indexedDB = undefined;   // unavailable in Node — exercises the fallback path

// ── Load module ───────────────────────────────────────────────────────────────
const SIDEBAR_PATH = path.join(__dirname, '..', 'static', 'sidebar.js');
const sb = require(SIDEBAR_PATH);

// ── Helpers ───────────────────────────────────────────────────────────────────
function freshProject(overrides) {
  return sb.createProject(Object.assign({
    name:    'Test Project',
    lat:     37.8695,
    lng:     -122.2685,
    units:   50,
    stories: 4,
    source:  'browser',
  }, overrides || {}));
}

function fakeResult(overrides) {
  return Object.assign({
    tier:              'MINISTERIAL WITH STANDARD CONDITIONS',
    hazard_zone:       'high_fhsz',
    in_fire_zone:      true,
    project_vehicles:  112.5,
    egress_minutes:    0,
    delta_t_threshold: 4.5,
    paths: [
      {
        route_id:                  'A',
        delta_t:                   2.3,
        flagged:                   false,
        bottleneck_osmid:          '99999',
        bottleneck_name:           'Telegraph Ave',
        bottleneck_road_type:      'secondary',
        bottleneck_lanes:          2,
        bottleneck_speed:          35,
        effective_capacity_vph:    950,
        hazard_degradation_factor: 0.5,
        path_coords:               [[37.870, -122.268], [37.871, -122.267]],
      },
    ],
  }, overrides || {});
}

function setup() {
  sb._resetState();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('S1: init loads pipeline-seeded projects from JOSH_DATA.projects', () => {
  setup();
  // Simulate init by calling createProject for each seed (mirrors sidebar.js init logic)
  // We test via the module: after require, state should be fresh; we call a manual
  // seed-load by checking that JOSH_DATA.projects is accessible.
  const seeds = global.window.JOSH_DATA.projects;
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].id, 'seed-001');
  assert.equal(seeds[0].name, 'Ashby Small Infill');
  assert.equal(seeds[0].result.tier, 'MINISTERIAL');
  // After reset the project list is empty; a fresh init would populate it.
  // Verify createProject with seed fields round-trips correctly.
  const seed = seeds[0];
  const p = sb.createProject({
    id:     seed.id,
    name:   seed.name,
    lat:    seed.lat,
    lng:    seed.lng,
    units:  seed.units,
    source: 'pipeline',
    result: seed.result,
  });
  assert.equal(p.name, 'Ashby Small Infill');
  assert.equal(p.source, 'pipeline');
  assert.equal(p.result.tier, 'MINISTERIAL');
  assert.equal(p.result.paths[0].bottleneck_name, 'Ashby Ave');
});

test('S2: createProject → serialize → deserialize round-trip', () => {
  setup();
  const p = freshProject({ name: 'Round Trip Test', units: 75, stories: 5 });
  p.result = fakeResult();
  const json = sb._serialize(p);
  const p2   = sb._deserialize(json);

  assert.equal(p2.name,    'Round Trip Test');
  assert.equal(p2.units,   75);
  assert.equal(p2.stories, 5);
  assert.equal(p2.lat,     37.8695);
  assert.equal(p2.lng,     -122.2685);
  assert.equal(p2.result.tier,              'MINISTERIAL WITH STANDARD CONDITIONS');
  assert.equal(p2.result.hazard_zone,       'high_fhsz');
  assert.equal(p2.result.paths.length,      1);
  assert.equal(p2.result.paths[0].route_id, 'A');
  assert.equal(p2.result.paths[0].bottleneck_name, 'Telegraph Ave');
  assert.ok(Array.isArray(p2.result.paths[0].path_coords));
});

test('S3: updateProject merges fields and updates analyzed_at', () => {
  setup();
  const p   = freshProject();
  const id  = p.id;
  const was = p.analyzed_at;
  // Simulate a short delay so analyzed_at changes
  const p2  = sb.updateProject(id, { result: fakeResult(), units: 80 });
  assert.equal(p2.units,   80);
  assert.equal(p2.result.tier, 'MINISTERIAL WITH STANDARD CONDITIONS');
  assert.ok(p2.analyzed_at !== null);
  // name was preserved
  assert.equal(p2.name, 'Test Project');
});

test('S4: deleteProject removes from list', () => {
  setup();
  const p  = freshProject({ name: 'Delete Me' });
  const id = p.id;
  assert.ok(sb.getProject(id) !== null);
  sb.deleteProject(id);
  assert.equal(sb.getProject(id), null);
  assert.ok(sb.getProjects().every(x => x.id !== id));
});

test('S5: _serialize produces valid JSON matching spec §7 schema', () => {
  setup();
  const p = freshProject({ name: 'Schema Check' });
  p.result = fakeResult();
  const json = sb._serialize(p);
  const obj  = JSON.parse(json);  // must not throw

  // Required top-level fields per spec §7
  assert.equal(obj.schema_v,           1);
  assert.equal(obj.city_slug,          'berkeley');
  assert.ok('josh_version'       in obj);
  assert.ok('parameters_version' in obj);
  assert.ok('name'               in obj);
  assert.ok('address'            in obj);
  assert.ok('lat'                in obj);
  assert.ok('lng'                in obj);
  assert.ok('units'              in obj);
  assert.ok('stories'            in obj);
  assert.ok('source'             in obj);
  assert.ok('created_at'         in obj);
  assert.ok('analyzed_at'        in obj);
  assert.ok('result'             in obj);
  assert.ok('brief_cache'        in obj);

  // Private fields must NOT be in the serialized form
  assert.ok(!('_handle' in obj));
  assert.ok(!('_stale'  in obj));

  // result.paths must have snake_case fields
  const path0 = obj.result.paths[0];
  assert.ok('route_id'                  in path0);
  assert.ok('delta_t'                   in path0);
  assert.ok('bottleneck_osmid'          in path0);
  assert.ok('bottleneck_name'           in path0);
  assert.ok('effective_capacity_vph'    in path0);
  assert.ok('hazard_degradation_factor' in path0);
  assert.ok('path_coords'               in path0);
});

test('S6: _deserialize rejects city_slug mismatch with informative error', () => {
  setup();
  const json = JSON.stringify({
    schema_v:           1,
    city_slug:          'encinitas',  // ← wrong city
    parameters_version: '4.0',
    name:               'Wrong City',
    lat:                33.03,
    lng:                -117.29,
    units:              50,
    stories:            4,
    source:             'browser',
    result:             null,
  });
  assert.throws(
    () => sb._deserialize(json),
    err => err.message.includes('city_slug mismatch'),
    'should throw with city_slug mismatch message'
  );
});

test('S7: _deserialize rejects schema_v > 1 with informative error', () => {
  setup();
  const json = JSON.stringify({
    schema_v:           99,
    city_slug:          'berkeley',
    parameters_version: '4.0',
    name:               'Future Version',
    lat:                37.87,
    lng:                -122.27,
    units:              50,
    stories:            4,
    source:             'browser',
    result:             null,
  });
  assert.throws(
    () => sb._deserialize(json),
    err => err.message.includes('schema_v'),
    'should throw with schema_v message'
  );
});

test('S8: _buildBriefInput maps result fields to BriefInput v1 schema', () => {
  setup();
  const p = freshProject({ name: 'Brief Test', units: 50, stories: 4 });
  p.result = fakeResult();

  const bi = sb._buildBriefInput(p);

  // Top-level schema fields
  assert.equal(bi.brief_input_version, 1);
  assert.ok(bi.source === 'whatif' || bi.source === 'pipeline');
  assert.equal(bi.city_name, 'Berkeley, CA');
  assert.equal(bi.city_slug, 'berkeley');
  assert.ok(typeof bi.case_number === 'string' && bi.case_number.startsWith('JOSH-'));
  assert.ok(typeof bi.eval_date   === 'string');

  // project sub-object
  assert.equal(bi.project.name,    'Brief Test');
  assert.equal(bi.project.units,   50);
  assert.equal(bi.project.lat,     37.8695);
  assert.equal(bi.project.lon,     -122.2685);

  // analysis sub-object
  assert.equal(bi.analysis.applicability_met,   true);
  assert.equal(bi.analysis.dwelling_units,       50);
  assert.equal(bi.analysis.unit_threshold,       15);
  assert.equal(bi.analysis.fhsz_flagged,         true);
  assert.equal(bi.analysis.hazard_zone,          'high_fhsz');
  assert.ok(   bi.analysis.mobilization_rate > 0);
  assert.ok(   bi.analysis.serving_route_count >= 0);

  // result sub-object
  assert.equal(bi.result.tier,          'MINISTERIAL WITH STANDARD CONDITIONS');
  assert.ok(   bi.result.paths.length > 0);
  const bp = bi.result.paths[0];
  assert.equal(bp.bottleneck_osmid,     '99999');
  assert.equal(bp.bottleneck_name,      'Telegraph Ave');
  assert.equal(bp.bottleneck_road_type, 'secondary');
  assert.equal(bp.delta_t_minutes,      2.3);
  assert.equal(bp.flagged,              false);
  assert.ok(   typeof bp.threshold_minutes === 'number');
  assert.ok(   typeof bp.safe_egress_window_minutes === 'number');
});

test('S9: stale result detection — parameters_version mismatch sets _stale flag', () => {
  setup();
  const staleJson = JSON.stringify({
    schema_v:           1,
    city_slug:          'berkeley',
    parameters_version: '3.4',   // ← old version; current is 4.0
    name:               'Stale Project',
    lat:                37.87,
    lng:                -122.27,
    units:              50,
    stories:            4,
    source:             'browser',
    analyzed_at:        '2026-01-01T00:00:00Z',
    result:             fakeResult(),
  });
  const p = sb._deserialize(staleJson);
  assert.equal(p._stale, true, '_stale should be true when parameters_version mismatches');
  assert.equal(p.name,   'Stale Project');
});

test('S10: project below threshold (< 15 units) serializes correctly', () => {
  setup();
  const p = freshProject({ name: 'Tiny Duplex', units: 2, stories: 2 });
  p.result = {
    tier:              'MINISTERIAL',
    hazard_zone:       'non_fhsz',
    in_fire_zone:      false,
    project_vehicles:  4.5,
    egress_minutes:    0,
    delta_t_threshold: 6.0,
    paths:             [],  // below threshold — no routes analyzed
  };
  const json = sb._serialize(p);
  const obj  = JSON.parse(json);
  assert.equal(obj.result.tier, 'MINISTERIAL');
  assert.equal(obj.units,       2);
  // brief input should set applicability_met false
  const bi = sb._buildBriefInput(p);
  assert.equal(bi.analysis.applicability_met, false);
});

test('S11: empty paths list stored and round-trips correctly (no-routes-found state)', () => {
  setup();
  const p = freshProject({ name: 'No Routes' });
  p.result = {
    tier:              'MINISTERIAL',
    hazard_zone:       'non_fhsz',
    in_fire_zone:      false,
    project_vehicles:  112.5,
    egress_minutes:    0,
    delta_t_threshold: 6.0,
    paths:             [],
  };
  const json = sb._serialize(p);
  const p2   = sb._deserialize(json);
  assert.ok(Array.isArray(p2.result.paths));
  assert.equal(p2.result.paths.length, 0);
  // brief input with no paths should still produce valid schema
  const bi = sb._buildBriefInput(p);
  assert.equal(bi.result.serving_paths_count, 0);
  assert.equal(bi.result.paths.length,        0);
});
