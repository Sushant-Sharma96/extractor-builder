'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'responsive-ir';
const PLUGIN_ID = 'facts.responsive.project';
const PACK_ID = 'responsive.detect';

const FACT_KIND_RESPONSIVE_SLICE = 'responsive.ir';

const EVIDENCE_SIGNAL = 'responsive.signal';
const EVIDENCE_BREAKPOINT = 'responsive.breakpoint';
const EVIDENCE_ADAPT = 'responsive.adapt';
const EVIDENCE_AMBIGUOUS = 'responsive.ambiguous';
const EVIDENCE_GROUP = 'responsive.group';

/** Exporter-neutral adaptation strategies (not CSS). */
const STRATEGY = Object.freeze({
  STACK: 'stack',
  ROW: 'row',
  WRAP: 'wrap',
  SHRINK: 'shrink',
  HIDE: 'hide',
  SHOW: 'show',
  SPACE_TIGHTEN: 'space-tighten',
  SPACE_PRESERVE: 'space-preserve',
  FIXED: 'fixed',
  ABSTAIN: 'abstain',
});

/** Canonical breakpoint kinds — widthHint is design-space intent, not a media query. */
const BREAKPOINT_KIND = Object.freeze({
  NARROW: 'narrow',
  MEDIUM: 'medium',
  WIDE: 'wide',
});

const DEFAULT_BREAKPOINTS = Object.freeze([
  { breakpointId: 'bp:narrow', kind: BREAKPOINT_KIND.NARROW, widthHint: 375 },
  { breakpointId: 'bp:medium', kind: BREAKPOINT_KIND.MEDIUM, widthHint: 768 },
  { breakpointId: 'bp:wide', kind: BREAKPOINT_KIND.WIDE, widthHint: 1280 },
]);

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_RESPONSIVE_SLICE,
  EVIDENCE_SIGNAL,
  EVIDENCE_BREAKPOINT,
  EVIDENCE_ADAPT,
  EVIDENCE_AMBIGUOUS,
  EVIDENCE_GROUP,
  STRATEGY,
  BREAKPOINT_KIND,
  DEFAULT_BREAKPOINTS,
};
