# Phase 12 Migration Notes — Component Engine

## Call order

```js
await job.materializeNormalizedDesignGraph({ document, graphId });
// recommended: layout + solve first
await job.projectLayoutIR({ sliceId: 'slice:layout:…' });
await job.solveLayoutConstraints({ baselineSliceId: 'slice:layout:…', sliceId: 'slice:layout-solved:…' });
await job.executeRulePack('component.detect'); // optional proposers
// optional: arbitrate component.instanceTreatment
await job.projectComponentIR({ sliceId: 'slice:component:…' });
```

## Do not

- Mutate NDG or LayoutIR  
- Nest under `compiler/layout/`  
- Emit React/HTML from ComponentIR  
- Flatten without Decision  

## Fingerprint

Adds `componentIrChecksum`, `componentBuilderVersion`, `componentSliceId`.
