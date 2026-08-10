# Pre-Phase-6 Integration Verification Audit

| Field | Value |
|-------|--------|
| **Role** | Integration Verification Auditor |
| **Date** | 2026-07-18 |
| **Scope** | Phases 1–5 as one coherent compiler spine |
| **Method** | Static verification of on-disk implementation + live Node probes (determinism, isolation, failure paths) |
| **Code modified** | **None** |
| **Phase 6** | Not implemented (audit only) |

**Suite evidence (re-run during audit):**

| Command | Result |
|---------|--------|
| `npm run test:contracts` | 34 passed, 0 failed |
| `npm run test:kernel` | 17 passed, 0 failed |
| `npm run test:workspace` | 25 passed, 0 failed |
| `npm run test:decision` | 24 passed, 0 failed |
| `npm run test:policy` | 19 passed, 0 failed |

**Live probes:** 5× identical compile request; 2-job isolation; 4-profile freeze/mutation; error-path matrix — executed against `compiler/*` APIs (no assumptions).

---

## Executive Summary

Phases 1–5 form a coherent, ownership-respecting spine:

**Contracts → Kernel (lifecycle) → Policy (config) → Workspace (passive store) → Decision Runtime (arbitration)**

An end-to-end path can be composed today: job → policy resolve → workspace → facts/hypotheses → rank → arbitrate → commit Decision + Trace. Determinism of **semantic** compile artifacts (fingerprint, ranking, thresholds, decision winner) holds under fixed IDs. Job isolation holds. Boundaries hold.

Gaps are operational completeness, not architecture collapse: no single `compile()` orchestrator; trace wall-clock `at`; unused `fail_closed_below`; engine capability declarations not yet auto-enforced on Workspace writers; policy **flags** are declarative only.

### Final Verdict

# YELLOW

**Minor integration gaps. Safe to begin Phase 6 with the recommendations below.**  
Not RED: no boundary violations, no ownership inversion, suites green.  
Not unqualified GREEN: orchestration surface incomplete; a few nondeterministic metadata fields and unused policy knobs remain.

---

## Part 1 — End-to-End Flow

Composed path verified live (there is **no** single Kernel `compile()` entry; steps are explicit APIs).

| # | Step | Module | Function | Input | Output | Owner | State changes |
|---|------|--------|----------|-------|--------|-------|---------------|
| 1 | Create kernel | `compiler/kernel` | `createKernel()` | `{ contractSuiteVersion? }` | Kernel instance | Kernel factory | Loads IR registry cache; empty engine Map |
| 2 | Create job | Kernel | `createJob({ policyProfileId \| policyProfile, seed?, … })` | Profile id or inline profile | Job handle | Kernel | Job `CREATED`; policy bound/resolved; fingerprint built; budgets created |
| 3 | Policy resolution | `compiler/policy` via `resolveJobPolicy` | `resolveProfile(id)` or `bindPolicy(inline)` | `pixel-faithful` etc. | Frozen PolicyProfile | **Policy module** (values); Kernel holds job binding | None in Policy store; job closes over policy |
| 4 | Attach workspace | Kernel / Workspace | `job.attachWorkspace()` → `createWorkspace({ jobId })` | jobId, suiteVersion | Workspace | Workspace factory | Workspace `OPEN`; empty Maps |
| 5 | Fact creation | Workspace | `putFact(record, writer?)` | Fact contract | Frozen Fact | Writer (engine/test); Workspace stores | Fact Map insert; audit log |
| 6 | Hypothesis creation | Workspace | `putHypothesis(record, writer?)` | Hypothesis | Frozen Hypothesis | Writer; Workspace stores | Hypothesis Map insert |
| 7 | Decision Runtime | Kernel facade → Decision | `invokeDecisionRuntime` → `createDecisionRuntime` → `createSession` | question, subject, policy, workspace | Session | Decision Runtime | Session `OPEN` |
| 8 | Collect | Decision | `registerCandidate` / `collectFromWorkspace` | Candidates or Hypothesis ids | Session lists | Decision Runtime | `OPEN`→`COLLECTED` |
| 9 | Ranking | Decision | `rank()` → `rankCandidates` | candidates + scores | `{ ranking, scored }` | Decision Runtime | →`RANKED` |
| 10 | Arbitration | Decision | `arbitrate()` → `arbitrate.js` | scored + thresholds | winner / abstain / fallen-back | Decision Runtime | →`ARBITRATED` |
| 11 | Decision commit | Decision → Workspace | `commit()` → `putDecision` | DecisionRecord | Frozen DecisionRecord | Runtime authors; Workspace persists | →`COMMITTED`; Decision Map |
| 12 | Decision Trace | Decision → Workspace | `buildTrace` → `putTrace` | Trace blob | Frozen DecisionTrace | Runtime authors; Workspace durable SoT | Trace Map; Runtime cache write-through |
| 13 | Finish | Kernel / Workspace | `runEmpty` and/or `finalize`/`discard` | outcome / qualityReport | Job terminal status | Kernel job lifecycle | Job `SUCCESS`\|`FAILED`\|`ABORTED`; optional Workspace `FINALIZED` |

