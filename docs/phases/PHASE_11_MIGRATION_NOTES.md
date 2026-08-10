# Phase 11 Migration Notes — Layout over NDG

| Field | Value |
|-------|--------|
| **Phase** | 11a |

---

## Required call order

1. `job.materializeNormalizedDesignGraph(...)`  
2. `job.executeRulePack('layout.interpret')` (or registry execute)  
3. Optional: Decision Runtime arbitrate layout questions  
4. `job.projectLayoutIR(...)`  

## Do not

- Feed RawDesignDocument into Layout  
- Treat Recognition `stack`/`grid` as committed layout  
- Mutate NDG from Layout  
- Emit CSS from LayoutIR  

## Transitional

If NDG missing, Layout must fail closed (not invent a tree).
