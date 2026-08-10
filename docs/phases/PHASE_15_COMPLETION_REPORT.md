# Phase 15 Completion Report — Responsive Engine

| Field | Value |
|-------|--------|
| **Phase** | 15 — Responsive Engine |
| **Date** | 2026-07-18 |
| **Status** | **Complete** |
| **Foundation** | Freeze v1 intact |

## Deliverables

| Item | Location |
|------|----------|
| Module | `compiler/responsive/` |
| Facts plugin | `facts.responsive.project` |
| Rule Pack | `responsive.detect` |
| Kernel | `job.projectResponsiveIR()` |
| Questions | `responsive.strategy`, `responsive.breakpoint` |
| Stage | `responsive-ir` (registry + envelope) |
| Tests | `npm run test:responsive` / `test:phase15` (9/9) |
| Fingerprint | `responsiveIrChecksum`, `responsiveBuilderVersion`, `responsiveSliceId` |

## Lifecycle

collect → detect → project → publish → materialize

## Exit criteria

| Criterion | Status |
|-----------|--------|
| Responsive Engine implemented | ✓ |
| ResponsiveIR published (immutable) | ✓ |
| Exporter-neutral (no CSS/media/React) | ✓ |
| Ownership unchanged | ✓ |
| Foundation unchanged | ✓ |
| Fingerprint synchronized | ✓ |
| Previous suites green | ✓ |
| Documentation complete | ✓ |
| CURRENT_TRUTH updated | ✓ |
| No Phase 16 started | ✓ |

## Out of scope (held)

A11y Engine, ResolvedIR, EmitPlan, `compile()`, CSS media-query lowering.

## Future RFC Recommendations

### FR-15-01 — Breakpoint widthHints are provisional defaults

| Field | Detail |
|-------|--------|
| **Problem** | Default narrow/medium/wide widthHints (375/768/1280) are heuristic, not product-configured. |
| **Reason** | Engine needs deterministic baseline; Policy/Knowledge should own product breakpoints later. |
| **Impact** | Emit may need remapping before shipping real CSS. |
| **Risk** | Medium for product fidelity; low for architecture. |
| **Suggested Solution** | Policy profile tables + Knowledge breakpoint packs; keep IR as intent only. |
| **Priority** | P3 |

### FR-15-02 — Missing responsive-ir was a Phase 1 gap

| Field | Detail |
|-------|--------|
| **Problem** | IR registry originally omitted `responsive-ir` despite Master Plan ResponsiveIR. |
| **Reason** | Phase 1 specialized stages were partial; Workspace rejects unknown stageIds. |
| **Impact** | Additive registry/envelope update required to publish. |
| **Risk** | Low — additive, non-breaking. |
| **Suggested Solution** | Audit remaining planned stages (motion, theme, …) before their engines ship. |
| **Priority** | P2 |

### FR-15-03 — No Workspace pin for ResponsiveIR

| Field | Detail |
|-------|--------|
| **Problem** | Same as Component/Token/Semantic — fingerprint slice id only. |
| **Reason** | Followed approved engine pattern. |
| **Impact** | Dual slices lack first-class active pointer. |
| **Risk** | Low until ResolvedIR. |
| **Suggested Solution** | Generalize IrSlice pins in a later RFC. |
| **Priority** | P3 |
