# Architecture Audit — Phases 1–4

| Field | Value |
|-------|--------|
| **Auditor role** | Compiler Architecture Auditor |
| **Date** | 2026-07-18 |
| **Scope** | Phases 1–4 implementation vs RFC-001, RFC-002, Master Plan, PHASE_01–04 execution plans |
| **Method** | Static verification of on-disk artifacts + live test runs |
| **Code modified** | **None** |
| **Phase 5** | Not implemented (audit only) |

**Test evidence (executed during audit):**

| Command | Result |
|---------|--------|
| `npm run test:contracts` | 34 passed, 0 failed |
| `npm run test:kernel` | 16 passed, 0 failed |
| `npm run test:workspace` | 22 passed, 0 failed |
| `npm run test:decision` | 18 passed, 0 failed |

---

## Executive Summary

Phases 1–4 implement a coherent spine consistent with RFC-002’s Kernel / Workspace / Decision model and the Master Plan dependency order:

**Contracts → Kernel → Workspace → Decision Runtime**

Boundaries are largely respected: Workspace is passive storage; Decision Runtime owns winner selection; Kernel owns job lifecycle and delegates arbitration; no convert-API wiring; no Layout/Semantic/Knowledge/Rule engines.

Minor gaps (trace persistence, IR-stage registry enforcement on slices, non-authoritative policy defaults, Kernel `arbitrate` facade naming) do **not** constitute architecture mismatch with the frozen RFCs/plans for this stage of the roadmap.

### Final Verdict

# YELLOW

**Minor issues. Safe to continue Phase 5 after acknowledging the recommendations below.**  
Not RED: no boundary collapse into domain engines or production wiring.  
Not unqualified GREEN: several maintainability / completeness nits should be tracked before claiming production-grade brain completeness.

---

## Part 1 — Architecture Traceability Matrix

### Phase 1 — Contracts & IR Spine

| Expected responsibility | Implementation location | Verified | Evidence | Comments |
|-------------------------|-------------------------|----------|----------|----------|
| Contract suite versioning | `contracts/suite.json` (`1.0.0`), `rules/versioning.md` | Yes | Files present; harness checks suite version | Matches PHASE_01 |
| RawDesignDocument / NDG schemas | `contracts/schemas/raw-design-document.json`, `normalized-design-graph.json` | Yes | Schema files + fixtures | |
| Fact / Hypothesis / Candidate / Evidence / DecisionRecord | `contracts/schemas/*.json` | Yes | Required fields; Decision Record RFC-002 matrix | |
| EmitPlan / ArtifactSet / ResolvedIR / Policy / Fingerprint / Quality / Provenance | `contracts/schemas/` | Yes | 15 contract schemas + `common.json` | |
| Specialized IR envelopes | `specialized-ir-envelope.json` + `registries/ir-stages.json` | Yes | Single envelope + `stageId` enum | Accepted Phase 1 deviation (non-architectural) |
| IR stage registry | `contracts/registries/ir-stages.json` | Yes | 12 stages; harness predecessor check | |
| Question type registry | `contracts/registries/question-types.json` | Yes | Extensible namespaces | |
| Compatibility / consistency / identity rules | `contracts/rules/*.md` | Yes | Three rulebooks | |
| Fixture pack + validation | `contracts/fixtures/`, `validation/harness.js` | Yes | `test:contracts` 34 PASS | Winner/abstain/override fixtures |

### Phase 2 — Compiler Kernel

