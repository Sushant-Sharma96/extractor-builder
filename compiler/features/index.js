'use strict';

/**
 * Phase 9 — Feature Extraction & Recognition helpers.
 * Pure functions only. Rule Packs own Workspace writes.
 * Phase 10: prefer ndg.node Facts (structural SSOT); source.node is transitional.
 */

const kinds = require('./kinds');
const { normalizeNode } = require('./normalize');
const { extractFeatures, featuresCanonicalJson } = require('./extract');
const { recognizeBlockKinds, nameHints, patternIdFor } = require('./recognize');

const NDG_NODE_KIND = 'ndg.node';

function isNdgNodeFact(fact) {
  return !!(fact && fact.kind === NDG_NODE_KIND);
}

function isSourceNodeFact(fact) {
  if (!fact || typeof fact !== 'object') return false;
  if (fact.kind === NDG_NODE_KIND) return true;
  if (fact.kind === kinds.SOURCE_NODE_KIND) return true;
  const a = fact.assertion;
  if (!a || typeof a !== 'object') return false;
  return a.nodeType != null || a.type != null;
}

/**
 * Project NDG node Fact assertion into feature-extractor input shape.
 */
function ndgAssertionToRaw(assertion) {
  if (!assertion || typeof assertion !== 'object') return null;
  const attrs = assertion.attributes || {};
  return {
    id: assertion.sourceNodeId || assertion.id,
    type: assertion.type,
    name: assertion.name,
    visible: assertion.visible !== false,
    absoluteBoundingBox: assertion.box || null,
    fills: assertion.paints || [],
    strokes: attrs.strokes || [],
    effects: attrs.effects || [],
    cornerRadius: assertion.geometry && assertion.geometry.cornerRadius,
    rectangleCornerRadii: assertion.geometry && assertion.geometry.rectangleCornerRadii,
    opacity: assertion.geometry && assertion.geometry.opacity,
    layoutMode: attrs.layoutMode,
    itemSpacing: attrs.itemSpacing,
    paddingTop: attrs.paddingTop,
    paddingRight: attrs.paddingRight,
    paddingBottom: attrs.paddingBottom,
    paddingLeft: attrs.paddingLeft,
    constraints: attrs.constraints,
    layoutPositioning: attrs.layoutPositioning,
    overflow: attrs.overflow,
    characters: attrs.characters,
    fontSize: attrs.fontSize,
    fontWeight: attrs.fontWeight,
    fontName: attrs.fontName,
    textAlignHorizontal: attrs.textAlignHorizontal,
    textAlignVertical: attrs.textAlignVertical,
    parentId: assertion.parentId || null,
    childIds: Array.isArray(assertion.childIds) ? assertion.childIds : [],
  };
}

function assertionFromFact(fact) {
  if (!fact) return null;
  if (isNdgNodeFact(fact)) {
    return ndgAssertionToRaw(fact.assertion);
  }
  return fact.assertion || null;
}

/**
 * Collect node Facts preferring NDG structural SSOT.
 * @returns {{ facts: object[], inputMode: 'ndg'|'transitional-source-node' }}
 */
function collectNodeFacts(getFact, listFactIds) {
  const ids = listFactIds().slice().sort();
  const ndg = [];
  const source = [];
  for (const id of ids) {
    const fact = getFact(id);
    if (!fact) continue;
    if (fact.kind === NDG_NODE_KIND) ndg.push(fact);
    else if (fact.kind === kinds.SOURCE_NODE_KIND) source.push(fact);
  }
  if (ndg.length) {
    return { facts: ndg, inputMode: 'ndg' };
  }
  return { facts: source, inputMode: 'transitional-source-node' };
}

module.exports = {
  ...kinds,
  NDG_NODE_KIND,
  normalizeNode,
  extractFeatures,
  featuresCanonicalJson,
  recognizeBlockKinds,
  nameHints,
  patternIdFor,
  isSourceNodeFact,
  isNdgNodeFact,
  assertionFromFact,
  ndgAssertionToRaw,
  collectNodeFacts,
};
