# Phase 13 Completion Report — Design Token Engine

| Field | Value |
|-------|--------|
| **Phase** | 13 — Design Token Engine |
| **Date** | 2026-07-18 |
| **Status** | **Complete** |
| **Foundation** | Freeze v1 intact |

## Deliverables

| Item | Location |
|------|----------|
| Module | `compiler/tokens/` |
| Facts plugin | `facts.token.project` |
| Rule Pack | `token.detect` |
| Kernel | `job.projectTokenIR()` |
| Questions | `token.bind`, `token.merge` |
| Tests | `npm run test:token` / `test:phase13` (9/9) |
| NDG ingest | Additive `styles` / `boundVariables` pass-through |
| Fingerprint | `tokenIrChecksum`, `tokenBuilderVersion`, `tokenSliceId` |

## Lifecycle

collect → detect → project → publish → materialize

## Exit criteria

| Criterion | Status |
|-----------|--------|
| Token Engine implemented | ✓ |
| Ownership unchanged | ✓ |
| Foundation unchanged | ✓ |
| Fingerprint synchronized | ✓ |
| Previous suites green | ✓ (contracts, ndg, layout, constraint, component, kernel, rulepack) |
| Documentation complete | ✓ |
| CURRENT_TRUTH updated | ✓ |
| No Phase 14 started | ✓ |

## Out of scope (held for later)

Semantic, Responsive, ResolvedIR, EmitPlan, `compile()`, CSS/theme materialization, design-system package export.

## Future RFC Recommendations

Findings during Phase 13 that are **not** implemented (Foundation remains frozen):

### FR-13-01 — No Workspace pin for TokenIR / ComponentIR

| Field | Detail |
|-------|--------|
| **Problem** | LayoutIR has explicit baseline/active pins; TokenIR and ComponentIR rely on fingerprint slice ids only. |
| **Reason** | Phase 12/13 followed the approved Component pattern; pin model was Layout-specific hardening (11b.1). |
| **Impact** | Multiple TokenIR slices in one Workspace lack a first-class “active” pointer. |
| **Risk** | Low until dual-run / ResolvedIR needs a single active TokenIR. |
| **Suggested Solution** | Optional RFC to generalize IrSlice pins (or stage-scoped active ids) after Semantic/ResolvedIR design. |
| **Priority** | P3 |

### FR-13-02 — Frequency heuristics for shared tokens

| Field | Detail |
|-------|--------|
| **Problem** | Shared color/spacing tokens require frequency ≥ 2; coincidental literals can become tokens. |
| **Reason** | Engine ships a deterministic baseline; pack + Decision refine bindings. |
| **Impact** | Over-tokenization possible on sparse designs. |
| **Risk** | Low — pack heuristics and `token.bind` / abstain can correct. |
| **Suggested Solution** | Evolve `token.detect` thresholds under Policy; do not change Kernel/Workspace ownership. |
| **Priority** | P4 |
