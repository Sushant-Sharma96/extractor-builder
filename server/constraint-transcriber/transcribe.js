'use strict';
/**
 * Constraint transcriber A0–A5 — derive flex/grid from measured oracle boxes.
 * @see docs/CONSTRAINT_TRANSCRIBER_SPEC.md §A
 */

const cfg = require('./config');
const {
  px, absBox, relBox, area, overlapArea, sizesEqual, median,
  isVisible, isFullBleedBg, isStepOverlay, isDecorativeDot, hasText, mergeClass,
} = require('./geometry');

function snapshotOracle(el, parent) {
  const r = parent ? relBox(el, parent) : absBox(el);
  if (r) el._oracleBox = { ...r };
  return r;
}

function clearAbsPlace(el) {
  if (!el || !el.decls) return;
  el.decls.delete('left');
  el.decls.delete('top');
  if (el.decls.get('position') === 'absolute') el.decls.delete('position');
}

function pinSize(el, axis) {
  const b = absBox(el);
  if (!b || !el.decls) return;
  if (axis === 'w' || axis === 'both') {
    el.decls.set('width', px(b.w));
    el.decls.set('max-width', px(b.w));
    el.decls.set('flex', `0 0 ${px(b.w)}`);
  }
  if (axis === 'h' || axis === 'both') {
    el.decls.set('height', px(b.h));
    el.decls.set('max-height', px(b.h));
  }
}

/** A0 — filter + sort layout-bearing children. */
function layoutChildren(container) {
  const kids = (container.children || []).filter(isVisible);
  const chrome = kids.filter((c) => isFullBleedBg(c, container));
  const overlays = kids.filter((c) => !chrome.includes(c) && (isStepOverlay(c, container) || isDecorativeDot(c)));
  const flow = kids.filter((c) => !chrome.includes(c) && !overlays.includes(c));
  flow.sort((a, b) => {
    const aa = absBox(a);
    const bb = absBox(b);
    if (Math.abs(aa.y - bb.y) > cfg.ALIGN_TOL) return aa.y - bb.y;
    return aa.x - bb.x;
  });
  return { chrome, overlays, flow };
}

/** A1 — content overlap → absolute. */
function hasBlockingOverlap(flow, container) {
  for (let i = 0; i < flow.length; i++) {
    for (let j = i + 1; j < flow.length; j++) {
      const a = absBox(flow[i]);
      const b = absBox(flow[j]);
      if (!a || !b) continue;
      const o = overlapArea(a, b);
      if (o <= 0) continue;
      const smaller = Math.min(area(a), area(b));
      if (smaller > 0 && o / smaller > cfg.OVERLAP_TOL) return true;
    }
  }
  return false;
}

function gapsAlong(flow, axis) {
  const gaps = [];
  for (let i = 1; i < flow.length; i++) {
    const prev = absBox(flow[i - 1]);
    const next = absBox(flow[i]);
    if (axis === 'x') gaps.push(next.x - (prev.x + prev.w));
    else gaps.push(next.y - (prev.y + prev.h));
  }
  return gaps;
}

function edgesAligned(flow, edge) {
  if (flow.length < 2) return true;
  const vals = flow.map((c) => {
    const b = absBox(c);
    if (edge === 'top') return b.y;
    if (edge === 'left') return b.x;
    if (edge === 'bottom') return b.y + b.h;
    if (edge === 'right') return b.x + b.w;
    if (edge === 'centerX') return b.x + b.w / 2;
    if (edge === 'centerY') return b.y + b.h / 2;
    return b.y;
  });
  return Math.max(...vals) - Math.min(...vals) <= cfg.ALIGN_TOL;
}

/** A2 — axis detection. */
function detectAxis(flow) {
  if (flow.length < 2) return { kind: 'ABSOLUTE' };
  const byX = [...flow].sort((a, b) => absBox(a).x - absBox(b).x);
  const byY = [...flow].sort((a, b) => absBox(a).y - absBox(b).y);

  const topsOk = edgesAligned(flow, 'top');
  const leftsOk = edgesAligned(flow, 'left');
  // Soft column: Figma often drifts media 2–4px vs text (IBM images at x+3)
  const lefts = flow.map((c) => absBox(c).x);
  const leftSpan = Math.max(...lefts) - Math.min(...lefts);
  const softColumn = leftSpan <= Math.max(cfg.ALIGN_TOL * 2, 6);

  // Single-row equal cards: tops aligned, L→R
  if (topsOk && flow.length >= 2) {
    const ws = byX.map((c) => absBox(c).w);
    const equal = ws.every((w) => sizesEqual(w, ws[0]));
    if (equal && flow.length >= 3) {
      return { kind: 'GRID', cols: flow.length, rows: 1, ordered: byX };
    }
    return { kind: 'ROW', ordered: byX };
  }
  if (leftsOk || softColumn) {
    return { kind: 'COLUMN', ordered: byY };
  }
  // Loose row: vertical centers within larger band (banner icon/quote/robot)
  const cy = flow.map((c) => {
    const b = absBox(c);
    return b.y + b.h / 2;
  });
  if (Math.max(...cy) - Math.min(...cy) <= 48) {
    return { kind: 'ROW', ordered: byX };
  }
  return { kind: 'ABSOLUTE' };
}

/** A3 — padding from content inset. */
function measurePadding(container, flow) {
  const p = absBox(container);
  const xs = flow.map((c) => absBox(c).x);
  const ys = flow.map((c) => absBox(c).y);
  const rights = flow.map((c) => absBox(c).x + absBox(c).w);
  const bottoms = flow.map((c) => absBox(c).y + absBox(c).h);
  return {
    top: Math.max(0, Math.min(...ys) - p.y),
    left: Math.max(0, Math.min(...xs) - p.x),
    right: Math.max(0, (p.x + p.w) - Math.max(...rights)),
    bottom: Math.max(0, (p.y + p.h) - Math.max(...bottoms)),
  };
}

