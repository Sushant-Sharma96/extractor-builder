'use strict';

/**
 * Ingest RawDesignDocument trees and/or source.node Facts into a flat working set.
 */

const { NdgError, NdgErrorKind } = require('./errors');
const { FACT_KIND_SOURCE_NODE, FACT_KIND_RAW } = require('./constants');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function boxFrom(raw) {
  const b = raw.absoluteBoundingBox || raw.bounds || raw.box || null;
  if (!isPlainObject(b)) return null;
  return {
    x: numOrNull(b.x),
    y: numOrNull(b.y),
    width: numOrNull(b.width != null ? b.width : b.w),
    height: numOrNull(b.height != null ? b.height : b.h),
  };
}

function workingNodeFromRaw(raw, pathHint) {
  if (!isPlainObject(raw)) {
    throw new NdgError(NdgErrorKind.INVALID_INPUT, 'raw node must be object');
  }
  const sourceNodeId = String(raw.id || raw.nodeId || pathHint || '').trim();
  if (!sourceNodeId) {
    throw new NdgError(NdgErrorKind.INVALID_INPUT, 'node missing id', { pathHint });
  }
  const childIds = Array.isArray(raw.children)
    ? raw.children.map((c, i) => {
      if (typeof c === 'string') return c;
      if (isPlainObject(c) && (c.id || c.nodeId)) return String(c.id || c.nodeId);
      return `${sourceNodeId}__anon_${i}`;
    })
    : Array.isArray(raw.childIds)
      ? raw.childIds.map(String)
      : [];

  return {
    sourceNodeId,
    name: raw.name != null ? String(raw.name) : null,
    type: raw.type || raw.nodeType || null,
    visible: raw.visible !== false,
    box: boxFrom(raw),
    // `absoluteRenderBounds` is the effects-inclusive bounding box (larger
    // than `absoluteBoundingBox` whenever a shadow/blur bleeds past the
    // node's own geometry) — a real, distinct REST field, confirmed present
    // on every node in every sampled fixture. Kept as its own top-level box,
    // parallel to `box`, rather than folded into it, since the two answer
    // different questions (layout box vs. visual paint extent).
    renderBox: boxFrom({ absoluteBoundingBox: raw.absoluteRenderBounds }),
    paints: Array.isArray(raw.fills) ? raw.fills : (raw.fills ? [raw.fills] : []),
    strokes: Array.isArray(raw.strokes) ? raw.strokes : [],
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    geometry: {
      cornerRadius: raw.cornerRadius != null ? raw.cornerRadius : raw.radius,
      rectangleCornerRadii: raw.rectangleCornerRadii || null,
      cornerSmoothing: raw.cornerSmoothing != null ? raw.cornerSmoothing : null,
      opacity: raw.opacity != null ? raw.opacity : null,
      strokeWeight: raw.strokeWeight != null ? raw.strokeWeight : null,
      strokeAlign: raw.strokeAlign != null ? raw.strokeAlign : null,
      individualStrokeWeights: raw.individualStrokeWeights || null,
      // Real, confirmed-populated fields (`"ROUND"` caps/joins, `[10,10]`-
      // style dash arrays) with no prior capture anywhere in this file.
      strokeCap: raw.strokeCap || null,
      strokeJoin: raw.strokeJoin || null,
      strokeDashes: Array.isArray(raw.strokeDashes) ? raw.strokeDashes : null,
      rotation: raw.rotation != null ? raw.rotation : null,
      // The full 2x3 affine matrix ([[a,b,c],[d,e,f]]) — the only Figma
      // source for skew/non-uniform scale (Research Part 5/Section 6.6:
      // "not ingested at all"). `rotation` above only ever carries a pure
      // rotation angle; a node that's ALSO skewed or non-uniformly scaled
      // needs this matrix, not a substitute for it. Zero confirmed real
      // occurrences in this project's own corpus to date (captured for
      // completeness/the next 1,000 files, not a currently-observed bug).
      relativeTransform: Array.isArray(raw.relativeTransform) ? raw.relativeTransform : null,
      // Real, present on every node in every fixture (Figma does not omit it
      // even at its default) — previously never captured under any name.
      blendMode: raw.blendMode || null,
      // A mask relationship is defined entirely by this node-level flag plus
      // sibling z-order; without it NDG cannot distinguish a mask shape from
      // an ordinary sibling, which is exactly the gap hasPaintSignal() in
      // build.js now also accounts for (see build.js's own comment).
      isMask: raw.isMask === true,
      maskType: raw.maskType || null,
    },
    attributes: {
      layoutMode: raw.layoutMode || raw.autoLayout || null,
      itemSpacing: raw.itemSpacing != null ? raw.itemSpacing : raw.gap,
      paddingTop: raw.paddingTop,
      paddingRight: raw.paddingRight,
      paddingBottom: raw.paddingBottom,
      paddingLeft: raw.paddingLeft,
      constraints: raw.constraints || null,
      layoutPositioning: raw.layoutPositioning || raw.positioning || null,
      overflow: raw.overflowDirection || raw.overflow || null,
      // The REAL per-node clip flag (a plain boolean) — distinct from
      // `overflowDirection` above (which controls SCROLL direction on a
      // scrollable frame, a different Figma concept entirely). Confirmed via
      // direct fixture audit: `overflowDirection` never appears in any of 15
      // real sampled fixtures, so `overflow` above has been permanently null
      // on real data; `clipsContent` is the field every real file actually
      // sets. Kept as its own field rather than folded into `overflow` so
      // existing `overflow` consumers see no behavior change.
      clipsContent: raw.clipsContent != null ? raw.clipsContent === true : null,
      // Nine real Auto Layout sub-fields, confirmed present with real,
      // varying values in this codebase's own cached fixtures (e.g.
      // layoutSizingHorizontal: "FIXED"/"HUG"/"FILL"), previously 100%
      // absent from this object despite `layoutMode` itself being captured.
      primaryAxisAlignItems: raw.primaryAxisAlignItems || null,
      counterAxisAlignItems: raw.counterAxisAlignItems || null,
      layoutWrap: raw.layoutWrap || null,
      layoutGrow: numOrNull(raw.layoutGrow),
      layoutAlign: raw.layoutAlign || null,
      primaryAxisSizingMode: raw.primaryAxisSizingMode || null,
      counterAxisSizingMode: raw.counterAxisSizingMode || null,
      layoutSizingHorizontal: raw.layoutSizingHorizontal || null,
      layoutSizingVertical: raw.layoutSizingVertical || null,
      // Native Figma Grid Auto Layout (layoutMode:'GRID') — a real,
      // declarative feature entirely distinct from this compiler's own
      // geometry-GUESSED 'grid-track' mode. Figma hands us near-literal CSS:
      // gridColumnsSizing/gridRowsSizing are already valid grid-template-
      // columns/rows syntax (e.g. "repeat(3,minmax(0,1fr))"), and every
      // child carries its own explicit 0-based row/column anchor + span —
      // no clustering or guessing needed, only reading. Confirmed via a real
      // fixture that previously fell through to unstyled block flow because
      // nothing read any of these fields at all.
      gridRowCount: raw.gridRowCount != null ? raw.gridRowCount : null,
      gridColumnCount: raw.gridColumnCount != null ? raw.gridColumnCount : null,
      gridRowGap: numOrNull(raw.gridRowGap),
      gridColumnGap: numOrNull(raw.gridColumnGap),
      gridColumnsSizing: raw.gridColumnsSizing || null,
      gridRowsSizing: raw.gridRowsSizing || null,
      gridRowAnchorIndex: raw.gridRowAnchorIndex != null ? raw.gridRowAnchorIndex : null,
      gridColumnAnchorIndex: raw.gridColumnAnchorIndex != null ? raw.gridColumnAnchorIndex : null,
      gridRowSpan: raw.gridRowSpan != null ? raw.gridRowSpan : null,
      gridColumnSpan: raw.gridColumnSpan != null ? raw.gridColumnSpan : null,
      characters: raw.characters || raw.text || null,
      // Typography — a real Figma TEXT node nests these under `raw.style`
      // (`style.fontFamily`, `.fontWeight`, `.fontSize`, `.letterSpacing`,
      // `.lineHeightPx`; confirmed directly against the cached Challenge
      // Arena fixture's document.json), never as flat top-level fields —
      // `raw.style` is read FIRST, with a flat-field fallback kept only for
      // any pre-existing synthetic/test raw node that already sets these
      // flat (no ingest test constructs one today, but this keeps the old
      // shape valid rather than silently dropping it).
      fontSize: numOrNull(raw.style ? raw.style.fontSize : raw.fontSize),
      fontWeight: numOrNull(raw.style ? raw.style.fontWeight : raw.fontWeight),
      fontName: (raw.style && raw.style.fontFamily) || raw.fontName || raw.fontFamily || null,
      letterSpacing: numOrNull(raw.style ? raw.style.letterSpacing : raw.letterSpacing),
      lineHeightPx: numOrNull(raw.style ? raw.style.lineHeightPx : raw.lineHeightPx),
      // Figma's own visible-uppercase/lowercase/titlecase rendering (e.g.
      // "Elite Protocol Reward" stored mixed-case but displayed as "ELITE
      // PROTOCOL REWARD") — a CSS text-transform, not a change to the
      // underlying characters.
      textCase: (raw.style && raw.style.textCase) || null,
      // Figma auto-sizes both dimensions of a "WIDTH_AND_HEIGHT" text node to
      // exactly fit its own single-line content — the box is a RESULT of the
      // text, not a wrap constraint. Any sub-pixel/font-metric drift between
      // Figma's own text measurement and the browser's then wraps it. Read
      // here so the renderer can force `white-space: nowrap` for these nodes.
      textAutoResize: (raw.style && raw.style.textAutoResize) || null,
      // Real bug: nested under `raw.style` exactly like fontSize/fontWeight/
      // textCase above (confirmed directly against a real fixture), but this
      // read top-level `raw.textAlignHorizontal` instead — always null on
      // real data, silently dropping every real CENTER/RIGHT/JUSTIFIED value.
      textAlignHorizontal: (raw.style && raw.style.textAlignHorizontal) || raw.textAlignHorizontal || raw.textAlign || null,
      textAlignVertical: (raw.style && raw.style.textAlignVertical) || raw.textAlignVertical || null,
      // Nests under `raw.style` exactly like textCase/textAlignHorizontal
      // above (confirmed real: "UNDERLINE"); legacy server/figma-generate.js
      // already reads this correctly — simply never ported into NDG.
      textDecoration: (raw.style && raw.style.textDecoration) || null,
      // Per-character text-style overrides (additive; Phase 3 parity work —
      // sourced verbatim from the raw Figma TEXT node, same fields legacy's
      // textRuns()/runStyleCss() read). Absent on nodes with no runs.
      characterStyleOverrides: Array.isArray(raw.characterStyleOverrides) ? raw.characterStyleOverrides : null,
      styleOverrideTable: isPlainObject(raw.styleOverrideTable) ? raw.styleOverrideTable : null,
      // Component structural attrs (Phase 12 consumers; additive pass-through)
      componentKey: raw.componentKey || null,
      componentId: raw.componentId || null,
      mainComponent: raw.mainComponent || raw.mainComponentId || null,
      mainComponentId: raw.mainComponentId || null,
      componentProperties: raw.componentProperties || null,
      componentPropertyDefinitions: raw.componentPropertyDefinitions || null,
      variantProperties: raw.variantProperties || null,
      overrides: raw.overrides || null,
      styles: raw.styles || null,
      boundVariables: raw.boundVariables || null,
    },
    childSourceIds: childIds,
    parentSourceId: raw.parentId != null ? String(raw.parentId) : null,
  };
}

