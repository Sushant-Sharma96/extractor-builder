'use strict';

/**
 * Phase 1 vocabulary (docs/COMPILER_MIGRATION_BLUEPRINT.md) — the remaining
 * geometric heuristics ported read-only from server/figma-build.js and
 * server/constraint-transcriber/{transcribe,detect}.js's A0–A5 walk:
 *
 *   - evaluateGrid            — N×M grid of siblings (uniform row AND column
 *                                spacing), generalizing figma-build's single-row
 *                                inferCardGrids/constraint-transcriber's 1×N
 *                                GRID axis (transcribe.js detectAxis) to a real
 *                                2D layout.
 *   - evaluateSideBySideRow   — server/figma-build.js's inferSideBySideRows:
 *                                siblings that are roughly the same row by
 *                                Y-OVERLAP RATIO rather than pixel-perfect
 *                                top-edge alignment.
 *   - evaluateColumnFlex      — server/figma-build.js's evaluateColumnFlex:
 *                                scores a freeform cluster of children as N
 *                                (2-4) side-by-side "columns" even when the
 *                                column gap or content isn't a clean uniform
 *                                gap — the "good enough" recovery Phase 0's
 *                                binary uniform-gap test deliberately excludes.
 *
 * Same rules as Phase 0: pure functions, read-only, never mutate the NDG
 * graph, never commit Decisions. Each returns its own `evidence` array in the
 * `{ kind:'feature', ref, detail }` shape so dual-run comparison and future
 * debugging stay inspectable — see compiler/geometry/detect.js's
 * evaluateRowOrColumn for the pattern this mirrors.
 *
 * Precedence (enforced by the caller, compiler/geometry/detect.js, not here):
 * these looser heuristics only run for a parent when Phase 0's strict
 * evaluateRowOrColumn did NOT already produce a candidate for that node.
 */

const {
  EVIDENCE_GRID,
  EVIDENCE_SIDE_BY_SIDE,
  EVIDENCE_COLUMN_FLEX,
  EVIDENCE_SIDE_BY_SIDE_COLUMN,
} = require('../constants');

// Same tolerances as Phase 0 (server/figma-build.js's proven legacy values).
const ALIGN_TOL = 2; // px — sibling edges within this count as aligned
const GAP_TOL = 2; // px — inter-item gaps within this count as uniform
// Mirrors legacy COLUMN_FLEX_MIN_SCORE (server/figma-build.js) — overridable
// via compiler/decision/thresholds.js's `geometry_column_flex_min` slot.
const DEFAULT_COLUMN_FLEX_MIN_SCORE = 0.75;

function boxOf(node) {
  const b = node && node.box;
  if (!b || b.x == null || b.y == null || b.width == null || b.height == null) return null;
  return { x: Number(b.x), y: Number(b.y), w: Number(b.width), h: Number(b.height) };
}

function withBoxes(children) {
  return (children || [])
    .map((c) => ({ nodeId: c.nodeId || c.id, type: c.type || null, box: boxOf(c) }))
    .filter((c) => c.nodeId && c.box);
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Real collision (not a tiny Figma measurement overlap on both axes). This
 *  is now the ONE canonical copy — detect.js used to keep a private,
 *  verbatim-identical duplicate "to keep this module independently
 *  requirable/testable without a detect.js import cycle," but that concern
 *  doesn't actually apply to this direction: this module has zero requires
 *  of its own, so detect.js importing FROM here (exactly like compiler/
 *  rulepack/packs/component-detect/geometry-rules.js already does for
 *  isThinOverlay/isVerticalDivider/isChromeBg below) cannot cycle back. */
function isRealOverlap(a, b) {
  if (!overlaps(a, b)) return false;
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return yOverlap > 4 && xOverlap > 4;
}

function hasAnyRealOverlap(items) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (isRealOverlap(items[i].box, items[j].box)) return true;
    }
  }
  return false;
}

function isUniform(gaps, tol = GAP_TOL) {
  return gaps.length > 0
    && gaps.every((g) => g >= -ALIGN_TOL)
    && (Math.max(...gaps) - Math.min(...gaps) <= tol);
}

