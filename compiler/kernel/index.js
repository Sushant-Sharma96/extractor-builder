'use strict';

const { FailureKind, KernelError } = require('./failures');
const { bindPolicy } = require('./policy');
const { buildFingerprint, fingerprintKey, loadSuiteVersion } = require('./fingerprint');
const { createBudgetTracker } = require('./budgets');
const { createEngineRegistry } = require('./engine-registry');
const { buildSchedule } = require('./scheduler');
const { evaluateGate } = require('./gates');
const { createWorkspace } = require('../workspace');
const { createDecisionRuntime } = require('../decision');
const {
  loadIrStageRegistry,
  listIrStageIds,
  isKnownIrStage: registryIsKnownIrStage,
} = require('../ir-stage-registry');
const {
  resolveProfile,
  gateOptionsFromProfile,
  PolicyError,
} = require('../policy');
const {
  createPluginRegistry,
  executePlugin,
  buildPluginSchedule,
  PluginError,
  PluginErrorKind,
} = require('../plugin');
const {
  createKnowledgeRegistry,
  KnowledgeError,
} = require('../knowledge');
const {
  createRulePackRegistry,
  RulePackError,
  loadRulePackDirectory,
} = require('../rulepack');
const {
  materializeNormalizedDesignGraph,
  ndgPluginDeclaration,
  PLUGIN_ID: NDG_PLUGIN_ID,
  NdgError,
} = require('../ndg');
const {
  materializeLayoutIR,
  layoutPluginDeclaration,
  PLUGIN_ID: LAYOUT_PLUGIN_ID,
  LayoutError,
  materializeSolvedLayoutIR,
  constraintPluginDeclaration,
  CONSTRAINT_PLUGIN_ID,
  SOLVER_VERSION,
} = require('../layout');
const {
  materializeComponentIR,
  componentPluginDeclaration,
  PLUGIN_ID: COMPONENT_PLUGIN_ID,
  ComponentError,
} = require('../components');
const {
  materializeTokenIR,
  tokenPluginDeclaration,
  PLUGIN_ID: TOKEN_PLUGIN_ID,
  TokenError,
} = require('../tokens');
const {
  materializeSemanticIR,
  semanticPluginDeclaration,
  PLUGIN_ID: SEMANTIC_PLUGIN_ID,
  SemanticError,
} = require('../semantic');
const {
  materializeResponsiveIR,
  responsivePluginDeclaration,
  PLUGIN_ID: RESPONSIVE_PLUGIN_ID,
  ResponsiveError,
} = require('../responsive');
const {
  materializeAccessibilityIR,
  accessibilityPluginDeclaration,
  PLUGIN_ID: ACCESSIBILITY_PLUGIN_ID,
  AccessibilityError,
} = require('../accessibility');
const {
  materializeResolvedIR,
  resolvedPluginDeclaration,
  PLUGIN_ID: RESOLVED_PLUGIN_ID,
  ResolvedError,
} = require('../resolved');
const {
  materializeEmitPlan,
  emitPluginDeclaration,
  PLUGIN_ID: EMIT_PLUGIN_ID,
  EmitError,
} = require('../emit');

const JobState = Object.freeze({
  CREATED: 'created',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  ABORTED: 'aborted',
});

/**
 * Bind job policy: inline PolicyProfile, or resolve Phase 5 registry by profileId.
 * Does not invent product thresholds — registry owns authoritative values.
 */
function resolveJobPolicy(jobOptions, contractSuiteVersion) {
  if (jobOptions.policyProfile) {
    return bindPolicy(jobOptions.policyProfile);
  }
  if (jobOptions.policyProfileId) {
    try {
      return resolveProfile(jobOptions.policyProfileId, {
        expectedSuiteVersion: contractSuiteVersion,
        requireAuthoritative: true,
      });
    } catch (e) {
      if (e instanceof PolicyError) {
        throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
          kind: e.kind,
          detail: e.detail,
        });
      }
      throw e;
    }
  }
  return bindPolicy({
    contractId: 'PolicyProfile',
    suiteVersion: contractSuiteVersion,
    profileId: 'default',
    valuesAuthoritative: false,
  });
}

