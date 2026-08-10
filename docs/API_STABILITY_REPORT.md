# API_STABILITY_REPORT.md — Foundation Freeze v1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Phase** | 11b.1 |
| **Authority** | ARCHITECTURE_LOCK_CONTRACT.md |

Legend: **Stable** · **Experimental** · **Internal** · **Deprecated**

---

## Kernel (`createKernel` / job)

| API | Class | Reason |
|-----|-------|--------|
| `createKernel` | Stable | Primary entry |
| `createJob` | Stable | Job lifecycle |
| `job.getStatus` / `getFingerprint` / `fingerprintKey` | Stable | Determinism surface |
| `job.attachWorkspace` / `getWorkspace` | Stable | Blackboard access |
| `job.invokeDecisionRuntime` | Stable | Preferred Decision facade |
| `job.arbitrate` | Deprecated | Alias of `invokeDecisionRuntime` |
| `job.materializeNormalizedDesignGraph` | Stable | NDG materialize |
| `job.projectLayoutIR` | Stable | LayoutIR₀ |
| `job.solveLayoutConstraints` | Stable | LayoutIR₁ |
| `job.executeRulePack` | Stable | Pack execution |
| `job.executePlugin` | Experimental | Escape hatch; prefer typed methods |
| `job.runEmpty` | Experimental | Phase 2 skeleton; not a compile |
| `job.abort` | Stable | Control |
| `job.listEnabledPlugins` / `listEnabledRulePacks` | Stable | Introspection |
| `job.buildPluginSchedule` | Experimental | Scheduling aid |
| `job.getPolicy` / knowledge getters | Stable | Bound config |
| `registerPlugin` / `registerRulePack` / `loadRulePackDirectory` | Stable | Extension registration |
| `registerKnowledge` / `loadKnowledge` | Stable | Bundle registration |
| `registerEngine` | Deprecated | Prefer `registerPlugin` (dual registry debt) |
| `evaluateGate` / `isKnownIrStage` / `listIrStages` | Stable | Shared utilities |
| `buildFingerprint` / `fingerprintKey` | Stable | Must match schema |
| `assertNoHiddenFingerprintFields` | Stable | 11b.1 guard |
| `FailureKind` / `JobState` / `KernelError` | Stable | Error vocabulary |
| `invariants` / `stubs` | Internal | Documentation flags |

---

## Workspace

| API | Class | Reason |
|-----|-------|--------|
| `createWorkspace` | Stable | |
| `putFact` / `getFact` / `invalidateFact` | Stable | Fact protocol |
| `putHypothesis` / `getHypothesis` | Stable | |
| `putDecision` / `getDecision` | Stable | Store only |
| `putEvidence` / `getEvidence` | Stable | |
| `putIrSlice` / `getIrSlice` | Stable | Immutable slices |
| `putTrace` / `getTrace` | Stable | |
| `putProvenance` / `getProvenance` | Stable | |
| `setLayoutIrPin` / `getLayoutIrPin` / `listLayoutIrPins` | Stable | Phase 11b.1 metadata |
| `listIds` / `getStatus` / `snapshot` | Stable | Introspection |
| `finalize` / `discard` | Stable | Lifecycle |
| `invariants` | Stable | Non-capability flags |

---

## Decision Runtime

| API | Class | Reason |
|-----|-------|--------|
| `createDecisionRuntime` | Stable | |
| Session `collect` / `rank` / `arbitrate` / `commit` | Stable | Orchestration |
| `rankCandidates` / `arbitrate` (module) | Internal | Prefer session |
| `resolveThresholds` | Stable | Policy bridge |
| `SessionState` / errors | Stable | |

---

## Layout / NDG / Constraint

| API | Class | Reason |
|-----|-------|--------|
| `materializeNormalizedDesignGraph` | Stable | |
| `materializeLayoutIR` / `projectLayoutIR` | Stable | |
| `materializeSolvedLayoutIR` / `solveConstraints` | Stable | |
| `buildConstraintNetwork` | Internal | Never publish as IR |
| `loadLayoutIrFromWorkspace` | Stable | Pin-aware |
| `loadNdgFromWorkspace` | Stable | |
| Pack handlers | Internal | Per-pack |

---

## Plugin / Rule Pack / Policy / Knowledge

| API | Class | Reason |
|-----|-------|--------|
| `createPluginRegistry` / `executePlugin` | Stable | |
| `createRulePackRegistry` / `execute` | Stable | |
| `resolveProfile` | Stable | |
| Knowledge registry + handle | Stable | Read-only handle to engines |

---

## Contracts

| API | Class | Reason |
|-----|-------|--------|
| JSON Schemas + registries | Stable | Suite 1.0.0 |
| Validation harness | Stable | CI |
| Fixtures | Stable | Golden inputs |