**Evidence:** Live probe composed steps 2–12 with `policyProfileId: 'pixel-faithful'` and fixed `decisionId`; suites cover each module.

---

## Part 2 — Ownership Matrix

| Artifact | Owner (authority) | Creator | Modifier | Reader | Destroyer | Persistence |
|----------|-------------------|---------|----------|--------|-----------|-------------|
| **CompileJob** | Kernel | `createJob` | Job state machine only | Caller / status | GC after handle drop (no explicit destroy) | In-process job closure |
| **PolicyProfile** | Policy module (corpus + resolve) | Profile JSON / `registerRaw` | None after `toEnforceable` freeze | Kernel bind, Decision Runtime | N/A (immutable) | Disk corpus + registry Map (singleton default) |
| **Fingerprint** | Kernel (build) | `buildFingerprint` | None (plain object; not frozen) | Job status / callers | N/A | Job closure |
| **Workspace** | Workspace module | `createWorkspace` / `attachWorkspace` | put*/invalidate/finalize/discard | Engines, Runtime, Kernel | `discard()` clears Maps | In-process Maps |
| **Fact** | Workspace store; writer creates | `putFact` | **Forbidden** (immutable); invalidate flag only | Any reader | Cleared on `discard` | Workspace Map |
| **Hypothesis** | Workspace | `putHypothesis` | No in-place mutate; duplicate id rejected | Decision Runtime collect | `discard` | Workspace Map |
| **Evidence** | Workspace | `putEvidence` / session register (session-local until commit embeds refs) | Immutable after put | Runtime / readers | `discard` | Workspace Map and/or DecisionRecord |
| **DecisionRecord** | Decision Runtime (author); Workspace (store) | `commit` → `putDecision` | None after put | Readers | `discard` | Workspace Map |
| **DecisionTrace** | Decision Runtime (author); Workspace (durable) | `buildTrace` → `putTrace` | None after put | `getTrace` (Runtime→WS) | `discard` | Workspace Map + Runtime cache |
| **IrSlice** | Workspace; stageId gated by Phase 1 registry | `putIrSlice` | None after put | Readers | `discard` | Workspace Map |
| **Provenance** | Workspace | `putProvenance` | None after put | Readers | `discard` | Workspace Map |
| **QualityReport** | Caller-supplied stub; Kernel evaluates | External / test | N/A in spine | `evaluateGate` / `runEmpty` | N/A | Not stored by Kernel |
| **EmitPlan** | Contract only (Phase 1) | **Not produced** in Phases 1–5 runtime | — | — | — | Schema/fixtures only |

---

## Part 3 — Determinism Audit

**Method:** 5 jobs with identical `jobId`, `policyProfileId`, `seed`, `decisionId`, candidates.

