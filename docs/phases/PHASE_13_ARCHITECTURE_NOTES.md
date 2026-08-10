# Phase 13 Architecture Notes — Design Token Engine

| Field | Value |
|-------|--------|
| **Phase** | 13 |
| **Status** | Implemented |
| **Lifecycle** | collect → detect → project → publish → materialize |

## Ownership

| Module | Owns |
|--------|------|
| `compiler/tokens/` | Detect + TokenIR |
| Pack `token.detect` | Evidence + Hypotheses only |
| `facts.token.project` | Publish TokenIR IrSlice + Fact |
| Decision Runtime | Commit `token.bind` / `token.merge` |
| NDG | Structural SSOT (unchanged ownership; additive `styles` / `boundVariables` attrs) |

## Pipeline

```text
NDG → (optional token.detect pack) → Decision (optional bind)
  → Token Engine → TokenIR → later CSS / Semantic / Emit
```

## TokenIR contents (neutral vocabulary)

- `tokens` — style / variable / shared color / shared spacing candidates  
- `bindings` — node property → tokenId (heuristic or decision-backed)  
- `unboundLiterals` — values not yet bound  
- `ambiguous` — multi-candidate conflicts  
- `metrics.tokenRate` — coverage signal  

No HTML/CSS emit strings. No framework IR vocabulary.

## Kernel

`job.projectTokenIR()` — materializes TokenIR; updates fingerprint fields  
`tokenIrChecksum`, `tokenBuilderVersion`, `tokenSliceId`.

## Non-goals (this phase)

SemanticIR, Responsive, EmitPlan, `compile()`, design-system package export, TokenIR Workspace pin (same pattern as ComponentIR).
