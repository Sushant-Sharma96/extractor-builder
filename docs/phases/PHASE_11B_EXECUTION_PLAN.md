# Phase 11b Execution Plan — Constraint Solver (Layout Subsystem)

| Field | Value |
|-------|--------|
| **Phase** | 11b — Constraint Solver |
| **Status** | **Complete** |
| **Depends on** | Phase 11a |
| **Authority** | PHASE_11B_ARCHITECTURE_PROPOSAL (wins on conflict) |

---

## Goals

Implement Layout-owned constraint network build, deterministic solve/relax, Evidence/Hypotheses, and **immutable LayoutIR₁** (solved) projection.

## In scope

- `compiler/layout/constraint/`  
- Internal ConstraintNetwork (not published)  
- Solver + diagnostics report  
- LayoutIR₁ re-projection (never mutate LayoutIR₀)  
- Optional Rule Pack proposers for relax  
- Kernel `solveLayoutConstraints`  
- Fingerprint participation  
- Tests + docs  

## Out of scope

ConstraintIR stage; Semantic/Responsive/Components; HTML/CSS; ResolvedIR; EmitPlan; `compile()`.

## Exit criteria

| Criterion | Status |
|-----------|--------|
| Deterministic/idempotent solve | ✓ |
| Unsat first-class | ✓ |
| Decision Runtime integration without modifying Runtime | ✓ |
| NDG unchanged | ✓ |
| Suites 1–11a green | ✓ |
| `test:constraint` green | ✓ |

## Implementation order (done)

1. Docs (plan / notes / migration)  
2. `constraint/` network + solver + projector + diagnostics  
3. Materialize + facts plugin `facts.layout.constraint`  
4. Rule Pack `layout.constraint`  
5. Kernel + fingerprint  
6. Tests + completion + validation reports  
