'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'resolved-ir';
const PLUGIN_ID = 'facts.resolved.compose';

const FACT_KIND_RESOLVED = 'resolved.ir';

/** Specialized stages ResolvedIR may compose (missing OK). */
const COMPOSABLE_STAGES = Object.freeze([
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
  FACT_KIND_RESOLVED,
  COMPOSABLE_STAGES,
};
