# Phase 6 Completion Report — Plugin Capability Contract

| Field | Value |
|-------|--------|
| **Phase** | 6 — Plugin Capability Contract |
| **Date** | 2026-07-18 |
| **Depends on** | Phases 1–5; `docs/PLUGIN_CAPABILITY_CONTRACT.md` |
| **Authority** | RFC-002 §11; Master Plan Phase 6; Plugin Capability Contract |
| **Status** | **Implementation complete** — all required tests green |
| **Phase 7** | **Not started** |

---

## Executive Summary

Phase 6 delivers plugin **infrastructure only**: full declaration validation, registry, capability-scoped execution context (no raw Workspace), lifecycle, crash/timeout/retry/rollback, compatibility gates, fingerprint plugin set, and a generic scheduler.

No Layout, Semantic, Knowledge, Rules, AI, Animation, Accessibility, Behavior, or Emit engines were implemented.

Phases 1–5 ownership unchanged. Decision Runtime remains the only Decision/Trace author.

---

## Implemented Components

| Item | Location |
|------|----------|
| Execution plan | `docs/phases/PHASE_06_EXECUTION_PLAN.md` |
| Plugin module | `compiler/plugin/` (`validate`, `registry`, `context`, `execute`, `compatibility`, `scheduler`, `constants`, `errors`) |
| Kernel wiring | `registerPlugin`, `job.executePlugin`, `buildPluginSchedule`, fingerprint plugins |
| Fingerprint | `compiler/kernel/fingerprint.js` — stable `plugins: [{id,version}]` |
| Tests | `compiler/test/plugin.test.js` |
| npm script | `npm run test:plugin` / `test:phase6` |

Legacy Phase 2 `registerEngine` retained for backward compatibility (skeleton).

---

## Capability Enforcement

- Scoped context exposes only permitted read/write APIs  
- Undeclared read/write → `CAPABILITY_DENIED`  
- `DecisionRecord` / `DecisionTrace` writes rejected at **registration** and at **context**  
- Fact mutation denied in context  
- `getWorkspace` / `invokeDecisionRuntime` / `putDecision` / `putTrace` → deny (bypass)  
- Writes stage until lifecycle **Commit**; failure → **rollback** (no Workspace pollution)

---

## Lifecycle

`Load → Validate → Register → Execute → Commit → Dispose`

Commit = Workspace persistence of staged artifacts only. Decision commit remains Decision Runtime.

---

## Failure Contract

| Event | Behavior |
|-------|----------|
| Throw / crash | Caught at Kernel/plugin boundary (`try_catch` isolation) |
| Timeout | `Promise.race` vs declaration `timeout` |
| Retries | Up to `retries` + 1 attempts; stage cleared each attempt |
| Rollback | Staged writes discarded (`workspace_tx` / default path) |
| Policy | `onFailure: continue \| abort` (defaults from gateMode) |
| Preservation | Workspace Facts, committed Decisions, Traces remain |

---

## Compatibility

Validated: suite version, compiler min/max, `allowedPolicies`, `allowedEngineIds`, `determinismStrict` vs `nondeterministic`, `incompatiblePlugins`.

---

## Fingerprint

Job fingerprint includes enabled plugins sorted by `id` (then version). Same set in any order → identical `fingerprintKey`.

---

## Scheduler

`buildPluginSchedule` groups by `phaseAffinity`, orders by `estimatedCost` then `id`, respects soft `maxMemory`. No domain reasoning.

---

## Validation

Registration rejects: missing fields, bad semver, duplicate ids, unknown StoreKinds, unknown IR stages, unknown questions, Decision/Trace writes, `creates ⊈ writes`, ontology tokens in ids.

---

## Test Results

```text
npm run test:contracts  → 34 passed
npm run test:kernel     → 17 passed
npm run test:workspace  → 25 passed
npm run test:decision   → 24 passed
npm run test:policy     → 19 passed
npm run test:plugin     → 28 passed
```

---

## Architectural Invariants

| Invariant | Status |
|-----------|--------|
| Plugins cannot own Decisions/Traces | Held |
| Workspace remains passive | Held |
| Decision Runtime sole arbitrator | Held |
| Kernel does not domain-reason | Held |
| Policy still owns thresholds | Held |
| No convert/emit wiring | Held |

---

## Known Limitations

- Isolation level implemented: `try_catch` (not OS `process`/`realm` sandboxes)  
- `invalidate_only` rollback does not auto-revert already-committed Workspace rows (staging avoids that on crash-before-commit)  
- Mutual `incompatiblePlugins` may exclude both when symmetric  
- Phase 2 `registerEngine` is a legacy subset, not full Phase 6 declarations  

---

## Out-of-Scope Confirmation

Not implemented: Layout, Semantic, Rule, Knowledge, Pattern, AI, Animation, A11y, Behavior engines; Emit/HTML/CSS/JS; `convert()` / `compile()` redesign; Phase 7.

---

## Phase 7 Handoff

Phase 7 may:

- Introduce Knowledge Bundle format and loader  
- Pin knowledge version in fingerprint (slot already present)  
- Address patterns by id for **future** engines using this plugin contract  

Phase 7 must **not**:

- Bypass plugin capabilities  
- Let Knowledge choose Decision winners  
- Collapse Knowledge into Kernel/Runtime  

**Stop. Phase 7 not implemented.**
