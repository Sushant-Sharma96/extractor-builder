# Phase 11b Migration Notes

| Field | Value |
|-------|--------|
| **Phase** | 11b |

---

## Call order

1. Materialize NDG  
2. `layout.interpret` + optional Decision Runtime  
3. `projectLayoutIR` → LayoutIR₀ (**pins** baseline=active)  
4. Optional `executeRulePack('layout.constraint')`  
5. Optional Decision Runtime for `layout.constraint.relax`  
6. `solveLayoutConstraints` → LayoutIR₁ (**pins** active=solved; baseline retained)  

```js
await job.projectLayoutIR({ sliceId: 'slice:layout:…' });
// workspace.getLayoutIrPin(graphId) → { baselineLayoutIrSliceId, activeLayoutIrSliceId }
await job.solveLayoutConstraints({
  baselineSliceId: 'slice:layout:…',
  sliceId: 'slice:layout-solved:…',
});
```

Loaders: `loadLayoutIrFromWorkspace({ prefer: 'baseline'|'active'|'solved', graphId })` **prefers pin** over last-created slice.

## Do not

- Mutate LayoutIR₀  
- Register ConstraintIR  
- Feed RawDesignDocument into solver  
- Emit CSS from solve results  
- Rely on “last IrSlice id wins” when a pin exists  

Downstream engines should read **`activeLayoutIrSliceId`** (fingerprint + Workspace pin).
