'use strict';

/**
 * Phase 8 — Rule Pack infrastructure.
 * Rule Packs are Phase 6 plugins. They produce Evidence/Hypotheses/Candidates only.
 */

const { RulePackError, RulePackErrorKind } = require('./errors');
const {
  SEMVER_RE,
  REQUIRED_PACK_FIELDS,
  FORBIDDEN_WRITES,
  REQUIRED_WRITES,
  StoreKind,
} = require('./constants');
const { validateRulePack, normalizeRulePack } = require('./validate');
const { checkRulePackCompatibility, satisfies } = require('./compatibility');
const { createRuleContext } = require('./context');
const { executeRulePack } = require('./execute');
const { createRulePackRegistry } = require('./registry');
const { loadRulePack, loadRulePackDirectory } = require('./load');
const path = require('path');

const SYNTHETIC_BASIC_DIR = path.join(__dirname, 'packs', 'synthetic-basic');
const FEATURE_EXTRACT_DIR = path.join(__dirname, 'packs', 'feature-extract');
const RECOGNITION_BASIC_DIR = path.join(__dirname, 'packs', 'recognition-basic');
const LAYOUT_INTERPRET_DIR = path.join(__dirname, 'packs', 'layout-interpret');
const LAYOUT_CONSTRAINT_DIR = path.join(__dirname, 'packs', 'layout-constraint');
const COMPONENT_DETECT_DIR = path.join(__dirname, 'packs', 'component-detect');
const TOKEN_DETECT_DIR = path.join(__dirname, 'packs', 'token-detect');
const SEMANTIC_DETECT_DIR = path.join(__dirname, 'packs', 'semantic-detect');
const RESPONSIVE_DETECT_DIR = path.join(__dirname, 'packs', 'responsive-detect');
const ACCESSIBILITY_DETECT_DIR = path.join(__dirname, 'packs', 'accessibility-detect');

function loadSyntheticBasicPack(opts) {
  return loadRulePackDirectory(SYNTHETIC_BASIC_DIR, opts);
}

function loadFeatureExtractPack(opts) {
  return loadRulePackDirectory(FEATURE_EXTRACT_DIR, opts);
}

function loadRecognitionBasicPack(opts) {
  return loadRulePackDirectory(RECOGNITION_BASIC_DIR, opts);
}

function loadLayoutInterpretPack(opts) {
  return loadRulePackDirectory(LAYOUT_INTERPRET_DIR, opts);
}

function loadLayoutConstraintPack(opts) {
  return loadRulePackDirectory(LAYOUT_CONSTRAINT_DIR, opts);
}

function loadComponentDetectPack(opts) {
  return loadRulePackDirectory(COMPONENT_DETECT_DIR, opts);
}

function loadTokenDetectPack(opts) {
  return loadRulePackDirectory(TOKEN_DETECT_DIR, opts);
}

function loadSemanticDetectPack(opts) {
  return loadRulePackDirectory(SEMANTIC_DETECT_DIR, opts);
}

function loadResponsiveDetectPack(opts) {
  return loadRulePackDirectory(RESPONSIVE_DETECT_DIR, opts);
}

function loadAccessibilityDetectPack(opts) {
  return loadRulePackDirectory(ACCESSIBILITY_DETECT_DIR, opts);
}

module.exports = {
  RulePackError,
  RulePackErrorKind,
  SEMVER_RE,
  REQUIRED_PACK_FIELDS,
  FORBIDDEN_WRITES,
  REQUIRED_WRITES,
  StoreKind,
  validateRulePack,
  normalizeRulePack,
  checkRulePackCompatibility,
  satisfies,
  createRuleContext,
  executeRulePack,
  createRulePackRegistry,
  loadRulePack,
  loadRulePackDirectory,
  loadSyntheticBasicPack,
  loadFeatureExtractPack,
  loadRecognitionBasicPack,
  loadLayoutInterpretPack,
  loadLayoutConstraintPack,
  loadComponentDetectPack,
  loadTokenDetectPack,
  loadSemanticDetectPack,
  loadResponsiveDetectPack,
  loadAccessibilityDetectPack,
  SYNTHETIC_BASIC_DIR,
  FEATURE_EXTRACT_DIR,
  RECOGNITION_BASIC_DIR,
  LAYOUT_INTERPRET_DIR,
  LAYOUT_CONSTRAINT_DIR,
  COMPONENT_DETECT_DIR,
  TOKEN_DETECT_DIR,
  SEMANTIC_DETECT_DIR,
  RESPONSIVE_DETECT_DIR,
  ACCESSIBILITY_DETECT_DIR,
};
