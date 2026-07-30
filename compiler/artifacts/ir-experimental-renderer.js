'use strict';

/**
 * Phase 5 (docs/COMPILER_MIGRATION_BLUEPRINT.md, NARROWED per explicit user
 * decision — toggle only, no cutover) — promotes the ad-hoc "new path"
 * assembly that `scripts/render-byte-diff.js` and
 * `scripts/responsive-dual-run.js` already build for validation purposes
 * into a real, reusable, callable function:
 *
 *   NDG materialization -> geometry detection -> layout interpretation
 *   -> component (card/banner) detection -> responsive detection
 *   -> materializeHtml()
 *
 * Reached ONLY via `compiler/artifacts/index.js`'s `emitArtifacts({ renderer:
 * 'ir-experimental' })` opt-in flag — never the default path. See that
 * file's doc comment on `opts.renderer` for the full usage note.
 *
 * DIAGNOSTIC / OPT-IN ONLY. Per Phase 3/4's own STATUS notes in the
 * blueprint, this renderer does NOT match legacy's HTML/CSS byte-for-byte
 * (documented, architecturally-blocked gaps — constraint-transcriber-derived
 * custom properties, legacy's heuristic-derived class names, per-run text
 * style overrides). It reproduces legacy's *decisions* (layout mode, card/
 * banner chrome, section wrapping, responsive strategy), not its exact
 * output bytes.
 *
 * Pure-ish: builds a fresh workspace/graph per call from `document`; does
 * not mutate anything the caller passed in.
 */

const { materializeNormalizedDesignGraph } = require('../ndg');
const { createWorkspace } = require('../workspace');
const { indexGraph } = require('../layout/collect');
const { interpretGraph } = require('../layout/interpret');
const { detectGeometry } = require('../geometry');
const {
  detectComponentGeometry,
  boxOf: rowSetBoxOf,
} = require('../rulepack/packs/component-detect/geometry-rules');
const { detectResponsive } = require('../responsive');
const { buildDesignSkeleton, ROLE_DECORATIVE_CHROME } = require('../skeleton');
const { materializeHtml } = require('../emit/render/materialize-html');
const { solidFillCss, paintCss, isPositionedAbsolute } = require('../emit/render/css-declarations');

/**
 * Intersection-over-Union of two Figma boxes — the standard overlap metric
 * (see docs/COMPILER_MIGRATION_BLUEPRINT.md's flex/grid-conversion research:
 * real design-to-code tools gate the absolute-vs-flow decision on this
 * exact test — IoU > 0.1 means genuine overlap, which can never be expressed
 * as non-overlapping flex/grid siblings without losing fidelity). Returns 0
 * for boxes that don't intersect at all or are missing dimensions.
 * @param {{x:number,y:number,width:number,height:number}} a
 * @param {{x:number,y:number,width:number,height:number}} b
 * @returns {number} 0..1
 */