/**
 * server/figma-build.js's yOverlapRatio — how much two boxes' Y spans
 * overlap, relative to the shorter box's height. 1.0 = fully overlapping,
 * 0 = no vertical overlap at all (a real row/column split).
 */
function yOverlapRatio(a, b) {
  const top = Math.max(a.y, b.y);
  const bot = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, bot - top);
  const minH = Math.min(a.h, b.h);
  return minH > 0 ? overlap / minH : 0;
}

/** Direct symmetric counterpart of yOverlapRatio, for the column axis. */
function xOverlapRatio(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const overlap = Math.max(0, right - left);
  const minW = Math.min(a.w, b.w);
  return minW > 0 ? overlap / minW : 0;
}

/**
 * Groups items into visual "rows" by Y-RANGE OVERLAP RATIO — deliberately
 * looser than clusterRows() below, which exists for STRICT N×M grid
 * recognition (near-identical top edges, ALIGN_TOL=2). Reading order needs a
 * much more forgiving idea of "same row": real card rows routinely have
 * mismatched heights (one card's description wraps an extra line, one has a
 * taller image) that still read as one row to a human even when their top
 * edges differ by dozens of px — confirmed on a real fixture (Figma file
 * c0kt3mp76RoEiq3CFoeCHa node 39:9, "Why Participate?": two cards at y=190
 * (h=323) and y=230 (h=226) are the same visual row — a 40px top-edge gap,
 * but their Y-ranges fully overlap). Each candidate is compared against the
 * FIRST item placed in a row (its anchor), mirroring evaluateSideBySideRow/
 * -Column's own "anchor, not immediate neighbor" convention above — same
 * 0.35 default threshold, for the same reason (server/figma-build.js's
 * proven legacy value).
 * Box shape matches yOverlapRatio's own native `{x,y,w,h}` (the canonical
 * shape throughout this module — see e.g. withBoxes() above) — NOT the
 * `{x,y,width,height}` shape some callers (e.g. structural-polish.js's
 * orderChildrenVisualY) carry natively; those callers must map to `{w,h}`
 * before calling this, exactly the mismatch that made a real, caught bug
 * out of this function's first draft (see compiler/test/geometry.test.js's
 * groupByRowOverlap unit test for the regression coverage).
 * @param {Array<{box:{x:number,y:number,w:number,h:number}}>} items
 *   — already sorted by box.y ascending
 * @returns {Array<Array<object>>} rows, each an array of the original items,
 *   in the same row-to-row order as the input (ascending Y)
 */
function groupByRowOverlap(items, threshold = 0.35) {
  const rows = [];
  for (const item of items) {
    const row = rows.find((r) => yOverlapRatio(r[0].box, item.box) >= threshold);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows;
}

// ─── Grid ────────────────────────────────────────────────────────────────

/** Cluster items into rows by Y proximity (ALIGN_TOL). Pure, order-preserving
 *  by ascending Y of each row's first-seen member. */
function clusterRows(items) {
  const sorted = [...items].sort((a, b) => a.box.y - b.box.y);
  const rows = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].box.y - item.box.y) <= ALIGN_TOL);
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows;
}

/**
 * evaluateGrid — N×M grid of siblings: uniform row spacing AND uniform
 * column spacing, every row holding the same column count, with each
 * column's X aligned across every row. This is the 2D generalization the
 * blueprint calls out — legacy code only ever detected a single row/band of
 * equal-size cards (figma-build.js's inferCardGrids, constraint-transcriber's
 * 1×N GRID axis in transcribe.js's detectAxis); a genuine N×M read directly
 * from box geometry is new in this phase.
 * @returns {{ isGrid: boolean, rows: number, cols: number, orderedIds: string[],
 *   rowGap: number|null, colGap: number|null, evidence: object[] }}
 */
