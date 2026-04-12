# Spec: PDF Determination Report (v1) — Client-Side

**Status:** Draft
**Date:** 2026-04-11
**Branch:** `feat/pdf-determination`

## Goal

"Download PDF" button in the sidebar that generates a monospace Courier
determination report client-side — no server, no Python, works from
`file://`. Same old-school government-printout aesthetic as the `.txt`
audit trail, but packaged as a proper PDF with a cover page.

## Why Client-Side

All user data lives in the browser. Pipeline projects arrive via
`window.JOSH_DATA`; browser projects are created via WhatIfEngine and
stored in localStorage. There is no server to call. The existing "View
Report" flow already builds a complete `BriefInput` and audit trail text
entirely in JS (`_buildBriefInput()` + `_buildAuditText()` in sidebar.js).
PDF generation is the last mile — take that same data and render it to a
downloadable file.

## Design Philosophy

Lean into the monospace aesthetic. The `_buildAuditText()` output is
already formatted for ~70-char Courier display with `=====` dividers,
indented STEP blocks, and `*** EXCEEDS THRESHOLD ***` flags. Render
this verbatim in Courier — don't reformat it. Add a structured cover
page with ASCII box art, and page headers/footers. The result should
look like a USGS technical note or an old EPA discharge report — dense,
precise, authoritative.

## Library Choice: jsPDF

