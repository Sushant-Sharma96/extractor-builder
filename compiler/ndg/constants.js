'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'normalized-design-graph';
const PLUGIN_ID = 'facts.ndg.materialize';

const FACT_KIND_GRAPH = 'ndg.graph';
const FACT_KIND_NODE = 'ndg.node';
const FACT_KIND_SOURCE_NODE = 'source.node';
const FACT_KIND_RAW = 'source.raw';

const EVIDENCE_DROPPED_INVISIBLE = 'ndg.dropped.invisible';
const EVIDENCE_DROPPED_EMPTY = 'ndg.dropped.empty';
const EVIDENCE_COLLAPSED = 'ndg.collapsed.passthrough';

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  FACT_KIND_GRAPH,
  FACT_KIND_NODE,
  FACT_KIND_SOURCE_NODE,
  FACT_KIND_RAW,
  EVIDENCE_DROPPED_INVISIBLE,
  EVIDENCE_DROPPED_EMPTY,
  EVIDENCE_COLLAPSED,
};