function evaluateGrid(parentId, children) {
  const evidence = [];
  const items = withBoxes(children);
  const empty = { isGrid: false, rows: 0, cols: 0, orderedIds: [], rowGap: null, colGap: null, evidence };
  if (items.length < 4) return empty; // need at least a 2×2

  if (hasAnyRealOverlap(items)) return empty;

  const rows = clusterRows(items);
  if (rows.length < 2) return empty; // a single row is evaluateRowOrColumn/side-by-side's job

  const cols = rows[0].length;
  if (cols < 2) return empty;
  if (!rows.every((r) => r.length === cols)) return empty;

  for (const r of rows) r.sort((a, b) => a.box.x - b.box.x);

  // Column X alignment across every row.
  for (let c = 0; c < cols; c++) {
    const xs = rows.map((r) => r[c].box.x);
    if (Math.max(...xs) - Math.min(...xs) > ALIGN_TOL) return empty;
  }

  // Uniform row-to-row vertical gap.
  const rowTops = rows.map((r) => Math.min(...r.map((k) => k.box.y)));
  const rowBottoms = rows.map((r) => Math.max(...r.map((k) => k.box.y + k.box.h)));
  const rowGaps = [];
  for (let r = 1; r < rows.length; r++) rowGaps.push(rowTops[r] - rowBottoms[r - 1]);
  if (!isUniform(rowGaps)) return empty;

  // Uniform column-to-column horizontal gap (measured on the first row —
  // column X alignment above already guarantees every row shares it).
  const colGaps = [];
  for (let c = 1; c < cols; c++) {
    colGaps.push(rows[0][c].box.x - (rows[0][c - 1].box.x + rows[0][c - 1].box.w));
  }
  if (!isUniform(colGaps)) return empty;

  const rowGap = Math.max(0, rowGaps.reduce((a, b) => a + b, 0) / rowGaps.length);
  const colGap = Math.max(0, colGaps.reduce((a, b) => a + b, 0) / colGaps.length);
  const orderedIds = rows.flat().map((k) => k.nodeId);

  evidence.push({
    kind: 'feature',
    ref: EVIDENCE_GRID,
    detail: {
      parentId,
      rows: rows.length,
      cols,
      rowGap: Number(rowGap.toFixed(2)),
      colGap: Number(colGap.toFixed(2)),
    },
  });

  return {
    isGrid: true,
    rows: rows.length,
    cols,
    orderedIds,
    rowGap,
    colGap,
    evidence,
  };
}

// ─── Side-by-side row ──────────────────────────────────────────────────────

/**
 * evaluateSideBySideRow — server/figma-build.js's inferSideBySideRows: a row
 * of siblings that are roughly at the same vertical band (Y-overlap ratio
 * against the leftmost sibling ≥ 0.35) but NOT pixel-perfectly top-aligned,
 * so Phase 0's edgesAligned(byX,'y') test misses them (Figma often offsets a
 * second column below a badge/eyebrow).
 * @returns {{ axis: 'row'|null, orderedIds: string[], gap: number|null, evidence: object[] }}
 */
function evaluateSideBySideRow(parentId, children) {
  const evidence = [];
  const items = withBoxes(children);
  const empty = { axis: null, orderedIds: [], gap: null, evidence };
  if (items.length < 2) return empty;
  if (hasAnyRealOverlap(items)) return empty;

  const byX = [...items].sort((a, b) => a.box.x - b.box.x);
  const gaps = [];
  for (let i = 1; i < byX.length; i++) {
    const g = byX[i].box.x - (byX[i - 1].box.x + byX[i - 1].box.w);
    if (g < -ALIGN_TOL) return empty;
    gaps.push(Math.max(0, g));
    // Faithful to legacy: ratio measured against the leftmost sibling, not
    // just the immediate neighbor — a wide "anchor" column on the left is
    // exactly the shape this heuristic targets (header/body side-by-side).
    if (yOverlapRatio(byX[0].box, byX[i].box) < 0.35) return empty;
  }

  const gap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  evidence.push({
    kind: 'feature',
    ref: EVIDENCE_SIDE_BY_SIDE,
    detail: { parentId, gap: Number(gap.toFixed(2)) },
  });

  return {
    axis: 'row',
    orderedIds: byX.map((k) => k.nodeId),
    gap,
    evidence,
  };
}

