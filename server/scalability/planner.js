'use strict';
/**
 * Request Planner — single source of truth for execution decisions.
 * Never calls Figma. Pure plan + refine helpers; Executor only executes.
 */

const figmaBuild = require('../figma-build');
const { reconstructSvgMarkup } = require('../figma-generate');
const {
  findPathToNode,
  selectCoveringFromPath,
  isSelfCoveringType,
  coverageTypeForNodeType,
} = require('./covering');

function emptyNeeds(overrides = {}) {
  return {
    structure: false,
    geometry: false,
    coveringGeometry: false,
    imageFills: false,
    svg: false,
    png: false,
    ...overrides,
  };
}

function basePlan(partial) {
  return {
    action: partial.action,
    cacheStrategy: partial.cacheStrategy,
    coveringStrategy: partial.coveringStrategy || 'none',
    cachePath: partial.cachePath || 'none',
    needs: partial.needs || emptyNeeds(),
    svgIds: partial.svgIds || [],
    pngIds: partial.pngIds || [],
    coveringNodeId: partial.coveringNodeId != null ? partial.coveringNodeId : null,
    coverageType: partial.coverageType || null,
    kind: partial.kind || null,
    requestedNodeId: partial.requestedNodeId != null ? partial.requestedNodeId : null,
    prediction: partial.prediction || { t1: 0, t2: 0 },
    estimate: partial.estimate || { t1: 0, t2: 0, t3: 0 },
    reason: partial.reason || '',
    warnings: partial.warnings || [],
    // Legacy compat for Budget / older callers
    needsLegacy: undefined,
  };
}

function syncEstimate(plan) {
  plan.estimate = {
    t1: plan.prediction.t1,
    t2: plan.prediction.t2,
    t3: 0,
  };
  return plan;
}

/**
 * Initial plan from cache probe + refresh (no document yet).
 */
function plan({ refresh, cacheHit, cachePath, nodeId = null }) {
  if (!refresh && cacheHit) {
    const strategy = cachePath === 'subtree' ? 'subtree' : 'exact';
    return syncEstimate(basePlan({
      action: 'offline_compile',
      cacheStrategy: strategy,
      coveringStrategy: 'none',
      cachePath: strategy,
      needs: emptyNeeds(),
      prediction: { t1: 0, t2: 0 },
      reason: strategy === 'subtree' ? 'subtree_hit_no_rest' : 'exact_hit_no_rest',
      requestedNodeId: nodeId,
    }));
  }

  if (!nodeId) {
    // URL without node-id → fetch default root frame (existing behavior).
    return syncEstimate(basePlan({
      action: 'execute_rest',
      cacheStrategy: refresh ? 'refresh' : 'miss',
      coveringStrategy: 'root_frame',
      cachePath: 'none',
      needs: emptyNeeds({
        geometry: true,
        imageFills: true,
        svg: true,
        png: true,
      }),
      prediction: { t1: 3, t2: 1 },
      reason: refresh ? 'refresh_root_frame' : 'miss_root_frame',
      requestedNodeId: null,
      kind: 'page',
    }));
  }

  // MISS / refresh with nodeId: fetch geometry first, then refine covering.
  return syncEstimate(basePlan({
    action: 'execute_rest',
    cacheStrategy: refresh ? 'refresh' : 'miss',
    coveringStrategy: 'pending_geometry',
    cachePath: 'none',
    needs: emptyNeeds({
      geometry: true,
      // structure / coveringGeometry set in refineAfterGeometry
      imageFills: true,
      svg: true,
      png: true,
    }),
    prediction: { t1: 4, t2: 1 },
    reason: refresh ? 'refresh_force_covering' : 'miss_pending_covering',
    requestedNodeId: nodeId,
  }));
}

/**
 * After requested-node geometry is available: decide self-cover vs structure discover.
 * Pure — no network.
 */
function refineAfterGeometry(plan, document, requestedNodeId) {
  const next = {
    ...plan,
    needs: { ...plan.needs },
    warnings: [...(plan.warnings || [])],
  };
  next.requestedNodeId = requestedNodeId;

  if (!document) {
    next.coveringStrategy = 'self';
    next.coveringNodeId = requestedNodeId;
    next.needs.structure = false;
    next.needs.coveringGeometry = false;
    next.reason = 'geometry_missing_fallback_self';
    return syncEstimate(next);
  }

  if (isSelfCoveringType(document.type)) {
    next.coveringStrategy = 'self';
    next.coveringNodeId = requestedNodeId;
    next.coverageType = coverageTypeForNodeType(document.type);
    next.kind = 'page';
    next.needs.structure = false;
    next.needs.coveringGeometry = false;
    next.prediction = { t1: 3, t2: 1 }; // geometry done + optional svg/png + fills
    next.reason = 'covering_self_' + next.coverageType;
    return syncEstimate(next);
  }

  // Need structure walk to find FRAME/SECTION/PAGE cover
  next.coveringStrategy = 'discover';
  next.needs.structure = true;
  next.needs.coveringGeometry = true;
  next.prediction = { t1: 4, t2: 1 };
  next.reason = 'covering_discover_required';
  return syncEstimate(next);
}