| Check | Result | Notes |
|-------|--------|-------|
| Fingerprint identical | **PASS** | `fingerprintKey` equal across runs |
| Decision identical | **PASS** | status/winner/ranking/scores/policy payload equal |
| Ranking identical | **PASS** | |
| Threshold resolution identical | **PASS** | authoritative slots from profile |
| Trace **semantic** content identical | **PASS** | question/ranking/scored/thresholds/arbitration |
| Full trace byte-identical | **FAIL (metadata)** | `buildTrace` sets `at: new Date().toISOString()` — wall clock |
| Hidden randomness in outcomes | **PASS** (gated) | `Math.random` only for **unspecified** `jobId` / `decisionId` / `workspaceId` |
| Mutable shared state affecting outcomes | **PASS** | Shared policy registry is read-only config cache |
| Order dependence of ranking | **PASS** | Band then score sort is pure |

### Determinism verdict: **PASS** (semantic) / **YELLOW caveat** (trace `at`, ephemeral IDs if unset)

---

## Part 4 — Job Isolation

**Method:** Job A (`pixel-faithful`) vs Job B (`semantic-lean`); distinct Facts/Decisions/Traces.

| Check | Result |
|-------|--------|
| Workspace isolation | **PASS** (`workspaceId` differs; facts not visible cross-job) |
| Policy isolation | **PASS** (distinct profile objects & ids) |
| Trace isolation | **PASS** |
| Decision isolation | **PASS** |
| Fingerprint isolation | **PASS** (different profile/seed → different key) |
| Cross-job memory leakage | **PASS** |
| Shared mutable decision objects | **PASS** (frozen stores; distinct Maps) |
| Engine registry cross-Kernel | **PASS** (register on K1 invisible on K2) |

### Isolation verdict: **PASS**

**Note:** Default Policy registry is a process singleton (`getDefaultRegistry`) — shared **immutable** config, not job mutable state. Acceptable; document for multi-tenant process reuse.

---

## Part 5 — Policy Audit

| Profile | Inheritance | Thresholds (accept/margin/fallback) | GateMode | Authoritative | Frozen | Mutation blocked |
|---------|-------------|--------------------------------------|----------|---------------|--------|------------------|
| `pixel-faithful` | self | 0.75 / 0.12 / 0.55 | `fail_closed` | true | yes | yes |
| `semantic-lean` | self | 0.55 / 0.08 / 0.45 | `best_effort` | true | yes | yes |
| `static-ok` | ← `pixel-faithful` | inherits 0.75 / 0.12 / 0.55 | `fail_closed` | true | yes | yes |
| `interactive-required` | ← `semantic-lean` (+ overrides) | 0.6 / 0.1 / 0.45 | `fail_closed` | true | yes | yes |

| Check | Result |
|-------|--------|
| Compatibility API | **PASS** (suite mismatch / engine allowlist throw `INCOMPATIBLE`) |
| No duplicate conflicting threshold sources at resolve | **PASS** (child overrides parent via merge; leaf identity kept) |
| Decision diffs by profile | **PASS** (mid-score abstain under pixel; accept under semantic — suite + live) |
| Flags enforced as runtime gates | **N/A / deferred** — `authorizeInteractionJs`, `requireBehaviorCoverage` are config only (correct for Phase 5; not yet consumed) |

### Policy verdict: **PASS** (configuration integrity)

---

## Part 6 — Boundary Verification

| Boundary | Result | Evidence |
|----------|--------|----------|
| Kernel never reasons / ranks / chooses winners | **PASS** | `invokeDecisionRuntime` delegates; `ownsArbitration: false`; no rank in kernel/ |
| Workspace never scores / ranks / chooses winners | **PASS** | `putDecision` stores caller winner; `invariants.scores/arbitrates: false` |
| Decision Runtime never creates Facts | **PASS** | No `putFact` in `compiler/decision/`; writer caps DECISION+TRACE only |
| Decision Runtime never mutates Facts | **PASS** | Suite + no invalidate paths |
| Policy never performs logic / ranks / emits HTML | **PASS** | validate/resolve/merge only; `emitsArtifacts: false` |
| Kernel never owns **authoritative policy values** | **PASS** | Values from `compiler/policy/profiles`; Kernel binds/resolves only |
| Runtime never owns policy values | **PASS** (authoritative path) | Consumes slots; rejects missing when `valuesAuthoritative` |
| Runtime non-authoritative defaults | **PASS with caveat** | Still present for `valuesAuthoritative !== true` (dev path) |

