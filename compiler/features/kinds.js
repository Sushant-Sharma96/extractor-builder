'use strict';

/**
 * Phase 9 — deterministic feature keys (structural only).
 * No semantic / AI labels.
 */

const NODE_TYPES = Object.freeze([
  'FRAME',
  'TEXT',
  'RECTANGLE',
  'ELLIPSE',
  'LINE',
  'VECTOR',
  'IMAGE',
  'COMPONENT',
  'INSTANCE',
  'GROUP',
  'OTHER',
]);

const FEATURE_KEYS = Object.freeze([
  'nodeType',
  'name',
  'autoLayout',
  'constraints',
  'padding',
  'spacing',
  'gap',
  'fill',
  'stroke',
  'radius',
  'shadow',
  'opacity',
  'typography',
  'font',
  'weight',
  'alignment',
  'dimensions',
  'position',
  'visibility',
  'overflow',
  'effects',
  'border',
  'corner',
  'hierarchy',
  'positioning',
]);

const BLOCK_KINDS = Object.freeze([
  'button-like',
  'card-like',
  'container-like',
  'text-block',
  'image-block',
  'divider',
  'section',
  'grid',
  'stack',
  'list',
  'generic-block',
]);

const SOURCE_NODE_KIND = 'source.node';

module.exports = {
  NODE_TYPES,
  FEATURE_KEYS,
  BLOCK_KINDS,
  SOURCE_NODE_KIND,
};
