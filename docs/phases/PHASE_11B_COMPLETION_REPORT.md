# Phase 11b Completion Report — Constraint Solver (Layout Subsystem)

| Field | Value |
|-------|--------|
| **Phase** | 11b — Constraint Solver |
| **Date** | 2026-07-18 |
| **Depends on** | Phase 11a; `PHASE_11B_ARCHITECTURE_PROPOSAL.md` |
| **Status** | **Implementation complete** — `test:constraint` green |
| **Authority** | Proposal wins on conflict; no ownership changes to Phases 1–11a |

---

## 1. Deliverables

| Item | Location |
|------|----------|
| Execution plan | `docs/phases/PHASE_11B_EXECUTION_PLAN.md` |
| Architecture notes | `docs/phases/PHASE_11B_ARCHITECTURE_NOTES.md` |
| Migration notes | `docs/phases/PHASE_11B_MIGRATION_NOTES.md` |
| Validation report | `docs/phases/PHASE_11B_CONSTRAINT_VALIDATION_REPORT.md` |
| Constraint module | `compiler/layout/constraint/` |
| Rule Pack | `compiler/rulepack/packs/layout-constraint/` |
| Facts plugin | `facts.layout.constraint` |
| Kernel API | `job.solveLayoutConstraints()` |
| Question | `layout.constraint.relax` (registry) |
| Tests | `compiler/test/constraint.test.js` |
| npm | `npm run test:constraint` / `test:phase11b` |

### Module layout

```text
compiler/layout/constraint/
  constants.js      — SOLVER_VERSION, strengths, kinds
  network.js        — internal ConstraintNetwork builder
  solver.js         — deterministic evaluate + relax (never commits)
  projector.js      — LayoutIR₁ (immutable new slice)
  diagnostics.js    — solver report
  load.js           — load LayoutIR₀/₁ from Workspace
  materialize.js    — plugin publish path
  index.js
```

---

## 2. Capabilities achieved

| Criterion | Status |
|-----------|--------|
| Constraint Network (internal) | ✓ |
| Deterministic Solver | ✓ |
| Relaxation (policy-ordered, never silent) | ✓ |
| Unsatisfied constraint reporting | ✓ Evidence + LayoutIR₁.unsat + report |
| Decision Runtime integration | ✓ reads committed `layout.constraint.relax`; does not modify Runtime |
| Solved LayoutIR (LayoutIR₁) | ✓ new IrSlice; LayoutIR₀ retained |
| Immutable LayoutIR projections | ✓ |
| Provenance (NDG, baseline slice, Evidence, Decisions) | ✓ |
| Fingerprints (solver version, solved checksum, solverFingerprint) | ✓ |
| Deterministic / idempotent execution | ✓ tested |
| No ConstraintIR / no new framework | ✓ |
| NDG unchanged | ✓ |

---

## 3. Pipeline (held)

```text
NDG → layout.interpret → Decisions → LayoutIR₀
    → Constraint Solver → (optional Decisions) → LayoutIR₁
```

---

## 4. Ownership boundaries (held)

| Concern | Owner |
|---------|--------|
| Arrangement modes | Layout 11a + Decisions |
| Spatial consistency | Layout constraint subsystem |
| Ranking / commit | Decision Runtime (unchanged) |
| Structural graph | NDG (read-only) |
| HTML / CSS / Emit | Out of scope |

**Not created:** ConstraintEngine, ConstraintFramework, GraphEngine, ConstraintIR stage.

---

## 5. Tests

`npm run test:constraint` — 15 cases covering network, solve, relax, unsat, Decision integration, LayoutIR₁, fingerprint, determinism, policy, nested/mixed, performance, 11a regression pack load.

Regression: `test:layout`, `test:ndg`, `test:rulepack`, `test:kernel` green after 11b.

---

## 6. Out of scope (deferred)

Semantic, Responsive, Components, Tokens, ResolvedIR, EmitPlan, HTML/CSS/JS, AI/Vision/LLM, `compile()`.
