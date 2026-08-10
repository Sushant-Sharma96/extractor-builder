# Phase 11 Execution Plan — Layout Interpretation Core (11a)

| Field | Value |
|-------|--------|
| **Phase** | 11a — Layout Interpretation Core |
| **Status** | Authorized (`PHASE_11_ARCHITECTURE_PROPOSAL`) |
| **Depends on** | Phases 1–10 |
| **Defers** | 11b Constraint Solver |
| **Authority** | PHASE_11_ARCHITECTURE_PROPOSAL (wins on conflict) |

---

## Goals

Implement arrangement interpretation over **NormalizedDesignGraph**:

- Evidence + Hypotheses (`layout.mode`, `layout.sizing`, …)
- Exporter-neutral **LayoutIR** projection
- Decision Runtime commits winners (Layout never commits)

## In scope

- `compiler/layout/` domain module  
- Layout Rule Pack proposers  
- Facts plugin for LayoutIR publish  
- Kernel `projectLayoutIR`  
- Fingerprint participation  
- Tests + docs  

## Out of scope

Constraint Solver (11b); Responsive; Semantic; Components; Tokens; ResolvedIR; EmitPlan; HTML/CSS/JS; `compile()`.

## Exit criteria

NDG-only structural input; multi-candidate Hypotheses; LayoutIR immutable & deterministic; Runtime integration without modifying Runtime; suites 1–10 green.
