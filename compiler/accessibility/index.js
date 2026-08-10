'use strict';

/**
 * Phase 16 — Accessibility (A11y) Engine.
 * Lifecycle: collect → detect → project → publish → materialize
 * Exporter-neutral: names / focus / validations — never HTML/ARIA attribute emit.
 * May consume SemanticIR as Evidence; never mutates SemanticIR.
 */

const { AccessibilityError, AccessibilityErrorKind } = require('./errors');
const constants = require('./constants');
const { canonicalStringify, accessibilityIrChecksum } = require('./checksum');
const {
  collectAccessibilityInputs,
  collectDecisions,
  loadSemanticIrFromWorkspace,
  loadNdgFromWorkspace,
} = require('./collect');
const { detectAccessibility } = require('./detect');
const { projectAccessibilityIR } = require('./project');
const { publishAccessibilityIR } = require('./publish');
const { materializeAccessibilityIR } = require('./materialize');
const { accessibilityPluginDeclaration } = require('./declaration');
const { buildAccessibilityReport } = require('./report');

module.exports = {
  AccessibilityError,
  AccessibilityErrorKind,
  ...constants,
  canonicalStringify,
  accessibilityIrChecksum,
  collectAccessibilityInputs,
  collectDecisions,
  loadSemanticIrFromWorkspace,
  loadNdgFromWorkspace,
  detectAccessibility,
  projectAccessibilityIR,
  publishAccessibilityIR,
  materializeAccessibilityIR,
  accessibilityPluginDeclaration,
  buildAccessibilityReport,
};