function applyGapOrMargins(ordered, axis) {
  const gaps = gapsAlong(ordered, axis);
  if (!gaps.length) return { mode: 'none' };
  const span = Math.max(...gaps) - Math.min(...gaps);
  if (span <= cfg.GAP_TOL) {
    return { mode: 'gap', gap: Math.max(0, median(gaps)) };
  }
  return { mode: 'margins', gaps: gaps.map((g) => Math.max(0, g)) };
}

function crossAlign(ordered, axis) {
  if (axis === 'row') {
    if (edgesAligned(ordered, 'top')) return 'flex-start';
    if (edgesAligned(ordered, 'centerY')) return 'center';
    if (edgesAligned(ordered, 'bottom')) return 'flex-end';
    return 'center';
  }
  if (edgesAligned(ordered, 'left')) return 'flex-start';
  if (edgesAligned(ordered, 'centerX')) return 'center';
  if (edgesAligned(ordered, 'right')) return 'flex-end';
  return 'flex-start';
}

function applyOverlayAbsolute(overlay, container) {
  const r = relBox(overlay, container);
  if (!r || !overlay.decls) return;
  const p = absBox(container);
  overlay.decls.set('position', 'absolute');
  overlay.decls.set('top', px(r.y));
  overlay.decls.set('right', px(Math.max(0, p.w - (r.x + r.w))));
  overlay.decls.delete('left');
  overlay.decls.delete('margin-top');
  overlay.extraClass = mergeClass(overlay.extraClass, 'et-card__badge et-badge et-hug');
  overlay._oracleBox = { ...r };
}

/**
 * Collect banner visual leaves: icon cluster, quote text, media — L→R by x.
 */
function collectBannerLeaves(banner) {
  const leaves = [];
  function visit(n, depth) {
    if (!n || !isVisible(n) || depth > 5) return;
    if (isFullBleedBg(n, banner)) return;
    if (n.kind === 'img' && absBox(n).w > 50) {
      leaves.push(n);
      return;
    }
    if ((n.text != null || n.runs) && absBox(n).w > 80) {
      leaves.push(n);
      return;
    }
    // Icon cluster: circle + glyph
    const kids = (n.children || []).filter(isVisible);
    const hasCircle = kids.some((c) => {
      const br = c.decls && c.decls.get('border-radius');
      return br === '50%' || /ellipse/i.test(c.name || '');
    });
    if (hasCircle && absBox(n).w <= 80 && absBox(n).h <= 80) {
      leaves.push(n);
      return;
    }
    kids.forEach((c) => visit(c, depth + 1));
  }
  (banner.children || []).forEach((c) => visit(c, 0));
  // de-dupe
  const seen = new Set();
  const uniq = [];
  for (const n of leaves) {
    const id = n.nodeId || n;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(n);
  }
  uniq.sort((a, b) => absBox(a).x - absBox(b).x);
  return uniq;
}

function applyFlexContainer(el, { direction, align, pad, gapInfo, wrap }) {
  if (!el.decls) el.decls = new Map();
  el.decls.set('display', direction === 'grid' ? 'grid' : 'flex');
  if (direction === 'grid') {
    // set by caller
  } else {
    el.decls.set('flex-direction', direction);
    el.decls.set('align-items', align || 'flex-start');
    if (wrap) el.decls.set('flex-wrap', wrap);
    else el.decls.set('flex-wrap', 'nowrap');
  }
  el.decls.set('box-sizing', 'border-box');
  el.decls.set('position', 'relative');
  el.decls.delete('left');
  el.decls.delete('top');
  if (pad) {
    el.decls.set('padding', `${px(pad.top)} ${px(pad.right)} ${px(pad.bottom)} ${px(pad.left)}`);
  }
  if (gapInfo && gapInfo.mode === 'gap') {
    el.decls.set('gap', px(gapInfo.gap));
  } else {
    el.decls.delete('gap');
  }
  el._standardsFlow = true;
  el._constraintTranscribed = true;
}

function placeFlowChildren(ordered, gapInfo, mainAxis, container, pad) {
  const p = absBox(container);
  ordered.forEach((c, i) => {
    clearAbsPlace(c);
    c.decls.delete('margin-top');
    c.decls.delete('margin-left');
    if (gapInfo.mode === 'margins' && i > 0) {
      const g = gapInfo.gaps[i - 1];
      if (g >= 0.5) {
        if (mainAxis === 'y') c.decls.set('margin-top', px(g));
        else c.decls.set('margin-left', px(g));
      }
    }
    // Cross-axis drift vs padding (IBM media x+3 vs text)
    if (pad && mainAxis === 'y') {
      const relX = absBox(c).x - p.x;
      const ml = Math.max(0, relX - pad.left);
      if (ml >= 0.5) c.decls.set('margin-left', px(ml));
    }
    // Synthetic / full-bleed rows must stretch with the content column
    if (c._synthetic || /\bet-title-link-row\b/.test(c.extraClass || '')) {
      c.decls.set('width', '100%');
      c.decls.set('max-width', '100%');
      c.decls.set('flex', '0 0 auto');
      c.decls.delete('height');
      c.decls.delete('max-height');
      c.decls.delete('margin-left');
      return;
    }
    const b = absBox(c);
    if (mainAxis === 'x') {
      c.decls.set('width', px(b.w));
      c.decls.set('flex', `0 0 ${px(b.w)}`);
      c.decls.set('max-width', px(b.w));
      if (!(c.text != null || c.runs)) {
        c.decls.set('height', px(b.h));
        c.decls.set('max-height', px(b.h));
      }
    } else {
      c.decls.set('width', px(b.w));
      c.decls.set('max-width', px(b.w));
      if (!(c.text != null || c.runs)) {
        c.decls.set('height', px(b.h));
        c.decls.set('max-height', px(b.h));
      }
      c.decls.set('flex', '0 0 auto');
    }
  });
}

