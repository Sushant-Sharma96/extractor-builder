'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'semantic-ir';
const PLUGIN_ID = 'facts.semantic.project';
const PACK_ID = 'semantic.detect';

const FACT_KIND_SEMANTIC_SLICE = 'semantic.ir';

const EVIDENCE_SIGNAL = 'semantic.signal';
const EVIDENCE_LANDMARK = 'semantic.landmark';
const EVIDENCE_HEADING = 'semantic.heading';
const EVIDENCE_AMBIGUOUS = 'semantic.ambiguous';
const EVIDENCE_GROUP = 'semantic.group';
// Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — banner/divider structural
// shape hints, sourced from compiler/rulepack/packs/component-detect's
// geometry-rules.js (shared with Component IR, not re-derived here).
const EVIDENCE_SHAPE_HINT = 'semantic.shape-hint';

/** Exporter-neutral role vocabulary (not HTML tags). */
const ROLE = Object.freeze({
  BANNER: 'banner',
  NAVIGATION: 'navigation',
  MAIN: 'main',
  COMPLEMENTARY: 'complementary',
  CONTENTINFO: 'contentinfo',
  REGION: 'region',
  ARTICLE: 'article',
  LIST: 'list',
  LISTITEM: 'listitem',
  FORM: 'form',
  BUTTON: 'button',
  HEADING: 'heading',
  GENERIC: 'generic',
  // Phase 2 (docs/COMPILER_MIGRATION_BLUEPRINT.md) — divider recognition
  // (server/figma-build.js's isVerticalDivider/convertDividersToBorders)
  // gets a real ARIA role hint rather than staying silently absorbed into
  // GENERIC. Not a landmark role (see LANDMARK_ROLES below).
  SEPARATOR: 'separator',
});

const LANDMARK_ROLES = Object.freeze([
  ROLE.BANNER,
  ROLE.NAVIGATION,
  ROLE.MAIN,
  ROLE.COMPLEMENTARY,
  ROLE.CONTENTINFO,
  ROLE.REGION,
]);

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_SEMANTIC_SLICE,
  EVIDENCE_SIGNAL,
  EVIDENCE_LANDMARK,
  EVIDENCE_HEADING,
  EVIDENCE_AMBIGUOUS,
  EVIDENCE_GROUP,
  EVIDENCE_SHAPE_HINT,
  ROLE,
  LANDMARK_ROLES,
};