### Boundary verdict: **PASS**

---

## Part 7 — State Machine Audit

### CompileJob (`JobState`)

| From | To | Trigger | Invalid rejected? |
|------|----|---------|-------------------|
| `created` | `running` | `runEmpty` | yes (`assertTransition`) |
| `running` | `success` \| `failed` \| `aborted` | success path / catch / abort outcome | yes |
| `created` | `aborted` | `abort` | yes |
| Terminal | * | `abort` | **yes** — throws |

### Workspace (`WorkspaceState`)

| From | To | Trigger |
|------|----|---------|
| `open` | `finalized` | `finalize` |
| `open` \| `finalized` | `discarded` | `discard` |
| `open` | writes | `put*` |
| non-open | writes | **rejected** |
| `discarded` | reads/writes | **rejected** |

### DecisionSession (`SessionState`)

`open` → `collected` → `ranked` → `arbitrated` → `committed` → `closed`  
Invalid (e.g. `commit` before arbitrate) → `DecisionErrorKind.INVALID_STATE` — **verified in suite**.

### DecisionRecord status

Set at arbitration/override: `arbitrated` | `overridden` | `fallen-back` (and reject paths via commit failure). Immutable after Workspace put.

### State machine verdict: **PASS**

---

## Part 8 — Failure Path Audit

| Failure | Handling path | Verified |
|---------|---------------|----------|
| Unknown policy | `resolveProfile` → `PolicyError` → Kernel `POLICY_VIOLATION` on `createJob` | Live **PASS** |
| Missing thresholds | `validateProfile` / Runtime `resolveThresholds` → reject | Live **PASS** |
| Bad profile suite version | `VERSION_MISMATCH` on resolve | Live **PASS** |
| Unknown IR stage | `putIrSlice` → `UNKNOWN_IR_STAGE` | Live **PASS** |
| Immutable Fact overwrite | `IMMUTABLE_FACT` | Live **PASS** |
| Duplicate Decision | Workspace duplicate → Runtime `COMMIT_FAILED` | Live **PASS** |
| Abstain | Arbitration `below_accept_min` / margin | Live **PASS** |
| Fallback | `fallen-back` + safeGeneric | Live **PASS** |
| Gate failure | `evaluateGate` fail_closed → job `FAILED` / `GATE_FAIL` | Live **PASS** |
| Budget exceeded | `budgets.check` → `BUDGET_EXCEEDED` → job `FAILED` | Live **PASS** |
| Quality fail best-effort | `semantic-lean` gateMode → job `SUCCESS` with errors present | Live **PASS** |

### Failure path verdict: **PASS**

---

## Part 9 — Plugin Readiness (no Phase 6 implementation)

| Surface | Present? | Ready for Phase 6? |
|---------|----------|--------------------|
| Engine registry | Yes — `createEngineRegistry` | **Skeleton yes** |
| Capability model (`reads`/`writes`) | Declared on engine entry | **Partial** — not auto-wired to Workspace writers |
| `allowedEngineIds` | On PolicyProfile; schedule filter in `runEmpty` | **Yes** (filter when non-empty) |
| Questions / packs / phaseAffinity / determinism | On declaration | **Yes** (declarative) |
| Future attachment point | `registerEngine` + `buildSchedule` | **Yes** |
| Dependency inversion | Engines not imported by Decision/Policy | **Yes** |
| Crash isolation contract | Not present | **No** (Phase 6 deliverable) |
| Version in fingerprint for engines | Not present | **No** |
| Plugin assumptions / coupling | None found | **PASS** |

### Plugin readiness: **YELLOW — skeleton ready; enforcement & isolation contracts still Phase 6**

---

## Part 10 — Production Readiness Scores

Scale: 1–5 (5 = production-grade for that concern **at this phase**).

