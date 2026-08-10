# Phase 13 Migration Notes — Design Token Engine

## Call order

```js
await job.materializeNormalizedDesignGraph({ document, graphId });
// recommended: layout (+ solve) + components first when those slices matter
await job.executeRulePack('token.detect'); // optional proposers
// optional: arbitrate token.bind / token.merge via Decision Runtime
await job.projectTokenIR({ sliceId: 'slice:token:…' });
```

## Do not

- Mutate NDG, LayoutIR, or ComponentIR from the Token Engine  
- Nest tokens under `compiler/layout/` or `compiler/components/`  
- Emit CSS custom properties / theme files from TokenIR in this phase  
- Commit Decisions from `token.detect` (Evidence + Hypotheses only)  
- Invent lifecycle stages beyond collect → detect → project → publish → materialize  

## Fingerprint

Adds (schema + fixture + `buildFingerprint` synchronized):

- `tokenIrChecksum`
- `tokenBuilderVersion`
- `tokenSliceId`

## NDG ingest (additive)

Raw nodes may carry `styles` and `boundVariables` into node attributes for token detection. Structural graph ownership remains NDG.

## Questions

| Id | Use |
|----|-----|
| `token.bind` | Bind property → token (or keep literal) |
| `token.merge` | Whether two token candidates should merge |
