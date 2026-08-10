# EMIT_PLAN_ARCHITECTURE.md

| Field | Value |
|-------|--------|
| **Phase** | 18 |
| **Module** | `compiler/emit/` |
| **Role** | Exporter-neutral lowering plan |

## Responsibility

Consume **ResolvedIR only** and produce an EmitPlan describing:

- export plan  
- asset plan (empty when AssetIR absent)  
- component expansion plan  
- render order  
- dependency order  
- resource graph  
- chunk plan  

## Never

- Generate HTML / CSS / React / framework code  
- Recompute domain engines  
- Read NDG directly for inventiveness (ResolvedIR is the sole IR input)  

## Schema note

Phase 1 `EmitPlan` contract requires `tagChoices` etc. Rich plan structures are nested under `classStrategy` (`mode: 'exporter-neutral'`) so the contract remains valid without HTML inventiveness. `tagChoices` / `roleChoices` are filled only from committed Decisions (`html.tag`, `semantic.role`, `a11y.role`, …).

## Kernel

`job.projectEmitPlan()`

## Fingerprint

`emitPlanChecksum`, `emitBuilderVersion`, `emitPlanSliceId`