| Expected responsibility | Implementation location | Verified | Evidence | Comments |
|-------------------------|-------------------------|----------|----------|----------|
| Kernel create / job lifecycle | `compiler/kernel/index.js` `createKernel`, `createJob`, `JobState` | Yes | States: created→running→success\|failed\|aborted | `runEmpty` |
| Policy bind | `compiler/kernel/policy.js` `bindPolicy` | Yes | Rejects ontology tokens in profileId | |
| Budgets | `compiler/kernel/budgets.js` | Yes | Exceed → `BUDGET_EXCEEDED` | Tested |
| Engine registry | `compiler/kernel/engine-registry.js` | Yes | phaseAffinity, determinism, capabilities | |
| Scheduler skeleton | `compiler/kernel/scheduler.js` `buildSchedule` | Yes | Waves early/mid/late/lowering; no engine exec | |
| Fingerprint | `compiler/kernel/fingerprint.js` | Yes | CompileJobFingerprint shape; `fingerprintKey` stable | |
| Gates | `compiler/kernel/gates.js` `evaluateGate` | Yes | Fail-closed on QualityReport errors | |
| Failure taxonomy | `compiler/kernel/failures.js` | Yes | `FailureKind` enum | |
| IR stage awareness | `loadIrStageRegistry` / `isKnownIrStage` | Yes | Reads Phase 1 registry | |
| No UI ontology / no HTML / no design API | `invariants` + tests | Yes | `kernel.test.js` ontology + `emitHtml` absence | |

### Phase 3 — Workspace

| Expected responsibility | Implementation location | Verified | Evidence | Comments |
|-------------------------|-------------------------|----------|----------|----------|
| Workspace create / finalize / discard | `compiler/workspace/index.js` | Yes | `WorkspaceState` open/finalized/discarded | |
| Fact storage + immutability | `putFact` / `getFact` / deepFreeze | Yes | Divergent overwrite → `IMMUTABLE_FACT` | |
| Hypothesis / Decision / Evidence / IR / Provenance | `put*` / `get*` / `listIds` | Yes | StoreKind enum | |
| Snapshot | `snapshot()` | Yes | Deep clone; mutation of snap does not affect store | |
| Audit | `getAuditLog` | Yes | put/invalidate/finalize events | |
| Capability stub | `assertCapability` | Yes | Denied writes tested | |
| Invalidation without Fact mutation | `invalidateFact` | Yes | Flags only | |
| Kernel attach | `job.attachWorkspace` | Yes | Creates/reuses workspace | |
| Passive invariants | `invariants.isPassive`, `scores:false`, `arbitrates:false` | Yes | Declared + no rank/score code paths | Grep: no winner selection logic |

### Phase 4 — Decision Runtime

| Expected responsibility | Implementation location | Verified | Evidence | Comments |
|-------------------------|-------------------------|----------|----------|----------|
| Decision session lifecycle | `compiler/decision/index.js` `createSession` | Yes | OPEN→…→COMMITTED | |
| Candidate / evidence / score registration | `registerCandidate`, `registerEvidence`, `registerScore` | Yes | | |
| Collect Hypotheses from Workspace | `collectFromWorkspace` | Yes | Reads only | |
| Ranking | `compiler/decision/rank.js` | Yes | Band then score | |
| Confidence combine | `compiler/decision/confidence.js` | Yes | Framework only | |
| Arbitration | `compiler/decision/arbitrate.js` | Yes | accept_min, margin, abstain, fallen-back | |
| Override | `applyOverride` | Yes | status `overridden` | |
| Commit to Workspace | `commit` → `workspace.putDecision` | Yes | Writer `decision-runtime` | |
| Traces | `compiler/decision/trace.js` + in-memory `traces` Map | Yes | `trace_refs` on DecisionRecord | Traces not stored in Workspace |
| Thresholds | `compiler/decision/thresholds.js` | Yes | Non-authoritative defaults if not Phase 5 | Documented |
| Kernel hook | `job.arbitrate` → `createDecisionRuntime` → `session.run` | Yes | `compiler/kernel/index.js:204-229` | Facade only |
| No Fact mutation / no HTML / no domain engines | Grep + invariants | Yes | No `putFact` in decision/; no emit | |

---

## Part 2 — Boundary Audit

