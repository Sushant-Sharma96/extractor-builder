'use strict';

const { StoreKind } = require('../plugin/constants');
const { PLUGIN_ID, BUILDER_VERSION, STAGE_ID } = require('./constants');

function resolvedPluginDeclaration(over = {}) {
  return {
    id: PLUGIN_ID,
    version: BUILDER_VERSION,
    engineType: 'facts',
    phaseAffinity: 'late',
    determinism: 'pure',
    reads: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.DECISION],
    writes: [StoreKind.FACT, StoreKind.IR_SLICE],
    creates: [StoreKind.FACT, StoreKind.IR_SLICE],
    destroys: [],
    consumes: ['Fact', 'IrSlice', 'DecisionRecord'],
    produces: ['Fact', 'IrSlice', 'ResolvedIR'],
    requiredFacts: ['ndg.graph'],
    optionalFacts: [],
    emittedIR: [STAGE_ID],
    acceptedQuestions: [],
    allowedPolicies: ['*'],
    requiredCapabilities: [],
    incompatiblePlugins: [],
    estimatedCost: 3,
    estimatedMemory: 2048,
    timeout: 15000,
    retries: 0,
    crashIsolation: 'try_catch',
    rollbackSupport: 'workspace_tx',
    contractSuiteVersion: '1.0.0',
    ...over,
  };
}

module.exports = { resolvedPluginDeclaration };
