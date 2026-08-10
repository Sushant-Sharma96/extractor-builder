'use strict';
/**
 * Executor — executes Planner output only. No covering/asset business decisions.
 */

const figmaBuild = require('../figma-build');
const {
  fetchNode,
  fetchFileStructure,
  exportImages,
  fetchSvgMarkup,
  fetchImageFills,
} = require('../figma-fetch');
const { extractSubtree } = require('../figma-snapshot');
const planner = require('./planner');
const { logDebug, logWarn } = require('./request-log');

function collectUsedImageRefs(tree, set = new Set()) {
  if (!tree) return set;
  if (tree.imageRef) set.add(tree.imageRef);
  for (const c of tree.children || []) collectUsedImageRefs(c, set);
  return set;
}

function filterObjectKeys(obj, allow) {
  const out = {};
  if (!obj || !allow) return out;
  for (const k of allow) {
    if (obj[k]) out[k] = obj[k];
  }
  return out;
}

function fromSnapshot(snap) {
  return {
    document: snap.document,
    name: snap.name,
    imageFillUrls: snap.imageFillsRemote || {},
    imageUrls: snap.pngRemote || {},
    svgFallback: snap.svgFallback || {},
    localByUrl: snap.urlToAbs || null,
    analyzed: null,
    fetchedMeta: null,
  };
}

/** Run only asset fetches the plan still needs. */
async function executeAssetNeeds(plan, fileKey, coveringDoc, auth, restCounter, t0) {
  const svgFallback = {};
  let imageFillUrls = {};
  let imageUrls = {};

  if (plan.needs.svg && plan.svgIds && plan.svgIds.length) {
    logDebug('fetch_svg', { count: plan.svgIds.length });
    Object.assign(svgFallback, await fetchSvgMarkup(fileKey, plan.svgIds, auth, restCounter));
    // A batched SVG export can come back short (per-id render failure, transient
    // REST error swallowed inside exportImages' chunk loop) without throwing —
    // those ids would otherwise sit uncovered forever and pin the snapshot at
    // complete:false on every retry. Raster fallback makes completeness reachable.
    const stillMissing = plan.svgIds.filter((id) => !svgFallback[id]);
    if (stillMissing.length) {
      logWarn('svg_bake_incomplete_png_fallback', { count: stillMissing.length });
      const rasterUrls = await exportImages(fileKey, stillMissing, 'png', auth, 2, restCounter);
      Object.assign(imageUrls, rasterUrls);
    }
  }

  if (plan.needs.imageFills) {
    logDebug('fetch_image_fills', {});
    const allFills = await fetchImageFills(fileKey, auth, restCounter);
    const analyzed = plan._analyzedCovering || figmaBuild.analyze(coveringDoc);
    const usedRefs = collectUsedImageRefs(analyzed.tree);
    imageFillUrls = filterObjectKeys(allFills, usedRefs);
    logDebug('image_fills_filtered', {
      used: Object.keys(imageFillUrls).length,
      total: Object.keys(allFills).length,
    });
  } else {
    logDebug('skip_image_fills', {});
  }

  if (plan.needs.png && plan.pngIds && plan.pngIds.length) {
    // Prefer SVG for vector/icon ids (scalable, no scale=2 cost); PNG for true rasters.
    // If SVG batch returns nothing for an id, fall back to PNG for that id.
    const ids = plan.pngIds;
    logDebug('fetch_png', { count: ids.length, prefer: 'svg_then_png' });
    const svgUrls = await exportImages(fileKey, ids, 'svg', auth, 2, restCounter);
    const needPng = ids.filter((id) => !svgUrls[id]);
    const pngUrls = needPng.length
      ? await exportImages(fileKey, needPng, 'png', auth, 2, restCounter)
      : {};
    imageUrls = { ...svgUrls, ...pngUrls };
  } else {
    logDebug('skip_png', {});
  }

  logDebug('assets_ready', { ms: Date.now() - t0 });
  return { imageFillUrls, imageUrls, svgFallback };
}

/**
 * Execute REST plan from Planner (MISS path).
 * @param {{ plan: object, fileKey: string, nodeId: string|null, auth: object, restCounter: object, t0: number }}
 */
