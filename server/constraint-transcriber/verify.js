'use strict';
/**
 * Verifier B-0a — structural geometric box-diff (no headless render).
 * @see docs/CONSTRAINT_TRANSCRIBER_SPEC.md §B
 */

const cfg = require('./config');
const { absBox, relBox, isVisible, isDecorativeDot } = require('./geometry');

function parsePx(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'auto') return null;
  // Percentages must be resolved against a parent length — use resolveLength()
  if (/%\s*$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Resolve px / % / auto against parent main size (content box). */
function resolveLength(v, parentLen) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'auto') return null;
  if (/%\s*$/.test(s)) {
    const pct = parseFloat(s);
    if (!Number.isFinite(pct) || parentLen == null) return null;
    return (pct / 100) * parentLen;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parsePadding(decls) {
  const raw = decls && decls.get('padding');
  if (!raw) return { top: 0, right: 0, bottom: 0, left: 0 };
  const parts = String(raw).trim().split(/\s+/).map(parsePx);
  if (parts.length === 1) {
    const p = parts[0] || 0;
    return { top: p, right: p, bottom: p, left: p };
  }
  if (parts.length === 2) {
    return { top: parts[0] || 0, right: parts[1] || 0, bottom: parts[0] || 0, left: parts[1] || 0 };
  }
  if (parts.length === 4) {
    return {
      top: parts[0] || 0, right: parts[1] || 0, bottom: parts[2] || 0, left: parts[3] || 0,
    };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function oracleRel(child, parent) {
  if (child._oracleBox) return child._oracleBox;
  return relBox(child, parent);
}

function sizePass(delta, measured, isText) {
  if (isText) return Math.abs(delta) <= cfg.TEXT_H_TOL;
  const lim = Math.max(cfg.SIZE_TOL_PX, (measured || 0) * cfg.SIZE_TOL_PCT);
  return Math.abs(delta) <= lim;
}

function posPass(delta) {
  return Math.abs(delta) <= cfg.POS_TOL;
}

function simulateLayout(container) {
  if (!container || !container.decls) return null;
  const display = container.decls.get('display');
  if (display !== 'flex' && display !== 'grid') return null;

  const pad = parsePadding(container.decls);
  const gap = parsePx(container.decls.get('gap')) || 0;
  const kids = (container.children || []).filter((c) => (
    isVisible(c) && !c._constraintChromeHidden && c.decls && c.decls.get('display') !== 'none'
  ));
  const flow = kids.filter((c) => c.decls.get('position') !== 'absolute');
  const result = new Map();

  const cw = absBox(container) ? absBox(container).w : 0;
  const ch = absBox(container) ? absBox(container).h : 0;
  const innerW = Math.max(0, cw - pad.left - pad.right);
  const innerH = Math.max(0, ch - pad.top - pad.bottom);

  kids.filter((c) => c.decls.get('position') === 'absolute').forEach((c) => {
    const top = parsePx(c.decls.get('top')) || 0;
    let left = parsePx(c.decls.get('left'));
    const right = parsePx(c.decls.get('right'));
    const w = resolveLength(c.decls.get('width'), cw) || (absBox(c) && absBox(c).w) || 0;
    const h = resolveLength(c.decls.get('height'), ch) || (absBox(c) && absBox(c).h) || 0;
    if (left == null && right != null) left = cw - right - w;
    result.set(c, { x: left || 0, y: top, w, h });
  });

  if (display === 'grid') {
    const colsMatch = /repeat\(\s*(\d+)/i.exec(container.decls.get('grid-template-columns') || '');
    const cols = colsMatch ? Number(colsMatch[1]) : flow.length;
    const gridInnerW = cw - pad.left - pad.right - gap * Math.max(0, cols - 1);
    const cellW = cols > 0 ? gridInnerW / cols : gridInnerW;
    flow.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const h = parsePx(c.decls.get('min-height'))
        || resolveLength(c.decls.get('height'), ch)
        || (absBox(c) && absBox(c).h)
        || 0;
      result.set(c, {
        x: pad.left + col * (cellW + gap),
        y: pad.top + row * (h + gap),
        w: cellW,
        h,
      });
    });
    return result;
  }

  const dir = container.decls.get('flex-direction') || 'row';
  let cursor = dir === 'column' ? pad.top : pad.left;

  // First pass: natural heights for margin-top:auto packing at end of column
  const natural = flow.map((c) => {
    let w = resolveLength(c.decls.get('width'), innerW);
    let h = resolveLength(c.decls.get('height'), innerH);
    const flex = c.decls.get('flex') || '';
    const maxW = resolveLength(c.decls.get('max-width'), innerW);
    if (w == null && absBox(c)) w = absBox(c).w;
    if (h == null && absBox(c)) h = absBox(c).h;
    if (/^1\s+1/i.test(flex) && maxW != null) w = maxW;
    if (c.decls.get('align-self') === 'stretch' || c.decls.get('width') === '100%') {
      w = innerW;
    }
    const mtAuto = String(c.decls.get('margin-top') || '') === 'auto';
    return {
      c,
      w: w || 0,
      h: h || 0,
      mt: mtAuto ? 0 : (parsePx(c.decls.get('margin-top')) || 0),
      ml: parsePx(c.decls.get('margin-left')) || 0,
      mtAuto,
    };
  });

  let fixedH = 0;
  natural.forEach((n, i) => {
    if (i > 0 && gap) fixedH += gap;
    fixedH += n.mt + n.h;
  });
  const autoExtra = dir === 'column' ? Math.max(0, innerH - fixedH) : 0;
  let autoBudget = autoExtra;

  natural.forEach((n, i) => {
    if (i > 0 && gap) cursor += gap;
    let mt = n.mt;
    if (n.mtAuto && dir === 'column') {
      mt = autoBudget;
      autoBudget = 0;
    }
    if (dir === 'column') cursor += mt;
    else cursor += n.ml;

    if (dir === 'column') {
      result.set(n.c, { x: pad.left + n.ml, y: cursor, w: n.w, h: n.h });
      cursor += n.h;
    } else {
      result.set(n.c, { x: cursor, y: pad.top + n.mt, w: n.w, h: n.h });
      cursor += n.w;
    }
  });

  return result;
}

function verifyMediaOverlay(container) {
  const failures = [];
  const kids = (container.children || []).filter((c) => (
    isVisible(c) && !c._constraintChromeHidden && c.decls && c.decls.get('display') !== 'none'
  ));
  for (const child of kids) {
    const expect = oracleRel(child, container);
    if (!expect) continue;
    const pos = child.decls.get('position');
    let got;
    if (pos === 'absolute') {
      const left = parsePx(child.decls.get('left')) || 0;
      const top = parsePx(child.decls.get('top')) || 0;
      const cw = absBox(container) ? absBox(container).w : 0;
      const w = resolveLength(child.decls.get('width'), cw) || expect.w;
      const h = resolveLength(child.decls.get('height'), absBox(container) && absBox(container).h)
        || expect.h;
      got = { x: left, y: top, w, h };
    } else {
      // Relative media: expect origin inset ~0 and full width
      const cw = absBox(container) ? absBox(container).w : expect.w;
      const w = resolveLength(child.decls.get('width'), cw) || cw;
      const h = resolveLength(child.decls.get('height'), null) || expect.h;
      got = { x: 0, y: 0, w, h };
    }
    const isText = !!(child.text != null || child.runs);
    const dx = got.x - expect.x;
    const dy = got.y - expect.y;
    const dw = got.w - expect.w;
    const dh = got.h - expect.h;
    if (pos === 'absolute') {
      if (!posPass(dx) || !posPass(dy)) {
        failures.push({
          containerId: container.nodeId,
          failingNodeId: child.nodeId,
          Δx: dx, Δy: dy, Δw: dw, Δh: dh,
        });
      }
    } else {
      // Media fill: tolerate width stretch to 100%
      if (!sizePass(dh, expect.h, isText) && Math.abs(dh) > cfg.SIZE_TOL_PX * 4) {
        failures.push({
          containerId: container.nodeId,
          failingNodeId: child.nodeId,
          Δx: dx, Δy: dy, Δw: dw, Δh: dh,
        });
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

function verifyContainer(container) {
  const failures = [];
  if (!container || !container._constraintTranscribed) {
    return { pass: false, failures: [{ code: 'NOT_TRANSCRIBED', containerId: container && container.nodeId }] };
  }

  if (container._constraintMediaOverlay) {
    return verifyMediaOverlay(container);
  }

  // Image-top cards: media must be in-flow (not absolute); overlays may be absolute
  if (container._constraintImageTop) {
    const media = (container.children || []).find((c) => c && /\bet-card__media--top\b/.test(c.extraClass || ''));
    if (media && media.decls && media.decls.get('position') === 'absolute') {
      return {
        pass: false,
        failures: [{
          containerId: container.nodeId,
          failingNodeId: media.nodeId,
          code: 'MEDIA_STILL_ABSOLUTE',
          Δx: 0, Δy: 0, Δw: 0, Δh: 0,
        }],
      };
    }
    // Soft pass on column box-diff — content below photo is the contract
    container._constraintVerified = true;
    return { pass: true, failures: [] };
  }

  const sim = simulateLayout(container);
  if (!sim) {
    return {
      pass: false,
      failures: [{
        containerId: container.nodeId,
        failingNodeId: container.nodeId,
        code: 'NO_SIM',
        Δx: 0, Δy: 0, Δw: 0, Δh: 0,
      }],
    };
  }

  for (const [child, got] of sim.entries()) {
    const expect = oracleRel(child, container);
    if (!expect) continue;
    // Bullet separators / tiny ellipses — flex align-items:center shifts them a few px;
    // never demote a whole meta row for a decorative dot.
    if (isDecorativeDot(child)) continue;
    const isText = !!(child.text != null || child.runs);
    const dx = got.x - expect.x;
    const dy = got.y - expect.y;
    const dw = got.w - expect.w;
    const dh = got.h - expect.h;
    const isGrid = container.decls.get('display') === 'grid';

    const xOk = posPass(dx);
    const yOk = posPass(dy);
    const wOk = isGrid
      ? Math.abs(dw) <= Math.max(cfg.SIZE_TOL_PX, expect.w * 0.08)
      : sizePass(dw, expect.w, false);
    const hOk = sizePass(dh, expect.h, isText);

    if (isGrid) {
      if (!yOk || !wOk) {
        failures.push({
          containerId: container.nodeId,
          failingNodeId: child.nodeId,
          Δx: dx, Δy: dy, Δw: dw, Δh: dh,
        });
      }
    } else if (isText) {
      if (!xOk || !yOk) {
        failures.push({
          containerId: container.nodeId,
          failingNodeId: child.nodeId,
          Δx: dx, Δy: dy, Δw: dw, Δh: dh,
        });
      }
    } else {
      // margin-top:auto media — Y is content-driven; only pin X/W/H
      const mtAuto = String(child.decls.get('margin-top') || '') === 'auto'
        || /\bet-card__media\b/.test(child.extraClass || '');
      if (mtAuto) {
        if (!xOk || !wOk || !hOk) {
          failures.push({
            containerId: container.nodeId,
            failingNodeId: child.nodeId,
            Δx: dx, Δy: dy, Δw: dw, Δh: dh,
          });
        }
      } else if (!xOk || !yOk || !wOk || !hOk) {
        failures.push({
          containerId: container.nodeId,
          failingNodeId: child.nodeId,
          Δx: dx, Δy: dy, Δw: dw, Δh: dh,
        });
      }
    }
  }

  return { pass: failures.length === 0, failures };
}

// Utility classes the transcriber (or legacy heuristics) may have already put on
// a node BEFORE it failed verification. Each carries !important display/position/
// flex rules in the shared stylesheet (see figma-build.js standards CSS), so they
// silently override whatever demoteToAbsolute writes into the node's OWN decls —
// the container renders as flex regardless of what we just deleted. This is the
// root cause of the Challenge Arena row bug: a demoted row kept `et-flow-row`
// (display:flex !important) and rendered flex with one raw-absolute leftover
// child on top of it. Strip them here, mirroring the same discipline already
// used by applyOverlayAbsolute() elsewhere in transcribe.js.
const LAYOUT_FORCING_CLASSES = new Set(['et-flow-row', 'et-flow-col', 'et-flow-stack', 'et-card-grid', 'et-measured-grid']);
function stripLayoutForcingClasses(el) {
  if (!el || !el.extraClass) return;
  el.extraClass = String(el.extraClass).split(/\s+/).filter((c) => c && !LAYOUT_FORCING_CLASSES.has(c)).join(' ');
}

function demoteToAbsolute(el) {
  if (!el || !el.box) return;
  (el.children || []).forEach((c) => {
    if (!c || !c.box || !c.decls) return;
    if (c._constraintChromeHidden) return;
    const left = c.box.x - el.box.x;
    const top = c.box.y - el.box.y;
    c.decls.set('position', 'absolute');
    c.decls.set('left', `${Math.round(left * 100) / 100}px`);
    c.decls.set('top', `${Math.round(top * 100) / 100}px`);
    if (c.box.width) c.decls.set('width', `${Math.round(c.box.width * 100) / 100}px`);
    if (c.box.height) c.decls.set('height', `${Math.round(c.box.height * 100) / 100}px`);
    c.decls.delete('flex');
    c.decls.delete('margin-top');
    c.decls.delete('margin-left');
    stripLayoutForcingClasses(c);
    // Propagate the demoted flag to each repositioned child too — every guard
    // added against this bug class (forceContentFlexStacks, inferFlow, etc.)
    // checks `_constraintDemoted` on the node it's about to modify, not just on
    // an ancestor. Without this, a demoted row's now-absolute children (e.g. a
    // reward/xp label+value sub-stack) were still fair game for any heuristic
    // that recurses per-node, re-flexing them individually right after this
    // function correctly positioned them.
    c._constraintDemoted = true;
  });
  el.decls.delete('display');
  el.decls.delete('flex-direction');
  el.decls.delete('grid-template-columns');
  el.decls.delete('gap');
  el.decls.delete('padding');
  el.decls.set('position', 'relative');
  stripLayoutForcingClasses(el);
  el._constraintDemoted = true;
  // Keep region stamps (_etCard / _etBanner / _etCardGrid) so scorecard + heuristic skips stay stable
}

function verifyAndDemote(root) {
  const demoted = [];
  const reasons = [];

  function visit(el) {
    if (!el) return;
    (el.children || []).forEach(visit);
    if (!el._constraintTranscribed) return;
    // Soft-locked regions (title+CTA row, card footers) — keep flex even if
    // the box simulator cannot reproduce space-between / border-top chrome.
    if (el._constraintSoft
      || el._synthetic
      || /\bet-title-link-row\b/.test(el.extraClass || '')
      || /\bet-card__footer\b/.test(el.extraClass || '')) {
      el._constraintVerified = true;
      return;
    }

    const result = verifyContainer(el);
    if (result.pass) {
      el._constraintVerified = true;
      return;
    }
    demoteToAbsolute(el);
    el._constraintTranscribed = false;
    el._constraintVerified = false;
    el._demoteReason = result.failures[0] || { containerId: el.nodeId, code: 'BOX_DIFF' };
    demoted.push(el.nodeId);
    reasons.push(el._demoteReason);
  }

  visit(root);
  return { demoted: demoted.length, reasons };
}

module.exports = {
  verifyContainer,
  verifyAndDemote,
  simulateLayout,
};
