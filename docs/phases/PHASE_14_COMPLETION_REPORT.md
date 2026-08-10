# Phase 14 Completion Report — Semantic Engine

| Field | Value |
|-------|--------|
| **Phase** | 14 — Semantic Engine |
| **Date** | 2026-07-18 |
| **Status** | **Complete** |
| **Foundation** | Freeze v1 intact |

## Deliverables

| Item | Location |
|------|----------|
| Module | `compiler/semantic/` |
| Facts plugin | `facts.semantic.project` |
| Rule Pack | `semantic.detect` |
| Kernel | `job.projectSemanticIR()` |
| Questions | `semantic.role`, `semantic.region` (pre-registered) |
| Tests | `npm run test:semantic` / `test:phase14` (9/9) |
| Fingerprint | `semanticIrChecksum`, `semanticBuilderVersion`, `semanticSliceId` |

## Lifecycle

collect → detect → project → publish → materialize

## Exit criteria

| Criterion | Status |
|-----------|--------|
| Semantic Engine implemented | ✓ |
| SemanticIR published (immutable) | ✓ |
| Exporter-neutral (no HTML/React/CSS) | ✓ |
| Ownership unchanged | ✓ |
| Foundation unchanged | ✓ |
| Fingerprint synchronized | ✓ |
| Previous suites green | ✓ |
| Documentation complete | ✓ |
| CURRENT_TRUTH updated | ✓ |
| No Phase 15 started | ✓ |

## Out of scope (held)

Responsive Engine, A11y Engine, ResolvedIR, EmitPlan, `compile()`, HTML tag mapping (`html.tag`).

## Future RFC Recommendations

### FR-14-01 — Name-heuristic landmark bias

| Field | Detail |
|-------|--------|
| **Problem** | Layer names drive many role scores; unnamed designs under-annotate. |
| **Reason** | Phase 14 ships deterministic baseline; Knowledge pattern packs remain thin. |
| **Impact** | Coverage depends on naming discipline or later packs. |
| **Risk** | Medium for production fidelity; low for architecture. |
| **Suggested Solution** | Evolve `semantic.detect` + Knowledge patterns; do not move commits into the engine. |
| **Priority** | P3 |

### FR-14-02 — html.tag remains emit-owned

| Field | Detail |
|-------|--------|
| **Problem** | Master Plan mentions `html.tag` beside Semantic; user architecture forbids tags in SemanticIR. |
| **Reason** | Correct separation: meaning vs emit vocabulary. |
| **Impact** | Emit phase must map roles → tags under Policy. |
| **Risk** | Low if Emit honors SemanticIR + Decisions. |
| **Suggested Solution** | Document role→tag mapping in Emit/ResolvedIR RFC; keep SemanticIR tag-free. |
| **Priority** | P2 (document at Emit kickoff) |

### FR-14-03 — No Workspace pin for SemanticIR

| Field | Detail |
|-------|--------|
| **Problem** | Same as Component/Token — fingerprint slice id only. |
| **Reason** | Followed approved engine pattern; Layout pins are Layout-specific. |
| **Impact** | Dual SemanticIR slices lack first-class active pointer. |
| **Risk** | Low until ResolvedIR. |
| **Suggested Solution** | Generalize IrSlice pins in a later RFC. |
| **Priority** | P3 |