/**
 * Transcribe one container's interior (A0–A4). Returns false → leave absolute.
 */
function transcribeContainer(container, opts = {}) {
  if (!container || !container.box || !container.decls) return false;
  if (container._sourceAutoLayout) return false; // figmaAL → never infer

  const { chrome, overlays, flow } = layoutChildren(container);
  if (flow.length < 1) return false;
  if (hasBlockingOverlap(flow, container)) return false;

  const axis = detectAxis(flow);
  if (axis.kind === 'ABSOLUTE') return false;

  const ordered = axis.ordered;
  const pad = measurePadding(container, ordered);
  const mainAxis = axis.kind === 'COLUMN' ? 'y' : 'x';
  const gapInfo = applyGapOrMargins(ordered, mainAxis);
  const align = crossAlign(ordered, axis.kind === 'COLUMN' ? 'column' : 'row');

  // Hide chrome vectors that duplicate frame fill (lift fill already on frame)
  chrome.forEach((c) => {
    if (c.decls) {
      c.decls.set('display', 'none');
      c._constraintChromeHidden = true;
    }
  });

  overlays.forEach((o) => applyOverlayAbsolute(o, container));

  if (axis.kind === 'GRID' || (opts.forceGrid && ordered.length >= 2)) {
    const cols = axis.cols || ordered.length;
    const gapX = applyGapOrMargins(ordered, 'x');
    applyFlexContainer(container, {
      direction: 'grid',
      align: 'stretch',
      pad,
      gapInfo: gapX,
    });
    container.decls.set('display', 'grid');
    container.decls.set('grid-template-columns', `repeat(${cols}, 1fr)`);
    container.decls.set('align-items', 'stretch');
    if (gapX.mode === 'gap') container.decls.set('gap', px(gapX.gap));
    container.decls.delete('flex-direction');
    ordered.forEach((c) => {
      clearAbsPlace(c);
      const b = absBox(c);
      c.decls.set('width', '100%');
      c.decls.set('max-width', '100%');
      c.decls.set('min-height', px(b.h));
      c.decls.delete('flex');
      c.decls.delete('height'); // content-driven unless pinned interior
    });
  } else if (axis.kind === 'ROW') {
    applyFlexContainer(container, {
      direction: 'row',
      align,
      pad,
      gapInfo,
    });
    placeFlowChildren(ordered, gapInfo, 'x', container, pad);
    // Flexible middle: widest text child spanning remainder
    const textKids = ordered.filter((c) => c.text != null || c.runs || hasText(c));
    if (textKids.length === 1 && ordered.length >= 3) {
      const q = textKids[0];
      const b = absBox(q);
      q.decls.set('flex', `1 1 ${px(b.w)}`);
      q.decls.set('min-width', '0');
      q.decls.set('max-width', px(b.w));
      q.decls.delete('width');
    } else if (opts.bannerQuote) {
      ordered.forEach((c) => {
        if (c.text != null || c.runs) {
          const b = absBox(c);
          c.decls.set('flex', `1 1 ${px(b.w)}`);
          c.decls.set('max-width', px(b.w));
          c.decls.set('min-width', '0');
          c.decls.delete('width');
          c.extraClass = mergeClass(c.extraClass, 'et-banner__quote');
        } else if (c.kind === 'img') {
          c.extraClass = mergeClass(c.extraClass, 'et-banner__media');
          c.decls.set('margin-left', 'auto');
          c.decls.set('align-self', 'flex-end');
        } else {
          c.extraClass = mergeClass(c.extraClass, 'et-banner__icon');
        }
      });
    }
  } else {
    // COLUMN
    applyFlexContainer(container, {
      direction: 'column',
      align,
      pad,
      gapInfo,
    });
    placeFlowChildren(ordered, gapInfo, 'y', container, pad);
  }

  // Rebuild children order: flow first, then overlays, chrome last (hidden)
  const flowIds = new Set(ordered.map((c) => c.nodeId || c));
  const rest = (container.children || []).filter((c) => c && !flowIds.has(c.nodeId || c)
    && !overlays.includes(c) && !chrome.includes(c));
  container.children = [...ordered, ...overlays, ...chrome, ...rest];

  // Snapshot oracle parent-relative for verifier
  ordered.forEach((c) => {
    snapshotOracle(c, container);
  });
  overlays.forEach((c) => snapshotOracle(c, container));
  snapshotOracle(container, opts.parent || null);

  return true;
}

/**
 * Transcribe a card frame: keep chrome, flatten one content wrapper, measured column.
 */