/**
 * After structure document loaded: pick covering id (Planner decision).
 */
function refineCoveringFromStructure(plan, structureDocument, requestedNodeId) {
  const next = {
    ...plan,
    needs: { ...plan.needs },
    warnings: [...(plan.warnings || [])],
  };

  const path = findPathToNode(structureDocument, requestedNodeId);
  if (!path) {
    next.coveringNodeId = requestedNodeId;
    next.coverageType = 'NODE';
    next.kind = 'exact';
    next.needs.coveringGeometry = false;
    next.coveringStrategy = 'self';
    next.warnings.push('node_not_in_structure_tree');
    next.reason = 'covering_fallback_requested_node';
    return syncEstimate(next);
  }

  const sel = selectCoveringFromPath(path);
  next.coveringNodeId = sel.coveringId;
  next.coverageType = sel.coverageType;
  next.kind = sel.kind;
  next.coveringStrategy = 'discover';

  if (String(sel.coveringId) === String(requestedNodeId)) {
    next.needs.coveringGeometry = false;
    next.reason = 'covering_equals_requested';
  } else {
    next.needs.coveringGeometry = true;
    next.reason = 'covering_' + sel.coverageType;
  }
  return syncEstimate(next);
}

/**
 * After covering document is final: gate fills / svg / png from tree content.
 * Same heuristics as former Executor (reconstruct-first SVG; PNG only if needed).
 */
function refineAfterCovering(plan, coveringDoc) {
  const next = {
    ...plan,
    needs: { ...plan.needs },
    svgIds: [],
    pngIds: [],
    warnings: [...(plan.warnings || [])],
  };

  if (!coveringDoc) {
    next.needs.imageFills = false;
    next.needs.svg = false;
    next.needs.png = false;
    next.reason = (next.reason || '') + '+empty_covering';
    return syncEstimate(recomputePrediction(next));
  }

  const analyzed = figmaBuild.analyze(coveringDoc);
  const localSvg = reconstructSvgMarkup(analyzed.svgNodes);
  const missingSvg = analyzed.svgNodeIds.filter((id) => !localSvg[id]);
  const usedRefs = [];
  (function walk(el) {
    if (!el) return;
    if (el.imageRef) usedRefs.push(el.imageRef);
    for (const c of el.children || []) walk(c);
  })(analyzed.tree);

  const pngIds = [
    ...analyzed.imageNodeIds.filter((id) => !(analyzed.svgNodes && analyzed.svgNodes[id])),
    // Vectors that failed local reconstruct and were not converted to img still need a raster fallback
    ...analyzed.svgNodeIds.filter((id) => !localSvg[id]),
  ];
  const pngUnique = [...new Set(pngIds)];

  next.needs.svg = missingSvg.length > 0;
  next.svgIds = missingSvg;
  next.needs.imageFills = usedRefs.length > 0;
  next.needs.png = pngUnique.length > 0;
  next.pngIds = pngUnique;
  next._analyzedCovering = analyzed; // Executor may reuse to avoid double analyze

  if (!next.needs.svg) next.warnings.push('svg_export_skipped_reconstruct_ok');
  if (!next.needs.imageFills) next.warnings.push('image_fills_skipped_no_refs');
  if (!next.needs.png) next.warnings.push('png_export_skipped_none_needed');

  next.reason = (plan.reason || 'covering') + '+assets_refined';
  return syncEstimate(recomputePrediction(next));
}

/** Recompute conservative prediction from current needs flags (post-refine). */
function recomputePrediction(plan) {
  let t1 = 0;
  let t2 = 0;
  // Already-fetched steps are not re-counted here for Budget (Budget runs pre-exec).
  // This prediction is informational for logs / future re-auth.
  if (plan.needs.structure) t1 += 1;
  if (plan.needs.geometry) t1 += 1;
  if (plan.needs.coveringGeometry) t1 += 1;
  if (plan.needs.svg) t1 += 1;
  if (plan.needs.png) t1 += 1;
  if (plan.needs.imageFills) t2 += 1;
  plan.prediction = { t1, t2 };
  return plan;
}

module.exports = {
  plan,
  refineAfterGeometry,
  refineCoveringFromStructure,
  refineAfterCovering,
  emptyNeeds,
  recomputePrediction,
};
