'use strict';

/**
 * Phase 9 — extract deterministic structural features from a normalized node.
 */

const { FEATURE_KEYS } = require('./kinds');
const { normalizeNode, isPlainObject } = require('./normalize');

function hasVisibleFill(fills) {
  return (fills || []).some((f) => {
    if (!f) return false;
    if (typeof f === 'string') return true;
    if (isPlainObject(f) && f.visible === false) return false;
    return true;
  });
}

function hasStroke(strokes) {
  return (strokes || []).some((s) => {
    if (!s) return false;
    if (typeof s === 'string') return true;
    if (isPlainObject(s) && s.visible === false) return false;
    return true;
  });
}

function hasShadow(effects) {
  return (effects || []).some((e) => {
    if (!e) return false;
    const t = String(e.type || e.kind || '').toUpperCase();
    return t.includes('SHADOW');
  });
}

function isImageLike(node) {
  if (node.nodeType === 'IMAGE') return true;
  return (node.fills || []).some((f) => {
    if (!isPlainObject(f)) return false;
    const t = String(f.type || '').toUpperCase();
    return t === 'IMAGE' || t === 'IMAGEFILL';
  });
}

/**
 * @param {object} rawOrNormalized — raw assertion or already-normalized node
 * @returns {object} frozen feature bag + meta
 */
function extractFeatures(rawOrNormalized) {
  const node = normalizeNode(rawOrNormalized);
  const pad = node.padding;
  const hasPad = [pad.top, pad.right, pad.bottom, pad.left].some((v) => v != null && v !== 0);

  const autoLayout = node.layoutMode
    ? Object.freeze({
      mode: node.layoutMode,
      gap: node.itemSpacing,
      padding: pad,
    })
    : null;

  const typography = (node.nodeType === 'TEXT' || node.characters || node.fontSize != null)
    ? Object.freeze({
      charactersPresent: !!node.characters,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      alignH: node.textAlignHorizontal,
      alignV: node.textAlignVertical,
    })
    : null;

  const font = node.fontName
    ? (typeof node.fontName === 'string'
      ? node.fontName
      : Object.freeze({ ...node.fontName }))
    : null;

  const box = node.absoluteBoundingBox;
  const dimensions = box
    ? Object.freeze({ width: box.width, height: box.height })
    : null;
  const position = box
    ? Object.freeze({ x: box.x, y: box.y })
    : null;

  let positioning = null;
  if (node.layoutPositioning) {
    const p = node.layoutPositioning.toUpperCase();
    if (p === 'ABSOLUTE') positioning = 'absolute';
    else if (p === 'AUTO' || p === 'RELATIVE') positioning = 'relative';
    else positioning = p.toLowerCase();
  }

  const radius = node.rectangleCornerRadii
    ? Object.freeze({ corners: node.rectangleCornerRadii, uniform: node.cornerRadius })
    : node.cornerRadius;

  const features = Object.freeze({
    nodeType: node.nodeType,
    name: node.name,
    autoLayout,
    constraints: node.constraints,
    padding: hasPad ? pad : null,
    spacing: node.itemSpacing,
    gap: node.itemSpacing,
    fill: hasVisibleFill(node.fills),
    stroke: hasStroke(node.strokes),
    radius,
    shadow: hasShadow(node.effects),
    opacity: node.opacity,
    typography,
    font,
    weight: node.fontWeight,
    alignment: Object.freeze({
      horizontal: node.textAlignHorizontal,
      vertical: node.textAlignVertical,
    }),
    dimensions,
    position,
    visibility: node.visible !== false,
    overflow: node.overflow,
    effects: node.effects,
    border: hasStroke(node.strokes)
      ? Object.freeze({ present: true, count: node.strokes.length })
      : null,
    corner: radius,
    hierarchy: Object.freeze({
      parentId: node.parentId,
      childIds: node.childIds,
      childCount: node.childIds.length,
      siblingIndex: node.siblingIndex,
      siblingCount: node.siblingCount,
    }),
    positioning,
  });

  const presentKeys = FEATURE_KEYS.filter((k) => {
    const v = features[k];
    if (v == null) return false;
    if (typeof v === 'boolean') return true;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });

  return Object.freeze({
    features,
    presentKeys: Object.freeze(presentKeys.slice()),
    meta: Object.freeze({
      imageLike: isImageLike(node),
      hasAutoLayout: !!autoLayout,
      childCount: node.childIds.length,
    }),
  });
}

/**
 * Stable JSON for fingerprint / determinism checks.
 */
function featuresCanonicalJson(extracted) {
  return JSON.stringify(extracted.features, Object.keys(extracted.features).sort());
}

module.exports = {
  extractFeatures,
  featuresCanonicalJson,
  hasVisibleFill,
  hasStroke,
  hasShadow,
  isImageLike,
};
