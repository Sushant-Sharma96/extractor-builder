# Phase 14 Migration Notes — Semantic Engine

## Call order

```js
await job.materializeNormalizedDesignGraph({ document, graphId });
// optional: layout / components / tokens first
await job.executeRulePack('semantic.detect'); // Evidence + Hypotheses only
// optional: arbitrate semantic.role / semantic.region
await job.projectSemanticIR({ sliceId: 'slice:semantic:…' });
```

## Do not

- Store HTML tags, React components, or CSS in SemanticIR  
- Commit Decisions from `semantic.detect`  
- Mutate NDG / LayoutIR / ComponentIR / TokenIR  
- Emit code from this phase  

## Fingerprint

Adds (schema + fixture + `buildFingerprint` synchronized):

- `semanticIrChecksum`
- `semanticBuilderVersion`
- `semanticSliceId`

## Questions

| Id | Use |
|----|-----|
| `semantic.role` | Landmark / role interpretation (or generic abstain) |
| `semantic.region` | Region / group keep vs abstain |

## Policy note

Under `pixel-faithful`, ambiguous nodes prefer **generic** abstain until Decision commits.  
Under `semantic-lean`, weaker heuristic annotations may still project.