function transcribeCard(card) {
  if (!card || !card.decls) return false;
  card.decls.set('position', 'relative');
  card.decls.set('overflow', 'hidden');
  card.decls.set('box-sizing', 'border-box');
  card.decls.delete('left');
  card.decls.delete('top');
  const b = absBox(card);
  card.decls.set('width', '100%');
  card.decls.set('max-width', '100%');
  card.decls.set('min-height', px(b.h));
  card.decls.set('--et-card-min-h', px(b.h));
  card.decls.delete('height');
  card._etCard = true;
  card.extraClass = mergeClass(card.extraClass, 'et-card et-flow-col');

  // A4 flatten: single non-media content group → lift its children into the card
  const visible = (card.children || []).filter(isVisible);
  const media = visible.filter((c) => {
    const r = relBox(c, card);
    return c.kind === 'img' || (r && r.y > b.h * 0.5 && absBox(c).w >= b.w * 0.5);
  });
  const nonMedia = visible.filter((c) => !media.includes(c) && !isStepOverlay(c, card) && !isFullBleedBg(c, card));
  if (nonMedia.length === 1 && (nonMedia[0].children || []).filter(isVisible).length >= 2) {
    const wrap = nonMedia[0];
    const inner = (wrap.children || []).filter(isVisible);
    const steps = visible.filter((c) => isStepOverlay(c, card));
    const other = (card.children || []).filter((c) => (
      c && c !== wrap && !inner.includes(c) && !media.includes(c) && !steps.includes(c)
    ));
    card.children = [...inner, ...media, ...steps, ...other];
  }

  const ok = transcribeContainer(card, {});
  if (!ok) return false;

  (card.children || []).forEach((c) => {
    if (c.kind === 'img' || (c.extraClass && /\bet-card__media\b/.test(c.extraClass))) {
      const r = relBox(c, card);
      if (r && r.y > b.h * 0.45) {
        c.extraClass = mergeClass(c.extraClass, 'et-card__media');
        // Measured height; width fills content box; margin-top:auto via CSS for baseline align
        c.decls.set('object-fit', 'cover');
        c.decls.set('width', '100%');
        c.decls.set('max-width', '100%');
        c.decls.set('height', px(absBox(c).h));
        c.decls.set('--et-media-h', px(absBox(c).h));
        c.decls.set('margin-top', 'auto');
        c.decls.set('align-self', 'stretch');
        c.decls.delete('margin-left'); // horizontal inset comes from card padding
        clearAbsPlace(c);
      }
    } else if ((c.kind === 'svg' || c.kind === 'img') && absBox(c) && absBox(c).w <= 64 && absBox(c).h <= 64) {
      c.extraClass = mergeClass(c.extraClass, 'et-card__icon');
      const ib = absBox(c);
      c.decls.set('width', px(ib.w));
      c.decls.set('height', px(ib.h));
      c.decls.set('--et-icon-w', px(ib.w));
      c.decls.set('--et-icon-h', px(ib.h));
      c.decls.set('max-width', px(ib.w));
      c.decls.set('max-height', px(ib.h));
      c.decls.set('flex', '0 0 auto');
      clearAbsPlace(c);
    } else if (c.text != null || c.runs) {
      if (!isStepOverlay(c, card)) {
        const label = String(c.text || c.name || '');
        if (/^STEP[_\s-]?\d+/i.test(label)) {
          /* badge handled as overlay */
        } else if (!c.extraClass || !/\bet-card__/.test(c.extraClass)) {
          // title vs body: first text after icon ≈ title
          const flowText = (card.children || []).filter((x) => x && (x.text != null || x.runs) && !isStepOverlay(x, card));
          if (flowText[0] === c) c.extraClass = mergeClass(c.extraClass, 'et-card__title');
          else c.extraClass = mergeClass(c.extraClass, 'et-card__body');
        }
      }
    }
  });

  card._constraintTranscribed = true;
  return true;
}

function transcribeCardGrid(gridInfo) {
  const { container, cards } = gridInfo;
  if (!container || !cards || cards.length < 2) return false;

  // Lift any absolute on grid
  clearAbsPlace(container);
  const pad = measurePadding(container, cards);
  const gapInfo = applyGapOrMargins(cards, 'x');

  applyFlexContainer(container, {
    direction: 'grid',
    align: 'stretch',
    pad: { top: 0, left: 0, right: 0, bottom: 0 },
    gapInfo,
  });
  container.decls.set('display', 'grid');
  container.decls.set('grid-template-columns', `repeat(${cards.length}, 1fr)`);
  container.decls.set('width', '100%');
  container.decls.set('max-width', '100%');
  container.decls.delete('height');
  if (gapInfo.mode === 'gap') container.decls.set('gap', px(gapInfo.gap));
  container._etCardGrid = true;
  container.extraClass = mergeClass(container.extraClass, 'et-card-grid et-measured-grid et-flow-row');

  let allOk = true;
  cards.forEach((card) => {
    if (!transcribeCard(card)) allOk = false;
    else card.extraClass = mergeClass(card.extraClass, 'et-measured-card');
  });

  container.children = [
    ...cards,
    ...(container.children || []).filter((c) => c && !cards.includes(c)),
  ];
  cards.forEach((c) => snapshotOracle(c, container));
  container._constraintTranscribed = allOk;
  return allOk;
}

function liftBannerFill(banner) {
  const { chrome } = layoutChildren(banner);
  for (const c of chrome) {
    for (const key of [
      'background-color', 'background-image', 'background-size',
      'background-position', 'background-repeat', 'border-radius',
    ]) {
      if (c.decls && c.decls.has(key) && !banner.decls.has(key)) {
        banner.decls.set(key, c.decls.get(key));
      }
    }
    if (c.decls) {
      c.decls.set('display', 'none');
      c._constraintChromeHidden = true;
    }
  }
}

/**
 * Promote nested rows/columns under an image-top card (meta row, footer).
 * Native AL → keep flex, clear abs children. Else measured row/column.
 */
function ensureNativeAlFlex(el) {
  if (!el || !el._sourceAutoLayout || !el.decls) return false;
  const mode = String(el.layoutMode || el._layoutMode || '').toUpperCase();
  const b = absBox(el);
  // Figma HORIZONTAL; if layoutMode missing, short wide frames are rows
  const asRow = mode === 'HORIZONTAL' || (!mode && b && b.w >= b.h * 2);
  el.decls.set('display', 'flex');
  el.decls.set('flex-direction', asRow ? 'row' : (mode === 'VERTICAL' ? 'column' : 'row'));
  el.decls.set('align-items', 'center');
  el.decls.set('position', 'relative');
  el.decls.set('box-sizing', 'border-box');
  el.decls.delete('text-align');
  clearAbsPlace(el);
  (el.children || []).filter(isVisible).forEach((c) => {
    if (!c.decls) return;
    clearAbsPlace(c);
    c.decls.set('position', 'relative');
    c.decls.delete('left');
    c.decls.delete('top');
    c.decls.delete('text-align');
    if (isDecorativeDot(c)) {
      const db = absBox(c);
      c.decls.set('flex', '0 0 auto');
      if (db) {
        c.decls.set('width', px(db.w));
        c.decls.set('height', px(db.h));
        c.decls.set('border-radius', '50%');
      }
    }
  });
  el._standardsFlow = true;
  el._constraintTranscribed = true;
  el._constraintVerified = true;
  el.extraClass = mergeClass(el.extraClass, asRow ? 'et-flow-row' : 'et-flow-stack');
  // Strip mistaken section-header stamps
  if (el.extraClass) {
    el.extraClass = String(el.extraClass).split(/\s+/)
      .filter((c) => c && c !== 'et-section-header' && c !== 'et-flow-col')
      .join(' ');
    el.extraClass = mergeClass(el.extraClass, asRow ? 'et-flow-row' : 'et-flow-stack');
  }
  return true;
}

