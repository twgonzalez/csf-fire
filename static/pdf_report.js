// Copyright (C) 2026 Thomas Gonzalez
// SPDX-License-Identifier: AGPL-3.0-or-later
// This file is part of JOSH (Jurisdictional Objective Standards for Housing).
// See LICENSE for full terms. See CONTRIBUTING.md for contributor license terms.

/**
 * JOSH PDF Determination Report - client-side generator.
 *
 * Renders a monospace Courier determination report as a downloadable PDF
 * using jsPDF (lazy-loaded from CDN on first use).  Works entirely in the
 * browser - no server, no Python, works from file://.
 *
 * Public API:
 *   window.JoshPdfReport.generate(briefInput, auditText, opts?)
 *     Returns Promise<void>  (triggers browser download on resolve)
 *
 * briefInput: BriefInput v1 schema (same object passed to BriefRenderer)
 * auditText:  pre-built audit trail string from _buildAuditText()
 * opts:       { filename?: string }
 */

(function (root) {
  'use strict';

  // -- Page geometry (Letter, points) ----------------------------------------
  var PW       = 612;          // page width
  var PH       = 792;          // page height
  var ML       = 54;           // left margin  (0.75")
  var MR       = 54;           // right margin
  var MT       = 54;           // top margin   (0.75")
  var MB       = 54;           // bottom margin
  var BW       = PW - ML - MR; // body width = 504 pt
  var BODY_FS  = 10;           // body font size
  var FOOT_FS  = 8;            // footer font size
  var LH       = 14;           // line height (1.4x)
  var LH_COVER = 16;           // cover page line height
  var CHAR_W   = 6;            // Courier char width at 10pt
  var COLS     = Math.floor(BW / CHAR_W);  // ~84
  var FOOTER_H = 30;           // reserved footer space
  var HDR_H    = 30;           // reserved header space (pages 2+)
  var BOX_W    = 72;           // cover box width in chars
  var BOX_PW   = BOX_W * CHAR_W;           // box pixel width = 432pt
  var BOX_X    = ML + (BW - BOX_PW) / 2;  // centered box left edge

  // -- Tier labels -----------------------------------------------------------
  var TIER_LABEL = {
    'DISCRETIONARY':                        '** DISCRETIONARY REVIEW REQUIRED **',
    'MINISTERIAL WITH STANDARD CONDITIONS': 'MINISTERIAL WITH STANDARD CONDITIONS',
    'MINISTERIAL':                          'MINISTERIAL APPROVAL ELIGIBLE',
  };

  // -- Unicode sanitization --------------------------------------------------
  // Base-14 Courier has no glyphs for these Unicode characters.  jsPDF falls
  // back to per-character width lookup that fails, causing letter-spacing
  // explosion on the entire line.  Replace with ASCII equivalents BEFORE
  // passing any string to doc.text().

  function _sanitize(str) {
    if (!str) return '';
    return str
      .replace(/\u0394T/g, 'dT')   // ΔT (delta-T) -> dT (must precede standalone delta)
      .replace(/\u0394/g, 'Delta') // standalone Greek capital delta -> Delta
      .replace(/\u00d7/g, 'x')     // multiplication sign -> x
      .replace(/\u00a7/g, 'Sec.')  // section sign -> Sec.
      .replace(/\u2265/g, '>=')    // greater-than-or-equal -> >=
      .replace(/\u2264/g, '<=')    // less-than-or-equal -> <=
      .replace(/\u2013/g, '-')     // en dash -> hyphen
      .replace(/\u2014/g, ' - ')   // em dash -> spaced hyphen
      .replace(/\u2019/g, "'")     // right single quote -> apostrophe
      .replace(/\u201c/g, '"')     // left double quote -> straight quote
      .replace(/\u201d/g, '"')     // right double quote -> straight quote
      .replace(/\u2026/g, '...')   // ellipsis -> three dots
      .replace(/\u00b7/g, '-')     // middle dot -> hyphen
      .replace(/[^\x00-\x7e]/g, '?');  // any remaining non-ASCII -> ?
  }

  // -- Public API ------------------------------------------------------------

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

  // -- Document builder ------------------------------------------------------

  function _buildDoc(inp, auditText) {
    var jsPDF = root.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var ctx = { y: MT, pageNum: 1 };

    _writeCoverPage(doc, inp, ctx);
    _writeAuditTrail(doc, auditText, inp, ctx);
    _stampFooters(doc, inp);

    return doc;
  }

  // -- Cover page ------------------------------------------------------------

  function _writeCoverPage(doc, inp, ctx) {
    var proj   = inp.project  || {};
    var result = inp.result   || {};
    var tier   = (result.tier || 'MINISTERIAL').toUpperCase().trim();
    var paths  = result.paths || [];
    var maxDt  = +(result.max_delta_t_minutes || 0);
    var thrMin = +(result.threshold_minutes   || 0);
    var hz     = result.hazard_zone || 'non_fhsz';
    var nPaths = paths.length;
    var nFlag  = 0;
    paths.forEach(function (p) { if (p.flagged) nFlag++; });

    // -- Count total cover lines to vertically center -------------------------
    var coverLines = 0;
    coverLines += 9;  // title block (rule + blank + 2 title + blank + 2 version + blank + rule)
    coverLines += 3;  // blank + project + blank before city
    if (proj.address) coverLines++;
    coverLines += 4;  // APN + location + units (+ stories)
    if (proj.stories) coverLines++;
    coverLines += 4;  // city + case + date + blank
    coverLines += 1;  // separator rule
    coverLines += 2;  // blank + inner box top
    coverLines += 2;  // det label + blank
    if (tier === 'MINISTERIAL') coverLines += 2;
    else if (tier === 'MINISTERIAL WITH STANDARD CONDITIONS') coverLines += 3;
    else coverLines += 4; // DISCRETIONARY
    coverLines += 3;  // blank + inner box bottom + blank
    coverLines += 1;  // bottom rule

    var totalHeight = coverLines * LH_COVER;
    var usable = PH - MT - MB - FOOTER_H;
    var startY = MT + Math.max(0, (usable - totalHeight) / 2);
    ctx.y = startY;

    // Title block
    _boxRule(doc, ctx, '=');
    _boxBlank(doc, ctx);
    _boxText(doc, ctx, '  FIRE EVACUATION CAPACITY ANALYSIS', true);
    _boxText(doc, ctx, '  PROJECT DETERMINATION', true);
    _boxBlank(doc, ctx);
    _boxText(doc, ctx, '  JOSH v' + (result.parameters_version || '4.0'));
    _boxText(doc, ctx, '  Jurisdictional Objective Standards for Housing');
    _boxBlank(doc, ctx);
    _boxRule(doc, ctx, '=');

    // Project metadata
    _boxBlank(doc, ctx);
    _boxText(doc, ctx, '  Project:    ' + _sanitize(proj.name || 'Untitled'));
    if (proj.address) _boxText(doc, ctx, '  Address:    ' + _sanitize(proj.address));
    _boxText(doc, ctx, '  APN:        ' + _sanitize(proj.apn || 'Not provided'));
    _boxText(doc, ctx, '  Location:   ' + _coord(proj.lat) + ', ' + _coord(proj.lon));
    _boxText(doc, ctx, '  Units:      ' + (proj.units || 0) + ' dwelling units');
    if (proj.stories) _boxText(doc, ctx, '  Stories:    ' + proj.stories);
    _boxBlank(doc, ctx);
    _boxText(doc, ctx, '  City:       ' + _sanitize(inp.city_name || ''));
    _boxText(doc, ctx, '  Case No:    ' + _sanitize(inp.case_number || ''));
    _boxText(doc, ctx, '  Date:       ' + (inp.eval_date || ''));
    _boxBlank(doc, ctx);
    _boxRule(doc, ctx, '-');

    // Determination inner box
    _boxBlank(doc, ctx);
    // Inner box: 4 chars indent each side inside the outer box -> innerW = BOX_W - 2(outer pipes) - 2*3(padding) = BOX_W - 8
    // Content inside inner box: 2 chars padding each side -> content width = innerW - 4
    var innerW = BOX_W - 8;
    var contentW = innerW - 4; // space between inner | and content

    _boxText(doc, ctx, '   +' + _repeat('-', innerW) + '+');

    var detLabel = TIER_LABEL[tier] || tier;
    _boxText(doc, ctx, '   | ' + _pad('DETERMINATION: ' + detLabel, innerW - 2) + ' |', true);
    _boxText(doc, ctx, '   |' + _repeat(' ', innerW) + '|');

    if (tier === 'MINISTERIAL') {
      var ut = (inp.analysis || {}).unit_threshold || 15;
      _boxText(doc, ctx, '   | ' + _pad((proj.units || 0) + ' units < ' + ut + '-unit threshold.', innerW - 2) + ' |');
      _boxText(doc, ctx, '   | ' + _pad('No evacuation capacity analysis required.', innerW - 2) + ' |');
    } else if (tier === 'MINISTERIAL WITH STANDARD CONDITIONS') {
      _boxText(doc, ctx, '   | ' + _pad('Max dT:     ' + maxDt.toFixed(2) + ' min', innerW - 2) + ' |');
      _boxText(doc, ctx, '   | ' + _pad('Threshold:  ' + thrMin.toFixed(2) + ' min', innerW - 2) + ' |');
      _boxText(doc, ctx, '   | ' + _pad('All paths within threshold. Conditions apply.', innerW - 2) + ' |');
    } else {
      // DISCRETIONARY
      var safeWin = +(result.safe_egress_window_minutes || 0);
      var share   = +(result.max_project_share || 0.05);
      var thrDesc = thrMin.toFixed(2) + ' min (' + safeWin.toFixed(0) + ' min x ' + (share * 100).toFixed(0) + '%)';
      _boxText(doc, ctx, '   | ' + _pad('Max dT:     ' + maxDt.toFixed(2) + ' min', innerW - 2) + ' |');
      _boxText(doc, ctx, '   | ' + _pad('Threshold:  ' + thrDesc, innerW - 2) + ' |');
      _boxText(doc, ctx, '   | ' + _pad('Hazard:     ' + hz, innerW - 2) + ' |');
      _boxText(doc, ctx, '   | ' + _pad('Paths:      ' + nPaths + ' evaluated, ' + nFlag + ' flagged', innerW - 2) + ' |');
    }

    _boxText(doc, ctx, '   |' + _repeat(' ', innerW) + '|');
    _boxText(doc, ctx, '   +' + _repeat('-', innerW) + '+');
    _boxBlank(doc, ctx);
    _boxRule(doc, ctx, '=');
  }

  // -- Box-drawing helpers ---------------------------------------------------

  function _boxLine(doc, ctx, text, bold) {
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.setFontSize(BODY_FS);
    doc.setTextColor(0);
    var inner = (text || '').length <= BOX_W - 2 ? (text || '') : text.substring(0, BOX_W - 2);
    var line  = '|' + _pad(inner, BOX_W - 2) + '|';
    doc.text(line, BOX_X, ctx.y);
    ctx.y += LH_COVER;
  }

  function _boxText(doc, ctx, text, bold) {
    _boxLine(doc, ctx, text, bold);
  }

  function _boxBlank(doc, ctx) {
    _boxLine(doc, ctx, '', false);
  }

  function _boxRule(doc, ctx, ch) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(BODY_FS);
    doc.setTextColor(0);
    doc.text('+' + _repeat(ch || '=', BOX_W - 2) + '+', BOX_X, ctx.y);
    ctx.y += LH_COVER;
  }

  // -- Audit trail -----------------------------------------------------------

  function _writeAuditTrail(doc, text, inp, ctx) {
    doc.addPage();
    ctx.pageNum++;
    ctx.y = MT + HDR_H;

    _writePageHeader(doc, inp);

    // Sanitize the entire audit text for base-14 Courier compatibility
    var clean = _sanitize(text || '');
    var lines = clean.split('\n');

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Word-wrap long lines instead of truncating
      var wrapped = _wordWrap(line, COLS);

      for (var w = 0; w < wrapped.length; w++) {
        var wline = wrapped[w];

        // Check if we need a new page
        if (ctx.y + LH > PH - MB - FOOTER_H) {
          doc.addPage();
          ctx.pageNum++;
          ctx.y = MT + HDR_H;
          _writePageHeader(doc, inp);
        }

        // Only apply formatting detection on the first wrapped segment
        // (continuation lines are plain)
        if (w > 0) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(BODY_FS);
          doc.setTextColor(0);
          doc.text(wline, ML, ctx.y);
          ctx.y += LH;
          continue;
        }

        // Detect line type for formatting
        var isSectionHeader = /^={5,}/.test(line);
        var isStepHeader    = /^\s*STEP\s+\d/.test(line);
        var isExceed        = /\*\*\*.*EXCEEDS?\s+THRESHOLD/.test(line);
        var isFinalDet      = /^FINAL DETERMINATION/.test(line.trim()) ||
                              /^SCENARIO:/.test(line.trim());
        var isAlgorithm     = /^ALGORITHM/.test(line.trim());
        var isDetermination = /^Determination:/.test(line.trim());

        if (isSectionHeader) {
          // Draw a thin rule with clearance above and below adjacent text.
          // Rule sits at the current baseline; advance a full line afterward
          // so the next text (often a bold section title) doesn't overlap.
          doc.setDrawColor(120);
          doc.setLineWidth(0.5);
          doc.line(ML, ctx.y - 2, ML + BW, ctx.y - 2);
          ctx.y += LH;
          continue;
        }

        if (isExceed) {
          // Gray background highlight bar
          doc.setFillColor(230, 230, 230);
          doc.rect(ML - 2, ctx.y - BODY_FS + 1, BW + 4, LH, 'F');
          doc.setFont('courier', 'bold');
          doc.setFontSize(BODY_FS);
          doc.setTextColor(0);
          doc.text(wline, ML, ctx.y);
          ctx.y += LH;
          continue;
        }

        if (isFinalDet || isAlgorithm || isDetermination) {
          doc.setFont('courier', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(0);
          doc.text(wline, ML, ctx.y);
          ctx.y += LH + 2;
          continue;
        }

        if (isStepHeader) {
          doc.setFont('courier', 'bold');
          doc.setFontSize(BODY_FS);
          doc.setTextColor(0);
          doc.text(wline, ML, ctx.y);
          ctx.y += LH;
          continue;
        }

        // Normal line
        doc.setFont('courier', 'normal');
        doc.setFontSize(BODY_FS);
        doc.setTextColor(0);
        doc.text(wline, ML, ctx.y);
        ctx.y += LH;
      }
    }
  }

  // -- Page header (pages 2+) ------------------------------------------------

  function _writePageHeader(doc, inp) {
    var proj   = inp.project || {};
    var result = inp.result  || {};
    var tier   = (result.tier || '').toUpperCase();
    var left   = 'JOSH v' + (result.parameters_version || '4.0') +
                 ' | ' + _sanitize(proj.name || 'Untitled') + ' | ' + tier;
    var right  = _sanitize(inp.case_number || '');

    doc.setFont('courier', 'normal');
    doc.setFontSize(FOOT_FS);
    doc.setTextColor(120);
    doc.text(left, ML, MT + 6);
    doc.text(right, PW - MR, MT + 6, { align: 'right' });
    doc.setDrawColor(180);
    doc.setLineWidth(0.3);
    doc.line(ML, MT + 12, ML + BW, MT + 12);
  }

  // -- Footer stamping (second pass) -----------------------------------------

  function _stampFooters(doc, inp) {
    var result  = inp.result || {};
    var total   = doc.internal.getNumberOfPages();
    var version = 'JOSH v' + (result.parameters_version || '4.0');
    var pv      = result.parameters_version || '4.0';
    var date    = inp.eval_date || '';

    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      var fy = PH - MB;

      // Divider line
      doc.setDrawColor(180);
      doc.setLineWidth(0.3);
      doc.line(ML, fy - 20, ML + BW, fy - 20);

      // Footer line 1: version | date | page
      doc.setFont('courier', 'normal');
      doc.setFontSize(FOOT_FS);
      doc.setTextColor(120);
      var left  = version + ' | Parameters v' + pv + ' | Generated ' + date;
      var right = 'Page ' + i + ' of ' + total;
      doc.text(left, ML, fy - 10);
      doc.text(right, PW - MR, fy - 10, { align: 'right' });

      // Footer line 2: objectivity statement
      doc.text('This determination is based solely on objective, verifiable criteria.', ML, fy - 2);
    }
  }

  // -- String helpers --------------------------------------------------------

  function _repeat(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  function _pad(str, width) {
    str = str || '';
    if (str.length >= width) return str.substring(0, width);
    return str + _repeat(' ', width - str.length);
  }

  /**
   * Word-wrap a string to maxChars columns.  Tries to break at spaces;
   * if a single word exceeds maxChars it is hard-broken.  Preserves
   * leading indentation on continuation lines.
   */
  function _wordWrap(str, maxChars) {
    if (!str) return [''];
    if (str.length <= maxChars) return [str];

    // Detect leading whitespace for continuation indent
    var indent = '';
    var m = str.match(/^(\s+)/);
    if (m) indent = m[1];
    // Continuation lines get 2 extra spaces of indent
    var contIndent = indent + '  ';
    if (contIndent.length >= maxChars - 10) contIndent = indent; // safety

    var result = [];
    var remaining = str;
    var isFirst = true;

    while (remaining.length > 0) {
      var limit = isFirst ? maxChars : maxChars;
      var pre   = isFirst ? '' : contIndent;
      var avail = limit - pre.length;

      if (remaining.length <= avail) {
        result.push(pre + remaining);
        break;
      }

      // Find last space within avail chars
      var chunk = remaining.substring(0, avail);
      var breakAt = chunk.lastIndexOf(' ');
      if (breakAt <= 0) {
        // No space found — hard break
        breakAt = avail;
      }

      result.push(pre + remaining.substring(0, breakAt));
      remaining = remaining.substring(breakAt).replace(/^\s/, ''); // trim leading space
      isFirst = false;
    }

    return result;
  }

  function _coord(v) {
    return v != null ? (+v).toFixed(4) : '?';
  }

  // -- jsPDF lazy loader -----------------------------------------------------

  var _JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.3/jspdf.umd.min.js';

  function _ensureJsPDF() {
    return new Promise(function (resolve, reject) {
      if (root.jspdf && root.jspdf.jsPDF) { resolve(); return; }
      var s = document.createElement('script');
      s.src = _JSPDF_CDN;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        if (root.jspdf && root.jspdf.jsPDF) { resolve(); }
        else { reject(new Error('jsPDF loaded but jspdf.jsPDF not found')); }
      };
      s.onerror = function () {
        reject(new Error(
          'Could not load jsPDF (requires internet).\n' +
          'Alternative: open View Report, then use Ctrl+P / Cmd+P to print to PDF.'
        ));
      };
      document.head.appendChild(s);
    });
  }

  // -- Expose ----------------------------------------------------------------

  root.JoshPdfReport = { generate: generate };

})(typeof globalThis !== 'undefined' ? globalThis : this);
