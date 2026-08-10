# Phase 15 Migration Notes — Responsive Engine

## Call order

```js
await job.materializeNormalizedDesignGraph({ document, graphId });
// recommended: layout (+ solve) first when arrangement modes matter
await job.projectLayoutIR({ sliceId: 'slice:layout:…' });
await job.executeRulePack('responsive.detect'); // optional proposers
// optional: arbitrate responsive.strategy / responsive.breakpoint
await job.projectResponsiveIR({ sliceId: 'slice:responsive:…' });
```

## Do not

- Store `@media` / CSS / React / framework values in ResponsiveIR  
- Commit Decisions from `responsive.detect`  
- Mutate NDG / LayoutIR / SemanticIR / other engines  
- Emit code from this phase  

## Fingerprint

Adds (schema + fixture + `buildFingerprint` synchronized):

- `responsiveIrChecksum`
- `responsiveBuilderVersion`
- `responsiveSliceId`

## Questions

| Id | Use |
|----|-----|
| `responsive.strategy` | stack / wrap / row / hide / … (or abstain) |
| `responsive.breakpoint` | Honor / abstain a breakpoint candidate |

## Policy note

Under `pixel-faithful`, ambiguous adaptations prefer **abstain** until Decision commits.