**[jsPDF](https://github.com/parallax/jsPDF)** (MIT license) — pure
client-side PDF generation. ~280 KB minified. No server, no canvas, no
DOM rendering. Text goes in, PDF comes out.

Why jsPDF over alternatives:
- **html2pdf.js / html2canvas**: Rasterizes HTML to canvas then to PDF.
  Blurry text, huge file sizes, lossy. Defeats the purpose of a
  crisp monospace text document.
- **Playwright page.pdf()**: Server-side only.
- **window.print()**: Requires user to manually choose "Save as PDF",
  pick settings, wait for dialog. Not a one-click download. Print CSS
  is already in brief_renderer.js for users who want that path.
- **jsPDF**: Vector text rendering. Courier is a PDF base-14 font — every
  reader has it built in. Text is searchable and copy-pasteable. File
  sizes are tiny (~30–50 KB for a 5-page report). MIT license is
  compatible with AGPL dual-licensing.

### Loading Strategy

jsPDF is loaded from CDN via a `<script>` tag injected on first use (lazy
load — don't bloat initial page load for a feature most users won't use
every session). Pattern:

```js
function _ensureJsPDF() {
  return new Promise(function (resolve, reject) {
    if (window.jspdf) { resolve(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
    s.onload  = function () { resolve(); };
    s.onerror = function () { reject(new Error('Failed to load jsPDF from CDN')); };
    document.head.appendChild(s);
  });
}
```

For fully offline `file://` usage: fall back to `window.print()` with a
console warning if CDN is unreachable. Or — bundle jsPDF into `app.js` at
`demo` build time (see "Offline Fallback" section).

## UI: "Download PDF" Button

### Location: sidebar detail card

Add a button below the existing "View Report" button:

```
┌─────────────────────────────┐
│       View Report           │  ← existing: opens HTML brief modal
├─────────────────────────────┤
│       Download PDF          │  ← NEW: generates + downloads PDF
├─────────────────────────────┤
│       Download .json        │  ← existing: project backup
└─────────────────────────────┘
```

Style: same `_btn('#1c4a6e','#fff')` as the other buttons. No new
visual language.

### Location: brief modal header bar

Add a small PDF icon button in the modal toolbar (next to the ✕ close
button). This lets users who are already viewing the HTML brief grab a
PDF without going back to the sidebar.

```
┌───────────────────────────────────────────────────┐
│  Determination Brief                    [PDF] [✕] │
├───────────────────────────────────────────────────┤
│  (iframe with HTML brief)                         │
```

## Page Layout

```
Letter size (8.5" × 11"), portrait
Margins: 0.75" left/right, 0.6" top/bottom
Printable width: 7.0" (504 pt)
Font: Courier 10pt body, 12pt cover headers, 8pt footer
Characters per line: ~84 at 10pt Courier (6.0 pt/char)
Line height: 14pt (1.4× — readable monospace spacing)
```

## Document Structure

### Page 1: Cover / Summary

ASCII art cover page built programmatically from project data:

```
+======================================================================+
|                                                                      |
|   FIRE EVACUATION CAPACITY ANALYSIS                                  |
|   PROJECT DETERMINATION                                              |
|                                                                      |
|   JOSH v4.0                                                          |
|   Jurisdictional Objective Standards for Housing                     |
|                                                                      |
+======================================================================+
|                                                                      |
|   Project:    Cedar Street Infill                                    |
|   Address:    Cedar Street & Shattuck Ave, North Berkeley            |
|   APN:        Not provided                                           |
|   Location:   37.8790, -122.2780                                     |
|   Units:      75 dwelling units                                      |
|   Stories:    6                                                      |
|                                                                      |
|   City:       Berkeley, CA                                           |
|   Case No:    JOSH-2026-CEDAR-STREET-INFI-37_8790-n122_2780         |
|   Date:       2026-04-11                                             |
|                                                                      |
+----------------------------------------------------------------------+
|                                                                      |
|   +----------------------------------------------------------+       |
|   |                                                          |       |
|   |   DETERMINATION:  ** DISCRETIONARY REVIEW REQUIRED **    |       |
|   |                                                          |       |
|   |   Max dT:     18.00 min                                  |       |
|   |   Threshold:   6.00 min (120 min x 5%)                   |       |
|   |   Hazard:     non_fhsz                                   |       |
|   |   Paths:      1 evaluated, 1 flagged                     |       |
|   |                                                          |       |
|   +----------------------------------------------------------+       |
|                                                                      |
+======================================================================+
```

The cover page is generated from the same `BriefInput` data used for the
HTML brief. No new data sources needed.

**Tier-dependent determination box content:**

MINISTERIAL (below size threshold):
```
|   DETERMINATION:  MINISTERIAL APPROVAL ELIGIBLE              |
|                                                              |
|   10 units < 15-unit threshold.                              |
|   No evacuation capacity analysis required.                  |
```

MINISTERIAL WITH STANDARD CONDITIONS:
```
|   DETERMINATION:  MINISTERIAL WITH STANDARD CONDITIONS       |
|                                                              |
|   Max dT:     3.02 min                                       |
|   Threshold:  6.00 min (120 min x 5%)                        |
|   All paths within threshold. Standard conditions apply.     |
```

DISCRETIONARY:
```
|   DETERMINATION:  ** DISCRETIONARY REVIEW REQUIRED **        |
|                                                              |
|   Max dT:     18.00 min                                      |
|   Threshold:   6.00 min (120 min x 5%)                       |
|   Hazard:     non_fhsz                                       |
|   Paths:      1 evaluated, 1 flagged                         |
```

### Pages 2+: Full Audit Trail

The complete audit trail text from `_buildAuditText()`, rendered
line-by-line in Courier 10pt. This is identical to the `.txt` file
content and the audit section embedded in the HTML brief.

Typographic enhancements (all still in Courier):

- **Section headers** (lines with `======`): Courier Bold 11pt with a
  thin drawn rule above/below (not text `=`, an actual PDF line stroke).
- **Step headers** (`STEP 1 - ...`): Courier Bold 10pt.
- **Threshold exceeded** (`*** dT EXCEEDS THRESHOLD ***`): Courier Bold
  with a light gray (#f0f0f0) background rect drawn behind the line.
  This is the one visual emphasis — draws the eye to the controlling
  finding.

### Footer (every page)

```
------------------------------------------------------------------------
JOSH v4.0 | Parameters v4.0 | Generated 2026-04-11         Page 1 of 5
This determination is based solely on objective, verifiable criteria.
```

Courier 8pt, gray (#666). jsPDF supports the `{pageNumber}` and
`{totalPages}` pattern for page counts via the `autoPage` callback or
a two-pass approach (first pass counts pages, second pass writes footers).

### Header (pages 2+ only)

```
JOSH v4.0 | Cedar Street Infill | DISCRETIONARY         [case number]
------------------------------------------------------------------------
```

Courier 8pt, gray. Page 1 (cover) has no header.

## Implementation

### New file: `static/pdf_report.js`

Hand-written, ~200–300 lines. IIFE pattern matching the existing static
JS files. Exposes `window.JoshPdfReport`.

```js
// Copyright (C) 2026 Thomas Gonzalez
// SPDX-License-Identifier: AGPL-3.0-or-later

(function (root) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────
  var PAGE_W     = 612;    // Letter width in points
  var PAGE_H     = 792;    // Letter height in points
  var MARGIN_L   = 54;     // 0.75"
  var MARGIN_R   = 54;
  var MARGIN_T   = 43;     // 0.6"
  var MARGIN_B   = 43;
  var BODY_W     = PAGE_W - MARGIN_L - MARGIN_R;  // 504pt
  var FONT_BODY  = 10;
  var FONT_HDR   = 12;
  var FONT_FOOT  = 8;
  var LINE_H     = 14;    // 1.4x body font
  var CHARS_LINE = 84;    // chars per line at 10pt Courier

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Generate a PDF determination report and trigger browser download.
   *
   * @param {Object} briefInput  — BriefInput v1 schema (same as BriefRenderer)
   * @param {string} auditText   — pre-built audit trail text
   * @param {Object} [opts]      — { filename: string }
   */
  function generate(briefInput, auditText, opts) {
    opts = opts || {};
    return _ensureJsPDF().then(function () {
      var doc = _buildDoc(briefInput, auditText);
      var filename = opts.filename ||
        (briefInput.case_number || 'determination').toLowerCase()
          .replace(/[^a-z0-9_-]/g, '_') + '.pdf';
      doc.save(filename);
    });
  }

  // ── Core builder ───────────────────────────────────────────────────

  function _buildDoc(inp, auditText) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });

    _writeCoverPage(doc, inp);
    _writeAuditTrail(doc, auditText, inp);
    _writeFooters(doc, inp);    // second pass: stamp footers on all pages

    return doc;
  }

  function _writeCoverPage(doc, inp) { /* ... */ }
  function _writeAuditTrail(doc, text, inp) { /* ... */ }
  function _writeFooters(doc, inp) { /* ... */ }

  // ── jsPDF lazy loader ──────────────────────────────────────────────

  function _ensureJsPDF() {
    return new Promise(function (resolve, reject) {
      if (window.jspdf) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
      s.integrity = 'sha384-...';   // SRI hash
      s.crossOrigin = 'anonymous';
      s.onload  = resolve;
      s.onerror = function () {
        reject(new Error('Could not load jsPDF. PDF export requires internet.'));
      };
      document.head.appendChild(s);
    });
  }

  // ── Expose ─────────────────────────────────────────────────────────
  root.JoshPdfReport = { generate: generate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

### Integration: sidebar.js

Add "Download PDF" button and handler:

```js
// In _renderDetailCard():
html += '<button onclick="joshSidebar_downloadPdf(\'' + _selectedId + '\')" ' +
        'style="width:100%;margin-bottom:6px;' + _btn('#1c4a6e','#fff') +
        '">Download PDF</button>';

// Handler:
function _downloadPdf(project) {
  if (!window.JoshPdfReport) {
    _showError('PDF module not loaded — try reloading the page.');
    return;
  }
  var briefInput = _buildBriefInput(project);
  var auditText  = _buildAuditText(project, project.result || {}, _params());
  window.JoshPdfReport.generate(briefInput, auditText)
    .catch(function (e) { _showError('PDF generation failed: ' + e.message); });
}

// Wire up global:
window.joshSidebar_downloadPdf = function (id) {
  var p = getProject(id); if (p) _downloadPdf(p);
};
```

### Integration: brief modal toolbar

In `static/v1/app.js`, add a PDF button to the modal header bar. The
button calls `postMessage` to the parent window with the BriefInput,
or — simpler — the parent stores the last-shown BriefInput in a
closure and the PDF button reads it directly.

### Inline strategy: demo.py

`pdf_report.js` is inlined into `demo_map.html` the same way as
`sidebar.js` and `brief_renderer.js` (line 1194 pattern in demo.py).
The file is read from disk and injected as a `<script>` block.

jsPDF itself is NOT inlined (280 KB is too large). It's lazy-loaded
from CDN on first "Download PDF" click. See "Offline Fallback" below.

## Offline Fallback

`demo_map.html` works from `file://` with no internet. jsPDF CDN
requires internet. Options:

1. **Graceful degradation** (v1): If jsPDF fails to load, show an error
   toast: "PDF export requires internet connection. Use View Report →
   Print to PDF as an alternative." The existing HTML brief already has
   `@media print` CSS with `@page { size: letter; }` — users can
   Ctrl+P from the brief modal for a decent print-to-PDF fallback.

2. **Inline jsPDF** (future): At `demo` build time, read
   `node_modules/jspdf/dist/jspdf.umd.min.js` and inline it. Adds
   ~280 KB to every `demo_map.html`. Only do this if offline PDF
   becomes a hard requirement.

v1 ships option 1. The `window.print()` path already works and
produces a good result from the brief modal.

## Filename Convention

```
{case_number}.pdf

Examples:
  josh-2026-cedar-street-infi-37_8790-n122_2780.pdf
  josh-2026-ashby-small-infill-37_8528-n122_2699.pdf
```

Derived from `BriefInput.case_number`, lowercased, non-alphanumeric
characters replaced with `_`.

## Fonts

**Courier** (PDF base-14 font). Every PDF reader has it built in. jsPDF
ships with base-14 support — no font embedding needed. Variants:

- `Courier` — normal weight (body text)
- `Courier-Bold` — bold (section headers, threshold flags)

No custom fonts. No font files. Zero-config.

## Color

**Monochrome in v1.** Pure black text on white. The one exception: the
gray (#f0f0f0) background highlight bar on `*** EXCEEDS THRESHOLD ***`
lines, drawn as a filled rect behind the text.

**Future v2 enhancement:** A single tier-colored accent — a 4pt colored
rule across the top of the cover page (green/orange/red matching the
tier). Keeps the government-document feel while providing instant visual
triage when flipping through a stack of printed reports.

## Test Plan

### Smoke test: `tests/smoke_sidebar.js`

New smoke test `SMOKE_27`:

```js
test('SMOKE_27: Download PDF button appears and triggers download', async () => {
  // 1. Create + submit a browser project (reuse SMOKE_25 pattern)
  // 2. Assert "Download PDF" button exists in detail card
  // 3. Mock jsPDF (inject window.jspdf.jsPDF stub that records calls)
  // 4. Click the button
  // 5. Assert jsPDF constructor was called
  // 6. Assert doc.save() was called with a .pdf filename
});
```

This tests the wiring without actually generating a PDF (jsPDF is
mocked). The visual output is verified by manual QA.

### Unit test: `tests/test_pdf_report.js` (Node)

Test the cover page text generation and audit trail line processing
functions in isolation (export them from the IIFE for test access via
the UMD pattern, same as `brief_renderer.js`).

```js
test('cover page contains project name');
test('cover page determination box matches tier');
test('audit trail splits lines correctly');
test('threshold exceeded lines are detected');
test('page count is reasonable for typical reports');
```

### Manual QA

Generate PDFs for all three tiers:
- MINISTERIAL: Ashby Small Infill (10 units, Berkeley)
- MINISTERIAL WITH STANDARD CONDITIONS: (any Berkeley project that fits)
- DISCRETIONARY: Cedar Street Infill (75 units, 6 stories, Berkeley)

Verify in Preview.app:
- Cover page box characters align (monospace grid integrity)
- Audit trail text matches `.txt` file exactly
- `*** EXCEEDS THRESHOLD ***` has visible gray highlight
- Footer on every page with correct page count
- Text is selectable and searchable (vector, not raster)
- File size is reasonable (~30–50 KB for a 5-page report)

## Rollout

| Step | What | Files Changed |
|------|------|---------------|
| 1 | Create `static/pdf_report.js` | NEW |
| 2 | Add "Download PDF" button + handler in sidebar.js | `static/sidebar.js` |
| 3 | Add PDF button to brief modal toolbar | `static/v1/app.js` (generated) |
| 4 | Inline `pdf_report.js` in demo.py | `agents/visualization/demo.py` |
| 5 | Smoke test SMOKE_27 | `tests/smoke_sidebar.js` |
| 6 | Unit tests | `tests/test_pdf_report.js` (NEW) |
| 7 | Rebuild all cities | all `demo_map.html` files |

No Python dependency changes. No `pyproject.toml` changes. No pipeline
changes. Pure JS feature.

## Non-Goals (v1)

- No Python-side PDF generation (fpdf2 removed from consideration)
- No font embedding (base-14 Courier only)
- No images, logos, or maps in the PDF
- No interactive PDF elements (bookmarks, links, form fields)
- No jsPDF inlining (CDN lazy-load only)
- No new CLI subcommand

## Future Enhancements (v2+)

- **Tier-colored accent rule** on cover page (4pt top bar)
- **Bookmarks/outline** for long DISCRETIONARY reports
- **Inline jsPDF** for full offline support
- **Brief modal PDF button** in toolbar
- **Batch CLI mode**: `build.py pdf --city "Berkeley"` regenerates
  PDFs from existing data without re-running analysis (would use
  fpdf2 Python-side for CI/automation, separate from the browser path)