| Boundary | Result | Evidence |
|----------|--------|----------|
| Kernel never stores Facts | **PASS** | No `putFact` in `compiler/kernel/`; Facts only via Workspace |
| Workspace never chooses winners | **PASS** | `putDecision` stores caller-supplied `winner`; no rank/arbitrate functions in workspace |
| Decision Runtime never mutates Facts | **PASS** | No `putFact`/`invalidateFact` in `compiler/decision/`; test asserts Fact JSON unchanged |
| Decision Runtime never emits HTML | **PASS** | No HTML generators; `invariants.emitsHtml: false` |
| Kernel never performs arbitration **algorithm** | **PASS** | Winner logic lives in `decision/arbitrate.js`; Kernel only invokes Runtime (`index.js:204-229`) |
| Kernel has no `arbitrate` entry point | **N/A (by design FAIL if required)** | PHASE_04 requires Kernel hook → Runtime. **Not a defect.** |
| Workspace never performs scoring | **PASS** | No score math; `invariants.scores: false` |
| No Layout logic | **PASS** | No layout solver/engine under `compiler/` |
| No Semantic logic | **PASS** | No semantic engine; `html.tag` appears only as synthetic **question id** / test answers |
| No Knowledge logic | **PASS** | Fingerprint has `knowledgeBundleVersion` **slot only**; no bundle loader |
| No Rule Engine | **PASS** | No rule pack executor |
| No Pattern Engine | **PASS** | `patternRef` is opaque string on candidates; no detection |
| No convert API wiring | **PASS** | Grep `server/` for `createKernel`/`createWorkspace`/`createDecisionRuntime`: **no matches** |
| No UI ontology leakage in Kernel | **PASS** | Forbidden list rejected on profileId/engine id; production kernel files (except `policy.js` denylist) free of ontology tokens |
| Decision Runtime never modifies Provenance | **PASS** | No `putProvenance` in decision/ |
| Workspace remains passive | **PASS** | Storage + validation hooks only |

---

## Part 3 — Real Execution Flow

Verified from `compiler/kernel/index.js` and `compiler/decision/index.js` (not invented).

```text
createKernel()
  └─ createJob({ policyProfile })
       ├─ bindPolicy(policyProfile)                 // kernel/policy.js
       ├─ buildFingerprint(...)                     // kernel/fingerprint.js
       └─ createBudgetTracker(policy.budgets)       // kernel/budgets.js

job.attachWorkspace()
  └─ createWorkspace({ jobId, contractSuiteVersion })  // workspace/index.js

[External / test writer — NOT Decision Runtime]
workspace.putHypothesis(hypothesis, writer)         // or register candidates later

job.arbitrate({ question, subject, fromWorkspace?, candidates?, ... })
  ├─ this.attachWorkspace()
  ├─ createDecisionRuntime({ workspace, policy, contractSuiteVersion })
  ├─ runtime.createSession({ question, subject, decisionId? })
  └─ session.run({ ... })
       ├─ collectFromWorkspace()?                   // workspace.getHypothesis / listIds
       ├─ registerCandidate / registerEvidence / registerScore
       ├─ rank()
       │    └─ rankCandidates(...)                  // decision/rank.js
       │         └─ scoreCandidate(...)             // decision/confidence.js
       ├─ runArbitration() OR applyOverride()
       │    └─ arbitrate({ scored, thresholds })    // decision/arbitrate.js
       └─ commit()
            ├─ buildDecisionRecord()
            ├─ workspace.putDecision(record, { id: 'decision-runtime', ... })
            └─ buildTrace(...) → traces.set(traceId, trace)

Finish: returns { decision, trace }
         DecisionRecord readable via workspace.getDecision(id)
```

**Note:** `runEmpty()` is a separate Phase 2 empty-job path (schedule skeleton only). It does **not** call Decision Runtime. Full brain flow uses `arbitrate`, not `runEmpty`.

---

## Part 4 — Data Flow (one object chain)