/**
 * Create Compiler Kernel (Phase 2).
 * No UI ontology, no HTML emit, no design API / network.
 *
 * Arbitration ownership: Decision Runtime owns winner selection.
 * Kernel only provides a job-scoped entry that delegates to Runtime
 * (`invokeDecisionRuntime` / alias `arbitrate`). Kernel does not score or choose winners.
 */
function createKernel(options = {}) {
  const contractSuiteVersion = options.contractSuiteVersion || loadSuiteVersion();
  loadIrStageRegistry(); // ensure Phase 1 registry loads (shared; Workspace also uses it)
  const engines = createEngineRegistry();
  const plugins = createPluginRegistry({ expectedSuiteVersion: contractSuiteVersion });
  const knowledge = createKnowledgeRegistry({ expectedSuiteVersion: contractSuiteVersion });
  const rulePacks = createRulePackRegistry({
    pluginRegistry: plugins,
    expectedSuiteVersion: contractSuiteVersion,
  });
  const compilerVersion = options.compilerVersion || '2.0.0';

  // Delegation surface only — algorithm lives in compiler/decision/
  const stubs = Object.freeze({
    arbitration: Object.freeze({
      status: 'delegates_to_decision_runtime',
      entryPoints: Object.freeze(['invokeDecisionRuntime', 'arbitrate']),
    }),
  });

  function createJob(jobOptions = {}) {
    const policy = resolveJobPolicy(jobOptions, contractSuiteVersion);
    const gateDefaults = gateOptionsFromProfile(policy);

    if (policy.allowedEngineIds.length) {
      // Restrictiveness checked at schedule time
    }

    const enabledPlugins = plugins.listEnabled({
      suiteVersion: contractSuiteVersion,
      compilerVersion,
      profileId: policy.profileId,
      allowedEngineIds: policy.allowedEngineIds,
      determinismStrict: jobOptions.determinismStrict === true
        || (policy.flags && policy.flags.determinismStrict === true),
    });

    const enabledRulePacks = rulePacks.listEnabled({
      suiteVersion: contractSuiteVersion,
      profileId: policy.profileId,
      allowedEngineIds: policy.allowedEngineIds,
      allowedPackIds: policy.allowedPackIds,
      determinismStrict: jobOptions.determinismStrict === true
        || (policy.flags && policy.flags.determinismStrict === true),
    });

    let knowledgeHandle = null;
    let knowledgePin = {
      knowledgeBundleId: null,
      knowledgeBundleVersion: jobOptions.knowledgeBundleVersion ?? null,
      knowledgeChecksum: null,
    };

    if (jobOptions.knowledgeBundleId && jobOptions.knowledgeBundleVersion) {
      try {
        const pinned = knowledge.pin(
          jobOptions.knowledgeBundleId,
          jobOptions.knowledgeBundleVersion,
          {
            expectedSuiteVersion: contractSuiteVersion,
            jobId: jobOptions.jobId || null,
            policyProfileId: policy.profileId,
          }
        );
        knowledgeHandle = pinned.handle;
        knowledgePin = pinned.pin;
      } catch (e) {
        if (e instanceof KnowledgeError) {
          throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
            kind: e.kind,
            detail: e.detail,
          });
        }
        throw e;
      }
    } else if (jobOptions.requireKnowledge === true) {
      throw new KernelError(
        FailureKind.MISSING_INPUT,
        'requireKnowledge set but knowledgeBundleId/version missing'
      );
    }

    let fingerprint = buildFingerprint({
      policyProfileId: policy.profileId,
      policyProfileVersion: policy.profileVersion,
      knowledgeBundleId: knowledgePin.knowledgeBundleId,
      knowledgeBundleVersion: knowledgePin.knowledgeBundleVersion,
      knowledgeChecksum: knowledgePin.knowledgeChecksum,
      ruleSetVersion: jobOptions.ruleSetVersion ?? null,
      rulePacks: rulePacks.fingerprintSlice(enabledRulePacks),
      seed: jobOptions.seed ?? null,
      contractSuiteVersion,
      plugins: plugins.fingerprintSlice(enabledPlugins),
      ndgChecksum: null,
      ndgBuilderVersion: null,
      ndgGraphId: null,
      layoutIrChecksum: null,
      layoutBuilderVersion: null,
      layoutSliceId: null,
      baselineLayoutIrSliceId: null,
      activeLayoutIrSliceId: null,
      constraintSolverVersion: null,
      solvedLayoutIrChecksum: null,
      solvedLayoutSliceId: null,
      solverFingerprint: null,
      componentIrChecksum: null,
      componentBuilderVersion: null,
      componentSliceId: null,
      tokenIrChecksum: null,
      tokenBuilderVersion: null,
      tokenSliceId: null,
      semanticIrChecksum: null,
      semanticBuilderVersion: null,
      semanticSliceId: null,
      responsiveIrChecksum: null,
      responsiveBuilderVersion: null,
      responsiveSliceId: null,
      accessibilityIrChecksum: null,
      accessibilityBuilderVersion: null,
      accessibilitySliceId: null,
      resolvedIrChecksum: null,
      resolvedBuilderVersion: null,
      resolvedSliceId: null,
      emitPlanChecksum: null,
      emitBuilderVersion: null,
      emitPlanSliceId: null,
    });

    function commonFingerprintFields(patch = {}) {
      return {
        policyProfileId: policy.profileId,
        policyProfileVersion: policy.profileVersion,
        knowledgeBundleId: knowledgePin.knowledgeBundleId,
        knowledgeBundleVersion: knowledgePin.knowledgeBundleVersion,
        knowledgeChecksum: knowledgePin.knowledgeChecksum,
        ruleSetVersion: jobOptions.ruleSetVersion ?? null,
        rulePacks: rulePacks.fingerprintSlice(
          rulePacks.listEnabled({
            suiteVersion: contractSuiteVersion,
            profileId: policy.profileId,
            allowedEngineIds: policy.allowedEngineIds,
            allowedPackIds: policy.allowedPackIds,
          })
        ),
        seed: jobOptions.seed ?? null,
        contractSuiteVersion,
        plugins: plugins.fingerprintSlice(plugins.listEnabled({
          suiteVersion: contractSuiteVersion,
          profileId: policy.profileId,
          allowedEngineIds: policy.allowedEngineIds,
          determinismStrict: jobOptions.determinismStrict === true,
        })),
        ndgChecksum: fingerprint.ndgChecksum,
        ndgBuilderVersion: fingerprint.ndgBuilderVersion,
        ndgGraphId: fingerprint.ndgGraphId,
        layoutIrChecksum: fingerprint.layoutIrChecksum,
        layoutBuilderVersion: fingerprint.layoutBuilderVersion,
        layoutSliceId: fingerprint.layoutSliceId,
        baselineLayoutIrSliceId: fingerprint.baselineLayoutIrSliceId,
        activeLayoutIrSliceId: fingerprint.activeLayoutIrSliceId,
        constraintSolverVersion: fingerprint.constraintSolverVersion,
        solvedLayoutIrChecksum: fingerprint.solvedLayoutIrChecksum,
        solvedLayoutSliceId: fingerprint.solvedLayoutSliceId,
        solverFingerprint: fingerprint.solverFingerprint,
        componentIrChecksum: fingerprint.componentIrChecksum,
        componentBuilderVersion: fingerprint.componentBuilderVersion,
        componentSliceId: fingerprint.componentSliceId,
        tokenIrChecksum: fingerprint.tokenIrChecksum,
        tokenBuilderVersion: fingerprint.tokenBuilderVersion,
        tokenSliceId: fingerprint.tokenSliceId,
        semanticIrChecksum: fingerprint.semanticIrChecksum,
        semanticBuilderVersion: fingerprint.semanticBuilderVersion,
        semanticSliceId: fingerprint.semanticSliceId,
        responsiveIrChecksum: fingerprint.responsiveIrChecksum,
        responsiveBuilderVersion: fingerprint.responsiveBuilderVersion,
        responsiveSliceId: fingerprint.responsiveSliceId,
        accessibilityIrChecksum: fingerprint.accessibilityIrChecksum,
        accessibilityBuilderVersion: fingerprint.accessibilityBuilderVersion,
        accessibilitySliceId: fingerprint.accessibilitySliceId,
        resolvedIrChecksum: fingerprint.resolvedIrChecksum,
        resolvedBuilderVersion: fingerprint.resolvedBuilderVersion,
        resolvedSliceId: fingerprint.resolvedSliceId,
        emitPlanChecksum: fingerprint.emitPlanChecksum,
        emitBuilderVersion: fingerprint.emitBuilderVersion,
        emitPlanSliceId: fingerprint.emitPlanSliceId,
        ...patch,
      };
    }

    const budgets = createBudgetTracker(policy.budgets);
    const jobId = jobOptions.jobId || `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    let state = JobState.CREATED;
    let failure = null;
    let result = null;
    let timing = { startedAt: null, endedAt: null };
    let workspace = null;

    function assertTransition(from, to) {
      if (state !== from) {
        throw new KernelError(
          FailureKind.INVARIANT_VIOLATION,
          `invalid job transition ${state} → ${to}`
        );
      }
    }

    function getStatus() {
      return {
        jobId,
        state,
        policy: {
          profileId: policy.profileId,
          profileVersion: policy.profileVersion,
          valuesAuthoritative: policy.valuesAuthoritative,
        },
        fingerprint,
        fingerprintKey: fingerprintKey(fingerprint),
        budgets: budgets.snapshot(),
        failure,
        result,
        timing: { ...timing },
      };
    }

    /**
     * Run an empty compile job to a terminal state (Phase 2 deliverable).
     * @param {{ outcome?: 'success'|'fail'|'abort', qualityReport?: object, failClosed?: boolean, budgetUsage?: object }} opts
     */
    function runEmpty(opts = {}) {
      assertTransition(JobState.CREATED, JobState.RUNNING);
      state = JobState.RUNNING;
      timing.startedAt = Date.now();

      const outcome = opts.outcome || 'success';

      try {
        if (opts.budgetUsage) {
          budgets.record(opts.budgetUsage);
          budgets.check();
        }

        if (opts.qualityReport) {
          const failClosed = opts.failClosed !== undefined
            ? opts.failClosed !== false
            : gateDefaults.failClosed;
          const gate = evaluateGate(opts.qualityReport, { failClosed });
          if (!gate.ok) {
            throw new KernelError(FailureKind.GATE_FAIL, 'gate failed', gate);
          }
        }

        if (outcome === 'abort') {
          state = JobState.ABORTED;
          failure = { kind: FailureKind.ABORTED, message: 'job aborted' };
          timing.endedAt = Date.now();
          return getStatus();
        }

        if (outcome === 'fail') {
          throw new KernelError(FailureKind.UNKNOWN, opts.failMessage || 'empty job failed by request');
        }

        // success path: schedule skeleton only (no engine execution)
        const schedule = buildSchedule(
          engines.list().filter((e) => {
            if (!policy.allowedEngineIds.length) return true;
            return policy.allowedEngineIds.includes(e.id);
          })
        );
        const pluginSchedule = buildPluginSchedule(enabledPlugins, {
          maxMemory: policy.budgets && policy.budgets.maxMemoryBytes != null
            ? policy.budgets.maxMemoryBytes
            : Infinity,
        });

        result = {
          kind: 'empty_job',
          schedule,
          pluginSchedule,
          contractSuiteVersion,
          note: 'No IR mutation, no emit, no network',
        };
        state = JobState.SUCCESS;
        timing.endedAt = Date.now();
        return getStatus();
      } catch (err) {
        state = JobState.FAILED;
        timing.endedAt = Date.now();
        failure = {
          kind: err.kind || FailureKind.UNKNOWN,
          message: err.message,
          detail: err.detail || null,
        };
        return getStatus();
      }
    }

    function abort(reason) {
      if (state === JobState.SUCCESS || state === JobState.FAILED || state === JobState.ABORTED) {
        throw new KernelError(FailureKind.INVARIANT_VIOLATION, `cannot abort from ${state}`);
      }
      if (state === JobState.CREATED) {
        state = JobState.ABORTED;
      } else {
        state = JobState.ABORTED;
      }
      failure = { kind: FailureKind.ABORTED, message: reason || 'aborted' };
      timing.endedAt = Date.now();
      return getStatus();
    }

    return {
      jobId,
      getStatus,
      runEmpty,
      abort,
      getPolicy: () => policy,
      getFingerprint: () => fingerprint,
      fingerprintKey: () => fingerprintKey(fingerprint),
      budgets,
      /** Phase 3 — attach passive Workspace blackboard (once per job). */
      attachWorkspace() {
        if (workspace) {
          const st = workspace.getStatus();
          if (st.state !== 'discarded') return workspace;
        }
        workspace = createWorkspace({ jobId, contractSuiteVersion });
        return workspace;
      },
      getWorkspace: () => workspace,
      getKnowledgeHandle: () => knowledgeHandle,
      getKnowledgePin: () => ({ ...knowledgePin }),
      /**
       * Job-scoped facade: create Decision Runtime and run one session.
       * Does NOT perform arbitration inside Kernel — delegates entirely to Runtime.
       * Prefer this name in new call sites; `arbitrate` is a compatibility alias.
       *
       * @param {{ question, subject, candidates?, evidence?, scores?, fromWorkspace?, override?, safeGenericId?, decisionId? }} opts
       */
      invokeDecisionRuntime(opts = {}) {
        if (!opts.question || opts.subject == null) {
          throw new KernelError(
            FailureKind.MISSING_INPUT,
            'invokeDecisionRuntime requires question and subject'
          );
        }
        const ws = this.attachWorkspace();
        const runtime = createDecisionRuntime({
          workspace: ws,
          policy,
          contractSuiteVersion,
        });
        const session = runtime.createSession({
          question: opts.question,
          subject: opts.subject,
          decisionId: opts.decisionId,
        });
        return session.run({
          fromWorkspace: opts.fromWorkspace,
          candidates: opts.candidates,
          evidence: opts.evidence,
          scores: opts.scores,
          override: opts.override,
          safeGenericId: opts.safeGenericId,
        });
      },
      /**
       * @deprecated Prefer `invokeDecisionRuntime` — same behavior; name historically implied Kernel-owned arbitration.
       * Compatibility alias only; ownership unchanged (Runtime owns arbitration).
       */
      arbitrate(opts) {
        return this.invokeDecisionRuntime(opts);
      },
      /** Phase 6 — enabled plugins at job bind time (frozen list). */
      listEnabledPlugins: () => enabledPlugins.map((p) => ({ id: p.id, version: p.version })),
      listEnabledRulePacks: () => enabledRulePacks.map((p) => ({
        packId: p.packId,
        version: p.version,
      })),
      buildPluginSchedule: () => buildPluginSchedule(enabledPlugins, {
        maxMemory: policy.budgets && policy.budgets.maxMemoryBytes != null
          ? policy.budgets.maxMemoryBytes
          : Infinity,
      }),
      /**
       * Phase 10 — materialize NormalizedDesignGraph (structural SSOT).
       * Fact producer via Phase 6 plugin capabilities — not Rule Packs.
       */
      async materializeNormalizedDesignGraph(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(NDG_PLUGIN_ID)) {
          try {
            plugins.register(ndgPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeNormalizedDesignGraph({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            rawDocument: execOpts.rawDocument,
            document: execOpts.document,
            rawDocumentId: execOpts.rawDocumentId,
            graphId: execOpts.graphId,
            facts: execOpts.facts,
            clock: execOpts.clock,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            ndgChecksum: out.checksum,
            ndgBuilderVersion: out.builderVersion,
            ndgGraphId: out.graph.graphId,
          }));
          return out;
        } catch (e) {
          if (e instanceof NdgError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 11a — project exporter-neutral LayoutIR from NDG (+ Decisions if any).
       * Does not commit Decisions. Does not mutate NDG.
       */
      async projectLayoutIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(LAYOUT_PLUGIN_ID)) {
          try {
            plugins.register(layoutPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeLayoutIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            recognitionHintsByNode: execOpts.recognitionHintsByNode,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            layoutIrChecksum: out.checksum,
            layoutBuilderVersion: out.builderVersion,
            layoutSliceId: out.sliceId,
            baselineLayoutIrSliceId: out.baselineLayoutIrSliceId || out.sliceId,
            activeLayoutIrSliceId: out.activeLayoutIrSliceId || out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof LayoutError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 11b — Constraint Solver (Layout subsystem).
       * Requires LayoutIR₀. Publishes LayoutIR₁ + Evidence/Hypotheses.
       * Never mutates NDG or LayoutIR₀. Never commits Decisions.
       */
      async solveLayoutConstraints(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(CONSTRAINT_PLUGIN_ID)) {
          try {
            plugins.register(constraintPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeSolvedLayoutIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            baselineSliceId: execOpts.baselineSliceId,
            maxRelaxations: execOpts.maxRelaxations,
            emitHypotheses: execOpts.emitHypotheses,
            traceIds: execOpts.traceIds,
          });
          const solverFp = [
            out.solverVersion || SOLVER_VERSION,
            out.solveResult && out.solveResult.status,
            out.checksum,
            out.baselineChecksum || fingerprint.layoutIrChecksum,
          ].join('|');
          fingerprint = buildFingerprint(commonFingerprintFields({
            constraintSolverVersion: out.solverVersion || SOLVER_VERSION,
            solvedLayoutIrChecksum: out.checksum,
            solvedLayoutSliceId: out.sliceId,
            baselineLayoutIrSliceId: out.baselineLayoutIrSliceId
              || fingerprint.baselineLayoutIrSliceId
              || fingerprint.layoutSliceId,
            activeLayoutIrSliceId: out.activeLayoutIrSliceId || out.sliceId,
            solverFingerprint: solverFp,
          }));
          return out;
        } catch (e) {
          if (e instanceof LayoutError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 12 — project ComponentIR from NDG (+ optional active LayoutIR).
       * Does not commit Decisions. Does not mutate NDG or LayoutIR.
       */
      async projectComponentIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(COMPONENT_PLUGIN_ID)) {
          try {
            plugins.register(componentPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeComponentIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            layoutSliceId: execOpts.layoutSliceId,
            skipLayout: execOpts.skipLayout,
            layoutIr: execOpts.layoutIr,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            componentIrChecksum: out.checksum,
            componentBuilderVersion: out.builderVersion,
            componentSliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof ComponentError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 13 — project TokenIR from NDG.
       * Does not commit Decisions. Does not mutate NDG.
       */
      async projectTokenIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(TOKEN_PLUGIN_ID)) {
          try {
            plugins.register(tokenPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeTokenIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            tokenIrChecksum: out.checksum,
            tokenBuilderVersion: out.builderVersion,
            tokenSliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof TokenError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 14 — project SemanticIR from NDG.
       * Does not commit Decisions. Does not emit HTML/React/CSS.
       */
      async projectSemanticIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(SEMANTIC_PLUGIN_ID)) {
          try {
            plugins.register(semanticPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeSemanticIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            layoutSliceId: execOpts.layoutSliceId,
            skipLayout: execOpts.skipLayout,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            semanticIrChecksum: out.checksum,
            semanticBuilderVersion: out.builderVersion,
            semanticSliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof SemanticError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 15 — project ResponsiveIR from NDG (+ Layout when available).
       * Does not commit Decisions. Does not emit CSS/media queries.
       */
      async projectResponsiveIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(RESPONSIVE_PLUGIN_ID)) {
          try {
            plugins.register(responsivePluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeResponsiveIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            layoutSliceId: execOpts.layoutSliceId,
            skipLayout: execOpts.skipLayout,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            responsiveIrChecksum: out.checksum,
            responsiveBuilderVersion: out.builderVersion,
            responsiveSliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof ResponsiveError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 16 — project AccessibilityIR from NDG (+ SemanticIR when available).
       * Does not commit Decisions. Does not emit HTML/ARIA. Does not mutate SemanticIR.
       */
      async projectAccessibilityIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(ACCESSIBILITY_PLUGIN_ID)) {
          try {
            plugins.register(accessibilityPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeAccessibilityIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            layoutSliceId: execOpts.layoutSliceId,
            skipLayout: execOpts.skipLayout,
            semanticSliceId: execOpts.semanticSliceId,
            skipSemantic: execOpts.skipSemantic,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            accessibilityIrChecksum: out.checksum,
            accessibilityBuilderVersion: out.builderVersion,
            accessibilitySliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof AccessibilityError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 17 — compose ResolvedIR from published IrSlices + Decisions.
       * Does not recompute domain engines. Does not mutate slices.
       */
      async projectResolvedIR(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(RESOLVED_PLUGIN_ID)) {
          try {
            plugins.register(resolvedPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeResolvedIR({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            resolvedId: execOpts.resolvedId,
            graphId: execOpts.graphId,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            resolvedIrChecksum: out.checksum,
            resolvedBuilderVersion: out.builderVersion,
            resolvedSliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof ResolvedError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Phase 18 — project EmitPlan from ResolvedIR only.
       * Exporter-neutral plan; does not emit HTML/CSS/React.
       */
      async projectEmitPlan(execOpts = {}) {
        const ws = this.attachWorkspace();
        if (!plugins.get(EMIT_PLUGIN_ID)) {
          try {
            plugins.register(emitPluginDeclaration());
          } catch (e) {
            if (!(e instanceof PluginError && e.kind === PluginErrorKind.DUPLICATE_ID)) {
              if (e instanceof PluginError) {
                throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
                  kind: e.kind,
                  detail: e.detail,
                });
              }
              throw e;
            }
          }
        }
        try {
          const out = await materializeEmitPlan({
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            suiteVersion: contractSuiteVersion,
            clock: execOpts.clock,
            decisions: execOpts.decisions,
            sliceId: execOpts.sliceId,
            planId: execOpts.planId,
            resolvedSliceId: execOpts.resolvedSliceId,
            graphId: execOpts.graphId,
          });
          fingerprint = buildFingerprint(commonFingerprintFields({
            emitPlanChecksum: out.checksum,
            emitBuilderVersion: out.builderVersion,
            emitPlanSliceId: out.sliceId,
          }));
          return out;
        } catch (e) {
          if (e instanceof EmitError) {
            throw new KernelError(FailureKind.INVARIANT_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          if (e instanceof PluginError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Execute a registered Rule Pack (Phase 8).
       * Writes Evidence/Hypotheses only; never Decisions.
       */
      async executeRulePack(packId, execOpts = {}) {
        const ws = this.attachWorkspace();
        try {
          return await rulePacks.execute(packId, {
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            fingerprint,
            config: execOpts.config || {},
            clock: execOpts.clock,
            suiteVersion: contractSuiteVersion,
            allowedEngineIds: policy.allowedEngineIds,
            allowedPackIds: policy.allowedPackIds,
            determinismStrict: jobOptions.determinismStrict === true,
            failFast: execOpts.failFast === true,
          });
        } catch (e) {
          if (e instanceof RulePackError) {
            throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
              kind: e.kind,
              detail: e.detail,
            });
          }
          throw e;
        }
      },
      /**
       * Execute a registered plugin with capability-scoped context.
       * Preserves Workspace / Decisions / Traces on crash.
       */
      async executePlugin(pluginId, handler, execOpts = {}) {
        const decl = plugins.get(pluginId);
        if (!decl) {
          throw new KernelError(
            FailureKind.POLICY_VIOLATION,
            `plugin not registered: ${pluginId}`,
            { kind: PluginErrorKind.NOT_REGISTERED }
          );
        }
        const ws = this.attachWorkspace();
        const onFailure = execOpts.onFailure
          || (gateDefaults.failClosed ? 'abort' : 'continue');
        try {
          return await executePlugin({
            declaration: decl,
            handler,
            workspace: ws,
            policy,
            knowledge: knowledgeHandle,
            onFailure,
          });
        } catch (e) {
          if (e instanceof PluginError && e.jobAction === 'abort') {
            state = JobState.FAILED;
            failure = {
              kind: FailureKind.ENGINE_CRASH,
              message: e.message,
              detail: { pluginId, kind: e.kind },
            };
          }
          throw e;
        }
      },
    };
  }

  function isKnownIrStage(stageId) {
    return registryIsKnownIrStage(stageId);
  }

  return {
    contractSuiteVersion,
    compilerVersion,
    FailureKind,
    JobState,
    createJob,
    registerEngine: (d) => engines.register(d),
    listEngines: () => engines.list(),
    buildSchedule: () => buildSchedule(engines.list()),
    registerPlugin: (d) => {
      try {
        return plugins.register(d);
      } catch (e) {
        if (e instanceof PluginError) {
          throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
            kind: e.kind,
            detail: e.detail,
          });
        }
        throw e;
      }
    },
    listPlugins: () => plugins.list(),
    getPlugin: (id) => plugins.get(id),
    buildPluginSchedule: (list) => buildPluginSchedule(list || plugins.list()),
    registerKnowledge: (bundle, opts) => {
      try {
        return knowledge.register(bundle, opts);
      } catch (e) {
        if (e instanceof KnowledgeError) {
          throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
            kind: e.kind,
            detail: e.detail,
          });
        }
        throw e;
      }
    },
    loadKnowledge: (source, opts) => {
      try {
        return knowledge.loadAndRegister(source, opts);
      } catch (e) {
        if (e instanceof KnowledgeError) {
          throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
            kind: e.kind,
            detail: e.detail,
          });
        }
        throw e;
      }
    },
    listKnowledge: () => knowledge.list(),
    getKnowledgeRegistry: () => knowledge,
    /**
     * Phase 8 — register Rule Pack through existing Plugin registry (no second framework).
     */
    registerRulePack: (pack, handlers) => {
      try {
        return rulePacks.register(pack, handlers);
      } catch (e) {
        if (e instanceof RulePackError) {
          throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
            kind: e.kind,
            detail: e.detail,
          });
        }
        throw e;
      }
    },
    loadRulePackDirectory: (dir, opts) => {
      try {
        const { pack, handlers } = loadRulePackDirectory(dir, {
          expectedSuiteVersion: contractSuiteVersion,
          ...(opts || {}),
        });
        return rulePacks.register(pack, handlers);
      } catch (e) {
        if (e instanceof RulePackError) {
          throw new KernelError(FailureKind.POLICY_VIOLATION, e.message, {
            kind: e.kind,
            detail: e.detail,
          });
        }
        throw e;
      }
    },
    listRulePacks: () => rulePacks.list(),
    getRulePack: (id) => rulePacks.get(id),
    getRulePackRegistry: () => rulePacks,
    evaluateGate,
    isKnownIrStage,
    listIrStages: () => listIrStageIds(),
    stubs,
    invariants: Object.freeze({
      hasUiOntology: false,
      emitsHtml: false,
      callsDesignApi: false,
      ownsArbitration: false,
      pluginsOwnDecisions: false,
      rulePacksOwnDecisions: false,
    }),
  };
}

module.exports = {
  createKernel,
  JobState,
  FailureKind,
  KernelError,
  bindPolicy,
  buildFingerprint,
  fingerprintKey,
  evaluateGate,
  buildSchedule,
};
