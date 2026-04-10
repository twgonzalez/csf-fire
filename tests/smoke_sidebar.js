// Copyright (C) 2026 Thomas Gonzalez
// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of JOSH (Jurisdictional Objective Standards for Housing).
// See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

/**
 * Smoke tests for the JOSH demo map (Berkeley) — Playwright + node:test.
 *
 * Opens output/berkeley/demo_map.html as file:// in headless Chromium and
 * exercises the full client-side stack end-to-end:
 *
 *   SMOKE_1:  sidebar div renders with JOSH header + city name
 *   SMOKE_2:  JOSH_DATA has all expected top-level keys
 *   SMOKE_3:  JOSH_DATA.city_slug === 'berkeley'
 *   SMOKE_4:  graph has ≥100 nodes and ≥100 edges
 *   SMOKE_5:  pipeline projects have analysis results
 *   SMOKE_6:  WhatIfEngine.evaluateProject is callable and returns a tier
 *   SMOKE_7:  BriefRenderer.render is callable and returns HTML
 *   SMOKE_8:  Leaflet.AntPath CDN plugin loaded — L.antPath is a function
 *             (skips gracefully when offline or CDN is unreachable)
 *   SMOKE_9:  pipeline project names appear in sidebar DOM as clickable rows
 *   SMOKE_10: selecting a project shows the detail card with a tier badge
 *   SMOKE_11: detail card has a "View Report" button for an analyzed project
 *   SMOKE_12: clicking "+ New" shows the New Project form
 *   SMOKE_13: clicking Cancel dismisses the form and restores the project list
 *
 * Prerequisites:
 *   npm install                          (installs playwright)
 *   npx playwright install chromium      (downloads headless Chrome)
 *   uv run python build.py demo --city Berkeley --data-dir <path>
 *     → output/berkeley/demo_map.html must exist
 *
 * Run:
 *   node --test tests/smoke_sidebar.js
 *   npm run smoke
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert   = require('node:assert/strict');
const { chromium } = require('playwright');
const path     = require('path');
const fs       = require('fs');

// ── Target file ───────────────────────────────────────────────────────────────
const DEMO_MAP = path.resolve(__dirname, '..', 'output', 'berkeley', 'demo_map.html');
const FILE_URL = 'file://' + DEMO_MAP;

// ── Shared browser + page (launched once, closed after all tests) ─────────────
let browser, page;

// ── Test suite ────────────────────────────────────────────────────────────────
describe('Smoke: Berkeley demo map', { timeout: 90_000 }, () => {

  // ── Setup / teardown ─────────────────────────────────────────────────────────
  before(async () => {
    if (!fs.existsSync(DEMO_MAP)) {
      throw new Error(
        '\nDemo map not found: ' + DEMO_MAP +
        '\nRun: uv run python build.py demo --city Berkeley --data-dir <path>\n'
      );
    }
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ permissions: [] });
    page = await ctx.newPage();

    // Surface page-level JS errors to stderr for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        process.stderr.write('[page:error] ' + msg.text() + '\n');
      }
    });

    await page.goto(FILE_URL, { waitUntil: 'domcontentloaded' });

    // Wait for sidebar to be rendered — joshSidebar.init() fires on DOMContentLoaded
    // and synchronously populates the sidebar from JOSH_DATA.projects.
    await page.waitForSelector('#josh-sidebar', { state: 'visible', timeout: 15_000 });
  });

  after(async () => {
    await browser?.close();
  });

  // ── SMOKE_1: basic page structure ─────────────────────────────────────────
  test('SMOKE_1: sidebar renders with JOSH header and city name', async () => {
    const text = await page.locator('#josh-sidebar').innerText();
    assert.ok(text.includes('JOSH'),     'header must contain "JOSH"');
    assert.ok(text.includes('Berkeley'), 'header must contain city name "Berkeley"');
  });

  // ── SMOKE_2: JOSH_DATA top-level keys ────────────────────────────────────
  test('SMOKE_2: JOSH_DATA has all expected top-level keys', async () => {
    const keys = await page.evaluate(() => Object.keys(window.JOSH_DATA || {}));
    for (const k of ['city_slug', 'city_name', 'graph', 'parameters', 'projects']) {
      assert.ok(keys.includes(k), `JOSH_DATA missing key: "${k}"`);
    }
  });

  // ── SMOKE_3: city identity ────────────────────────────────────────────────
  test('SMOKE_3: JOSH_DATA.city_slug is "berkeley"', async () => {
    const slug = await page.evaluate(() => window.JOSH_DATA.city_slug);
    assert.equal(slug, 'berkeley');
  });

  // ── SMOKE_4: graph completeness ───────────────────────────────────────────
  test('SMOKE_4: graph has ≥100 nodes and ≥100 edges', async () => {
    const { nodes, edges } = await page.evaluate(() => ({
      nodes: (window.JOSH_DATA.graph.nodes || []).length,
      edges: (window.JOSH_DATA.graph.edges || []).length,
    }));
    assert.ok(nodes >= 100, `expected ≥100 nodes, got ${nodes}`);
    assert.ok(edges >= 100, `expected ≥100 edges, got ${edges}`);
  });

  // ── SMOKE_5: pipeline projects have results ───────────────────────────────
  test('SMOKE_5: JOSH_DATA.projects has ≥1 project with an analysis result', async () => {
    const { total, withResult } = await page.evaluate(() => ({
      total:      (window.JOSH_DATA.projects || []).length,
      withResult: (window.JOSH_DATA.projects || []).filter(p => p.result).length,
    }));
    assert.ok(total      >= 1, `expected ≥1 pipeline project, got ${total}`);
    assert.ok(withResult >= 1, `expected ≥1 project with result, got ${withResult}`);
  });

  // ── SMOKE_6: WhatIfEngine ─────────────────────────────────────────────────
  test('SMOKE_6: WhatIfEngine.evaluateProject is callable and returns a tier', async () => {
    const tier = await page.evaluate(() => {
      if (typeof window.WhatIfEngine === 'undefined') return null;
      // Evaluate a minimal project near UC Berkeley campus
      const r = window.WhatIfEngine.evaluateProject(37.8695, -122.2685, 50, 4);
      return (r && r.tier) || null;
    });
    assert.ok(tier !== null, 'WhatIfEngine.evaluateProject must return a result');
    const valid = ['MINISTERIAL', 'MINISTERIAL WITH STANDARD CONDITIONS', 'DISCRETIONARY'];
    assert.ok(valid.includes(tier), `tier "${tier}" is not one of the valid tiers`);
  });

  // ── SMOKE_7: BriefRenderer ────────────────────────────────────────────────
  test('SMOKE_7: BriefRenderer.render is callable and returns HTML', async () => {
    const html = await page.evaluate(() => {
      if (typeof window.BriefRenderer === 'undefined') return null;
      try {
        return window.BriefRenderer.render({
          brief_input_version: 1,
          source:    'whatif',
          city_name: 'Berkeley',
          city_slug: 'berkeley',
          case_number: 'JOSH-TEST-001',
          eval_date:   '2026-01-01',
          audit_text:  '',
          audit_filename: '',
          project:  { name: 'Test', address: '', lat: 37.87, lon: -122.27, units: 50, stories: 4, apn: '' },
          analysis: {
            applicability_met: true, dwelling_units: 50, unit_threshold: 15,
            fhsz_flagged: false, fhsz_desc: 'Not in FHSZ', fhsz_level: 0,
            hazard_zone: 'non_fhsz', mobilization_rate: 0.90,
            hazard_degradation_factor: 1.00, serving_route_count: 2,
            route_radius_miles: 0.5, routes_trigger_analysis: true,
            delta_t_triggered: false, egress_minutes: 0,
          },
          result: {
            tier: 'MINISTERIAL', hazard_zone: 'non_fhsz', project_vehicles: 112.5,
            max_delta_t_minutes: 3.2, threshold_minutes: 6.0,
            safe_egress_window_minutes: 120, max_project_share: 0.05,
            serving_paths_count: 2, egress_minutes: 0,
            parameters_version: '4.0', analyzed_at: '2026-01-01',
            determination_reason: '', triggered: false, paths: [],
          },
          parameters: {},
        });
      } catch (e) { return 'ERROR: ' + e.message; }
    });
    assert.ok(html !== null,                   'BriefRenderer.render must return a value');
    assert.ok(!html.startsWith('ERROR:'),       'BriefRenderer.render must not throw: ' + html);
    assert.ok(html.includes('MINISTERIAL'),    'rendered HTML must contain tier text');
    assert.ok(html.includes('Berkeley'),       'rendered HTML must contain city name');
  });

  // ── SMOKE_8: Leaflet.AntPath CDN plugin ──────────────────────────────────
  test('SMOKE_8: L.antPath loaded from CDN', async (t) => {
    // Requires internet access to load the CDN script.
    // Skips gracefully when offline or CDN is unreachable.
    let loaded = false;
    try {
      await page.waitForFunction(
        () => typeof window.L !== 'undefined' &&
              typeof (window.L.antPath ||
                (window.L.polyline && window.L.polyline.antPath)) === 'function',
        { timeout: 8_000 }
      );
      loaded = true;
    } catch (_) {
      t.skip('Leaflet.AntPath CDN unreachable — skipping (offline or CDN down)');
      return;
    }
    assert.ok(loaded, 'L.antPath must be a function after CDN script loads');
  });

  // ── SMOKE_9: project rows in DOM ──────────────────────────────────────────
  test('SMOKE_9: pipeline project names appear as clickable rows in the sidebar', async () => {
    const rowCount = await page.evaluate(() =>
      document.querySelectorAll('[onclick^="joshSidebar_select"]').length
    );
    assert.ok(rowCount >= 1, `expected ≥1 project row in DOM, got ${rowCount}`);
  });

  // ── SMOKE_10: select project → detail card ────────────────────────────────
  test('SMOKE_10: selecting a project shows detail card with tier badge', async () => {
    // Click the first project row via its onclick handler
    await page.evaluate(() => {
      const row = document.querySelector('[onclick^="joshSidebar_select"]');
      if (row) row.click();
    });
    await page.waitForTimeout(300);
    const text = await page.locator('#josh-sidebar').innerText();
    const hasTier = ['MINISTERIAL', 'CONDITIONAL', 'DISCRETIONARY'].some(t => text.includes(t));
    assert.ok(hasTier, 'detail card must show a tier (MINISTERIAL / CONDITIONAL / DISCRETIONARY)');
  });

  // ── SMOKE_11: "View Report" button ────────────────────────────────────────
  test('SMOKE_11: detail card has "View Report" button for an analyzed project', async () => {
    const hasBtn = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .some(b => b.textContent.trim() === 'View Report')
    );
    assert.ok(hasBtn, '"View Report" button must appear in the detail card after selecting an analyzed project');
  });

  // ── SMOKE_12: New project form ────────────────────────────────────────────
  test('SMOKE_12: clicking "+ New" shows the New Project form', async () => {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('New'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    const text = await page.locator('#josh-sidebar').innerText();
    assert.ok(text.includes('New Project'), '"New Project" form heading must appear after clicking + New');
  });

  // ── SMOKE_14: "View Report" brief modal ──────────────────────────────────
  test('SMOKE_14: clicking "View Report" opens the determination brief modal', async () => {
    // SMOKE_12 left the sidebar in "New Project" form mode — no detail card visible.
    // Be self-sufficient: cancel any open form and re-select a pipeline project.
    await page.evaluate(() => {
      // Cancel form if open
      if (typeof joshSidebar_cancelForm === 'function') joshSidebar_cancelForm();
      // Select the first pipeline project that has a result
      const firstWithResult = (window.JOSH_DATA.projects || []).find(p => p.result);
      if (firstWithResult && typeof joshSidebar_select === 'function') {
        joshSidebar_select(firstWithResult.id);
      }
    });
    await page.waitForTimeout(300);

    // The brief modal overlay is injected on DOMContentLoaded by app.js.
    const modalExists = await page.evaluate(() =>
      !!document.getElementById('josh-brief-modal')
    );
    assert.ok(modalExists, '#josh-brief-modal overlay must exist in DOM (injected by app.js)');

    // Ensure modal is currently hidden before clicking
    await page.evaluate(() => {
      const m = document.getElementById('josh-brief-modal');
      if (m) m.style.display = 'none';
    });

    // Click "View Report"
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'View Report');
      if (btn) btn.click();
    });
    await page.waitForTimeout(600);  // allow BriefRenderer.render() + srcdoc write

    // Modal must be visible
    const modalVisible = await page.evaluate(() => {
      const m = document.getElementById('josh-brief-modal');
      return m && m.style.display !== 'none';
    });
    assert.ok(modalVisible, '#josh-brief-modal must be visible after clicking "View Report"');

    // iframe must have content (srcdoc set, not about:blank)
    const frameHasSrcdoc = await page.evaluate(() => {
      const f = document.getElementById('josh-brief-frame');
      return f && f.srcdoc && f.srcdoc.length > 100;
    });
    assert.ok(frameHasSrcdoc, '#josh-brief-frame must have brief HTML in srcdoc (not about:blank)');

    // Close modal for subsequent tests
    await page.evaluate(() => {
      const m = document.getElementById('josh-brief-modal');
      if (m) m.style.display = 'none';
    });
  });

  // ── SMOKE_13: cancel form ─────────────────────────────────────────────────
  test('SMOKE_13: Cancel dismisses the form and restores the project list', async () => {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Cancel');
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    const text = await page.locator('#josh-sidebar').innerText();
    assert.ok(!text.includes('New Project'), '"New Project" heading must be gone after Cancel');
    const rowCount = await page.evaluate(() =>
      document.querySelectorAll('[onclick^="joshSidebar_select"]').length
    );
    assert.ok(rowCount >= 1, `project list rows must be visible after Cancel, got ${rowCount}`);
  });

});
