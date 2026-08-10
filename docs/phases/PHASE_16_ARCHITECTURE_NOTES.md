# Phase 16 Architecture Notes — Accessibility Engine

| Field | Value |
|-------|--------|
| **Phase** | 16 |
| **Status** | Implemented |
| **Lifecycle** | collect → detect → project → publish → materialize |

## Ownership

| Module | Owns |
|--------|------|
| `compiler/accessibility/` | A11y interpretation + AccessibilityIR |
| Pack `accessibility.detect` | Evidence + Hypotheses only |
| `facts.accessibility.project` | Publish AccessibilityIR IrSlice + Fact |
| Decision Runtime | Commit `a11y.name` / `a11y.role` |

## Boundary vs Semantic

| Engine | Answers |
|--------|---------|
| **Semantic** | What does this represent? |
| **Accessibility** | Can users (incl. AT) use this correctly? |

Accessibility may **read** SemanticIR as Evidence. It **never** writes or mutates SemanticIR.

## Exporter neutrality

Uses `candidateName`, `accessRole` (`interactive` / `decorative` / …), `keyboardHints` — **not** `aria-*`, HTML attributes, or React props.

## AccessibilityIR contents

- `names` — accessible-name candidates  
- `focusOrder` / `focusGroups` — tab-sequence intent  
- `labelLinks` — control ↔ label associations  
- `imageAccess` — description needs  
- `validations` / `warnings` — landmark/heading/name checks  
- `ambiguous` — competing name (etc.) candidates  
- `keyboardHints` — focusable / activate / skip  
- `semanticEvidence` — read-only provenance of SemanticIR consume  

## Kernel

`job.projectAccessibilityIR()` — fingerprint fields  
`accessibilityIrChecksum`, `accessibilityBuilderVersion`, `accessibilitySliceId`.