function promoteFlowSubtree(el) {
  if (!el || !el.decls) return;
  if (ensureNativeAlFlex(el)) {
    (el.children || []).forEach(promoteFlowSubtree);
    return;
  }
  const kids = (el.children || []).filter(isVisible);
  if (kids.length >= 2) {
    const ok = transcribeContainer(el, {});
    if (ok) {
      el._standardsFlow = true;
      (el.children || []).forEach((c) => {
        if (!isDecorativeDot(c) || !c.decls) return;
        clearAbsPlace(c);
        const b = absBox(c);
        c.decls.set('position', 'relative');
        c.decls.set('flex', '0 0 auto');
        if (b) {
          c.decls.set('width', px(b.w));
          c.decls.set('height', px(b.h));
          c.decls.set('border-radius', '50%');
        }
      });
    }
  }
  (el.children || []).forEach(promoteFlowSubtree);
}

/**
 * Card footer: hairline + date row + circular arrow CTA.
 * Line → border-top; date left; button right (space-between).
 */
function transcribeCardFooter(footer) {
  if (!footer || !footer.decls || !footer.box) return false;
  const kids = (footer.children || []).filter(isVisible);
  if (kids.length < 1) return false;

  const line = kids.find((c) => {
    const b = absBox(c);
    if (!b) return false;
    // Hairline may be stroke-only (h≈0), or named Line*
    return b.h <= 4
      || (b.w >= (absBox(footer)?.w || 0) * 0.7 && b.h <= 8)
      || /^line\b/i.test(String(c.name || ''))
      || c.type === 'LINE';
  });
  // Must have a hairline divider — otherwise this is meta/title content, not footer
  if (!line) return false;
  let cluster = kids.filter((c) => c !== line);
  // Unwrap single wrapper group (date + circle CTA share one parent)
  if (cluster.length === 1 && (cluster[0].children || []).filter(isVisible).length >= 2) {
    cluster = (cluster[0].children || []).filter(isVisible);
  }

  let cta = cluster.find((c) => {
    const b = absBox(c);
    if (!b || b.w > 56 || b.h > 56) return false;
    return /ellipse/i.test(String(c.name || ''))
      || (c.children || []).some((x) => /ellipse|arrow/i.test(String(x.name || '')));
  });
  if (!cta) {
    cta = cluster.find((c) => {
      const b = absBox(c);
      return b && b.w <= 56 && b.h <= 56 && /ellipse/i.test(String(c.name || ''));
    });
  }
  const arrow = cluster.find((c) => c !== cta && (
    /arrow/i.test(String(c.name || '')) || c.kind === 'svg'
  ));
  const dateRow = cluster.find((c) => c !== cta && c !== arrow && (
    hasText(c) || (c.children || []).some((x) => hasText(x) || x.kind === 'svg')
  ));
  if (!dateRow && !cta) return false;

  // Merge arrow into circle button if both exist
  if (cta && arrow && arrow !== cta) {
    if (!arrow.decls) arrow.decls = new Map();
    clearAbsPlace(arrow);
    arrow.decls.set('position', 'absolute');
    arrow.decls.set('left', '50%');
    arrow.decls.set('top', '50%');
    arrow.decls.set('transform', 'translate(-50%, -50%)');
    if (!cta.children) cta.children = [];
    if (!cta.children.includes(arrow)) cta.children.push(arrow);
  }

  clearAbsPlace(footer);
  footer.decls.set('display', 'flex');
  footer.decls.set('flex-direction', 'row');
  footer.decls.set('align-items', 'center');
  footer.decls.set('justify-content', 'space-between');
  footer.decls.set('width', '100%');
  footer.decls.set('max-width', '100%');
  footer.decls.set('position', 'relative');
  footer.decls.set('box-sizing', 'border-box');
  footer.decls.set('border-top', '1px solid #e0e0e0');
  footer.decls.delete('height');
  footer.decls.delete('padding');
  footer.decls.delete('padding-left');
  footer.decls.delete('padding-right');
  footer.decls.delete('padding-bottom');
  footer.decls.set('padding-top', '16px');
  if (footer.extraClass) {
    footer.extraClass = String(footer.extraClass)
      .split(/\s+/)
      .filter((c) => c && c !== 'et-flow-stack')
      .join(' ');
  }
  footer.extraClass = mergeClass(footer.extraClass, 'et-card__footer et-measured-flow et-flow-row');

  if (line) {
    if (!line.decls) line.decls = new Map();
    line.decls.set('display', 'none');
    line._constraintChromeHidden = true;
  }

  if (dateRow) {
    if (!dateRow.decls) dateRow.decls = new Map();
    clearAbsPlace(dateRow);
    dateRow.decls.set('position', 'relative');
    dateRow.decls.set('flex', '1 1 auto');
    dateRow.decls.set('min-width', '0');
    dateRow.decls.delete('left');
    dateRow.decls.delete('top');
    dateRow.extraClass = mergeClass(dateRow.extraClass, 'et-card__footer-date');
    promoteFlowSubtree(dateRow);
  }
  if (cta) {
    if (!cta.decls) cta.decls = new Map();
    clearAbsPlace(cta);
    const cb = absBox(cta);
    cta.decls.set('position', 'relative');
    cta.decls.set('flex', '0 0 auto');
    cta.decls.set('margin-left', 'auto');
    cta.decls.set('overflow', 'hidden');
    if (cb) {
      cta.decls.set('width', px(cb.w));
      cta.decls.set('height', px(cb.h));
      cta.decls.set('border-radius', '50%');
    }
    cta.extraClass = mergeClass(cta.extraClass, 'et-card__footer-cta');
    // Do NOT stamp et-hug — fit-content collapses when kids are position:absolute
    if (cta.extraClass) {
      cta.extraClass = String(cta.extraClass)
        .split(/\s+/)
        .filter((c) => c && c !== 'et-hug' && c !== 'et-badge')
        .join(' ');
      cta.extraClass = mergeClass(cta.extraClass, 'et-card__footer-cta');
    }
    (cta.children || []).forEach((ch) => {
      if (!ch.decls) ch.decls = new Map();
      if (/ellipse/i.test(String(ch.name || '')) || ch.decls.get('border-radius') === '50%') {
        ch.decls.set('position', 'absolute');
        ch.decls.set('inset', '0');
        ch.decls.set('width', '100%');
        ch.decls.set('height', '100%');
        ch.decls.set('border-radius', '50%');
        ch.decls.delete('left');
        ch.decls.delete('top');
      } else if (ch.kind === 'svg' || /arrow/i.test(String(ch.name || ''))) {
        clearAbsPlace(ch);
        ch.decls.set('position', 'absolute');
        ch.decls.set('left', '50%');
        ch.decls.set('top', '50%');
        ch.decls.set('transform', 'translate(-50%, -50%)');
      }
    });
  }

  // Rebuild row: date | CTA. Drop empty wrapper + hide line via border-top.
  footer.children = [dateRow, cta, line].filter(Boolean);
  footer._constraintTranscribed = true;
  footer._constraintVerified = true;
  footer._standardsFlow = true;
  return true;
}

