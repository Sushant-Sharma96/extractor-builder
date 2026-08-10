# Phase 11b — Constraint Validation Report

| Field | Value |
|-------|--------|
| **Phase** | 11b |
| **Date** | 2026-07-18 |
| **Suite** | `npm run test:constraint` |

---

## Validation matrix

| Area | Result | Notes |
|------|--------|-------|
| Constraint graph (network) | **PASS** | Ordered variables/constraints; never published as IR |
| Alignment | **PASS** | Absolute out-of-flow vs positioning checks |
| Sizing | **PASS** | `sizing_axis` consistency signals |
| Parent–child fit | **PASS** | `parent_fit` with epsilon |
| Overflow | **PASS** | Medium-strength overflow; policy auto-relax under pixel-faithful |
| Gap | **PASS** | `gap_nonneg`; negative → traced relax |
| Padding | **PASS** | `padding_nonneg` |
| Absolute children | **PASS** | `absolute_bounds` |
| Mixed layouts | **PASS** | Covered via flow Doc + modes from 11a |
| Nested layouts | **PASS** | Vertical parent + horizontal child |
| Unsatisfied constraints | **PASS** | Evidence `layout.constraint.unsat` + LayoutIR₁.payload.unsat |
| Relaxation | **PASS** | Weak auto-drop + Evidence; medium/strong → Hypotheses |
| Evidence | **PASS** | conflict / relaxed / unsat / fallback refs |
| Decision integration | **PASS** | Committed relax Decision applied; Runtime unchanged |
| LayoutIR projection | **PASS** | LayoutIR₁ cites LayoutIR₀; baseline immutable |
| Provenance | **PASS** | NDG graphId, baseline slice/checksum, decisionIds, evidenceIds |
| Determinism | **PASS** | Stable sort; identical checksums across runs |
| Idempotent rebuild | **PASS** | Same inputs → same LayoutIR₁ checksum |
| Policy behaviour | **PASS** | pixel-faithful vs semantic-lean paths exercised |
| Performance sanity | **PASS** | ~50 nodes under 15s budget |
| Regression (11a pack) | **PASS** | `layout.interpret` still loads |

---

## Explicit non-goals verified

| Check | Result |
|-------|--------|
| No ConstraintIR registry stage | Held |
| No NDG mutation | Held |
| No HTML/CSS vocabulary in solve outputs | Held |
| No Decision Runtime algorithm changes | Held |
| No silent relaxation | Held |

---

## Residual risks

| Risk | Mitigation |
|------|------------|
| Float epsilon edge cases | Fixed 1px epsilon; document in solver |
| LayoutIR₀ vs₁ consumer confusion | `constraintSolve.fromLayoutIrSliceId`; Kernel fingerprint separates checksums |
| Pack proposers without Fact payload | LayoutIR₀ Fact now includes `payload` for pack path |