Example path observed in tests (`decision.test.js` + Workspace APIs):

| Step | Object | Owner action | Mutation |
|------|--------|--------------|----------|
| 1 | **Fact** (optional) | Writer → `workspace.putFact` | Created once; deep-frozen; never changed by Decision Runtime |
| 2 | **Hypothesis** | Writer → `workspace.putHypothesis` | Stored frozen; contains candidates/evidence/localScores |
| 3 | Session collect | Decision Runtime **reads** Hypothesis | No Hypothesis mutation |
| 4 | In-session **candidates/evidence** | Runtime arrays | Session-local copies; not Workspace until commit |
| 5 | **Ranking / scores** | Runtime ephemeral `rankingResult` | Not persisted until DecisionRecord |
| 6 | **Arbitration result** | Runtime ephemeral | Winner/abstain/override chosen |
| 7 | **DecisionRecord** | Runtime `buildDecisionRecord` → `workspace.putDecision` | New immutable store entry |
| 8 | **Trace** | Runtime `traces` Map + `trace_refs` on DecisionRecord | Trace object **not** written to Workspace store |
| 9 | Output | Caller receives `{ decision, trace }` | Workspace retains DecisionRecord |

**Ownership:** Facts/Hypotheses owned by producing writers; DecisionRecords owned by Decision Runtime at commit time; Workspace owns storage durability for the job; Kernel owns job/policy/fingerprint lifecycle.

---

## Part 5 — State Ownership Matrix

| Object | Owner (lifecycle) | Writer | Reader | Mutability | Lifetime |
|--------|-------------------|--------|--------|------------|----------|
| CompileJob | Kernel | Kernel (`createJob`) | Tests/callers | State machine transitions | Job |
| PolicyProfile (bound) | Kernel (bound copy) | Caller supplies; Kernel `bindPolicy` freezes | Job, Decision Runtime | Immutable after bind | Job |
| CompileJobFingerprint | Kernel | `buildFingerprint` | Job status | Immutable | Job |
| Workspace | Kernel attaches; Workspace module | Writers with capabilities | Engines/Runtime | Container state open/finalized/discarded | Job (until discard) |
| Fact | Producing engine/writer | `putFact` only | Any reader | **Immutable** after put | Workspace lifetime |
| Hypothesis | Producing engine/writer | `putHypothesis` | Decision Runtime, readers | Immutable after put (replace = duplicate reject) | Workspace |
| Evidence (standalone) | Writer | `putEvidence` | Readers | Immutable after put | Workspace |
| DecisionRecord | Decision Runtime (commit) | Runtime via `putDecision` | Readers / later phases | Immutable after put | Workspace |
| ProvenanceBundle | Future writers | `putProvenance` | Readers | Immutable after put | Workspace |
| IrSlice | Future engines | `putIrSlice` | Readers | Immutable after put | Workspace |
| Decision Trace | Decision Runtime instance | `buildTrace` | Caller / `getTrace` | Append-only Map | **Runtime instance** (lost if new Runtime per `job.arbitrate` call) |
| Engine registry | Kernel | `registerEngine` | Scheduler | Mutable Map on Kernel instance | Kernel instance |

---

## Part 6 — Dependency Graph

### Target (Master Plan / RFC-002)

```text
Contracts
  → Kernel
    → Workspace
      → Decision Runtime
        → Policy Profiles (Phase 5)     [not implemented]
        → Knowledge / Rules / Pattern   [not implemented]
        → Layout / Semantic             [not implemented]
        → Emit                          [not implemented]
```

### Actual `require` graph (verified)

```text
contracts/                          (data only; loaded by path from kernel/fingerprint & harness)
compiler/kernel
  → ./failures, ./policy, ./fingerprint, ./budgets, ./engine-registry, ./scheduler, ./gates
  → ../workspace   (createWorkspace)
  → ../decision    (createDecisionRuntime)
compiler/decision
  → ./rank, ./arbitrate, ./confidence, ./bands, ./thresholds, ./trace, ./errors
  → ../workspace   (StoreKind only + putDecision via injected workspace instance)
compiler/workspace
  → ./errors, ./kinds
  (does not require kernel or decision)
```