/**
 * Image-top article card (Figma Group 15 pattern):
 *   photo (in-flow top) → content below → category pill absolute on photo only.
 * Fixes the failure mode where the photo stays position:absolute and text paints over it.
 */
function transcribeImageTopCard(container) {
  if (!container || !container.box || !container.decls) return false;
  if (container._sourceAutoLayout || container._constraintTranscribed) return false;

  const kids = (container.children || []).filter(isVisible);
  if (kids.length < 2) return false;
  const p = absBox(container);
  if (!p || p.w < 120 || p.h < 160) return false;

  const media = kids.find((c) => {
    const b = absBox(c);
    if (!b) return false;
    const topAligned = Math.abs(b.y - p.y) <= cfg.ALIGN_TOL + 6;
    const wide = b.w >= p.w * 0.7;
    const tallEnough = b.h >= p.h * 0.35;
    if (!(topAligned && wide && tallEnough)) return false;
    return c.kind === 'img'
      || !!(c.decls && (c.decls.has('background-image') || c.decls.get('background-size')));
  });
  if (!media) return false;

  const mb = absBox(media);
  const mediaBottom = mb.y + mb.h;

  const overlays = [];
  const below = [];
  const chrome = [];
  kids.forEach((c) => {
    if (c === media) return;
    if (isFullBleedBg(c, container)) {
      chrome.push(c);
      return;
    }
    const b = absBox(c);
    if (!b) return;
    const centerY = b.y + b.h / 2;
    const o = overlapArea(b, mb);
    const smaller = Math.min(area(b), area(mb));
    const onPhoto = centerY < mediaBottom - 2 && smaller > 0 && o / smaller >= 0.25;
    if (onPhoto) overlays.push(c);
    else if (b.y >= mediaBottom - 16) below.push(c);
    else if (o / Math.max(smaller, 1) >= 0.35) overlays.push(c);
    else below.push(c);
  });
  if (!below.length) return false;

  below.sort((a, b) => absBox(a).y - absBox(b).y);
  const gapAfterMedia = Math.max(0, absBox(below[0]).y - mediaBottom);
  const gapsBelow = [];
  for (let i = 1; i < below.length; i++) {
    const prev = absBox(below[i - 1]);
    const next = absBox(below[i]);
    gapsBelow.push(Math.max(0, next.y - (prev.y + prev.h)));
  }

  clearAbsPlace(container);
  container.decls.set('display', 'flex');
  container.decls.set('flex-direction', 'column');
  container.decls.set('align-items', 'stretch');
  container.decls.set('flex-wrap', 'nowrap');
  container.decls.set('position', 'relative');
  container.decls.set('overflow', 'hidden');
  container.decls.set('box-sizing', 'border-box');
  container.decls.set('width', '100%');
  container.decls.set('max-width', '100%');
  container.decls.set('min-height', px(p.h));
  container.decls.set('--et-card-min-h', px(p.h));
  container.decls.delete('height');
  container.decls.delete('padding');
  container.decls.delete('gap');
  container._etCard = true;
  container._constraintImageTop = true;
  container._standardsFlow = true;
  container.extraClass = mergeClass(container.extraClass, 'et-card et-measured-card et-image-top-card');

  clearAbsPlace(media);
  media.decls.set('position', 'relative');
  media.decls.set('display', 'block');
  media.decls.set('width', '100%');
  media.decls.set('max-width', '100%');
  media.decls.set('height', px(mb.h));
  media.decls.set('--et-media-h', px(mb.h));
  media.decls.set('object-fit', 'cover');
  media.decls.set('flex', '0 0 auto');
  media.decls.set('align-self', 'stretch');
  media.decls.delete('margin-top');
  media.decls.delete('left');
  media.decls.delete('top');
  media.extraClass = mergeClass(media.extraClass, 'et-card__media et-card__media--top');
  snapshotOracle(media, container);

  overlays.forEach((o) => {
    const r = relBox(o, container);
    if (!r || !o.decls) return;
    clearAbsPlace(o);
    o.decls.set('position', 'absolute');
    o.decls.set('left', px(r.x));
    o.decls.set('top', px(r.y));
    o.decls.set('--et-badge-left', px(r.x));
    o.decls.set('--et-badge-top', px(r.y));
    o.decls.delete('right');
    o.decls.delete('margin-top');
    o.decls.delete('margin-left');
    // Category pills should hug, not stretch 100%
    const ob = absBox(o);
    if (ob && ob.w < p.w * 0.55) {
      o.decls.set('width', px(ob.w));
      o.decls.set('max-width', px(ob.w));
      o.extraClass = mergeClass(o.extraClass, 'et-card__badge et-badge et-hug');
    } else {
      o.decls.set('width', px(r.w));
      o.decls.set('max-width', px(r.w));
    }
    // Strip flow-stack so standards CSS cannot force relative + full width
    if (o.extraClass) {
      o.extraClass = String(o.extraClass).split(/\s+/).filter((c) => c && c !== 'et-flow-stack' && c !== 'et-flow-row').join(' ');
      o.extraClass = mergeClass(o.extraClass, 'et-card__badge et-badge et-hug');
    }
    o._oracleBox = { ...r };
    o._constraintOverlay = true;
  });

  below.forEach((c, i) => {
    clearAbsPlace(c);
    c.decls.set('position', 'relative');
    c.decls.set('width', '100%');
    c.decls.set('max-width', '100%');
    c.decls.set('align-self', 'stretch');
    c.decls.delete('left');
    c.decls.delete('top');
    c.decls.delete('height');
    c.decls.delete('padding');
    c.decls.delete('padding-left');
    c.decls.delete('margin-left');
    if (i === 0 && gapAfterMedia >= 0.5) c.decls.set('margin-top', px(gapAfterMedia));
    else if (i > 0 && gapsBelow[i - 1] >= 0.5) c.decls.set('margin-top', px(gapsBelow[i - 1]));
    else c.decls.delete('margin-top');
    snapshotOracle(c, container);
    if (transcribeCardFooter(c, container)) {
      // Equal-height cards: pin footer to bottom (Figma footer y is shared across cards)
      c.decls.set('margin-top', 'auto');
      return;
    }
    promoteFlowSubtree(c);
  });

  chrome.forEach((c) => {
    if (c.decls) {
      c.decls.set('display', 'none');
      c._constraintChromeHidden = true;
    }
  });

  container.children = [media, ...below, ...overlays, ...chrome];
  snapshotOracle(container, null);
  container._constraintTranscribed = true;
  return true;
}

