'use strict';

const { PluginError, PluginErrorKind } = require('./errors');
const { StoreKind, RUNTIME_ONLY_KINDS } = require('./constants');

/**
 * Capability-scoped plugin context. Never exposes raw Workspace.
 * Writes stage until commit(); rollback clears stage (workspace_tx).
 */
function createPluginContext({
  workspace,
  declaration,
  policy,
  abortSignal = null,
  log = () => {},
  knowledge = null,
} = {}) {
  if (!workspace || !declaration) {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'workspace and declaration required');
  }

  const readSet = new Set(declaration.reads);
  const writeSet = new Set(declaration.writes);
  const destroySet = new Set(declaration.destroys);
  const staged = new Map(); // kind -> Map(id -> record)
  for (const k of writeSet) staged.set(k, new Map());

  let disposed = false;
  let committed = false;
  const logs = [];

  const needsKnowledge = Array.isArray(declaration.requiredCapabilities)
    && declaration.requiredCapabilities.includes('knowledge:read');

  if (needsKnowledge && !knowledge) {
    throw new PluginError(
      PluginErrorKind.CAPABILITY_DENIED,
      'plugin requires knowledge:read but no KnowledgeHandle provided'
    );
  }

  function assertLive() {
    if (disposed) {
      throw new PluginError(PluginErrorKind.INVALID_STATE, 'context disposed');
    }
  }

  function assertRead(kind) {
    assertLive();
    if (RUNTIME_ONLY_KINDS.includes(kind) && !readSet.has(kind)) {
      throw new PluginError(PluginErrorKind.CAPABILITY_DENIED, `undeclared read: ${kind}`, { kind });
    }
    if (!readSet.has(kind)) {
      throw new PluginError(PluginErrorKind.CAPABILITY_DENIED, `undeclared read: ${kind}`, { kind });
    }
  }

  function assertWrite(kind) {
    assertLive();
    if (RUNTIME_ONLY_KINDS.includes(kind)) {
      throw new PluginError(
        PluginErrorKind.CAPABILITY_DENIED,
        `Runtime monopoly — cannot write ${kind}`,
        { kind }
      );
    }
    if (!writeSet.has(kind)) {
      throw new PluginError(PluginErrorKind.CAPABILITY_DENIED, `undeclared write: ${kind}`, { kind });
    }
  }

  function stagePut(kind, idField, record) {
    assertWrite(kind);
    const id = record[idField];
    if (!id) {
      throw new PluginError(PluginErrorKind.INVALID_DECLARATION, `${kind} missing ${idField}`);
    }
    // Fact immutability: existing workspace fact with different content → deny
    if (kind === StoreKind.FACT) {
      const existing = workspace.getFact(id);
      if (existing) {
        const a = JSON.stringify({
          kind: existing.kind,
          subject: existing.subject,
          assertion: existing.assertion,
        });
        const b = JSON.stringify({
          kind: record.kind,
          subject: record.subject,
          assertion: record.assertion,
        });
        if (a !== b) {
          throw new PluginError(
            PluginErrorKind.CAPABILITY_DENIED,
            `Fact mutation denied: ${id}`,
            { id }
          );
        }
      }
    }
    if (!staged.has(kind)) staged.set(kind, new Map());
    staged.get(kind).set(id, { ...record });
    return id;
  }

  function getFromStageOrWs(kind, id, wsGet) {
    assertRead(kind);
    const m = staged.get(kind);
    if (m && m.has(id)) return m.get(id);
    return wsGet(id);
  }

  const writer = {
    id: `plugin:${declaration.id}`,
    capabilities: { writes: [...writeSet] },
  };

  const ctx = {
    pluginId: declaration.id,
    pluginVersion: declaration.version,
    policy: {
      profileId: policy && policy.profileId,
      valuesAuthoritative: policy && policy.valuesAuthoritative === true,
      gateMode: policy && policy.gateMode,
    },
    abortSignal,
    /** Read-only KnowledgeHandle when capability granted; otherwise null. */
    knowledge: knowledge || null,
    getKnowledge() {
      assertLive();
      if (!knowledge) {
        throw new PluginError(
          PluginErrorKind.CAPABILITY_DENIED,
          'knowledge handle not available'
        );
      }
      return knowledge;
    },
    get aborted() {
      return !!(abortSignal && abortSignal.aborted);
    },
    log(message, detail) {
      assertLive();
      const entry = { at: Date.now(), message, detail: detail || null };
      logs.push(entry);
      log(entry);
    },
    getLogs: () => logs.map((e) => ({ ...e })),

    // --- reads ---
    getFact: (id) => getFromStageOrWs(StoreKind.FACT, id, (x) => workspace.getFact(x)),
    getHypothesis: (id) => getFromStageOrWs(StoreKind.HYPOTHESIS, id, (x) => workspace.getHypothesis(x)),
    getEvidence: (id) => getFromStageOrWs(StoreKind.EVIDENCE, id, (x) => workspace.getEvidence(x)),
    getIrSlice: (id) => getFromStageOrWs(StoreKind.IR_SLICE, id, (x) => workspace.getIrSlice(x)),
    getDecision: (id) => {
      assertRead(StoreKind.DECISION);
      return workspace.getDecision(id);
    },
    getTrace: (id) => {
      assertRead(StoreKind.TRACE);
      return workspace.getTrace(id);
    },
    listIds: (kind) => {
      assertRead(kind);
      const fromWs = workspace.listIds(kind);
      const m = staged.get(kind);
      const stagedIds = m ? [...m.keys()] : [];
      return [...new Set([...fromWs, ...stagedIds])];
    },

    // --- writes (staged) ---
    putFact: (record) => stagePut(StoreKind.FACT, 'factId', record),
    putHypothesis: (record) => stagePut(StoreKind.HYPOTHESIS, 'hypothesisId', record),
    putEvidence: (record) => stagePut(StoreKind.EVIDENCE, 'evidenceId', record),
    putIrSlice: (record) => {
      assertWrite(StoreKind.IR_SLICE);
      if (declaration.emittedIR.length && record.stageId
          && !declaration.emittedIR.includes(record.stageId)) {
        throw new PluginError(
          PluginErrorKind.CAPABILITY_DENIED,
          `stageId ${record.stageId} not in emittedIR`,
          { stageId: record.stageId }
        );
      }
      return stagePut(StoreKind.IR_SLICE, 'sliceId', record);
    },

    /** Explicit deny surfaces for bypass attempts */
    putDecision() {
      throw new PluginError(
        PluginErrorKind.CAPABILITY_DENIED,
        'Runtime bypass denied — cannot write DecisionRecord'
      );
    },
    putTrace() {
      throw new PluginError(
        PluginErrorKind.CAPABILITY_DENIED,
        'Runtime bypass denied — cannot write DecisionTrace'
      );
    },
    getWorkspace() {
      throw new PluginError(
        PluginErrorKind.CAPABILITY_DENIED,
        'Workspace bypass denied — raw workspace not exposed'
      );
    },
    invokeDecisionRuntime() {
      throw new PluginError(
        PluginErrorKind.CAPABILITY_DENIED,
        'Runtime bypass denied'
      );
    },

    invalidateFact: (factId, reason) => {
      assertLive();
      if (!destroySet.has(StoreKind.FACT)) {
        throw new PluginError(
          PluginErrorKind.CAPABILITY_DENIED,
          'undeclared destroy: Fact',
          { kind: StoreKind.FACT }
        );
      }
      return workspace.invalidateFact(factId, { reason }, writer);
    },

    /** Persist staged writes to Workspace (lifecycle Commit). */
    commit() {
      assertLive();
      if (committed) return { already: true };
      const putters = {
        [StoreKind.FACT]: (r) => workspace.putFact(r, writer),
        [StoreKind.HYPOTHESIS]: (r) => workspace.putHypothesis(r, writer),
        [StoreKind.EVIDENCE]: (r) => workspace.putEvidence(r, writer),
        [StoreKind.IR_SLICE]: (r) => workspace.putIrSlice(r, writer),
        [StoreKind.PROVENANCE]: (r) => workspace.putProvenance(r, writer),
      };
      for (const [kind, map] of staged.entries()) {
        const put = putters[kind];
        if (!put) continue;
        for (const record of map.values()) {
          put(record);
        }
      }
      committed = true;
      return { ok: true, counts: Object.fromEntries([...staged].map(([k, m]) => [k, m.size])) };
    },

    /** Clear staged writes (rollback / retry). */
    rollback() {
      assertLive();
      for (const m of staged.values()) m.clear();
      committed = false;
    },

    dispose() {
      if (disposed) return;
      for (const m of staged.values()) m.clear();
      disposed = true;
    },

    _isDisposed: () => disposed,
    _isCommitted: () => committed,
  };

  return ctx;
}

module.exports = { createPluginContext };
