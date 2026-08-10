'use strict';

const { StoreKind } = require('../plugin/constants');
const { PLUGIN_ID, BUILDER_VERSION, STAGE_ID } = require('./constants');

function freeformLayoutPluginDeclaration(over = {}) {
  return {
    id: PLUGIN_ID,
    version: BUILDER_VERSION,
    engineType: 'facts',
    phaseAffinity: 'mid',
    determinism: 'pure',
    reads: [StoreKind.FACT, StoreKind.IR_SLICE, StoreKind.DECISION, StoreKind.EVIDENCE],
    writes: [StoreKind.FACT, StoreKind.IR_SLICE],
    creates: [StoreKind.FACT, StoreKind.IR_SLICE],
    destroys: [],
    consumes: ['Fact', 'IrSlice', 'DecisionRecord'],
    produces: ['Fact', 'IrSlice', 'FreeformLayoutIR'],
    requiredFacts: ['ndg.graph'],
    optionalFacts: ['component.ir', 'geometry.ir'],
    emittedIR: [STAGE_ID],
    acceptedQuestions: [],
    allowedPolicies: ['*'],
    requiredCapabilities: [],
    incompatiblePlugins: [],
    estimatedCost: 4,
    estimatedMemory: 4096,
    timeout: 30000,
    retries: 0,
    crashIsolation: 'try_catch',
    rollbackSupport: 'workspace_tx',
    contractSuiteVersion: '1.0.0',
    ...over,
  };
}

module.exports = { freeformLayoutPluginDeclaration };
