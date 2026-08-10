'use strict';

const { WorkspaceError, WorkspaceErrorKind } = require('./errors');
const { StoreKind, ALL_KINDS, WorkspaceState } = require('./kinds');
const { isKnownIrStage } = require('../ir-stage-registry');

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return obj;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function stableStringify(obj) {
  return JSON.stringify(obj);
}

function identitiesEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Passive capability stub: writer may only touch declared kinds.
 * Missing capabilities ⇒ all kinds allowed (open writer) for Kernel/tests;
 * empty array ⇒ deny all.
 */
function assertCapability(writer, kind) {
  if (!writer || writer.capabilities == null) return;
  const caps = writer.capabilities.writes;
  if (!Array.isArray(caps)) return;
  if (!caps.includes(kind)) {
    throw new WorkspaceError(
      WorkspaceErrorKind.CAPABILITY_DENIED,
      `writer not allowed to write ${kind}`,
      { writerId: writer.id, kind, writes: caps }
    );
  }
}

function requireOpen(state) {
  if (state !== WorkspaceState.OPEN) {
    throw new WorkspaceError(
      WorkspaceErrorKind.INVALID_STATE,
      `workspace is ${state}; writes require open`
    );
  }
}

function requireNotDiscarded(state) {
  if (state === WorkspaceState.DISCARDED) {
    throw new WorkspaceError(
      WorkspaceErrorKind.INVALID_STATE,
      'workspace discarded'
    );
  }
}

/**
 * Create a passive Workspace blackboard (Phase 3).
 * Stores only — no reasoning, scoring, arbitration, scheduling, or emit.
 */
