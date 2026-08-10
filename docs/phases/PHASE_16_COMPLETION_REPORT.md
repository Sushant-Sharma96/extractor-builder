# Phase 16 Completion Report — Accessibility Engine

| Field | Value |
|-------|--------|
| **Phase** | 16 — Accessibility (A11y) Engine |
| **Date** | 2026-07-18 |
| **Status** | **Complete** |
| **Foundation** | Freeze v1 intact |

## Deliverables

| Item | Location |
|------|----------|
| Module | `compiler/accessibility/` |
| Facts plugin | `facts.accessibility.project` |
| Rule Pack | `accessibility.detect` |
| Kernel | `job.projectAccessibilityIR()` |
| Questions | `a11y.name`, `a11y.role` (pre-registered) |
| Stage | `a11y-ir` (existing registry) |
| Tests | `npm run test:accessibility` / `test:phase16` (9/9) |
| Fingerprint | `accessibilityIrChecksum`, `accessibilityBuilderVersion`, `accessibilitySliceId` |

## Lifecycle

collect → detect → project → publish → materialize

## Exit criteria

| Criterion | Status |
|-----------|--------|
| Accessibility Engine implemented | ✓ |
| AccessibilityIR published (immutable) | ✓ |
| SemanticIR consumed read-only | ✓ |
| Exporter-neutral (no HTML/ARIA emit) | ✓ |
| Ownership unchanged | ✓ |
| Foundation unchanged | ✓ |
| Fingerprint synchronized | ✓ |
| Previous suites green | ✓ |
| Documentation complete | ✓ |
| CURRENT_TRUTH updated | ✓ |
| ResolvedIR not started | ✓ |

## Out of scope (held)

ResolvedIR, EmitPlan, `compile()`, HTML/ARIA lowering, Behavior/Motion engines.

## Future RFC Recommendations

### FR-16-01 — Contrast observations are stub-level

| Field | Detail |
|-------|--------|
| **Problem** | Contrast checks are not computed from paints (would need color math + background resolution). |
| **Reason** | Phase 16 ships structural/name/focus a11y; contrast is product-heavy. |
| **Impact** | `warnings` may omit contrast failures. |
| **Risk** | Medium for WCAG gates; low for architecture. |
| **Suggested Solution** | Optional contrast pack under Policy thresholds; keep IR as observations, not CSS. |
| **Priority** | P3 |

### FR-16-02 — a11y.role question wording vs exporter neutrality

| Field | Detail |
|-------|--------|
| **Problem** | Registry text says “ARIA / implicit role” while engine forbids ARIA attribute storage. |
| **Reason** | Phase 1 question copy predates exporter-neutral IR rules. |
| **Impact** | Mild doc confusion; runtime uses `accessRole` intents. |
| **Risk** | Low. |
| **Suggested Solution** | MINOR registry description update in a docs pass — do not change Decision monopoly. |
| **Priority** | P4 |

### FR-16-03 — No Workspace pin for AccessibilityIR

| Field | Detail |
|-------|--------|
| **Problem** | Same as prior specialized engines — fingerprint slice id only. |
| **Reason** | Followed approved engine pattern. |
| **Impact** | Dual slices lack first-class active pointer. |
| **Risk** | Low until ResolvedIR. |
| **Suggested Solution** | Generalize IrSlice pins in a later RFC. |
| **Priority** | P3 |
