'use strict';

const { StoreKind } = require('../plugin/constants');
const {
  PLUGIN_ID,
  STAGE_ID,
  BUILDER_VERSION,
  FACT_KIND_GRAPH,
  FACT_KIND_NODE,
} = require('./constants');

function ndgPluginDeclaration(over = {}) {
  return {
    id: PLUGIN_ID,
    version: BUILDER_VERSION,
    engineType: 'facts',
    phaseAffinity: 'early',
    determinism: 'pure',
    reads: [StoreKind.FACT],
    writes: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.EVIDENCE],
    creates: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.EVIDENCE],
    destroys: [],
    consumes: ['Fact'],
    produces: ['Fact', 'IrSlice', 'Evidence', 'NormalizedDesignGraph'],
    requiredFacts: [],
    optionalFacts: ['source.node', 'source.raw'],
    emittedIR: [STAGE_ID],
    acceptedQuestions: [],
    allowedPolicies: ['*'],
    requiredCapabilities: [],
    incompatiblePlugins: [],
    estimatedCost: 5,
    estimatedMemory: 4096,
    timeout: 30000,
    retries: 0,
    crashIsolation: 'try_catch',
    rollbackSupport: 'workspace_tx',
    contractSuiteVersion: '1.0.0',
    ...over,
  };
}

module.exports = { ndgPluginDeclaration };