/**
 * evaluateSideBySideColumn — the direct symmetric counterpart of
 * evaluateSideBySideRow: 2+ siblings simply stacked top-to-bottom (X-overlap
 * ratio against the topmost sibling >= 0.35) but not sharing a left edge, so
 * Phase 0's edgesAligned(byY,'x') test misses them (e.g. a full-width row of
 * cards below a narrower, independently-centered heading block — confirmed
 * as a real, recurring shape via cross-corpus validation: 162 real
 * containers across 5 independent Figma files, 63 previously falling
 * through to mode:'unknown'/absolute with no DOM-order correction, 0
 * regressions against the 99 already correctly resolved). Only the ROW half
 * of this looser tier existed before; a plain vertical stack of differently
 * sized blocks is at least as common a real design pattern.
 * @returns {{ axis: 'column'|null, orderedIds: string[], gap: number|null, evidence: object[] }}
 */
function evaluateSideBySideColumn(parentId, children) {
  const evidence = [];
  const items = withBoxes(children);
  const empty = { axis: null, orderedIds: [], gap: null, evidence };
  if (items.length < 2) return empty;
  if (hasAnyRealOverlap(items)) return empty;

  const byY = [...items].sort((a, b) => a.box.y - b.box.y);
  const gaps = [];
  for (let i = 1; i < byY.length; i++) {
    const g = byY[i].box.y - (byY[i - 1].box.y + byY[i - 1].box.h);
    if (g < -ALIGN_TOL) return empty;
    gaps.push(Math.max(0, g));
    // Mirrors evaluateSideBySideRow: ratio measured against the topmost
    // sibling, not just the immediate neighbor.
    if (xOverlapRatio(byY[0].box, byY[i].box) < 0.35) return empty;
  }

  const gap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  evidence.push({
    kind: 'feature',
    ref: EVIDENCE_SIDE_BY_SIDE_COLUMN,
    detail: { parentId, gap: Number(gap.toFixed(2)) },
  });

  return {
    axis: 'column',
    orderedIds: byY.map((k) => k.nodeId),
    gap,
    evidence,
  };
}

// ─── Column-flex scoring ───────────────────────────────────────────────────

/** Decorative LINE/hairline only — not icons or photos (box-only test; the
 *  paint-based refinement legacy applies belongs to a later, decls-aware
 *  phase — this stage never reads paints). */
function isThinOverlay(box) {
  if (!box) return false;
  return (box.w <= 4 && box.h > 40) || (box.h <= 4 && box.w > 40);
}

function isVerticalDivider(box) {
  return !!box && box.w <= 4 && box.h > 40;
}

/** Box-only approximation of legacy's isChromeBg: a child that nearly covers
 *  the whole cluster from its origin — almost certainly a background shell,
 *  not one of the side-by-side content columns. */
function isChromeBg(box, containerBox) {
  if (!box || !containerBox) return false;
  const coversW = box.w >= containerBox.w * 0.9;
  const coversH = box.h >= containerBox.h * 0.85;
  const nearOrigin = Math.abs(box.x - containerBox.x) <= 4 && Math.abs(box.y - containerBox.y) <= 4;
  return coversW && coversH && nearOrigin;
}

