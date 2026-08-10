'use strict';

/**
 * Phase 9 — normalize raw design-node shaped objects into a canonical bag.
 * Deterministic; no semantic interpretation.
 */

const { NODE_TYPES } = require('./kinds');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(v) {
  if (v === true || v === false) return v;
  return null;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function upperType(raw) {
  const t = strOrNull(raw);
  if (!t) return 'OTHER';
  const u = t.toUpperCase().replace(/[\s-]+/g, '_');
  return NODE_TYPES.includes(u) ? u : 'OTHER';
}

/**
 * Accept common aliases from design tools without inventing semantics.
 */
function normalizeNode(raw) {
  if (!isPlainObject(raw)) {
    return Object.freeze({
      nodeType: 'OTHER',
      name: null,
      layoutMode: null,
      itemSpacing: null,
      padding: Object.freeze({ top: null, right: null, bottom: null, left: null }),
      fills: Object.freeze([]),
      strokes: Object.freeze([]),
      effects: Object.freeze([]),
      cornerRadius: null,
      rectangleCornerRadii: null,
      opacity: null,
      visible: true,
      overflow: null,
      constraints: null,
      absoluteBoundingBox: null,
      relativeTransform: null,
      layoutPositioning: null,
      characters: null,
      fontName: null,
      fontSize: null,
      fontWeight: null,
      textAlignHorizontal: null,
      textAlignVertical: null,
      parentId: null,
      childIds: Object.freeze([]),
      siblingIndex: null,
      siblingCount: null,
    });
  }

  const layoutMode = strOrNull(raw.layoutMode || raw.autoLayout || raw.layout);
  const pad = raw.padding && isPlainObject(raw.padding) ? raw.padding : {};
  const box = raw.absoluteBoundingBox || raw.bounds || raw.box || null;

  const childIds = Array.isArray(raw.childIds)
    ? raw.childIds.map((id) => String(id)).filter(Boolean)
    : Array.isArray(raw.children)
      ? raw.children.map((c) => (typeof c === 'string' ? c : c && (c.id || c.nodeId))).filter(Boolean).map(String)
      : [];

  const fills = Array.isArray(raw.fills) ? raw.fills : (raw.fill ? [raw.fill] : []);
  const strokes = Array.isArray(raw.strokes) ? raw.strokes : (raw.stroke ? [raw.stroke] : []);
  const effects = Array.isArray(raw.effects) ? raw.effects : [];

  return Object.freeze({
    nodeType: upperType(raw.nodeType || raw.type || raw.kind),
    name: strOrNull(raw.name),
    layoutMode: layoutMode ? layoutMode.toUpperCase() : null,
    itemSpacing: numOrNull(raw.itemSpacing != null ? raw.itemSpacing : raw.gap),
    padding: Object.freeze({
      top: numOrNull(raw.paddingTop != null ? raw.paddingTop : pad.top),
      right: numOrNull(raw.paddingRight != null ? raw.paddingRight : pad.right),
      bottom: numOrNull(raw.paddingBottom != null ? raw.paddingBottom : pad.bottom),
      left: numOrNull(raw.paddingLeft != null ? raw.paddingLeft : pad.left),
    }),
    fills: Object.freeze(fills.map((f) => (isPlainObject(f) ? Object.freeze({ ...f }) : f))),
    strokes: Object.freeze(strokes.map((s) => (isPlainObject(s) ? Object.freeze({ ...s }) : s))),
    effects: Object.freeze(effects.map((e) => (isPlainObject(e) ? Object.freeze({ ...e }) : e))),
    cornerRadius: numOrNull(raw.cornerRadius != null ? raw.cornerRadius : raw.radius),
    rectangleCornerRadii: Array.isArray(raw.rectangleCornerRadii)
      ? Object.freeze(raw.rectangleCornerRadii.map(numOrNull))
      : null,
    opacity: numOrNull(raw.opacity),
    visible: boolOrNull(raw.visible) == null ? true : raw.visible !== false,
    overflow: strOrNull(raw.overflowDirection || raw.overflow || raw.clipsContent),
    constraints: isPlainObject(raw.constraints) ? Object.freeze({ ...raw.constraints }) : null,
    absoluteBoundingBox: isPlainObject(box)
      ? Object.freeze({
        x: numOrNull(box.x),
        y: numOrNull(box.y),
        width: numOrNull(box.width != null ? box.width : box.w),
        height: numOrNull(box.height != null ? box.height : box.h),
      })
      : null,
    relativeTransform: Array.isArray(raw.relativeTransform) ? Object.freeze([...raw.relativeTransform]) : null,
    layoutPositioning: strOrNull(raw.layoutPositioning || raw.positioning),
    characters: strOrNull(raw.characters || raw.text),
    fontName: isPlainObject(raw.fontName)
      ? Object.freeze({ ...raw.fontName })
      : strOrNull(raw.fontName || raw.fontFamily),
    fontSize: numOrNull(raw.fontSize),
    fontWeight: numOrNull(raw.fontWeight) != null
      ? numOrNull(raw.fontWeight)
      : strOrNull(raw.fontWeight),
    textAlignHorizontal: strOrNull(raw.textAlignHorizontal || raw.textAlign),
    textAlignVertical: strOrNull(raw.textAlignVertical),
    parentId: strOrNull(raw.parentId || (raw.parent && (raw.parent.id || raw.parent))),
    childIds: Object.freeze(childIds.slice().sort()),
    siblingIndex: numOrNull(raw.siblingIndex),
    siblingCount: numOrNull(raw.siblingCount),
  });
}

module.exports = { normalizeNode, numOrNull, strOrNull, isPlainObject };