| Area | Score | Rationale |
|------|-------|-----------|
| Scalability | 3 | In-process Maps; fine for single-job; no horizontal design yet |
| Maintainability | 4 | Clear modules; invariants documented; suites |
| Extensibility | 4 | Registry + policy allowlists; plugin hooks stubbed |
| Debuggability | 4 | Traces, audit log, snapshot; wall-clock `at` helps humans |
| Observability | 3 | Audit/traces exist; no metrics/export pipeline |
| Traceability | 4 | Decision↔trace_refs↔Workspace; provenance store ready unused |
| Determinism | 4 | Semantic PASS; ID/`at` caveats |
| Architectural cleanliness | 5 | Ownership and boundaries coherent |

**Mean ≈ 3.9** — strong constitution; not a shipping compiler product yet (expected).

---

## Part 11 — Risk Register

| ID | Risk | Severity | Blocks Phase 6–10? | Mitigation |
|----|------|----------|--------------------|------------|
| R1 | Trace `at` wall-clock → non-byte-identical traces | Low | No | Pin/omit `at` for golden compares later |
| R2 | Ephemeral `jobId`/`decisionId`/`workspaceId` if unset | Low | No | Callers must pass fixed IDs for goldens |
| R3 | Default Policy registry singleton | Low | No | Document; clone registry per Kernel if multi-tenant |
| R4 | Engine capabilities not enforced on Workspace writes | Medium | Phase 6 should close | Wire writer caps from declaration |
| R5 | `fail_closed_below` unused in `arbitrate.js` | Low | Soft | Wire in Decision or drop from tables |
| R6 | Policy flags declarative only | Medium | Behavior/emit phases | Consume in gates when Behavior arrives |
| R7 | No single `compile()` orchestrator | Medium | Clarity for 7–10 | Add thin Kernel orchestrator later without moving ownership |
| R8 | Fingerprint object not frozen | Low | No | Freeze if mutation feared |
| R9 | Open writer (no capabilities) can write all kinds | Low | Phase 6 | Tighten defaults |
| R10 | EmitPlan/Provenance not in E2E path | Expected | Later phases | Normal staging |
| R11 | Concurrent jobs on one Kernel share engine registry | Low–Med | If parallel jobs mutate registry | Per-job registry snapshot or freeze after bind |
| R12 | Future RFC: confidence calibration vs localScore | Low | Soft | Keep framework-only until Knowledge |

**Hidden coupling:** Kernel→Policy→Decision is intentional. No reverse requires. Workspace does not import Kernel/Decision.

**Leaky abstractions:** `job.arbitrate` name (aliased; mitigated by `invokeDecisionRuntime`).

**Technical debt:** unused threshold knobs; non-authoritative Runtime defaults still in tree.

---

## Architecture Score

| Dimension | Score (1–10) |
|-----------|--------------|
| Coherence of Phases 1–5 | 9 |
| Ownership clarity | 9 |
| Boundary integrity | 9 |
| Determinism (semantic) | 8 |
| Isolation | 9 |
| Failure handling | 8 |
| Plugin readiness | 6 |
| Production completeness | 5 |
| **Overall** | **8.0 / 10** |

---

## Recommendations (before / during Phase 6)

1. Treat Phase 6 as **capability enforcement + crash isolation**, not architecture rewrite.  
2. When adding goldens: fix `decisionId`/`seed`; compare traces without `at` or stabilize timestamp.  
3. Optionally freeze fingerprints; document shared Policy registry.  
4. Either wire `fail_closed_below` or mark it reserved in profile docs.  
5. Do **not** move arbitration into Kernel or scoring into Workspace.  
6. Keep Policy flags as config until Behavior/Emit phases consume them.

---

## Final Verdict

# YELLOW

Phases 1–5 integrate as one coherent compiler **constitution**. Ownership, isolation, boundaries, and semantic determinism are sound. Remaining issues are metadata nondeterminism, incomplete orchestration surface, and plugin-enforcement gaps appropriate for Phase 6+ — not architectural RED.

**Do not treat this audit as Phase 6 start.**

---

**End of audit. No code was modified. Phase 6 was not implemented.**
