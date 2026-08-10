'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'emit-plan';
const PLUGIN_ID = 'facts.emit.plan';
const FACT_KIND_EMIT = 'emit.plan';

/** Pipeline stage order for dependency / chunk planning (exporter-neutral). */
const STAGE_ORDER = Object.freeze([
  'layout-ir',
  'component-ir',
  'token-ir',
  'semantic-ir',
  'responsive-ir',
  'a11y-ir',
  'asset-ir',
  'behavior-ir',
]);

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  FACT_KIND_EMIT,
  STAGE_ORDER,
};
