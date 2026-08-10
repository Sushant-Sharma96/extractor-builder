'use strict';

const { StoreKind } = require('../workspace/kinds');

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const REQUIRED_PACK_FIELDS = Object.freeze([
  'packId',
  'version',
  'suiteVersion',
  'plugin',
  'rules',
  'dependencies',
  'knowledgeRefs',
  'allowedPolicies',
]);

/** StoreKinds rule packs must never write. */
const FORBIDDEN_WRITES = Object.freeze([
  StoreKind.FACT,
  StoreKind.DECISION,
  StoreKind.TRACE,
  StoreKind.PROVENANCE,
  StoreKind.IR_SLICE,
]);

/** Minimum writes for a rule pack plugin. */
const REQUIRED_WRITES = Object.freeze([
  StoreKind.HYPOTHESIS,
  StoreKind.EVIDENCE,
]);

module.exports = {
  SEMVER_RE,
  REQUIRED_PACK_FIELDS,
  FORBIDDEN_WRITES,
  REQUIRED_WRITES,
  StoreKind,
};