function iou(a, b) {
  if (!a || !b || ![a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(Number.isFinite)) return 0;
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = xOverlap * yOverlap;
  if (intersection <= 0) return 0;
  const union = (a.width * a.height) + (b.width * b.height) - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Decides whether a freeform-layout-ir group's members can become REAL
 * flex/grid siblings (no position:absolute) instead of the coordinate-
 * absolute fallback every member previously used unconditionally. Verified
 * against real fixtures: Challenge Arena's 4 rows tile with exactly 0px gap
 * along the column axis; Articles' 3 cards have 26px/27px gaps (1px
 * variance) along the row axis — both well within the 2px tolerance used
 * here, matching the reference algorithm's alignment-tolerance constant.
 * Two independent gates, both required:
 *   1. No pair of members overlaps (IoU > 0.1) — genuine overlap can only
 *      be expressed correctly with absolute positioning; this never fires
 *      for legitimate repeating rows/cards (they're a list, not a stack of
 *      overlapping layers) and exists as a safety net against a
 *      mis-detected group slipping through with members that DO overlap.
 *   2. The gap between consecutive members (sorted by visual position
 *      along the group's own axis) is consistent within 2px — the same
 *      tolerance the reference algorithm uses for alignment/gap checks.
 * `containerBox` (the group container's own real box, when known) is used
 * to compute `leadingOffset` — the space between the container's own edge
 * and the first member along the axis. This matters whenever the container
 * has a NON-member sibling the members don't know about (verified on this
 * exact fixture: Challenge Arena's `<table>`'s TH header row is a plain
 * absolutely-positioned sibling, not a freeform-layout-ir member — it
 * contributes nothing to a real flex container's flow, so without this,
 * row 1 renders flush against the container's top edge instead of the real
 * 49px below the header that Figma's own coordinates encode).
 *
 * Two offsets are computed, not one — they're independent and both real:
 *   - `leadingOffset` — along the group's own axis (row→x, column→y). The
 *     Challenge Arena case above.
 *   - `crossAxisOffset` — along the PERPENDICULAR axis (row→y, column→x).
 *     Verified on Articles: its 3 cards are axis:'row' (side-by-side), and
 *     the section's headline sits ABOVE them — a cross-axis offset (real
 *     126px), not a main-axis one. Without this, `align-items:flex-start`
 *     (needed to stop the OTHER, unrelated bug — see freeformGroupContainerDecls'
 *     comment) anchors the cards flush at the container's top edge, 126px
 *     too high.
 * @param {Array<{nodeId:string, box:{x:number,y:number,width:number,height:number}}>} members
 * @param {'row'|'column'} axis
 * @param {{x:number,y:number,width:number,height:number}} [containerBox]
 * @returns {{flowSafe:boolean, orderedMemberIds:string[], gap:number, leadingOffset:number, crossAxisOffset:number}}
 */
function computeFreeformFlowSafety(members, axis, containerBox) {
  const withBox = members.filter((m) => m && m.box);
  const fail = {
    flowSafe: false, orderedMemberIds: members.map((m) => m.nodeId), gap: 0, leadingOffset: 0, crossAxisOffset: 0,
  };
  if (withBox.length < 2) return fail;
  for (let i = 0; i < withBox.length; i += 1) {
    for (let j = i + 1; j < withBox.length; j += 1) {
      if (iou(withBox[i].box, withBox[j].box) > 0.1) return fail;
    }
  }
  const ordered = [...withBox].sort((x, y) => (
    axis === 'column' ? (x.box.y - y.box.y) || (x.box.x - y.box.x) : (x.box.x - y.box.x) || (x.box.y - y.box.y)
  ));
  const gaps = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const cur = ordered[i].box;
    const next = ordered[i + 1].box;
    gaps.push(axis === 'column' ? next.y - (cur.y + cur.height) : next.x - (cur.x + cur.width));
  }
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const uniform = (maxGap - minGap) <= 2;
  const firstBox = ordered[0].box;
  const haveContainerBox = containerBox && Number.isFinite(containerBox.x) && Number.isFinite(containerBox.y);
  const leadingOffset = (uniform && haveContainerBox)
    ? Math.max(0, axis === 'column' ? (firstBox.y - containerBox.y) : (firstBox.x - containerBox.x))
    : 0;
  const crossAxisOffset = (uniform && haveContainerBox)
    ? Math.max(0, axis === 'column' ? (firstBox.x - containerBox.x) : (firstBox.y - containerBox.y))
    : 0;
  return {
    flowSafe: uniform,
    orderedMemberIds: ordered.map((m) => m.nodeId),
    gap: uniform ? Math.max(0, Math.round((minGap + maxGap) / 2)) : 0,
    leadingOffset,
    crossAxisOffset,
  };
}

/**
 * Row-set (repeating-pattern / table) render wiring — consumes Component
 * IR's `rowSetFacts` (docs/COMPILER_MIGRATION_BLUEPRINT.md's "Row-Set"
 * section). Real-fixture validation (Challenge Arena, node 1:326) showed
 * EVERY row carries its own chrome background rectangle as a direct child,
 * and the row's remaining columns are bundled behind ONE level of
 * "pass-through" wrapper group for some rows but not others (row 1 bundles
 * all 5 columns in a single wrapper; rows 2-4 pull the 5th/button column out
 * as the row's own direct child) — see `rowColumnCandidates` in
 * geometry-rules.js, which this function deliberately mirrors read-only
 * (does not modify) to find the same pass-through wrapper(s) per row.
 *
 * DESIGN DEVIATION from the originally-sketched "container becomes one
 * shared CSS Grid, every row flattens via `display:contents` into it": that
 * approach loses each row's own background (a `display:contents` row's
 * chrome-rect child would either paint nothing where expected or become a
 * stray misplaced grid cell) — and every row in the real fixture has one.
 * Instead: each ROW becomes its OWN CSS Grid with the fact's column widths
 * as explicit tracks (so every row's tracks are pixel-identical, guaranteeing
 * cross-row column alignment without needing a single shared grid), the
 * row's chrome color is lifted onto the row itself as `background-color`
 * (same "lift chrome paint" idiom `cardChromeDecls` already uses) and the
 * original chrome node is hidden (`display:none` — its color already lives
 * on the row), and any pass-through wrapper found inside the row gets
 * `display:contents` so its children become direct grid items of the row's
 * own grid. This still uses `display:contents` exactly where the original
 * design intended it (flattening structural wrappers) — just scoped to the
 * row's own grid instead of the shared container, and only after confirming
 * (by inspecting the real generated bytes, not asserting) that chrome-less
 * rows would have been fine with the simpler design. A row with NO chrome
 * child at all still gets the simpler `display:contents` treatment (no
 * background to lose), preserving the originally-sketched behavior for that
 * case.
 */
/**
 * NDG's own structural collapse (compiler/ndg/build.js, Pass 3) can delete a
 * wrapper node and promote its single child to take its place in the graph
 * — correct and desirable when the wrapper is genuinely meaningless, but a
 * real bug when a SEPARATE, NDG-bypassing system (server/figma-generate.js's
 * SVG icon reconstruction, or a legacy imageUrls lookup) already computed
 * its output keyed by that wrapper's ORIGINAL id. Confirmed via a real
 * fixture: an icon built from exactly one vector shape (as opposed to 2+)
 * has its wrapping "SVG" frame collapsed away by Pass 3 (no paint signal of
 * its own, exactly one child) — svgMarkup, keyed by the frame's pre-collapse
 * id, then silently misses on every lookup, since the renderer only ever
 * sees the survivor's id (and, as a visible side effect, whatever DOES
 * render in its place uses the child's own tighter/offset box instead of
 * the original wrapper's, which is what looked like a misalignment).
 *
 * This treats NDG's own collapse record (`events`) as authoritative and
 * re-keys any pre-collapse id in a lookup table to whichever id actually
 * survived — including chained collapses (a collapsed wrapper's own
 * replacement can itself be collapsed again) — rather than teaching NDG
 * about the legacy SVG-reconstruction heuristics, which would recreate the
 * exact "two systems quietly depending on each other's internals" problem
 * this is fixing.
 * @param {object} bySourceId — e.g. svgMarkup/imageUrls, keyed by raw Figma node id
 * @param {Array<{type:string, sourceNodeId?:string, replacedBy?:string}>} events
 * @returns {object} a same-shape object, re-keyed wherever NDG collapsed the original id
 */
function rekeyForNdgCollapse(bySourceId, events) {
  if (!bySourceId || !Object.keys(bySourceId).length) return bySourceId || {};
  const replacedBy = new Map();
  for (const ev of events || []) {
    if (ev && ev.type === 'collapsed' && ev.sourceNodeId && ev.replacedBy) {
      replacedBy.set(ev.sourceNodeId, ev.replacedBy);
    }
  }
  if (!replacedBy.size) return bySourceId;
  function resolve(id) {
    let current = id;
    const seen = new Set();
    while (replacedBy.has(current) && !seen.has(current)) {
      seen.add(current);
      current = replacedBy.get(current);
    }
    return current;
  }
  const out = {};
  for (const [id, value] of Object.entries(bySourceId)) {
    out[resolve(id)] = value;
  }
  return out;
}

/** Walks a raw Figma document tree once, indexing every node by its own raw id. */
function indexRawNodesById(root) {
  const byId = new Map();
  function walk(n) {
    if (!n) return;
    if (n.id != null) byId.set(String(n.id), n);
    for (const c of n.children || []) walk(c);
  }
  walk(root);
  return byId;
}

/**
 * When NDG collapses a wrapper into its single child (see
 * rekeyForNdgCollapse's comment) and that child ends up rendered via
 * reconstructed SVG, the child's OWN (tighter, differently-offset) box is
 * not what should size/position the icon — the wrapper's box is (e.g. a
 * consistent 24x24 icon-container every sibling icon whose own wrapper
 * survived collapse already uses). Confirmed via a real fixture: a
 * single-vector icon rendered 20x20 at a visibly different offset than its
 * five 24x24 siblings once the missing-markup bug above was fixed — same
 * root cause, one layer deeper. Returns nodeId -> the ORIGINAL wrapper's raw
 * absoluteBoundingBox, only for collapses that actually happened.
 * @param {Array<{type:string, sourceNodeId?:string, replacedBy?:string}>} events
 * @param {Map<string,object>} rawNodesById
 * @returns {Map<string,object>} survivor sourceNodeId -> original wrapper's absoluteBoundingBox
 */
function collapsedWrapperBoxBySurvivorId(events, rawNodesById) {
  const out = new Map();
  for (const ev of events || []) {
    if (!ev || ev.type !== 'collapsed' || !ev.sourceNodeId || !ev.replacedBy) continue;
    const originalRaw = rawNodesById.get(ev.sourceNodeId);
    if (originalRaw && originalRaw.absoluteBoundingBox) {
      out.set(ev.replacedBy, originalRaw.absoluteBoundingBox);
    }
  }
  return out;
}

/**
 * Figma's own `gridColumnsSizing`/`gridRowsSizing` strings (native Grid Auto
 * Layout, see ingest.js's comment) are already valid CSS grid-template-
 * columns/rows syntax verbatim (e.g. "repeat(3,minmax(0,1fr))") — this only
 * guards against interpolating anything outside a safe grid-track character
 * set into generated CSS before trusting the string as-is.
 * @param {*} value
 * @returns {string|null}
 */
function sanitizeGridTrackString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^[a-zA-Z0-9.,()%\s-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Image-fill resolution — mirrors legacy's `imageRefOf()`/`imgUrl()`
 * (server/figma-build.js) which treats ANY node carrying an `IMAGE`-type
 * fill paint as an image, regardless of the node's own Figma `type`
 * (`RECTANGLE`/`ELLIPSE` shapes with an image paint are the common real-world
 * case — confirmed via direct inspection of the Challenge Arena fixture: 26
 * such nodes, 0 of them `type==='IMAGE'`). `node.paints` (see
 * `compiler/ndg/ingest.js`) already carries the raw Figma `fills` array,
 * including `imageRef` on an `IMAGE`-type paint, so no NDG changes are
 * needed here — this only reads it.
 * @param {{paints?: Array<{type?:string, visible?:boolean, imageRef?:string}>}} node
 * @returns {string|null}
 */
function imageRefOf(node) {
  const f = (node.paints || []).find((p) => p && p.visible !== false && p.type === 'IMAGE');
  return f ? f.imageRef : null;
}

function subtreeContainsMember(nodeId, memberIdSet, childrenOfMap, byId, depth = 0) {
  if (memberIdSet.has(nodeId)) return true;
  if (depth >= 4) return false;
  const kids = childrenOfMap.get(nodeId) || [];
  return kids.some((k) => {
    const child = byId.get(k.id);
    return child && subtreeContainsMember(child.id, memberIdSet, childrenOfMap, byId, depth + 1);
  });
}

/**
 * @param {string} rowId
 * @param {{ columns: Array<{width:number, memberIds:string[]}> }} fact
 * @param {Map<string,object>} skeletonByNodeId — see classifyFreeformMember's
 *   own comment on why chrome identity is now sourced from here.
 * @returns {{ memberIdSet:Set<string>, passthroughIds:string[], chromeIds:string[], chromeBg:string|null }}
 */
function classifyRowSetRow(rowId, fact, byId, childrenOfMap, skeletonByNodeId) {
  const memberIdSet = new Set();
  for (const col of fact.columns || []) {
    for (const id of col.memberIds || []) memberIdSet.add(id);
  }
  const rowNode = byId.get(rowId);
  const rowBox = rowSetBoxOf(rowNode);
  const directKids = (childrenOfMap.get(rowId) || []).map((k) => byId.get(k.id)).filter(Boolean);
  const passthroughIds = [];
  const chromeIds = [];
  let chromeBg = null;
  // Same real bug as the generic per-node case (see modeDecls()'s comment):
  // the chrome node being classified here has its own real cornerRadius/
  // strokes too (Figma-verified: Incentives' card chrome rect carries a real
  // 15%-white 1px stroke) — lifting only its fill and dropping these left
  // the VISIBLE member (chromeBg's whole point is to lift the hidden
  // chrome's look onto the member that replaces it) without them.
  let chromeCornerRadius = null;
  let chromeStrokeCss = null;
  let chromeStrokeWeight = null;
  // `rowBox`/`kidBox` are no longer needed for the chrome check itself (see
  // below), but the box-presence gates are kept exactly as before: a
  // box-less row or child was, and still is, skipped for member/passthrough
  // classification too, not just chrome — preserving that behavior exactly,
  // not just the chrome decision, is what this refactor is scoped to.
  if (rowBox) {
    for (const kid of directKids) {
      const kidBox = rowSetBoxOf(kid);
      if (!kidBox) continue;
      // Chrome identity now sourced from the Design Skeleton (compiler/
      // skeleton) instead of a second, independent isChromeBgRefined(kid,
      // rowBox) call — empirically verified to agree on every real
      // chrome-candidate node across this codebase's full fixture corpus
      // (26/26, 0 disagreements) before this swap was made, precisely
      // because the Skeleton classifies a leaf against its own direct NDG
      // parent's box, which for any direct child of a row-set row IS this
      // same rowBox. This consolidates what was the last of three
      // independent "which sibling is the chrome" decisions (docs/
      // FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.4) onto one
      // shared classification.
      const skelEntry = skeletonByNodeId && skeletonByNodeId.get(kid.id);
      if (skelEntry && skelEntry.role === ROLE_DECORATIVE_CHROME) {
        chromeIds.push(kid.id);
        if (!chromeBg) {
          chromeBg = solidFillCss(kid.paints);
          chromeCornerRadius = Number.isFinite(kid.geometry && kid.geometry.cornerRadius)
            ? kid.geometry.cornerRadius : null;
          chromeStrokeCss = solidFillCss(kid.attributes && kid.attributes.strokes);
          chromeStrokeWeight = Number.isFinite(kid.geometry && kid.geometry.strokeWeight)
            ? kid.geometry.strokeWeight : null;
        }
        continue;
      }
      if (memberIdSet.has(kid.id)) continue; // already a direct grid item
      if (subtreeContainsMember(kid.id, memberIdSet, childrenOfMap, byId)) {
        passthroughIds.push(kid.id);
      }
    }
  }
  return {
    memberIdSet, passthroughIds, chromeIds, chromeBg, chromeCornerRadius, chromeStrokeCss, chromeStrokeWeight,
  };
}

/**
 * `freeform-layout-ir` render wiring — consumes `RepeatingGroupMembership`
 * facts (docs/COMPILER_MIGRATION_BLUEPRINT.md §10) whenever one exists for a
 * node, generalizing (and, for any node a fact actually covers, superseding)
 * the narrower row-set wiring above. The fact schema only resolves each
 * member down to ONE leaf node per column (`memberColumnMap[columnId]` ->
 * `nodeId | null`) — it does not itself expose which intermediate
 * descendants are chrome backgrounds or pass-through wrappers, so (mirroring
 * `classifyRowSetRow`/`subtreeContainsMember` above, the already-blessed
 * precedent for this exact situation) this walks a member's own subtree
 * read-only, using the Design Skeleton's role classification (chrome
 * identity) plus the already-exported `boxOf` helper (box-presence gating),
 * to find: (a) which direct children are chrome backgrounds, and
 * (b) which nodes on the path from the member down to each resolved column
 * leaf are pass-through wrappers needing `display:contents` so the leaf
 * becomes a direct grid item of the member's own CSS Grid. This does NOT
 * re-derive the grouping/columns themselves (that remains the IR's job) —
 * it only re-derives the same "is this specific node chrome, or a
 * transparent wrapper" classification already legitimized for row-set.
 * @param {string} memberId
 * @param {Set<string>} leafIds — the member's own resolved column leaves
 *   (`Object.values(memberColumnMap)`, nulls excluded)
 * @param {Map<string,object>} skeletonByNodeId — Design Skeleton entries
 *   (compiler/skeleton), keyed by node id. Chrome identity (`role ===
 *   ROLE_DECORATIVE_CHROME`) is read from here instead of a second,
 *   independent `isChromeBgRefined(kid, memberBox)` call — empirically
 *   verified to agree on every real chrome-candidate node in this codebase's
 *   full fixture corpus (26/26, 0 disagreements) before this swap was made,
 *   precisely because the Skeleton classifies a leaf against its own direct
 *   NDG parent's box, which for any direct child of a member IS this same
 *   memberBox. Consolidates what was the last of three independent "which
 *   sibling is the chrome" decisions (docs/
 *   FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 4.2.4) onto one shared
 *   classification.
 * @returns {{ chromeIds:string[], chromeBg:string|null, passthroughIds:string[] }}
 */
function classifyFreeformMember(memberId, leafIds, byId, childrenOfMap, skeletonByNodeId) {
  const memberNode = byId.get(memberId);
  const memberBox = rowSetBoxOf(memberNode);
  const directKids = (childrenOfMap.get(memberId) || []).map((k) => byId.get(k.id)).filter(Boolean);
  const chromeIds = [];
  const passthroughIds = [];
  let chromeBg = null;
  // Same real bug as classifyRowSetRow's identical fix, above.
  let chromeCornerRadius = null;
  let chromeStrokeCss = null;
  let chromeStrokeWeight = null;

  function markPassthroughChain(nodeId, depth) {
    if (leafIds.has(nodeId)) return true; // reached a resolved column leaf — stop, it's a grid item.
    if (depth >= 5) return false;
    const kids = (childrenOfMap.get(nodeId) || []).map((k) => byId.get(k.id)).filter(Boolean);
    let any = false;
    for (const kid of kids) {
      if (markPassthroughChain(kid.id, depth + 1)) any = true;
    }
    if (any) passthroughIds.push(nodeId);
    return any;
  }

  if (memberBox) {
    for (const kid of directKids) {
      const kidBox = rowSetBoxOf(kid);
      if (!kidBox) continue;
      if (leafIds.has(kid.id)) continue; // already a direct grid item, nothing to classify.
      const skelEntry = skeletonByNodeId && skeletonByNodeId.get(kid.id);
      if (skelEntry && skelEntry.role === ROLE_DECORATIVE_CHROME) {
        chromeIds.push(kid.id);
        if (!chromeBg) {
          chromeBg = solidFillCss(kid.paints);
          chromeCornerRadius = Number.isFinite(kid.geometry && kid.geometry.cornerRadius)
            ? kid.geometry.cornerRadius : null;
          chromeStrokeCss = solidFillCss(kid.attributes && kid.attributes.strokes);
          chromeStrokeWeight = Number.isFinite(kid.geometry && kid.geometry.strokeWeight)
            ? kid.geometry.strokeWeight : null;
        }
        continue;
      }
      markPassthroughChain(kid.id, 0);
    }
  }
  return {
    chromeIds, chromeBg, chromeCornerRadius, chromeStrokeCss, chromeStrokeWeight, passthroughIds,
  };
}

/**
 * @param {object} document — raw Figma-like document (same shape emitArtifacts() requires)
 * @param {object} [opts]
 * @param {string} [opts.graphId]
 * @param {string} [opts.title]
 * @param {string} [opts.policyProfileId] — NDG policy profile (default 'pixel-faithful',
 *   matching the diagnostic scripts this function was promoted from)
 * @param {object} [opts.imageUrls] — nodeId (source Figma id) -> resolved URL, mirrors
 *   `emitArtifacts()`'s legacy-path `opts.imageUrls` (fallback lookup by node id).
 * @param {object} [opts.imageFillUrls] — imageRef -> resolved URL, mirrors
 *   `emitArtifacts()`'s legacy-path `opts.imageFillUrls` (primary lookup for any node
 *   carrying an `IMAGE`-type fill paint, regardless of the node's own Figma `type` —
 *   see `imageRefOf()` above).
 * @returns {Promise<{ html: string, css: string, graphId: string, nodeCount: number }>}
 */
async function renderIrExperimental(document, opts = {}) {
  if (!document) {
    throw new Error('renderIrExperimental requires document');
  }
  const imageFillUrls = opts.imageFillUrls || {};
  const graphId = opts.graphId || `g:ir-experimental:${Date.now()}`;
  const ws = createWorkspace();
  const ndg = await materializeNormalizedDesignGraph({
    workspace: ws,
    policy: { profileId: opts.policyProfileId || 'pixel-faithful' },
    document,
    graphId,
  });
  const graph = ndg.graph;
  // `imageUrls`/`svgMarkup` are keyed by raw Figma node id, but built by
  // legacy, NDG-bypassing code (server/figma-generate.js's SVG icon
  // reconstruction) that has no idea NDG might collapse the exact node that
  // id refers to — re-key using NDG's own collapse record so a lookup by
  // the post-collapse survivor id still finds it. See rekeyForNdgCollapse's
  // own header comment for the full root-cause explanation.
  const imageUrls = rekeyForNdgCollapse(opts.imageUrls || {}, ndg.events);
  const svgMarkup = rekeyForNdgCollapse(opts.svgMarkup || {}, ndg.events);
  // See collapsedWrapperBoxBySurvivorId's own comment: the collapsed
  // wrapper's ORIGINAL box (not the promoted child's own, tighter one) is
  // what should size/position an icon rendered via reconstructed SVG.
  const rawNodesById = indexRawNodesById(document);
  const collapsedWrapperBoxByNodeId = collapsedWrapperBoxBySurvivorId(ndg.events, rawNodesById);
  const index = indexGraph(graph);
  const detectedGeometry = detectGeometry(graph, {});
  const interpretations = interpretGraph(graph, index, {
    recognitionHintsByNode: detectedGeometry.recognitionHintsByNode,
  });
  const interpByNodeId = new Map(interpretations.map((i) => [i.nodeId, i]));

  const geometryCandidatesByNode = {};
  for (const c of detectedGeometry.candidates || []) {
    geometryCandidatesByNode[c.nodeId] = c;
  }
  const detectedComponent = detectComponentGeometry(graph, { geometryCandidatesByNode });
  const cardByNodeId = new Map((detectedComponent.cardFacts || []).map((c) => [c.nodeId, c]));
  const bannerByNodeId = new Map((detectedComponent.bannerFacts || []).map((b) => [b.nodeId, b]));

  // Design Skeleton (docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 3)
  // — built once, here, so this renderer consumes it rather than
  // re-materializing its own detection stack (the exact architecture-
  // contract violation that document's Precedent section confirmed against
  // this file). v0 wraps `compiler/freeform-layout`'s already-proven
  // clustering verbatim (`skeleton.freeformGroups` IS `detectFreeformLayout`'s
  // own `groups` output — same call, same `componentDetected` seed-hint
  // threading, zero behavior change) and additionally exposes a per-node
  // `readingOrder`, used below in place of the narrower, single-case
  // `orderChildrenVisualY` call this generalizes (see that call site's own
  // comment). Role classification isn't consumed by this renderer yet —
  // this is an incremental wiring step, not the full migration.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const designSkeleton = buildDesignSkeleton(graph, { componentDetected: detectedComponent });
  const skeletonByNodeId = new Map(designSkeleton.nodes.map((n) => [n.nodeId, n]));
  const freeformGroups = designSkeleton.freeformGroups || [];
  const freeformClaimedNodeIds = new Set();
  for (const g of freeformGroups) {
    freeformClaimedNodeIds.add(g.containerNodeId);
    for (const m of g.members) freeformClaimedNodeIds.add(m.nodeId);
  }

  // Row-set (repeating-pattern / table) wiring — see the classifyRowSetRow/
  // subtreeContainsMember header comment above for the full design rationale.
  // Facts whose container node is already claimed by a `freeform-layout-ir`
  // group are skipped here (mutual exclusion, same shape as the existing
  // row-set/card-grid mutual-exclusion check) — the generalized mechanism,
  // wired below, takes over for that node instead.
  const rowSetFacts = (detectedComponent.rowSetFacts || []).filter(
    (r) => !freeformClaimedNodeIds.has(r.nodeId)
  );
  const rowSetContainerByNodeId = new Map(rowSetFacts.map((r) => [r.nodeId, r]));
  const rowSetRowInfoByNodeId = new Map(); // rowId -> { fact, chromeBg, hasChrome }
  const rowSetPassthroughByNodeId = new Set(); // nodeId -> pass-through wrapper needing display:contents
  const rowSetChromeHiddenByNodeId = new Set(); // nodeId -> chrome node whose color was lifted onto its row
  const rowSetGridItemIds = new Set(); // nodeId -> a recognized column member (must not render position:absolute)
  for (const fact of rowSetFacts) {
    for (const col of fact.columns || []) {
      for (const id of col.memberIds || []) rowSetGridItemIds.add(id);
    }
    for (const rowId of fact.orderedChildIds || []) {
      const {
        passthroughIds, chromeIds, chromeBg, chromeCornerRadius, chromeStrokeCss, chromeStrokeWeight,
      } = classifyRowSetRow(rowId, fact, byId, index.childrenOf, skeletonByNodeId);
      rowSetRowInfoByNodeId.set(rowId, {
        fact, chromeBg, chromeCornerRadius, chromeStrokeCss, chromeStrokeWeight, hasChrome: chromeIds.length > 0,
      });
      for (const id of passthroughIds) rowSetPassthroughByNodeId.add(id);
      for (const id of chromeIds) rowSetChromeHiddenByNodeId.add(id);
    }
  }

  // `freeform-layout-ir` wiring — see classifyFreeformMember's header comment
  // above for the full design rationale. Builds the same shape of lookup
  // maps as the row-set wiring above (container fact, per-member fact,
  // pass-through/chrome-hidden node sets, grid-item exclusion set, plus an
  // explicit per-leaf grid-line placement map row-set didn't need because
  // row-set never had to tolerate a missing column).
  const freeformContainerByNodeId = new Map(); // containerNodeId -> group
  const freeformMemberByNodeId = new Map(); // memberNodeId -> { group, member, chromeBg }
  const freeformPassthroughByNodeId = new Set();
  const freeformChromeHiddenByNodeId = new Set();
  const freeformGridItemIds = new Set(); // nodeId -> a resolved column leaf (must not render position:absolute)
  const freeformPlacementByNodeId = new Map(); // nodeId -> { axis, order }
  for (const group of freeformGroups) {
    freeformContainerByNodeId.set(group.containerNodeId, group);
    for (const member of group.members) {
      const leafIds = new Set(Object.values(member.memberColumnMap).filter(Boolean));
      const {
        chromeIds, chromeBg, chromeCornerRadius, chromeStrokeCss, chromeStrokeWeight, passthroughIds,
      } = classifyFreeformMember(member.nodeId, leafIds, byId, index.childrenOf, skeletonByNodeId);
      freeformMemberByNodeId.set(member.nodeId, {
        group, member, chromeBg, chromeCornerRadius, chromeStrokeCss, chromeStrokeWeight,
      });
      for (const id of chromeIds) freeformChromeHiddenByNodeId.add(id);
      for (const id of passthroughIds) freeformPassthroughByNodeId.add(id);
      for (const [columnId, nodeId] of Object.entries(member.memberColumnMap)) {
        if (!nodeId) continue;
        // A real, general gap found by wiring the renderer (not specific to
        // any one fixture — see docs/COMPILER_MIGRATION_BLUEPRINT.md §10's
        // own disclosed `group:src:1:4` finding, "does not yet generalize
        // cleanly"): `detectFreeformLayout` walks EVERY parent unconditionally,
        // so nested/overlapping groups are possible — a node that is itself
        // the container or a member of its OWN (often cleaner, zero-null)
        // group can ALSO turn up as a plain column-leaf value inside a
        // different, unrelated ANCESTOR group's `memberColumnMap`. Treating
        // it as a leaf there too would force conflicting decls onto the same
        // node (e.g. an outer group's `grid-row` placement landing on a
        // node that is already a table row with its own `grid-template-columns`,
        // and — worse — would wrongly exclude it from the coordinate-absolute
        // fallback it needs for correct real-position stacking, since leaf
        // grid items must stay in-flow). This is a general precedence rule
        // (innermost/most-specific group role wins), not a fixture-specific
        // patch: skip marking a node as a plain leaf grid item of ANY group
        // if it is itself already a container or member of ANY group
        // (including a different one).
        if (freeformClaimedNodeIds.has(nodeId)) continue;
        freeformGridItemIds.add(nodeId);
        const col = member.columns.find((c) => c.columnId === columnId);
        if (col) freeformPlacementByNodeId.set(nodeId, { axis: group.axis, order: col.order });
      }
    }
  }

  // Flex/grid conversion for freeform-layout-ir groups (docs/
  // COMPILER_MIGRATION_BLUEPRINT.md's flex/grid-conversion research) —
  // computed once per group, up front, so both the container (which needs
  // to know its own display/gap) and each member (which needs to know
  // whether to skip absolute positioning) can look up the same verdict.
  const freeformFlowSafetyByContainerId = new Map(); // containerNodeId -> {flowSafe, orderedMemberIds, gap}
  const freeformFlowSafeMemberIds = new Set(); // memberNodeId -> in a flow-safe group
  for (const group of freeformGroups) {
    const membersWithBox = group.members.map((m) => ({ nodeId: m.nodeId, box: byId.get(m.nodeId) && byId.get(m.nodeId).box }));
    const containerNode = byId.get(group.containerNodeId);
    const safety = computeFreeformFlowSafety(membersWithBox, group.axis, containerNode && containerNode.box);
    freeformFlowSafetyByContainerId.set(group.containerNodeId, safety);
    if (safety.flowSafe) {
      for (const m of group.members) freeformFlowSafeMemberIds.add(m.nodeId);
    }
  }

  const layoutIrLike = {
    payload: {
      nodes: interpretations.map((i) => ({
        nodeId: i.nodeId,
        mode: i.modeCandidates && i.modeCandidates[0] ? i.modeCandidates[0].mode : 'unknown',
      })),
    },
  };
  const rawDetectedResponsive = detectResponsive(graph, { layoutIr: layoutIrLike, policy: {} });
  // detectResponsive() (compiler/responsive/detect.js) keys every adaptation
  // by the NDG graph node's OWN id (compiler/ndg/ids.js's stableCompileId(),
  // literally `src:${sourceNodeId}`) — but the render tree's own `nodeId`
  // (this file, buildRenderNode: `nodeId: node.sourceNodeId`) and therefore
  // materializeHtml()'s class-lookup (registry.responsiveClassByNode.get(
  // node.nodeId)) both use the RAW sourceNodeId, with no `src:` prefix.
  // Real, verified bug: every single adaptation's lookup silently missed —
  // 100% of the "Responsive (Phase 4)" CSS block was dead on every compile,
  // for every design, never assigned to any element. Remap here, once, right
  // at the boundary between the two id worlds.
  const sourceNodeIdById = new Map(graph.nodes.map((n) => [n.id, n.sourceNodeId]));
  const detectedResponsive = {
    ...rawDetectedResponsive,
    adaptations: (rawDetectedResponsive.adaptations || []).map((a) => ({
      ...a,
      nodeId: sourceNodeIdById.get(a.nodeId) || a.nodeId,
    })),
  };

  const roots = graph.nodes.filter((n) => (
    !graph.nodes.some((p) => (index.childrenOf.get(p.id) || []).some((k) => k.id === n.id))
  ));

  // Real font family names used across the whole document, collected as
  // buildRenderNode walks every TEXT node (same purpose as legacy's `ctx.fonts`
  // Set in server/figma-generate.js's nodeDecls()/analyze()) — threaded into
  // materializeHtml() below so the document shell can emit a real Google
  // Fonts <link>, mirroring server/figma-build.js's fontsLink() exactly.
  const fonts = new Set();

  function buildRenderNode(node, parentBox, parentAttrs) {
    const interp = interpByNodeId.get(node.id);
    const top = interp && interp.modeCandidates && interp.modeCandidates[0];
    const cardFact = cardByNodeId.get(node.id);
    const bannerFact = bannerByNodeId.get(node.id);
    const rowSetContainerFact = rowSetContainerByNodeId.get(node.id);
    const rowSetRowInfo = rowSetRowInfoByNodeId.get(node.id);
    const isRowSetPassthrough = rowSetPassthroughByNodeId.has(node.id);
    const isRowSetChromeHidden = rowSetChromeHiddenByNodeId.has(node.id);
    const isRowSetGridItem = rowSetGridItemIds.has(node.id);
    const freeformGroupFact = freeformContainerByNodeId.get(node.id);
    const freeformMemberFact = freeformMemberByNodeId.get(node.id);
    const isFreeformPassthrough = freeformPassthroughByNodeId.has(node.id);
    const isFreeformChromeHidden = freeformChromeHiddenByNodeId.has(node.id);
    const isFreeformGridItem = freeformGridItemIds.has(node.id);
    const freeformPlacement = freeformPlacementByNodeId.get(node.id);
    // Native Figma Grid Auto Layout (layoutMode:'GRID') — a real declared
    // layout, confirmed via a real fixture to previously fall through to
    // unstyled block flow because nothing recognized it at all:
    // layout/interpret.js's sourceFlowMode only checks HORIZONTAL/VERTICAL
    // (a narrower, separate gap from this one), so this is resolved
    // directly here instead of relying on that path. See ingest.js's
    // comment for why the child-placement fields need no clustering, only
    // reading — Figma already gives every child an explicit 0-based
    // row/column anchor + span.
    const nodeAttrs = node.attributes || {};
    const isRealGridContainer = String(nodeAttrs.layoutMode || '').toUpperCase() === 'GRID';
    const parentIsRealGrid = String((parentAttrs && parentAttrs.layoutMode) || '').toUpperCase() === 'GRID';
    const hasRealGridPlacement = parentIsRealGrid
      && nodeAttrs.gridRowAnchorIndex != null
      && nodeAttrs.gridColumnAnchorIndex != null;
    // Image-fill resolution — see imageRefOf()'s header comment above. Only
    // considered for non-TEXT nodes: a TEXT node's own paint is its font
    // color (see the isText flag below / css-declarations.js's modeDecls()),
    // never an image fill in practice, and guarding here keeps that
    // pre-existing text-color behavior untouched no matter what a node's
    // paints array happens to contain.
    const isTextNode = String(node.type || '').toUpperCase() === 'TEXT';
    const imageRef = !isTextNode ? imageRefOf(node) : null;
    // A Figma VECTOR node (icon/arrow/decorative path — never has an IMAGE
    // paint, `imageRefOf` never matches it) has real path geometry the
    // server-side SVG reconstruction (`server/figma-generate.js`'s
    // `reconstructSvgMarkup`, keyed by raw sourceNodeId) already resolves —
    // it was simply never threaded into this renderer. Reusing the existing
    // <img src> rendering path (materialize-html.js) via a data: URI is the
    // smallest change: no new render branch, same contract as an image fill.
    const svgForNode = !isTextNode ? svgMarkup[node.sourceNodeId] : null;
    const isImageFill = Boolean(imageRef) || Boolean(svgForNode);
    const imageSrc = imageRef
      ? ((imageFillUrls[imageRef]) || imageUrls[node.sourceNodeId] || '')
      : (svgForNode ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgForNode)}` : '');
    // See collapsedWrapperBoxBySurvivorId's own comment: use the collapsed
    // wrapper's ORIGINAL box (a consistent icon-container size/position, e.g.
    // 24x24) instead of this node's own tighter/differently-offset one, but
    // only when this node is actually the thing standing in for that
    // wrapper (svgForNode) — an ordinary node that merely happens to have
    // been some other unrelated wrapper's sole child keeps its own real box.
    const effectiveBox = (svgForNode && collapsedWrapperBoxByNodeId.has(node.sourceNodeId))
      ? collapsedWrapperBoxByNodeId.get(node.sourceNodeId)
      : node.box;
    // A recognized row-set row must stack at its OWN real y-position, not
    // wherever its raw graph/layer order happens to place it in document
    // flow — real-fixture validation (Challenge Arena) showed the table's
    // 4 rows are NOT stored in top-to-bottom visual order in the source
    // document (layer order is 001, 003, 004, 002), so letting a row fall
    // back to whatever in-flow mode layout.interpret assigned it (e.g.
    // flow-row) would stack rows in that scrambled layer order instead of
    // their real vertical order. Forcing 'absolute' here reuses the exact
    // same freeform-fallback mechanism below (left/top from the node's own
    // box) that already correctly positions row 1 (whose interpreted mode
    // already happened to be 'unknown') — this just makes that positioning
    // unconditional for EVERY recognized row, not incidental.
    const forcedAbsoluteRow = !!(rowSetRowInfo && rowSetRowInfo.hasChrome);
    // Every `freeform-layout-ir` member gets the same treatment, generalized
    // beyond "only when it has chrome": this fact only exists for genuinely
    // freeform (no-Auto-Layout) repeating shapes in the first place, and the
    // document-order-vs-visual-order bug the row-set precedent found is a
    // property of freeform Figma content in general (layer order need not
    // match visual stacking order), not specific to any one fixture's shape.
    // A flow-safe freeform member (see computeFreeformFlowSafety above) no
    // longer needs the coordinate-absolute fallback at all: its container
    // becomes a real flex container (below), and reordering the container's
    // children to real visual order (also below) already solves the
    // document-order-vs-visual-order problem the forced-absolute path
    // existed for — so this is the one case explicitly EXCLUDED from that
    // forcing, not an additional case added to it.
    const isFlowSafeFreeformMember = freeformMemberFact && freeformFlowSafeMemberIds.has(node.id);
    const forcedAbsoluteFreeformMember = !!freeformMemberFact && !isFlowSafeFreeformMember;
    // A real declared Grid Auto Layout wins over every guessed mode, the
    // same way a real HORIZONTAL/VERTICAL layoutMode already does via
    // sourceFlowMode's 0.85 score in layout/interpret.js — checked first,
    // unconditionally, since this is Figma's own explicit answer, not an
    // inference to weigh against others.
    let resolvedMode = isRealGridContainer
      ? 'grid-real'
      : (forcedAbsoluteRow || forcedAbsoluteFreeformMember) ? 'absolute' : (top ? top.mode : 'unknown');
    // A freeform-layout-ir column leaf (already reliably identified — it
    // resolved as a repeating-group column in detect.js) is a small
    // icon+text-style wrapper whose own children MUST lay out side-by-side/
    // stacked for it to render at all (min-height/align-items only apply to
    // flow-row/flow-column/grid-track — see modeDecls()). `interpretGraph`'s
    // generic geometry recognizer is fragile to an extra overlapping sibling
    // (verified directly: Challenge Arena row 1's version of this exact
    // wrapper has 2 children and resolves 'flow-row' fine; row 3/4's version
    // has a 3rd child — a decorative duplicate rectangle sharing the image's
    // exact box — which the 2-child clustering heuristic doesn't tolerate,
    // so it falls through to 'unknown' and silently loses its own flex
    // layout). Since this node is already confirmed to need its own real
    // internal arrangement (it's a grid leaf, not a leaf value), derive a
    // fallback directly from its own children's raw boxes when the generic
    // recognizer found nothing usable — never overrides a real recognized
    // mode.
    if (isFreeformGridItem && (resolvedMode === 'unknown' || resolvedMode === 'mixed')) {
      const kidsRaw = (index.childrenOf.get(node.id) || []).map((k) => byId.get(k.id)).filter((k) => k && k.box);
      if (kidsRaw.length >= 2) {
        const xs = kidsRaw.map((k) => k.box.x);
        const ys = kidsRaw.map((k) => k.box.y);
        const xSpread = Math.max(...xs) - Math.min(...xs);
        const ySpread = Math.max(...ys) - Math.min(...ys);
        resolvedMode = xSpread >= ySpread ? 'flow-row' : 'flow-column';
      }
    }
    const mode = resolvedMode;
    const layoutChoice = {
      mode,
      gap: interp ? interp.gap : null,
      padding: interp ? interp.padding : null,
      fillCss: solidFillCss(node.paints),
      // TEXT nodes' own fill paint is the font color, not a box background —
      // see css-declarations.js's modeDecls(), which reads this flag to emit
      // `color` instead of `background-color` for the same fillCss value.
      isText: String(node.type || '').toUpperCase() === 'TEXT',
      // A node's own corner-radius/stroke, read generically off NDG's ingest
      // for EVERY node — not gated on card/freeform-leaf recognition (see
      // modeDecls()'s own comment on why: real bug, a repeating-but-
      // unrecognized card frame with its own real fills+strokes+cornerRadius
      // — Figma-verified: fills 10% black, strokes 20% white 1px,
      // cornerRadius 20 — got neither, since cardChromeDecls only fires for
      // a resolved Component IR CardFact and freeformLeafChromeDecls only
      // for a freeform-layout-ir grid-item LEAF, and this node is neither).
      // buildDecls()'s overlay() replaces-by-key, never duplicates, so a
      // more specific cardFact/freeformLeafCornerRadius value applied later
      // still correctly wins over this generic one for the same node.
      // Every generic shape decoration below (corner-radius, stroke) is
      // suppressed when this node is being rendered via reconstructed SVG
      // markup (`svgForNode`, set above): `reconstructSvg()` already paints
      // this exact node's own fill/stroke as part of the SVG path data
      // itself, so a SEPARATE CSS border/outline on top of the `<img>`
      // would be pure duplication — confirmed as a real, visible bug (a
      // stray green outline around an otherwise-correct icon) on the one
      // real fixture where NDG's own structural collapse (see
      // rekeyForNdgCollapse's comment) promotes a stroked VECTOR leaf
      // directly into the render tree, something that never happens for a
      // multi-vector icon (its wrapping frame — which has no stroke of its
      // own — survives collapse instead).
      cornerRadius: (!svgForNode && Number.isFinite(node.geometry && node.geometry.cornerRadius))
        ? node.geometry.cornerRadius
        : null,
      // Unlike `paints` (top-level on the graph node, compiler/ndg/build.js),
      // `strokes` is nested under `attributes.strokes` there — verified
      // directly (a synthetic-shaped `node.strokes` read came back
      // `undefined` for a real Figma node with real, confirmed stroke data).
      strokeCss: svgForNode ? null : solidFillCss(node.attributes && node.attributes.strokes),
      strokeWeight: (!svgForNode && Number.isFinite(node.geometry && node.geometry.strokeWeight))
        ? node.geometry.strokeWeight
        : null,
      // CENTER/OUTSIDE stroke alignment (real-data audit: 244 of 290 real
      // strokes are CENTER or OUTSIDE, not INSIDE) — a plain CSS `border`
      // always sits fully inside the box (matches Figma's INSIDE align
      // only); modeDecls() reads this to switch to `outline` (which
      // supports a configurable `outline-offset`) for the other two.
      strokeAlign: svgForNode ? null : ((node.geometry && node.geometry.strokeAlign) || null),
      // Real, per-side stroke widths (e.g. a border-bottom-only divider) —
      // when present, wins over the single uniform `strokeWeight` above.
      individualStrokeWeights: svgForNode ? null : ((node.geometry && node.geometry.individualStrokeWeights) || null),
      // Real per-node clip flag (Figma's `clipsContent`) — previously always
      // false on real data because it was read via the wrong field
      // (`attributes.overflow`, sourced from `overflowDirection`, a
      // different Figma concept: scroll direction, not clipping — see
      // ingest.js's comment). modeDecls() applies this the same way
      // canvasDecls() already does for the page root, generalized per-node.
      clips: !!(node.attributes && node.attributes.clipsContent === true),
      // Figma's compositing blend mode — present on every node in every
      // fixture (Figma never omits it, even at its NORMAL/PASS_THROUGH
      // default); ingested but never emitted anywhere before this.
      blendMode: (node.geometry && node.geometry.blendMode) || null,
      // A dash-pattern array (e.g. [10,10]) vs. absent — modeDecls() maps
      // presence to CSS `border-style:dashed`, mirroring the exact,
      // already-correct legacy pattern (server/figma-generate.js's
      // strokeCss()) rather than attempting exact dash/gap lengths (which
      // plain CSS borders can't express anyway).
      strokeDashes: (node.geometry && node.geometry.strokeDashes) || null,
      // Native Figma Grid Auto Layout — see this function's own comment on
      // isRealGridContainer/hasRealGridPlacement above. gridColumnsTemplate/
      // gridRowsTemplate carry Figma's own near-literal CSS track strings
      // when present and safe to trust verbatim (sanitizeGridTrackString);
      // gridColumnCount/gridRowCount survive as a plain-integer fallback
      // for modeDecls() to build an equivalent repeat(N, ...) track list
      // when the sizing string is absent or fails sanitization.
      gridColumnCount: (isRealGridContainer && Number.isFinite(nodeAttrs.gridColumnCount))
        ? nodeAttrs.gridColumnCount : null,
      gridRowCount: (isRealGridContainer && Number.isFinite(nodeAttrs.gridRowCount))
        ? nodeAttrs.gridRowCount : null,
      gridColumnsTemplate: isRealGridContainer ? sanitizeGridTrackString(nodeAttrs.gridColumnsSizing) : null,
      gridRowsTemplate: isRealGridContainer ? sanitizeGridTrackString(nodeAttrs.gridRowsSizing) : null,
      gridRowGap: (isRealGridContainer && Number.isFinite(nodeAttrs.gridRowGap)) ? nodeAttrs.gridRowGap : null,
      gridColumnGap: (isRealGridContainer && Number.isFinite(nodeAttrs.gridColumnGap)) ? nodeAttrs.gridColumnGap : null,
      // Explicit 1-based grid-row/grid-column placement for a child of a
      // real Grid Auto Layout container — sourced directly from Figma's own
      // 0-based anchor + span, never inferred from document order (which,
      // per this file's other recognized-group comments, is not guaranteed
      // to match visual order anyway).
      gridPlacement: hasRealGridPlacement ? {
        rowStart: nodeAttrs.gridRowAnchorIndex + 1,
        rowSpan: Number.isFinite(nodeAttrs.gridRowSpan) && nodeAttrs.gridRowSpan > 0 ? nodeAttrs.gridRowSpan : 1,
        colStart: nodeAttrs.gridColumnAnchorIndex + 1,
        colSpan: Number.isFinite(nodeAttrs.gridColumnSpan) && nodeAttrs.gridColumnSpan > 0 ? nodeAttrs.gridColumnSpan : 1,
      } : null,
      // A full fill/gradient result ({prop,value}) — see css-declarations.js's
      // paintCss() — kept SEPARATE from the plain-string `fillCss` above
      // (used for TEXT color and the root canvas background, neither of
      // which should attempt a gradient): 0 real gradient TEXT nodes exist
      // in our corpus, and a text-color gradient needs a different CSS
      // mechanism (background-clip:text) not worth building unverified.
      fillPaint: paintCss(node.paints, node.box),
      // Figma's ELLIPSE has no `cornerRadius` field at all — roundness is
      // intrinsic to the node TYPE, not a numeric property (verified: real
      // ellipse node's cornerRadius is `undefined`). modeDecls() reads this
      // to force `border-radius:50%` regardless of the (absent) cornerRadius.
      isEllipse: String(node.type || '').toUpperCase() === 'ELLIPSE',
      // The node's OWN overall opacity (Figma: "this whole layer, all its
      // content, at N% opacity") — distinct from a fill's own paint-level
      // opacity (already folded into fillCss/fillPaint's color via
      // figmaColor()). Ingested but never emitted anywhere before this.
      nodeOpacity: Number.isFinite(node.geometry && node.geometry.opacity)
        ? node.geometry.opacity
        : null,
      // Real-data audit: 56 rotated nodes, ALL exactly ±90deg or ±180deg —
      // but the 2 that are ±90deg are BOTH type GROUP, and Figma's own
      // `absoluteBoundingBox` for a rotated node is already the POST-
      // rotation axis-aligned box (verified: a 90deg-rotated 411x42 node's
      // box is 42x411 — width/height swapped). Since every OTHER descendant
      // is independently positioned via its own absolute box, a GROUP's
      // rotation is already fully reflected in its children's real
      // positions with no transform needed — applying one would rotate an
      // already-correctly-oriented subtree a second time. Every non-GROUP
      // rotated node in real data is exactly 180deg, which never swaps
      // width/height, so applying `transform:rotate()` directly to THIS
      // node's own (already up-to-date) box is safe with no basis conflict.
      // Not verified safe for arbitrary non-180deg non-GROUP rotation —
      // revisit the width/height basis question above if that ever occurs.
      rotationDeg: (String(node.type || '').toUpperCase() !== 'GROUP'
        && Number.isFinite(node.geometry && node.geometry.rotation)
        && Math.abs(node.geometry.rotation) > 0.001)
        ? (node.geometry.rotation * 180) / Math.PI
        : null,
    };
    // Typography — TEXT nodes only, read straight off NDG's own ingest
    // (compiler/ndg/ingest.js's workingNodeFromRaw, which reads these from
    // the raw Figma node's nested `style` object). Only push a field when
    // NDG actually carries it (never invent a fallback value) — mirrors the
    // "only push if finite/present" contract css-declarations.js already
    // follows for width/height. Collected onto `fonts` (this closure's Set,
    // declared alongside `roots` below) so the document shell can link the
    // real Google Fonts the design uses, mirroring legacy's `ctx.fonts`
    // collection in server/figma-generate.js's nodeDecls().
    if (layoutChoice.isText && node.attributes) {
      const attrs = node.attributes;
      if (attrs.fontName) {
        layoutChoice.fontFamily = attrs.fontName;
        fonts.add(attrs.fontName);
      }
      if (Number.isFinite(attrs.fontSize)) layoutChoice.fontSize = attrs.fontSize;
      if (Number.isFinite(attrs.fontWeight)) layoutChoice.fontWeight = attrs.fontWeight;
      if (Number.isFinite(attrs.letterSpacing)) layoutChoice.letterSpacing = attrs.letterSpacing;
      if (Number.isFinite(attrs.lineHeightPx)) layoutChoice.lineHeight = attrs.lineHeightPx;
      if (attrs.textCase) layoutChoice.textCase = attrs.textCase;
      // See ingest.js's textAutoResize comment — a "WIDTH_AND_HEIGHT" box is
      // sized to its own single-line text, so it must never wrap.
      if (attrs.textAutoResize === 'WIDTH_AND_HEIGHT') layoutChoice.textNoWrap = true;
      // Ingested since NDG's own ingest.js, never read anywhere until now —
      // real, confirmed bug (Figma "Why Participate?"): every heading is
      // LEFT (default, invisible either way since headings are single-line
      // and positioned by their own absolute box) but every description
      // paragraph is genuinely CENTER — silently dropped, rendering flush-
      // left instead. Figma's JUSTIFIED has a direct CSS equivalent too.
      if (attrs.textAlignHorizontal) layoutChoice.textAlign = attrs.textAlignHorizontal;
      // Nests under raw.style like textCase/textAlignHorizontal above;
      // legacy server/figma-generate.js already emits this correctly for
      // UNDERLINE/STRIKETHROUGH — simply never ported into this renderer.
      if (attrs.textDecoration) layoutChoice.textDecoration = attrs.textDecoration;
    }
    // Freeform Figma content (no Auto Layout anywhere) has no declared
    // flow/absolute signal at all, so layout.interpret's fallback leaves it
    // 'unknown'. Rather than emit no positioning whatsoever (collapsing
    // every sibling into plain document flow — see docs/
    // COMPILER_MIGRATION_BLUEPRINT.md's renderer-parity findings), fall
    // back to the node's own raw box geometry, same as a declared-absolute
    // node — this is the "Path B: freeform -> absolute-that-scales"
    // strategy the legacy dual-path emitter already uses for this exact case.
    // Skipped for a recognized row-set column member: it needs to stay a
    // normal in-flow box so its row's CSS Grid can auto-place it into the
    // matching explicit column track — position:absolute would remove it
    // from grid flow entirely.
    // Whether THIS node needs an absolute offset from its own parent is a
    // question about the PARENT's arrangement, not about how this node
    // arranges its OWN children (`mode`, above, answers that second,
    // unrelated question — see docs/COMPILER_MIGRATION_BLUEPRINT.md's
    // RenderNode-stage trace: a node with real internal structure, e.g. a
    // title+description pair, legitimately resolves `mode: 'flow-column'`
    // for its own children, but that has no bearing on whether IT is
    // parent-positioned). A parent with no declared Figma Auto Layout
    // (`layoutMode` null/absent) placed every direct child by raw x/y —
    // every such child needs this offset regardless of its own mode.
    // Corpus-audited before this change (Challenge Arena 37/37, Articles
    // 18/19, IBM 105/120 flow-mode nodes have a freeform parent) — the
    // child-arrangement declarations below (flow-row/flow-column/grid-track)
    // are untouched by this condition, so a node can be both
    // `display:flex` for its own children and `position:absolute` for its
    // own placement at the same time (see css-declarations.js's modeDecls(),
    // restructured to allow both non-exclusively).
    // A `display:contents` passthrough node (row-set/freeform) generates no
    // box at all — position/left/top/width are inert on it per the CSS spec,
    // and worse, its children's OWN `position:absolute` then resolves against
    // whatever real ancestor box happens to be positioned instead (silently
    // losing this node's intended offset). Must stay excluded from this gate
    // exactly like isRowSetGridItem/isFreeformGridItem above.
    const isDisplayContentsPassthrough = isRowSetPassthrough || isFreeformPassthrough;
    const parentHasAutoLayout = !!(parentAttrs && parentAttrs.layoutMode);
    if (
      (mode === 'absolute' || mode === 'unknown' || !parentHasAutoLayout) && effectiveBox && parentBox
      && !isRowSetGridItem && !isFreeformGridItem && !isDisplayContentsPassthrough && !isFlowSafeFreeformMember
      && !hasRealGridPlacement
    ) {
      layoutChoice.left = effectiveBox.x - parentBox.x;
      layoutChoice.top = effectiveBox.y - parentBox.y;
      if (Number.isFinite(effectiveBox.width)) layoutChoice.width = effectiveBox.width;
      if (Number.isFinite(effectiveBox.height)) layoutChoice.height = effectiveBox.height;
    }
    // A flow-safe freeform member is a REAL flex child of its (now
    // flex-container) parent — no left/top at all, since flex placement
    // handles that — but its own explicit width/height are still preserved
    // as sizing hints (min-height, never a hard height, same "measured box
    // vs. actual rendered size" reasoning every other leaf/container in this
    // file already follows) so a flex-column's zero-gap tiling still matches
    // Figma's real row height, and naturally reflows later siblings down
    // (never overlapping them) if real content renders taller than measured.
    if (isFlowSafeFreeformMember && node.box) {
      if (Number.isFinite(node.box.width)) layoutChoice.width = node.box.width;
      if (Number.isFinite(node.box.height)) layoutChoice.height = node.box.height;
      // Tells css-declarations.js's modeDecls() to emit min-height/min-width
      // from that width/height regardless of this node's OWN `mode` (which
      // describes how it arranges its own children, an unrelated question —
      // see isFlowSafeFreeformMember's own comment above).
      layoutChoice.freeformFlowSafeMember = true;
      // The group's own axis identifies which dimension is this member's
      // flex MAIN axis (row→width, column→height) — verified real bug: a
      // row-axis group whose members don't sum to the container's full
      // width (Incentives' row 2, 2 cards vs. row 1's 3) leaves leftover
      // flex space, and a member sized only by `min-width` (no flex-basis)
      // silently expands into it (measured: 380px cards rendered at 600px/
      // 568px). The CROSS axis (height, for a row) correctly keeps
      // min-height's existing "never clip real content" behavior — only
      // the main axis needs pinning against this specific growth.
      layoutChoice.freeformFlowSafeMainAxis = freeformMemberFact.group.axis === 'row' ? 'width' : 'height';
    }
    if (cardFact) {
      layoutChoice.cardShape = cardFact.shape;
      layoutChoice.cardFact = { shape: cardFact.shape, padding: cardFact.padding };
    }
    if (bannerFact) {
      layoutChoice.bannerShape = true;
      layoutChoice.bannerFact = { padding: bannerFact.padding };
    }
    // Row-set (repeating-pattern / table) wiring — see this file's header
    // comment (above renderIrExperimental) for the full design rationale.
    if (rowSetContainerFact) {
      layoutChoice.rowSetContainer = { columns: rowSetContainerFact.columns };
    }
    if (rowSetRowInfo) {
      layoutChoice.rowSetRow = {
        columns: rowSetRowInfo.fact.columns,
        hasChrome: rowSetRowInfo.hasChrome,
        chromeBg: rowSetRowInfo.chromeBg,
        chromeCornerRadius: rowSetRowInfo.chromeCornerRadius,
        chromeStrokeCss: rowSetRowInfo.chromeStrokeCss,
        chromeStrokeWeight: rowSetRowInfo.chromeStrokeWeight,
        // The row's own absolute box — computeRowSetColumns() (geometry-
        // rules.js) already computes each column's real, cross-row-median
        // absolute x; without the row's own box to subtract against,
        // rowSetRowDecls() had no way to recover the row's real left inset
        // (its content starting some px in from its own chrome edge) and
        // hardcoded it to 0.
        rowBox: node.box ? { x: node.box.x, y: node.box.y } : null,
      };
    }
    if (isRowSetPassthrough) {
      layoutChoice.rowSetPassthrough = true;
    }
    if (isRowSetChromeHidden) {
      layoutChoice.rowSetChromeHidden = true;
    }
    // `freeform-layout-ir` wiring — see classifyFreeformMember's header
    // comment (above renderIrExperimental) for the full design rationale.
    // Consumed whenever a `RepeatingGroupMembership` fact matches this node
    // (container or member); if none matches, none of these fields are set
    // and every branch above (row-set, card/banner chrome, coordinate
    // fallback) runs exactly as it already did before this wiring existed.
    if (freeformGroupFact) {
      const flowSafety = freeformFlowSafetyByContainerId.get(node.id);
      layoutChoice.freeformGroupContainer = {
        axis: freeformGroupFact.axis,
        columns: freeformGroupFact.columns,
        flowSafe: !!(flowSafety && flowSafety.flowSafe),
        gap: flowSafety ? flowSafety.gap : 0,
        leadingOffset: flowSafety ? flowSafety.leadingOffset : 0,
        crossAxisOffset: flowSafety ? flowSafety.crossAxisOffset : 0,
      };
    }
    if (freeformMemberFact) {
      layoutChoice.freeformGroupMember = {
        axis: freeformMemberFact.group.axis,
        columns: freeformMemberFact.member.columns,
        chromeBg: freeformMemberFact.chromeBg,
        chromeCornerRadius: freeformMemberFact.chromeCornerRadius,
        chromeStrokeCss: freeformMemberFact.chromeStrokeCss,
        chromeStrokeWeight: freeformMemberFact.chromeStrokeWeight,
        crossInset: freeformMemberFact.group.crossInset,
      };
    }
    if (isFreeformChromeHidden) {
      layoutChoice.freeformChromeHidden = true;
    }
    if (isFreeformPassthrough) {
      layoutChoice.freeformPassthrough = true;
    }
    if (freeformPlacement) {
      layoutChoice.freeformGridPlacement = freeformPlacement;
    }
    // A freeform-layout-ir column leaf (e.g. a plain button/chip resolved as
    // one of a member's grid-placed columns) never matches a recognized
    // Component IR card/banner fact, so `cardChromeDecls` never runs for it
    // and it previously got NO border-radius at all even when the raw Figma
    // node genuinely has one — see css-declarations.js's
    // `freeformLeafChromeDecls` header comment. NDG's own ingest already
    // carries this verbatim off the raw node (`geometry.cornerRadius`,
    // compiler/ndg/ingest.js); this only reads it, never invents a default.
    if (isFreeformGridItem && node.geometry && Number.isFinite(node.geometry.cornerRadius)) {
      layoutChoice.freeformLeafCornerRadius = node.geometry.cornerRadius;
    }

    let kids = (index.childrenOf.get(node.id) || []).map((k) => byId.get(k.id)).filter(Boolean);
    // A flow-safe freeform container's children must be in real visual
    // order in the render tree/HTML — its members no longer carry explicit
    // left/top (see isFlowSafeFreeformMember above), so a real
    // display:flex/flex-direction container now positions them purely by
    // DOM order, and Figma's raw layer order is not guaranteed to match
    // visual order (confirmed on this exact fixture: Challenge Arena's 4
    // rows are stored 001, 003, 004, 002). Sourced from the Design Skeleton's
    // per-node `readingOrder` (compiler/skeleton), computed once for the
    // whole graph — provably equivalent to the narrower, single-case
    // orderChildrenVisualY call this replaces (see compiler/skeleton/
    // build.js's resolveReadingOrder comment and the dedicated equivalence
    // test in compiler/test/skeleton.test.js), so this is a pure
    // generalization, not a behavior change.
    const containerFlowSafety = freeformGroupFact && freeformFlowSafetyByContainerId.get(node.id);
    if (containerFlowSafety && containerFlowSafety.flowSafe) {
      kids = kids.slice().sort((a, b) => {
        const oa = skeletonByNodeId.get(a.id);
        const ob = skeletonByNodeId.get(b.id);
        return (oa ? oa.readingOrder : 0) - (ob ? ob.readingOrder : 0);
      });
    }
    const renderedKids = kids.map((k) => buildRenderNode(k, node.box, node.attributes));

    // A flex/grid container's natural (in-flow) height can fall short of its
    // real content whenever ANY child is rendered position:absolute — an
    // absolutely-positioned child contributes NOTHING to its parent's auto
    // height, no matter how much real content it holds. This was originally
    // scoped to "every child is absolute" (the total-collapse case), but a
    // MIXED container — one in-flow child (e.g. a short row-index label)
    // plus one or more absolute children carrying the bulk of the real
    // content — has exactly the same problem: the lone in-flow child's
    // short natural height is all the browser has to go on, so the
    // container still renders too short and the next sibling row overlaps
    // it. Use the container's own measured box height as a floor whenever
    // at least one child is out of flow. This is safe to apply this
    // broadly specifically because the declaration below is `min-height`,
    // not `height` (see css-declarations.js) — a container with enough
    // in-flow content already still grows past this floor; nothing gets
    // clipped, unlike the fixed-height version of this fallback that
    // caused real clipping earlier.
    if (
      (mode === 'flow-row' || mode === 'flow-column' || mode === 'grid-track')
      && node.box && Number.isFinite(node.box.height)
      && renderedKids.some((k) => isPositionedAbsolute(k.layoutChoice))
    ) {
      layoutChoice.height = node.box.height;
    }
    // Same collapse, perpendicular axis: a flex-COLUMN container whose
    // children are all/partly out of flow contributes nothing to its own
    // auto WIDTH either — this is not hypothetical, it is the confirmed
    // cause of a real overlap bug (docs/COMPILER_MIGRATION_BLUEPRINT.md,
    // freeform-layout-ir renderer integration follow-up): a title+description
    // wrapper nested inside a freeform-layout-ir grid cell collapsed to
    // width:0, forcing its absolutely-positioned text children to wrap into
    // a near-zero-width column and grow tall enough to visually overflow
    // into the next row. Same `min-width` (not `width`) reasoning as the
    // height fix above — a floor, never a clip.
    if (
      (mode === 'flow-row' || mode === 'flow-column' || mode === 'grid-track')
      && node.box && Number.isFinite(node.box.width)
      && renderedKids.some((k) => isPositionedAbsolute(k.layoutChoice))
    ) {
      layoutChoice.width = node.box.width;
    }

    return {
      nodeId: node.sourceNodeId,
      type: node.type,
      name: node.name,
      characters: node.attributes && node.attributes.characters,
      fontSize: node.attributes && node.attributes.fontSize,
      characterStyleOverrides: node.attributes && node.attributes.characterStyleOverrides,
      styleOverrideTable: node.attributes && node.attributes.styleOverrideTable,
      layoutChoice,
      box: node.box,
      fillCss: layoutChoice.fillCss,
      clips: layoutChoice.clips,
      // Design Skeleton role (compiler/skeleton) — 'decorative-chrome' /
      // 'leaf-shape' vs. real content. Consumed by materialize-html.js to
      // give decorative images an empty alt (rather than their raw Figma
      // layer name, e.g. "Rectangle 47" — a real, previously-shipped
      // accessibility gap, not hypothetical) and mark decorative non-text
      // elements aria-hidden. Purely an accessibility-attribute concern —
      // never read by anything that affects layout, CSS, or DOM structure.
      role: (skeletonByNodeId.get(node.id) || {}).role || null,
      // Image-fill resolution (see imageRefOf() above) — set for ANY node
      // (not just Figma type IMAGE) carrying an IMAGE-type fill paint, so
      // materialize-html.js's renderNode() can emit a real <img> for it.
      isImageFill,
      imageRef,
      src: imageSrc,
      children: renderedKids,
    };
  }

  const rootNode = roots[0] || graph.nodes[0];
  if (!rootNode) {
    // Empty/degenerate graph — still return the shape emitArtifacts() expects.
    return { html: '', css: '', graphId, nodeCount: 0 };
  }
  const renderTree = buildRenderNode(rootNode, null, null);
  const rendered = materializeHtml(renderTree, {
    title: opts.title || 'Compiled design',
    canvas: { fillCss: renderTree.fillCss, box: renderTree.box, clips: renderTree.clips },
    responsiveIr: {
      breakpoints: detectedResponsive.breakpoints,
      adaptations: detectedResponsive.adaptations,
    },
    fonts: [...fonts],
  });

  return {
    html: rendered.html,
    css: rendered.css,
    graphId,
    nodeCount: graph.nodes.length,
  };
}

module.exports = {
  renderIrExperimental,
  sanitizeGridTrackString,
  rekeyForNdgCollapse,
  indexRawNodesById,
  collapsedWrapperBoxBySurvivorId,
};
