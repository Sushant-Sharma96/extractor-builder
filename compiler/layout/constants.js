'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'layout-ir';
const PLUGIN_ID = 'facts.layout.project';
const PACK_ID = 'layout.interpret';

const FACT_KIND_LAYOUT_SLICE = 'layout.ir';
const FACT_KIND_NDG_NODE = 'ndg.node';
const FACT_KIND_NDG_GRAPH = 'ndg.graph';

/** Exporter-neutral arrangement modes */
const LAYOUT_MODES = Object.freeze([
  'flow-row',
  'flow-column',
  'absolute',
  'grid-track',
  'mixed',
  'unknown',
]);

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_LAYOUT_SLICE,
  FACT_KIND_NDG_NODE,
  FACT_KIND_NDG_GRAPH,
  LAYOUT_MODES,
};
