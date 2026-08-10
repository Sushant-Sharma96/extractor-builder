# Phase 16 Migration Notes — Accessibility Engine

## Call order

```js
await job.materializeNormalizedDesignGraph({ document, graphId });
// recommended: SemanticIR first (consumed as Evidence)
await job.projectSemanticIR({ sliceId: 'slice:semantic:…' });
await job.executeRulePack('accessibility.detect'); // optional proposers
// optional: arbitrate a11y.name / a11y.role
await job.projectAccessibilityIR({ sliceId: 'slice:a11y:…' });
```

## Do not

- Store HTML / ARIA attributes / React props in AccessibilityIR  
- Mutate SemanticIR (or any other engine IR)  
- Duplicate semantic role ownership  
- Commit Decisions from `accessibility.detect`  
- Emit code from this phase  

## Fingerprint

Adds (schema + fixture + `buildFingerprint` synchronized):

- `accessibilityIrChecksum`
- `accessibilityBuilderVersion`
- `accessibilitySliceId`

## Questions

| Id | Use |
|----|-----|
| `a11y.name` | Accessible name candidate (or abstain) |
| `a11y.role` | Access-role intent (`interactive` / `static` / …) — not ARIA strings |