async function executeMiss({ plan: initialPlan, fileKey, nodeId, auth, restCounter, t0 }) {
  let plan = initialPlan;

  // ── No node-id: root frame path ───────────────────────────────────────────
  if (!nodeId) {
    if (!plan.needs.geometry) {
      throw new Error('Planner error: root miss requires needs.geometry');
    }
    const fetched = await fetchNode(fileKey, null, auth, { counter: restCounter });
    logDebug('node_fetched', { ms: Date.now() - t0, covering: 'root_frame', name: fetched.name });

    plan = {
      ...plan,
      coveringNodeId: fetched.document && fetched.document.id,
      coverageType: fetched.document && fetched.document.type === 'CANVAS' ? 'PAGE' : 'FRAME',
      kind: 'page',
    };
    plan = planner.refineAfterCovering(plan, fetched.document);

    const assets = await executeAssetNeeds(plan, fileKey, fetched.document, auth, restCounter, t0);
    if (plan._analyzedCovering) delete plan._analyzedCovering;
    const analyzed = figmaBuild.analyze(fetched.document);
    return {
      document: fetched.document,
      name: fetched.name,
      ...assets,
      localByUrl: null,
      analyzed,
      plan,
      fetchedMeta: {
        name: fetched.name,
        fileName: fetched.fileName,
        version: fetched.version,
        coveringDocument: fetched.document,
        coveringName: (fetched.document && fetched.document.name) || fetched.name,
        coveringNodeId: plan.coveringNodeId,
        coverageType: plan.coverageType,
        kind: plan.kind || 'page',
        requestedNodeId: null,
      },
    };
  }

  // ── Geometry for requested node ─────────────────────────────────────────
  if (!plan.needs.geometry) {
    throw new Error('Planner error: miss with nodeId requires needs.geometry');
  }
  const direct = await fetchNode(fileKey, nodeId, auth, { counter: restCounter });
  logDebug('node_fetched', { ms: Date.now() - t0, name: direct.name, nodeId });

  plan = planner.refineAfterGeometry(plan, direct.document, nodeId);
  logDebug('covering_strategy', { coveringStrategy: plan.coveringStrategy, reason: plan.reason });

  let coveringFetched = direct;

  // ── Structure discover (only if Planner asked) ──────────────────────────
  if (plan.needs.structure) {
    try {
      const structure = await fetchFileStructure(fileKey, auth, restCounter);
      plan = planner.refineCoveringFromStructure(plan, structure.document, nodeId);
      logDebug('covering_selected', {
        coverageType: plan.coverageType,
        coveringNodeId: plan.coveringNodeId,
        requested: nodeId,
      });

      if (plan.needs.coveringGeometry && plan.coveringNodeId && String(plan.coveringNodeId) !== String(nodeId)) {
        coveringFetched = await fetchNode(fileKey, plan.coveringNodeId, auth, { counter: restCounter });
        logDebug('covering_fetched', { ms: Date.now() - t0, name: coveringFetched.name });
      } else {
        coveringFetched = direct;
      }
    } catch (e) {
      logWarn('covering_discovery_failed', { message: e.message });
      plan = {
        ...plan,
        coveringStrategy: 'self',
        coveringNodeId: nodeId,
        coverageType: 'NODE',
        kind: 'exact',
        needs: { ...plan.needs, structure: false, coveringGeometry: false },
        warnings: [...(plan.warnings || []), 'covering_discovery_failed'],
      };
      coveringFetched = direct;
    }
  } else {
    // self-cover
    coveringFetched = direct;
    logDebug('covering_self', { coverageType: plan.coverageType, coveringNodeId: plan.coveringNodeId });
  }

  const coveringDoc = coveringFetched.document;
  plan = planner.refineAfterCovering(plan, coveringDoc);

  const assets = await executeAssetNeeds(plan, fileKey, coveringDoc, auth, restCounter, t0);
  if (plan._analyzedCovering) delete plan._analyzedCovering;

  // Compile ONLY the requested node
  let compileDoc = coveringDoc;
  if (nodeId && coveringDoc.id !== nodeId) {
    const extracted = extractSubtree(coveringDoc, nodeId);
    if (extracted) compileDoc = extracted;
    else compileDoc = direct.document;
  } else if (String(plan.coveringNodeId) === String(nodeId)) {
    compileDoc = direct.document;
  }

  const analyzed = figmaBuild.analyze(compileDoc);

  return {
    document: compileDoc,
    name: compileDoc.name || direct.name,
    ...assets,
    localByUrl: null,
    analyzed,
    plan,
    fetchedMeta: {
      name: coveringFetched.name,
      fileName: coveringFetched.fileName,
      version: coveringFetched.version,
      coveringDocument: coveringDoc,
      coveringName: coveringDoc.name || coveringFetched.name,
      coveringNodeId: plan.coveringNodeId,
      coverageType: plan.coverageType,
      kind: plan.kind,
      requestedNodeId: nodeId,
    },
  };
}

module.exports = {
  fromSnapshot,
  executeMiss,
  executeAssetNeeds,
  collectUsedImageRefs,
  filterObjectKeys,
};
