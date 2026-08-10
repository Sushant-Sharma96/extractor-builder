'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'a11y-ir';
const PLUGIN_ID = 'facts.accessibility.project';
const PACK_ID = 'accessibility.detect';

const FACT_KIND_A11Y_SLICE = 'accessibility.ir';

const EVIDENCE_SIGNAL = 'a11y.signal';
const EVIDENCE_NAME = 'a11y.name';
const EVIDENCE_FOCUS = 'a11y.focus';
const EVIDENCE_LABEL = 'a11y.label';
const EVIDENCE_IMAGE = 'a11y.image';
const EVIDENCE_VALIDATE = 'a11y.validate';
const EVIDENCE_AMBIGUOUS = 'a11y.ambiguous';
const EVIDENCE_SEMANTIC = 'a11y.semantic-evidence';

/** Exporter-neutral access intents (not ARIA attribute strings). */
const ACCESS_ROLE = Object.freeze({
  INTERACTIVE: 'interactive',
  STATIC: 'static',
  DECORATIVE: 'decorative',
  LANDMARK: 'landmark',
  HEADING: 'heading',
  UNKNOWN: 'unknown',
});

const KEYBOARD_HINT = Object.freeze({
  FOCUSABLE: 'focusable',
  ACTIVATE: 'activate',
  SKIP: 'skip',
  NONE: 'none',
});

const VALIDATION_STATUS = Object.freeze({
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
});

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_A11Y_SLICE,
  EVIDENCE_SIGNAL,
  EVIDENCE_NAME,
  EVIDENCE_FOCUS,
  EVIDENCE_LABEL,
  EVIDENCE_IMAGE,
  EVIDENCE_VALIDATE,
  EVIDENCE_AMBIGUOUS,
  EVIDENCE_SEMANTIC,
  ACCESS_ROLE,
  KEYBOARD_HINT,
  VALIDATION_STATUS,
};