function boundingBoxOf(items) {
  const minX = Math.min(...items.map((k) => k.box.x));
  const minY = Math.min(...items.map((k) => k.box.y));
  const maxX = Math.max(...items.map((k) => k.box.x + k.box.w));
  const maxY = Math.max(...items.map((k) => k.box.y + k.box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * evaluateColumnFlex — server/figma-build.js's evaluateColumnFlex: scores a
 * freeform cluster of children as recoverable into N (2-4) side-by-side
 * "columns" (each column itself a vertical stack), even when the column gap
 * isn't uniform-gap-clean. This is the "good enough" scored recovery Phase
 * 0's binary uniform-gap test deliberately excludes — probabilistic, so it
 * is gated by a threshold (`geometry_column_flex_min`, default 0.75,
 * mirroring legacy COLUMN_FLEX_MIN_SCORE) rather than accepted outright.
 * @param {number} [minScore] — accept threshold; caller resolves this via
 *   compiler/decision/thresholds.js so policy — not this pure function —
 *   owns the authoritative value.
 * @returns {{ ok: boolean, score: number, axis: 'row'|null, columns: string[][],
 *   gap: number|null, evidence: object[] }}
 */
function evaluateColumnFlex(parentId, children, minScore = DEFAULT_COLUMN_FLEX_MIN_SCORE) {
  const evidence = [];
  const empty = { ok: false, score: 0, axis: null, columns: [], gap: null, evidence };
  const items = withBoxes(children);
  if (items.length < 2) return empty;

  const containerBox = boundingBoxOf(items);
  const chrome = items.filter((c) => isChromeBg(c.box, containerBox));
  const overlays = items.filter((c) => isThinOverlay(c.box) && !chrome.includes(c));
  const content = items.filter((c) => !isThinOverlay(c.box) && !chrome.includes(c));
  if (content.length < 2) return empty;

  if (hasAnyRealOverlap(content)) return empty; // low-confidence path in legacy; Phase 1 treats as reject

  const sorted = [...content].sort((a, b) => a.box.x - b.box.x);
  const columns = [];
  for (const c of sorted) {
    let placed = false;
    for (const col of columns) {
      const colMinX = Math.min(...col.map((k) => k.box.x));
      const colMaxX = Math.max(...col.map((k) => k.box.x + k.box.w));
      const cx1 = c.box.x;
      const cx2 = c.box.x + c.box.w;
      const overlap = Math.min(colMaxX, cx2) - Math.max(colMinX, cx1);
      const minW = Math.min(colMaxX - colMinX, c.box.w) || c.box.w;
      if (overlap > minW * 0.35) {
        col.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([c]);
  }
  if (columns.length < 2 || columns.length > 4) return empty;

  const gapX = [];
  for (let i = 1; i < columns.length; i++) {
    const prevRight = Math.max(...columns[i - 1].map((k) => k.box.x + k.box.w));
    const nextLeft = Math.min(...columns[i].map((k) => k.box.x));
    gapX.push(Math.max(0, nextLeft - prevRight));
  }
  const rowGap = gapX.length ? gapX.reduce((a, b) => a + b, 0) / gapX.length : 12;
  const minGap = gapX.length ? Math.min(...gapX) : 0;

  let score = 0.4;
  if (columns.length === 2 || columns.length === 3) score += 0.25;
  else score += 0.1;
  if (minGap >= 4) score += 0.15;
  else if (minGap >= 0) score += 0.05;
  const lineOverlays = overlays.filter((o) => isVerticalDivider(o.box));
  if (overlays.length && lineOverlays.length === overlays.length) score += 0.1;
  else if (!overlays.length) score += 0.05;
  if (content.length >= 3 && content.length <= 8) score += 0.1;
  score = Math.min(1, Math.round(score * 100) / 100);

  const ok = score >= minScore;

  evidence.push({
    kind: 'feature',
    ref: EVIDENCE_COLUMN_FLEX,
    detail: {
      parentId,
      score,
      columns: columns.length,
      minScore,
      ok,
    },
  });

  return {
    ok,
    score,
    axis: ok ? 'row' : null,
    columns: columns.map((col) => col.map((k) => k.nodeId)),
    gap: rowGap,
    evidence,
  };
}

module.exports = {
  ALIGN_TOL,
  GAP_TOL,
  DEFAULT_COLUMN_FLEX_MIN_SCORE,
  yOverlapRatio,
  xOverlapRatio,
  groupByRowOverlap,
  evaluateGrid,
  evaluateSideBySideRow,
  evaluateSideBySideColumn,
  evaluateColumnFlex,
  // Exported for compiler/rulepack/packs/component-detect/geometry-rules.js
  // (Phase 2, docs/COMPILER_MIGRATION_BLUEPRINT.md) — reused rather than
  // duplicated, per the blueprint's explicit instruction not to re-derive
  // geometric facts this stage already computes. Phase 2's version wraps
  // isChromeBg with paint-aware refinement (isChromeBgRefined) but keeps this
  // box-only test as the shared geometric core.
  isThinOverlay,
  isVerticalDivider,
  isChromeBg,
  boundingBoxOf,
  isRealOverlap,
};