/**
 * Walk a tree document (RawDesignDocument.document or similar).
 * @returns {{ nodes: object[], rawDocumentId: string|null }}
 */
function ingestTreeDocument(doc, rawDocumentId) {
  if (!isPlainObject(doc)) {
    throw new NdgError(NdgErrorKind.INVALID_INPUT, 'document tree required');
  }
  const nodes = [];
  const seen = new Set();

  function walk(raw, parentSourceId, path) {
    const wn = workingNodeFromRaw(raw, path);
    if (seen.has(wn.sourceNodeId)) {
      throw new NdgError(
        NdgErrorKind.DUPLICATE_ID,
        `duplicate source id in tree: ${wn.sourceNodeId}`,
        { sourceNodeId: wn.sourceNodeId }
      );
    }
    seen.add(wn.sourceNodeId);
    wn.parentSourceId = parentSourceId;
    nodes.push(wn);

    const children = Array.isArray(raw.children) ? raw.children : [];
    const childIds = [];
    children.forEach((child, i) => {
      if (typeof child === 'string') {
        childIds.push(child);
        return;
      }
      const childWn = walk(child, wn.sourceNodeId, `${path}/${i}`);
      childIds.push(childWn.sourceNodeId);
    });
    wn.childSourceIds = childIds;
    return wn;
  }

  walk(doc, null, 'root');
  return { nodes, rawDocumentId: rawDocumentId || null };
}