| Check | Result |
|-------|--------|
| Follows Contracts → Kernel → Workspace → Decision order | **PASS** |
| No Workspace → Kernel require | **PASS** |
| No Decision → Kernel require | **PASS** |
| No cycle Kernel ↔ Decision ↔ Workspace | **PASS** (Kernel→both; Decision→Workspace kinds; Workspace standalone) |
| Later phases absent (Knowledge→…→Emit) | **PASS** (correctly not present yet) |

---

## Part 7 — Invariant Verification

| Invariant | Result | Evidence |
|-----------|--------|----------|
| Facts immutable | **PASS** | `IMMUTABLE_FACT`; deepFreeze; tests |
| Workspace passive | **PASS** | No arbitration/scoring implementation |
| Kernel owns lifecycle | **PASS** | JobState + createJob/runEmpty/abort |
| Decision Runtime owns arbitration | **PASS** | `arbitrate.js` + session commit |
| No cyclic dependencies | **PASS** | See Part 6 |
| No duplicate ownership of winner selection | **PASS** | Only Decision Runtime selects winners |
| No hidden global singleton Workspace/Kernel | **PASS** | Factory `create*` per call; Maps are instance-local |
| Deterministic fingerprint | **PASS** | `fingerprintKey` equality test |
| Shared live mutable Fact across readers | **PASS** (mitigated) | Frozen clones on put; snapshot clones |
| Decision traces durable in Workspace | **FAIL (minor)** | Traces live in Runtime Map; only `trace_refs` on DecisionRecord in Workspace |
| IR slice `stageId` validated against registry | **FAIL (minor)** | `putIrSlice` does not call Kernel `isKnownIrStage` |
| Open writer (no capabilities) can write all kinds | **PASS with risk** | Documented stub; intentional for Kernel/tests |

---

## Part 8 — Test Coverage Audit

| Module | Test file | Approx. cases | Strengths | Gaps / risks |
|--------|-----------|---------------|-----------|--------------|
| Contracts | `contracts/validation/harness.js` | 34 checks | Schema, negatives, Decision cases, consistency | Not a full JSON-Schema draft-07 engine (subset) |
| Kernel | `compiler/test/kernel.test.js` | 16 | Lifecycle, fingerprint, ontology, gate, budget, arbitrate integration | No concurrent jobs; `runEmpty`+`arbitrate` interaction; discarded workspace re-attach edge |
| Workspace | `compiler/test/workspace.test.js` | 22 | Immutability, caps, snapshot, two-engine, cross-ref | Finalize then read allowed?; provenance without enforceCrossRef=false path lightly tested |
| Decision | `compiler/test/decision.test.js` | 18 | Winner/abstain/override/bands/fallback/commit/dup | P0/P1 veto paths lightly covered; `fail_closed_below` unused in arbitrate.js; recovery hook not behavioral |

**Weak assertions / mutation risks**

- Identical Decision re-put is idempotent (by design); tests correctly use divergent content for duplicate reject.  
- `html.tag` / `{ tag: 'section' }` in tests are synthetic payloads—not Semantic Engine—but reviewers must not confuse with domain intelligence.  
- Each `job.arbitrate` constructs a **new** DecisionRuntime → prior in-memory traces not retained on the job object.

**Uncovered APIs (examples)**

- Workspace: `enforceCrossRef: false` option path  
- Decision: explicit `close()` session end; `listTraces` multi-session  
- Kernel: `allowedEngineIds` filtering during `runEmpty` schedule (code exists; limited tests)

---

## Part 9 — Architecture Smells