/**
 * Image + overlapping content (rare full-bleed caption-on-image).
 * Prefer transcribeImageTopCard when content sits below the photo.
 */
function transcribeMediaOverlay(container) {
  if (!container || !container.box || !container.decls) return false;
  if (container._sourceAutoLayout || container._constraintTranscribed) return false;

  const kids = (container.children || []).filter(isVisible);
  if (kids.length < 2) return false;

  const p = absBox(container);
  if (!p) return false;

  const media = kids.filter((c) => {
    const b = absBox(c);
    if (!b) return false;
    if (c.kind === 'img') return b.w >= p.w * 0.55 && b.h >= p.h * 0.4;
    // Large rect fill acting as photo
    if (c.decls && (c.decls.has('background-image') || c.decls.has('background-color'))) {
      return b.w >= p.w * 0.85 && b.h >= p.h * 0.55
        && Math.abs(b.x - p.x) <= cfg.ALIGN_TOL + 4
        && Math.abs(b.y - p.y) <= cfg.ALIGN_TOL + 4;
    }
    return false;
  });
  if (media.length !== 1) return false;
  const base = media[0];
  const baseBox = absBox(base);

  const overlays = kids.filter((c) => {
    if (c === base) return false;
    if (isFullBleedBg(c, container)) return false;
    const b = absBox(c);
    if (!b) return false;
    const o = overlapArea(b, baseBox);
    const smaller = Math.min(area(b), area(baseBox));
    if (smaller <= 0) return false;
    // Must substantially overlap the media (classic caption-on-image)
    if (o / smaller < 0.35) return false;
    return hasText(c) || (c.children || []).some(hasText) || c.kind === 'el';
  });
  if (!overlays.length) return false;

  // Confirm blocking overlap would have forced ABSOLUTE under A1
  const flowProbe = kids.filter((c) => c !== base && !overlays.includes(c) && !isFullBleedBg(c, container));
  if (flowProbe.length) return false;

  clearAbsPlace(container);
  container.decls.set('position', 'relative');
  container.decls.set('overflow', 'hidden');
  container.decls.set('box-sizing', 'border-box');
  container.decls.set('width', px(p.w));
  container.decls.set('max-width', '100%');
  container.decls.set('min-height', px(p.h));
  container.decls.set('--et-card-min-h', px(p.h));
  container.decls.delete('height');
  container.decls.delete('display');
  container.decls.delete('flex-direction');
  container.decls.delete('gap');
  container._etCard = true;
  container._constraintMediaOverlay = true;
  container.extraClass = mergeClass(container.extraClass, 'et-card et-media-overlay et-measured-card');

  clearAbsPlace(base);
  base.decls.set('position', 'relative');
  base.decls.set('display', 'block');
  base.decls.set('width', '100%');
  base.decls.set('max-width', '100%');
  base.decls.set('height', px(baseBox.h));
  base.decls.set('object-fit', 'cover');
  base.extraClass = mergeClass(base.extraClass, 'et-card__media');
  snapshotOracle(base, container);

  overlays.forEach((o) => {
    const r = relBox(o, container);
    if (!r || !o.decls) return;
    o.decls.set('position', 'absolute');
    o.decls.set('left', px(r.x));
    o.decls.set('top', px(r.y));
    o.decls.set('width', px(r.w));
    o.decls.set('max-width', px(r.w));
    if (!(o.text != null || o.runs)) {
      o.decls.set('height', px(r.h));
    }
    o.decls.delete('margin-top');
    o.decls.delete('margin-left');
    o.extraClass = mergeClass(o.extraClass, 'et-card__overlay');
    o._oracleBox = { ...r };
    // Interior of overlay: try column flex if non-overlapping
    if ((o.children || []).filter(isVisible).length >= 2) {
      transcribeContainer(o, { parent: container });
    }
  });

  // Hide full-bleed chrome duplicates
  kids.filter((c) => isFullBleedBg(c, container) && c !== base).forEach((c) => {
    if (c.decls) {
      c.decls.set('display', 'none');
      c._constraintChromeHidden = true;
    }
  });

  container.children = [
    base,
    ...overlays,
    ...kids.filter((c) => c !== base && !overlays.includes(c)),
  ];
  snapshotOracle(container, null);
  container._constraintTranscribed = true;
  return true;
}