/**
 * Ingest flat source.node Facts (Phase 9 transitional).
 */
function ingestSourceNodeFacts(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const nodes = [];
  const bySource = new Map();

  for (const fact of list) {
    if (!fact || fact.kind !== FACT_KIND_SOURCE_NODE) continue;
    const assertion = fact.assertion || {};
    const wn = workingNodeFromRaw(
      {
        ...assertion,
        id: assertion.id || assertion.nodeId || fact.subject || fact.factId,
        parentId: assertion.parentId,
        childIds: assertion.childIds,
        children: assertion.children,
      },
      fact.factId
    );
    if (bySource.has(wn.sourceNodeId)) {
      throw new NdgError(
        NdgErrorKind.DUPLICATE_ID,
        `duplicate source.node id: ${wn.sourceNodeId}`,
        { sourceNodeId: wn.sourceNodeId }
      );
    }
    bySource.set(wn.sourceNodeId, wn);
    nodes.push(wn);
  }

  // Infer parent links from childIds when parentId missing
  for (const wn of nodes) {
    for (const cid of wn.childSourceIds) {
      const child = bySource.get(cid);
      if (child && !child.parentSourceId) child.parentSourceId = wn.sourceNodeId;
    }
  }

  return { nodes, rawDocumentId: null };
}