| Smell | Severity | Detail |
|-------|----------|--------|
| Kernel `arbitrate` facade | Low | Name suggests Kernel arbitrates; body only delegates. Aligns with PHASE_04 but confuses the user’s “Kernel never performs arbitration” checklist wording. |
| Trace not in Workspace | Medium | Explainability across process restarts incomplete; only `trace_refs` survive in DecisionRecord. |
| Non-authoritative thresholds | Low (expected) | Defaults in `decision/thresholds.js` until Phase 5 — correct staging, must not be mistaken for product policy. |
| `jobId` uses `Date.now` + `Math.random` | Low | Job identity non-deterministic; fingerprint remains deterministic. |
| Dead / vestigial `stubs` object on Kernel | Low | `stubs.arbitration.status` informational; no longer throws. |
| `fail_closed_below` unused | Low | Resolved in thresholds but not applied in `arbitrate.js`. |
| Open capability writer | Medium (ops) | Null capabilities ⇒ all writes allowed — fine for unit tests; dangerous if production writers omit caps. |
| No god-object domain compiler | Good | Responsibilities split across contracts/kernel/workspace/decision. |
| Premature domain engines | Absent (good) | Not implemented — correct. |
| Over-engineering | Low | Phase 1–4 spine is appropriate for roadmap; not a 30-engine premature build. |
| RFC-001 linear engine chain | N/A | Implementation correctly follows RFC-002 workspace model, not RFC-001’s rejected linear narrative. |

**Nothing found that reintroduces a monolithic analyze→emit heuristic compiler inside `compiler/`.**

---

## Part 10 — Phase Readiness

### Can Phase 5 begin?

**YES — with YELLOW caveats.**

Phase 5 (Policy Profiles & authoritative thresholds) is the natural next dependency: Decision Runtime already consumes PolicyProfile threshold **slots** and documents non-authoritative defaults.

### Recommendations before / during Phase 5

1. Treat Phase 5 as the moment `valuesAuthoritative: true` profiles replace defaults — do not hardcode product thresholds into Decision Runtime.  
2. Optionally persist traces into Workspace or attach trace blobs to Provenance (plan amendment if required).  
3. Optionally validate `IrSlice.stageId` against Phase 1 IR registry on write.  
4. Keep convert APIs unwired until a later dual-run phase (Master Plan Phase 30).  
5. When documenting boundaries, say: **“Kernel invokes arbitration; Decision Runtime performs arbitration.”**

### Risk Register (audit)

| ID | Risk | Severity | Mitigation |
|----|------|----------|------------|
| A1 | Trace loss across `arbitrate` calls | Medium | Persist traces or attach to job |
| A2 | Open writers bypass capability model | Medium | Require capabilities in non-test profiles |
| A3 | Confusion: Kernel.arbitrate vs Runtime | Low | Docs / naming |
| A4 | Unused threshold knobs | Low | Phase 5 + arbitrate wiring |
| A5 | Premature convert wiring | High if done | Do not wire yet |

---

## Recommendations (summary)

1. Proceed to Phase 5 **policy authority**, not Phase 5 domain engines.  
2. Track A1–A4 as Phase 5/ops polish, not architecture rewrites.  
3. Do **not** “fix” boundaries by moving arbitration algorithm into Kernel or Workspace.  
4. Do **not** implement Knowledge/Rules/Layout/Semantic until their Master Plan phases.

---

## Final Verdict

| Dimension | Assessment |
|-----------|------------|
| Traceability to plans/RFCs | Strong |
| Boundary discipline | Strong (with naming caveat) |
| Dependency order | Correct |
| Test signal | All suites green |
| Production wiring | Correctly absent |
| Ready for Phase 5? | **YELLOW — yes, with recommendations** |

```text
YELLOW
Minor issues.
Safe to continue after acknowledging recommendations.
Architecture of Phases 1–4 matches the frozen foundation;
no RED mismatch found.
```

---

**End of audit. No code was modified. Phase 5 was not implemented.**
