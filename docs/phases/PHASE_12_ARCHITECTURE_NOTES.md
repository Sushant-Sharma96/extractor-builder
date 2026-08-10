# Phase 12 Architecture Notes — Component Engine

| Field | Value |
|-------|--------|
| **Phase** | 12 |
| **Status** | Implemented |
| **Lifecycle** | collect → detect → project → publish → materialize |

## Ownership

| Module | Owns |
|--------|------|
| `compiler/components/` | Detect + ComponentIR |
| Pack `component.detect` | Evidence + Hypotheses |
| `facts.component.project` | Publish ComponentIR |
| Decision Runtime | Commit treatment/reuse |

## Pipeline

```text
NDG → (LayoutIR₁ preferred) → Component → ComponentIR → later Semantic
```
