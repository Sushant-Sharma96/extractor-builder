'use strict';

const { StoreKind } = require('../plugin/constants');
const { PLUGIN_ID, BUILDER_VERSION, STAGE_ID } = require('./constants');

function geometryPluginDeclaration(over = {}) {
  return {
    id: PLUGIN_ID,
    version: BUILDER_VERSION,
    engineType: 'facts',
    // Must run before layout.interpret consumes recognitionHints.
    phaseAffinity: 'early',
    determinism: 'pure',
    reads: [StoreKind.FACT, StoreKind.IR_SLICE],
    writes: [StoreKind.FACT, StoreKind.IR_SLICE],
    creates: [StoreKind.FACT, StoreKind.IR_SLICE],
    destroys: [],
    consumes: ['Fact', 'IrSlice'],
    produces: ['Fact', 'IrSlice', 'GeometryIR'],
    requiredFacts: ['ndg.graph'],
    optionalFacts: ['ndg.node'],
    emittedIR: [STAGE_ID],
    acceptedQuestions: [],
    allowedPolicies: ['*'],
    requiredCapabilities: [],
    incompatiblePlugins: [],
    estimatedCost: 3,
    estimatedMemory: 4096,
    timeout: 30000,
    retries: 0,
    crashIsolation: 'try_catch',
    rollbackSupport: 'workspace_tx',
    contractSuiteVersion: '1.0.0',
    ...over,
  };
}

module.exports = { geometryPluginDeclaration };
