'use strict';

/** Storage kinds — blackboard partitions only. No UI ontology. */
const StoreKind = Object.freeze({
  FACT: 'Fact',
  HYPOTHESIS: 'Hypothesis',
  DECISION: 'DecisionRecord',
  EVIDENCE: 'Evidence',
  IR_SLICE: 'IrSlice',
  PROVENANCE: 'ProvenanceBundle',
  /** Passive blob store for Decision Runtime–authored traces (Runtime owns generation). */
  TRACE: 'DecisionTrace',
});

const ALL_KINDS = Object.freeze(Object.values(StoreKind));

const WorkspaceState = Object.freeze({
  OPEN: 'open',
  FINALIZED: 'finalized',
  DISCARDED: 'discarded',
});

module.exports = { StoreKind, ALL_KINDS, WorkspaceState };