function createWorkspace(options = {}) {
  const workspaceId = options.workspaceId || `ws_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const jobId = options.jobId || null;
  const contractSuiteVersion = options.contractSuiteVersion || '1.0.0';

  let state = WorkspaceState.OPEN;

  const facts = new Map();
  const hypotheses = new Map();
  const decisions = new Map();
  const evidence = new Map();
  const irSlices = new Map();
  const provenance = new Map();
  const traces = new Map(); // DecisionTrace blobs — passive store; Runtime authors
  /** LayoutIR pins (metadata only — never mutates IrSlices). graphId → pin */
  const layoutIrPins = new Map();
  const invalidations = []; // { factId, by, reason, at }
  const audit = [];

  function log(action, kind, id, writer) {
    audit.push({
      at: Date.now(),
      action,
      kind,
      id,
      writerId: writer && writer.id ? writer.id : null,
    });
  }

  function checkSuiteVersion(record) {
    if (record.suiteVersion != null && record.suiteVersion !== contractSuiteVersion) {
      throw new WorkspaceError(
        WorkspaceErrorKind.VERSION,
        `suiteVersion mismatch: record=${record.suiteVersion} workspace=${contractSuiteVersion}`,
        { recordSuiteVersion: record.suiteVersion, contractSuiteVersion }
      );
    }
  }

  function putInMap(map, idKey, record, kind, writer, idField) {
    requireOpen(state);
    assertCapability(writer, kind);
    if (!record || typeof record !== 'object') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, `${kind} record required`);
    }
    const id = record[idField];
    if (!id || typeof id !== 'string') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, `${kind} missing ${idField}`);
    }
    if (record.contractId && record.contractId !== kind && kind !== StoreKind.IR_SLICE) {
      // IrSlice uses envelope contractIds; handled separately
      if (kind !== StoreKind.IR_SLICE) {
        throw new WorkspaceError(
          WorkspaceErrorKind.INVALID_WRITE,
          `contractId must be ${kind}`,
          { got: record.contractId }
        );
      }
    }
    checkSuiteVersion(record);

    const stored = deepFreeze(clone(record));
    if (map.has(id)) {
      const existing = map.get(id);
      if (identitiesEqual(existing, stored)) {
        log('put_idempotent', kind, id, writer);
        return existing;
      }
      throw new WorkspaceError(
        WorkspaceErrorKind.DUPLICATE_IDENTITY,
        `${kind} id already exists with different content: ${id}`,
        { id }
      );
    }
    map.set(id, stored);
    log('put', kind, id, writer);
    return stored;
  }

  // --- Facts (immutable) ---
  function putFact(record, writer) {
    requireOpen(state);
    assertCapability(writer, StoreKind.FACT);
    if (!record || record.contractId !== 'Fact') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'Fact.contractId required');
    }
    if (!record.factId || !record.kind || record.subject == null || !record.assertion) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'Fact missing required fields');
    }
    checkSuiteVersion(record);
    const id = record.factId;
    const stored = deepFreeze(clone(record));
    if (facts.has(id)) {
      const existing = facts.get(id);
      if (identitiesEqual(existing, stored)) {
        log('put_idempotent', StoreKind.FACT, id, writer);
        return existing;
      }
      throw new WorkspaceError(
        WorkspaceErrorKind.IMMUTABLE_FACT,
        `Fact is immutable; cannot overwrite ${id}`,
        { factId: id }
      );
    }
    // Cross-ref: invalidatesFactIds / derivedFromFactIds should exist if present (soft: warn via throw on hard)
    if (Array.isArray(record.derivedFromFactIds)) {
      for (const dep of record.derivedFromFactIds) {
        if (!facts.has(dep)) {
          throw new WorkspaceError(
            WorkspaceErrorKind.CROSS_REF,
            `derivedFromFactIds missing Fact: ${dep}`,
            { factId: id, dep }
          );
        }
      }
    }
    facts.set(id, stored);
    log('put', StoreKind.FACT, id, writer);
    return stored;
  }

  function getFact(factId) {
    requireNotDiscarded(state);
    return facts.get(factId) || null;
  }

  function invalidateFact(factId, meta, writer) {
    requireOpen(state);
    assertCapability(writer, StoreKind.FACT);
    if (!facts.has(factId)) {
      throw new WorkspaceError(WorkspaceErrorKind.NOT_FOUND, `Fact not found: ${factId}`);
    }
    // Do not mutate the Fact; record invalidation only
    const entry = Object.freeze({
      factId,
      by: writer && writer.id ? writer.id : null,
      reason: (meta && meta.reason) || null,
      at: Date.now(),
    });
    invalidations.push(entry);
    log('invalidate', StoreKind.FACT, factId, writer);
    return entry;
  }

  function isFactInvalidated(factId) {
    return invalidations.some((i) => i.factId === factId);
  }

  // --- Hypotheses ---
  function putHypothesis(record, writer) {
    if (!record || record.contractId !== 'Hypothesis') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'Hypothesis.contractId required');
    }
    if (!record.hypothesisId || !record.question || record.subject == null || !Array.isArray(record.candidates)) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'Hypothesis missing required fields');
    }
    return putInMap(hypotheses, 'hypothesisId', record, StoreKind.HYPOTHESIS, writer, 'hypothesisId');
  }

  function getHypothesis(id) {
    requireNotDiscarded(state);
    return hypotheses.get(id) || null;
  }

  // --- Decisions (store only; never alter winner/status here) ---
  function putDecision(record, writer) {
    if (!record || record.contractId !== 'DecisionRecord') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'DecisionRecord.contractId required');
    }
    if (!record.id || !record.question || record.winner == null || !record.status) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'DecisionRecord missing required fields');
    }
    return putInMap(decisions, 'id', record, StoreKind.DECISION, writer, 'id');
  }

  function getDecision(id) {
    requireNotDiscarded(state);
    return decisions.get(id) || null;
  }

  // --- Evidence ---
  function putEvidence(record, writer) {
    requireOpen(state);
    assertCapability(writer, StoreKind.EVIDENCE);
    if (!record || !record.evidenceId || !record.kind) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'Evidence missing evidenceId/kind');
    }
    const withContract = record.contractId
      ? record
      : { contractId: 'Evidence', suiteVersion: contractSuiteVersion, ...record };
    return putInMap(evidence, 'evidenceId', withContract, StoreKind.EVIDENCE, writer, 'evidenceId');
  }

  function getEvidence(id) {
    requireNotDiscarded(state);
    return evidence.get(id) || null;
  }

  // --- IR slices ---
  function putIrSlice(record, writer) {
    requireOpen(state);
    assertCapability(writer, StoreKind.IR_SLICE);
    if (!record || !record.sliceId || !record.stageId) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'IrSlice missing sliceId/stageId');
    }
    if (!isKnownIrStage(record.stageId)) {
      throw new WorkspaceError(
        WorkspaceErrorKind.UNKNOWN_IR_STAGE,
        `unknown IrSlice.stageId (not in Phase 1 IR registry): ${record.stageId}`,
        { stageId: record.stageId }
      );
    }
    checkSuiteVersion(record);
    const id = record.sliceId;
    const stored = deepFreeze(clone(record));
    if (irSlices.has(id)) {
      const existing = irSlices.get(id);
      if (identitiesEqual(existing, stored)) {
        log('put_idempotent', StoreKind.IR_SLICE, id, writer);
        return existing;
      }
      throw new WorkspaceError(
        WorkspaceErrorKind.DUPLICATE_IDENTITY,
        `IrSlice id already exists with different content: ${id}`
      );
    }
    irSlices.set(id, stored);
    log('put', StoreKind.IR_SLICE, id, writer);
    return stored;
  }

  function getIrSlice(sliceId) {
    requireNotDiscarded(state);
    return irSlices.get(sliceId) || null;
  }

  // --- Provenance ---
  function putProvenance(record, writer) {
    if (!record || record.contractId !== 'ProvenanceBundle') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'ProvenanceBundle.contractId required');
    }
    if (!record.bundleId || !Array.isArray(record.bindings) || record.bindings.length < 1) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'ProvenanceBundle missing fields');
    }
    // Cross-ref: if decisionId present, Decision should exist when enforceCrossRef
    if (options.enforceCrossRef !== false) {
      for (const b of record.bindings) {
        if (b.decisionId && !decisions.has(b.decisionId)) {
          throw new WorkspaceError(
            WorkspaceErrorKind.CROSS_REF,
            `Provenance decisionId not in workspace: ${b.decisionId}`,
            { bundleId: record.bundleId, decisionId: b.decisionId }
          );
        }
      }
    }
    return putInMap(provenance, 'bundleId', record, StoreKind.PROVENANCE, writer, 'bundleId');
  }

  function getProvenance(bundleId) {
    requireNotDiscarded(state);
    return provenance.get(bundleId) || null;
  }

  /**
   * Passive DecisionTrace storage.
   * Workspace does not generate or interpret traces — Decision Runtime owns authorship.
   * After commit, Workspace is the durable source of truth for retrieval.
   */
  function putTrace(record, writer) {
    requireOpen(state);
    assertCapability(writer, StoreKind.TRACE);
    if (!record || !record.traceId || !record.decisionId) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'DecisionTrace missing traceId/decisionId');
    }
    const id = record.traceId;
    const stored = deepFreeze(clone(record));
    if (traces.has(id)) {
      const existing = traces.get(id);
      if (identitiesEqual(existing, stored)) {
        log('put_idempotent', StoreKind.TRACE, id, writer);
        return existing;
      }
      throw new WorkspaceError(
        WorkspaceErrorKind.DUPLICATE_IDENTITY,
        `DecisionTrace id already exists with different content: ${id}`,
        { id }
      );
    }
    traces.set(id, stored);
    log('put', StoreKind.TRACE, id, writer);
    return stored;
  }

  function getTrace(traceId) {
    requireNotDiscarded(state);
    return traces.get(traceId) || null;
  }

  // --- Lists / query ---
  function listIds(kind) {
    requireNotDiscarded(state);
    switch (kind) {
      case StoreKind.FACT: return [...facts.keys()];
      case StoreKind.HYPOTHESIS: return [...hypotheses.keys()];
      case StoreKind.DECISION: return [...decisions.keys()];
      case StoreKind.EVIDENCE: return [...evidence.keys()];
      case StoreKind.IR_SLICE: return [...irSlices.keys()];
      case StoreKind.PROVENANCE: return [...provenance.keys()];
      case StoreKind.TRACE: return [...traces.keys()];
      default:
        throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, `unknown kind ${kind}`);
    }
  }

  function getAuditLog() {
    return audit.map((e) => ({ ...e }));
  }

  function getInvalidations() {
    return invalidations.map((e) => ({ ...e }));
  }

  /** Debug snapshot — deep clone; no live references. */
  function snapshot() {
    requireNotDiscarded(state);
    return clone({
      workspaceId,
      jobId,
      contractSuiteVersion,
      state,
      facts: Object.fromEntries(facts),
      hypotheses: Object.fromEntries(hypotheses),
      decisions: Object.fromEntries(decisions),
      evidence: Object.fromEntries(evidence),
      irSlices: Object.fromEntries(irSlices),
      provenance: Object.fromEntries(provenance),
      traces: Object.fromEntries(traces),
      layoutIrPins: Object.fromEntries(layoutIrPins),
      invalidations: [...invalidations],
      audit: [...audit],
    });
  }

  function finalize() {
    if (state === WorkspaceState.DISCARDED) {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_STATE, 'cannot finalize discarded workspace');
    }
    if (state === WorkspaceState.FINALIZED) return getStatus();
    state = WorkspaceState.FINALIZED;
    log('finalize', 'Workspace', workspaceId, null);
    return getStatus();
  }

  function discard() {
    state = WorkspaceState.DISCARDED;
    facts.clear();
    hypotheses.clear();
    decisions.clear();
    evidence.clear();
    irSlices.clear();
    provenance.clear();
    traces.clear();
    layoutIrPins.clear();
    log('discard', 'Workspace', workspaceId, null);
    return getStatus();
  }

  /**
   * Pin LayoutIR slices for a graph (Phase 11b.1).
   * Metadata only — does not mutate or overwrite IrSlices.
   * @param {string} graphId
   * @param {{ baselineLayoutIrSliceId?: string|null, activeLayoutIrSliceId?: string|null }} pin
   * @param {object} [writer]
   */
  function setLayoutIrPin(graphId, pin = {}, writer) {
    requireOpen(state);
    if (!graphId || typeof graphId !== 'string') {
      throw new WorkspaceError(WorkspaceErrorKind.INVALID_WRITE, 'graphId required for LayoutIR pin');
    }
    const prev = layoutIrPins.get(graphId) || {};
    const next = Object.freeze({
      graphId,
      baselineLayoutIrSliceId:
        pin.baselineLayoutIrSliceId !== undefined
          ? pin.baselineLayoutIrSliceId
          : (prev.baselineLayoutIrSliceId ?? null),
      activeLayoutIrSliceId:
        pin.activeLayoutIrSliceId !== undefined
          ? pin.activeLayoutIrSliceId
          : (prev.activeLayoutIrSliceId ?? null),
      updatedAt: Date.now(),
    });
    // Validate referenced slices exist when set
    for (const key of ['baselineLayoutIrSliceId', 'activeLayoutIrSliceId']) {
      const sid = next[key];
      if (sid == null) continue;
      const slice = irSlices.get(sid);
      if (!slice) {
        throw new WorkspaceError(
          WorkspaceErrorKind.INVALID_WRITE,
          `LayoutIR pin ${key} references missing IrSlice: ${sid}`,
          { graphId, sliceId: sid }
        );
      }
      if (slice.stageId !== 'layout-ir') {
        throw new WorkspaceError(
          WorkspaceErrorKind.INVALID_WRITE,
          `LayoutIR pin ${key} must reference stageId layout-ir`,
          { graphId, sliceId: sid, stageId: slice.stageId }
        );
      }
    }
    layoutIrPins.set(graphId, next);
    log('pin_layout_ir', 'LayoutIrPin', graphId, writer);
    return next;
  }

  function getLayoutIrPin(graphId) {
    requireNotDiscarded(state);
    if (!graphId) return null;
    return layoutIrPins.get(graphId) || null;
  }

  function listLayoutIrPins() {
    requireNotDiscarded(state);
    return [...layoutIrPins.values()]
      .map((p) => ({ ...p }))
      .sort((a, b) => (a.graphId < b.graphId ? -1 : 1));
  }

  function getStatus() {
    return {
      workspaceId,
      jobId,
      contractSuiteVersion,
      state,
      counts: {
        facts: facts.size,
        hypotheses: hypotheses.size,
        decisions: decisions.size,
        evidence: evidence.size,
        irSlices: irSlices.size,
        provenance: provenance.size,
        traces: traces.size,
        layoutIrPins: layoutIrPins.size,
        invalidations: invalidations.length,
        audit: audit.length,
      },
    };
  }

  return {
    workspaceId,
    jobId,
    contractSuiteVersion,
    StoreKind,
    WorkspaceState,
    getStatus,
    putFact,
    getFact,
    invalidateFact,
    isFactInvalidated,
    putHypothesis,
    getHypothesis,
    putDecision,
    getDecision,
    putEvidence,
    getEvidence,
    putIrSlice,
    getIrSlice,
    putProvenance,
    getProvenance,
    putTrace,
    getTrace,
    setLayoutIrPin,
    getLayoutIrPin,
    listLayoutIrPins,
    listIds,
    getAuditLog,
    getInvalidations,
    snapshot,
    finalize,
    discard,
    /** Explicit non-capabilities */
    invariants: Object.freeze({
      isPassive: true,
      reasons: false,
      scores: false,
      arbitrates: false,
      emitsHtml: false,
      hasUiOntology: false,
    }),
  };
}

module.exports = {
  createWorkspace,
  StoreKind,
  ALL_KINDS,
  WorkspaceState,
  WorkspaceError,
  WorkspaceErrorKind,
};
