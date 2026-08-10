'use strict';

const BUILDER_VERSION = '1.0.0';
const STAGE_ID = 'token-ir';
const PLUGIN_ID = 'facts.token.project';
const PACK_ID = 'token.detect';

const FACT_KIND_TOKEN_SLICE = 'token.ir';

const EVIDENCE_SIGNAL = 'token.signal';
const EVIDENCE_BIND = 'token.bind';
const EVIDENCE_LITERAL = 'token.literal';
const EVIDENCE_AMBIGUOUS = 'token.ambiguous';

module.exports = {
  BUILDER_VERSION,
  STAGE_ID,
  PLUGIN_ID,
  PACK_ID,
  FACT_KIND_TOKEN_SLICE,
  EVIDENCE_SIGNAL,
  EVIDENCE_BIND,
  EVIDENCE_LITERAL,
  EVIDENCE_AMBIGUOUS,
};
