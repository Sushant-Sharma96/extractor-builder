# Phase 14 Architecture Notes — Semantic Engine

| Field | Value |
|-------|--------|
| **Phase** | 14 |
| **Status** | Implemented |
| **Lifecycle** | collect → detect → project → publish → materialize |

## Ownership

| Module | Owns |
|--------|------|
| `compiler/semantic/` | Semantic interpretation + SemanticIR |
| Pack `semantic.detect` | Evidence + Hypotheses only |
| `facts.semantic.project` | Publish SemanticIR IrSlice + Fact |
| Decision Runtime | Commit `semantic.role` / `semantic.region` |

## Exporter neutrality

SemanticIR uses **roles** (banner, navigation, main, …), not HTML tags, React types, or CSS.

Emit / HTML / React remain later phases.

## Pipeline

```text
NDG → (optional Layout pin) → semantic.detect (optional)
  → Decision (optional role) → Semantic Engine → SemanticIR
  → later Responsive / A11y / Emit
```

## SemanticIR contents

- `annotations` — nodeId → role (+ optional heading level)
- `landmarks` — landmark subset
- `headings` — hierarchy levels
- `groups` — list (and similar) groupings
- `ambiguous` — competing role candidates
- `metrics` — coverage / counts

## Kernel

`job.projectSemanticIR()` — fingerprint fields  
`semanticIrChecksum`, `semanticBuilderVersion`, `semanticSliceId`.
