# PHASE_17_19_COMPLETION_REPORT.md

| Field | Value |
|-------|--------|
| **Phases** | 17 ResolvedIR · 18 EmitPlan · 19 compile() |
| **Date** | 2026-07-18 |
| **Status** | **Complete** |
| **Foundation** | Freeze v1 intact |

## Deliverables

| Item | Location |
|------|----------|
| ResolvedIR | `compiler/resolved/` · `facts.resolved.compose` · `job.projectResolvedIR()` |
| EmitPlan | `compiler/emit/` · `facts.emit.plan` · `job.projectEmitPlan()` |
| compile() | `compiler/compile.js` |
| Tests | `npm run test:resolved` · `test:emit` · `test:compile` |
| Docs | `RESOLVED_IR_ARCHITECTURE.md`, `EMIT_PLAN_ARCHITECTURE.md`, `COMPILER_PIPELINE.md` |

## Fingerprint

Added: `resolvedIrChecksum`, `resolvedBuilderVersion`, `resolvedSliceId`, `emitPlanChecksum`, `emitBuilderVersion`, `emitPlanSliceId` (schema + fixture + harness synced — 45 named fields).

## Exit criteria

| Criterion | Status |
|-----------|--------|
| ResolvedIR composes slices + Decisions | ✓ |
| Tolerates missing Asset/Behavior | ✓ |
| EmitPlan exporter-neutral | ✓ |
| compile() Raw → EmitPlan | ✓ |
| Optional engines | ✓ |
| Previous suites green | ✓ |
| Ownership unchanged | ✓ |
| No HTML generation / Figma / product QA started | ✓ |

## Future RFC Recommendations

### FR-19-01 — EmitPlan schema vs rich plan nesting

| Field | Detail |
|-------|--------|
| **Problem** | Phase 1 EmitPlan `additionalProperties: false` forces rich plan into `classStrategy`. |
| **Reason** | Avoided contract redesign mid-sprint. |
| **Impact** | Plan fields are nested, not first-class. |
| **Risk** | Low. |
| **Suggested Solution** | MINOR schema extension for `exportPlan` / `renderOrder` / etc. when Emit lowering begins. |
| **Priority** | P3 |

### FR-19-02 — compile() does not auto-run Decision waves

| Field | Detail |
|-------|--------|
| **Problem** | `compile()` does not execute rule packs or arbitrate by default. |
| **Reason** | Decision monopoly + FR-04 deferred; no silent commits. |
| **Impact** | tagChoices may be empty without prior Decisions. |
| **Risk** | Low for architecture; medium for product tags. |
| **Suggested Solution** | Optional `compile({ decide: true })` orchestrator later — still Decision Runtime commits. |
| **Priority** | P2 |

## Out of scope (held)

HTML/CSS/JS emission, ArtifactSet materialization, Asset/Behavior engines, Figma optimizations, pixel QA.