function transcribeBanner(banner) {
  if (!banner || !banner.decls) return false;
  liftBannerFill(banner);

  const leaves = collectBannerLeaves(banner);
  if (leaves.length < 2) return false;

  // Temporarily set children to leaves for measured transcription
  const original = banner.children;
  // Keep non-leaf nodes but we'll rebuild
  const pad = measurePadding(banner, leaves);
  const gapInfo = applyGapOrMargins(leaves, 'x');
  const align = 'center';

  applyFlexContainer(banner, {
    direction: 'row',
    align: 'flex-start', // per-item margin-top preserves measured Y (icon vs robot)
    pad,
    gapInfo,
  });
  banner.decls.set('justify-content', 'flex-start');
  banner.decls.set('width', '100%');
  banner.decls.set('max-width', '100%');
  banner.decls.delete('height');
  banner.decls.set('min-height', px(absBox(banner).h));
  banner._etBanner = true;
  banner.extraClass = mergeClass(banner.extraClass, 'et-banner et-measured-banner');

  const bAbs = absBox(banner);
  leaves.forEach((c, i) => {
    clearAbsPlace(c);
    const b = absBox(c);
    const relY = b.y - bAbs.y;
    const mt = Math.max(0, relY - pad.top);
    if (mt >= 0.5) c.decls.set('margin-top', px(mt));
    else c.decls.delete('margin-top');

    if (c.text != null || c.runs) {
      c.decls.set('flex', `1 1 ${px(b.w)}`);
      c.decls.set('min-width', '0');
      c.decls.set('max-width', px(b.w));
      c.decls.set('--et-banner-quote-max', px(b.w));
      if (mt >= 0.5) c.decls.set('--et-banner-quote-mt', px(mt));
      c.decls.delete('width');
      c.extraClass = mergeClass(c.extraClass, 'et-banner__quote');
    } else if (c.kind === 'img') {
      pinSize(c, 'both');
      c.extraClass = mergeClass(c.extraClass, 'et-banner__media');
      c.decls.set('--et-banner-media-w', px(b.w));
      c.decls.set('--et-banner-media-h', px(b.h));
      c.decls.set('align-self', 'flex-start');
      c.decls.set('object-fit', 'contain');
      if (mt >= 0.5) c.decls.set('--et-banner-media-mt', px(mt));
      // Do not margin-left:auto — measured gap to quote is exact (IBM 60px)
    } else {
      c.decls.set('position', 'relative');
      c.decls.set('flex', `0 0 ${px(b.w)}`);
      c.decls.set('width', px(b.w));
      c.decls.set('height', px(b.h));
      c.decls.set('--et-banner-icon-w', px(b.w));
      c.decls.set('--et-banner-icon-h', px(b.h));
      if (mt >= 0.5) c.decls.set('--et-banner-icon-mt', px(mt));
      c.extraClass = mergeClass(c.extraClass, 'et-banner__icon');
      (c.children || []).forEach((ch) => {
        if (!ch.decls) return;
        if (/ellipse/i.test(ch.name || '') || ch.decls.get('border-radius') === '50%') {
          ch.decls.set('position', 'absolute');
          ch.decls.set('inset', '0');
          ch.decls.set('width', '100%');
          ch.decls.set('height', '100%');
          ch.decls.delete('left');
          ch.decls.delete('top');
        } else if (ch.kind === 'img' || ch.kind === 'svg') {
          ch.decls.set('position', 'absolute');
          ch.decls.set('left', '50%');
          ch.decls.set('top', '50%');
          ch.decls.set('transform', 'translate(-50%, -50%)');
          const cb = absBox(ch);
          if (cb) {
            ch.decls.set('width', px(cb.w));
            ch.decls.set('height', px(cb.h));
          }
          ch.extraClass = mergeClass(ch.extraClass, 'et-banner__glyph');
        }
      });
    }
    if (gapInfo.mode === 'margins' && i > 0) {
      const g = gapInfo.gaps[i - 1];
      if (g >= 0.5) {
        c.decls.set('margin-left', px(g));
        if (/\bet-banner__media\b/.test(c.extraClass || '')) {
          c.decls.set('--et-banner-media-ml', px(g));
        }
      }
    }
    snapshotOracle(c, banner);
  });

  // Detach leaves from nested parents into banner children list
  function detach(n, target) {
    if (!n || !n.children) return;
    n.children = n.children.filter((c) => {
      if (leaves.includes(c)) return false;
      detach(c, target);
      return true;
    });
  }
  detach(banner, leaves);
  // Also walk original tree to remove leaves from mid parents
  function strip(n) {
    if (!n || !n.children) return;
    n.children = n.children.filter((c) => !leaves.includes(c));
    n.children.forEach(strip);
  }
  (original || []).forEach(strip);

  const hidden = (original || []).filter((c) => c && c._constraintChromeHidden);
  banner.children = [...leaves, ...hidden];
  banner._constraintTranscribed = true;
  return true;
}

module.exports = {
  transcribeContainer,
  transcribeCard,
  transcribeCardGrid,
  transcribeBanner,
  transcribeMediaOverlay,
  transcribeImageTopCard,
  promoteFlowSubtree,
  ensureNativeAlFlex,
  layoutChildren,
  detectAxis,
  collectBannerLeaves,
};
