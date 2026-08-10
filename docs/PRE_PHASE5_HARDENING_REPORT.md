# Pre-Phase-5 Architecture Hardening Report

| Field | Value |
|-------|--------|
| **Role** | Architecture Hardening |
| **Date** | 2026-07-18 |
| **Scope** | Resolve YELLOW findings from `docs/AUDIT_PHASE_1_TO_4.md` without redesign |
| **Phase 5** | **Not started** |
| **Out of scope** | Knowledge, Rules, Pattern Engine, Layout, Semantic, Policy Profiles, convert API wiring |

---

## Executive Summary

Hardening closed every audit recommendation that could be fixed without changing the frozen architecture. Trace durability, IR stage registry checks, Kernel facade clarity, and authoritative threshold slot enforcement are implemented. All regression suites remain green.

### Final Verdict

# GREEN

---

## Implemented Hardening

### Task 1 — Trace persistence

| Item | Detail |
|------|--------|
| **Author** | Decision Runtime (`buildTrace` on commit) |
| **Store** | Workspace `putTrace` / `getTrace` / `StoreKind.TRACE` (`DecisionTrace`) |
| **Cache** | Runtime in-memory Map is write-through only |
| **Retrieval** | `runtime.getTrace(id)` → Runtime cache, else Workspace (durable SoT) |
| **Ownership preserved** | Runtime still owns generation; Workspace remains passive; no scoring/arbitration in Workspace |

### Task 2 — IR stage validation

| Item | Detail |
|------|--------|
| **Registry** | Shared `compiler/ir-stage-registry.js` → `contracts/registries/ir-stages.json` |
| **Enforcement** | `workspace.putIrSlice` rejects unknown `stageId` (`UNKNOWN_IR_STAGE`) |
| **No duplication** | Kernel and Workspace both use the shared loader; no second stage list |

### Task 3 — Kernel facade clarity

| Item | Detail |
|------|--------|
| **Primary name** | `job.invokeDecisionRuntime(opts)` |
| **Alias** | `job.arbitrate(opts)` → same function (compat) |
| **Docs** | JSDoc states Kernel does not arbitrate; Runtime owns winner selection |
| **Invariant** | `kernel.invariants.ownsArbitration === false` |
| **Behavior** | Unchanged — still creates Runtime + `session.run` |

### Task 4 — Authoritative thresholds (prep for Phase 5)

| Item | Detail |
|------|--------|
| **Slots only** | Runtime resolves `policy.thresholds`; does not invent production policy |
| **Authoritative** | `valuesAuthoritative === true` → require `accept_min`, `margin_min`, `fallback_below` as numbers; missing → `DecisionErrorKind.POLICY` |
| **Non-authoritative** | Dev/synthetic defaults still allowed when `valuesAuthoritative !== true` |
| **Not done** | Policy Profiles product implementation (Phase 5+) |

### Task 5 — Tests added

- Persisted traces + retrieval across Runtime instances
- Invalid / valid IR `stageId`
- Authoritative missing / present thresholds
- Kernel `invokeDecisionRuntime` facade
- Regression coverage retained

---

## Audit Findings Closed

| Audit finding | Status | Evidence |
|---------------|--------|----------|
| Decision traces only in Runtime memory | **CLOSED** | `putTrace` on commit; Workspace durable SoT |
| `IrSlice.stageId` not registry-checked | **CLOSED** | `isKnownIrStage` in `putIrSlice` |
| Kernel `arbitrate` naming / facade ambiguity | **CLOSED** | `invokeDecisionRuntime` + docs + `ownsArbitration: false` |
| Non-authoritative threshold defaults risk | **CLOSED (prep)** | Authoritative mode rejects missing slots; no production hardcodes when authoritative |
| Trace retrieval lost on new Runtime per `job.arbitrate` | **CLOSED** | Fresh Runtime reads Workspace via `getTrace` |

---

## Remaining Risks

| Risk | Severity | Notes |
|------|----------|-------|
| Policy Profiles not implemented | Expected | Phase 5+; slots ready |
| Non-authoritative defaults still exist | Low | Explicitly gated; not for production authoritative policies |
| Open writer (no capabilities) can write all kinds | Low | Pre-existing stub; intentional for Kernel/tests |
| Contract harness is subset JSON Schema | Low | Unchanged from Phase 1 |
| In-process Maps only (no disk persistence) | Low | Process-lifetime durability; architecture-correct for this spine |

None of these reopen architecture YELLOW findings from Phases 1–4.

---

## Regression Results

| Command | Result |
|---------|--------|
| `npm run test:contracts` | **34 passed, 0 failed** |
| `npm run test:kernel` | **17 passed, 0 failed** |
| `npm run test:workspace` | **25 passed, 0 failed** |
| `npm run test:decision` | **24 passed, 0 failed** |

---

## Architecture Impact

| Question | Answer |
|----------|--------|
| Architecture redesigned? | **No** |
| New concepts introduced? | **No** (TRACE is storage kind for existing DecisionTrace concept) |
| Ownership moved? | **No** — clarified and enforced |
| Phase 5 domain engines? | **Not implemented** |
| Convert APIs wired? | **No** |

---

## Updated Ownership Matrix

| Artifact | Authors | Durable store | Reads | Notes |
|----------|---------|---------------|-------|-------|
| Fact | Engine/writer | Workspace | Any | Immutable |
| Hypothesis | Engine/writer | Workspace | Decision Runtime | Passive |
| Evidence | Writer | Workspace | Readers | Passive |
| DecisionRecord | Decision Runtime | Workspace | Readers | Runtime commits |
| **DecisionTrace** | **Decision Runtime** | **Workspace** | Runtime / readers | Runtime authors; Workspace passive; Runtime Map = cache |
| IrSlice | Engine/writer | Workspace | Readers | `stageId` must be in Phase 1 registry |
| ProvenanceBundle | Writer | Workspace | Readers | Cross-ref optional enforce |
| Job lifecycle / policy bind / budgets | Kernel | Kernel job | — | Kernel does **not** own arbitration algorithm |
| Winner selection / rank / abstain | Decision Runtime | — | — | Kernel only delegates |

### Trace ownership model (final)

```text
Decision Runtime          Workspace (passive)
  buildTrace()    ──put──►  DecisionTrace blob
  getTrace()      ◄─read──  durable SoT after commit
  Map (cache)     write-through only
```

No duplicate source of truth after commit: Workspace wins for persistence; Runtime cache is optional acceleration.

---

## Final Recommendation

Proceed to Phase 5 when ready. Pre-Phase-5 hardening is complete; architecture remains frozen and GREEN.

**Do not treat this report as Phase 5 start.**

---

## Verdict

# GREEN
