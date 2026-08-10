# Phase 12 Execution Plan — Component Engine

| Field | Value |
|-------|--------|
| **Phase** | 12 — Component Engine |
| **Status** | **Complete** |
| **Depends on** | Foundation Freeze v1; NDG; LayoutIR recommended |
| **Authority** | `PHASE_12_ARCHITECTURE_PROPOSAL.md` |
| **Out of scope** | Token, Semantic, Responsive, Emit, `compile()`, design-system package export |

---

## Goals

Ship Component detection + ComponentIR via existing plugin/pack/Kernel patterns. Decision Runtime commits interpretive flatten/reuse. NDG and Layout untouched in ownership.

## Deliverables

| # | Item |
|---|------|
| 1 | `compiler/components/` module (detect → project → publish → materialize) |
| 2 | Facts plugin `facts.component.project` |
| 3 | Rule Pack `component.detect` |
| 4 | Questions (MINOR): `component.instanceTreatment`, `component.reuse` (± `component.variant`) |
| 5 | Kernel `job.projectComponentIR()` |
| 6 | Fingerprint fields + schema sync |
| 7 | `test:component` / `test:phase12` |
| 8 | `PHASE_12_ARCHITECTURE_NOTES.md`, `MIGRATION_NOTES.md`, `COMPLETION_REPORT.md` |

## Implementation order

1. Constants + NDG attribute collect (definitions / instances / variants / overrides)  
2. Pure detect → ComponentIR payload builder (deterministic sort)  
3. Facts plugin publish path  
4. Rule Pack proposers  
5. Kernel wiring + fingerprint  
6. Tests + docs  
7. Update `CURRENT_TRUTH.md` only after completion (status), not during coding  

## Invariants (must hold)

- Never mutate NDG or LayoutIR  
- Never commit Decisions from Component module  
- Never nest under `compiler/layout/`  
- No ConstraintIR / new frameworks  
- No HTML/CSS/React emit  
- Flatten only with Decision + Trace  

## Exit criteria

- ComponentIR published; Facts available for Semantic later  
- Pixel-faithful default keeps instances  
- Suites 1–11b.1 still green  
- Fingerprint schema includes component fields  

## Rollback

Treat all nodes as plain frames (no ComponentIR / empty instances).

## Next after Phase 12

Phase 13 Token Engine (sibling) — not in this plan.