/**
 * Collect ingest inputs from options + workspace Facts.
 */
function collectIngestInput(opts = {}) {
  if (opts.rawDocument && isPlainObject(opts.rawDocument)) {
    const raw = opts.rawDocument;
    const tree = raw.document || raw;
    const rawDocumentId = raw.documentId || opts.rawDocumentId || null;
    return ingestTreeDocument(tree, rawDocumentId);
  }

  if (opts.document && isPlainObject(opts.document)) {
    return ingestTreeDocument(opts.document, opts.rawDocumentId || null);
  }

  if (Array.isArray(opts.workingNodes) && opts.workingNodes.length) {
    return { nodes: opts.workingNodes, rawDocumentId: opts.rawDocumentId || null };
  }

  const facts = opts.facts || [];
  const rawFact = facts.find((f) => f && f.kind === FACT_KIND_RAW);
  if (rawFact && rawFact.assertion) {
    const a = rawFact.assertion;
    const tree = a.document || a;
    return ingestTreeDocument(tree, a.documentId || rawFact.subject || null);
  }

  const fromNodes = ingestSourceNodeFacts(facts);
  if (!fromNodes.nodes.length) {
    throw new NdgError(
      NdgErrorKind.INVALID_INPUT,
      'no RawDesignDocument or source.node Facts to materialize'
    );
  }
  return fromNodes;
}

module.exports = {
  workingNodeFromRaw,
  ingestTreeDocument,
  ingestSourceNodeFacts,
  collectIngestInput,
  boxFrom,
};
