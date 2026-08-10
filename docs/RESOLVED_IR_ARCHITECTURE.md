# RESOLVED_IR_ARCHITECTURE.md

| Field | Value |
|-------|--------|
| **Phase** | 17 |
| **Module** | `compiler/resolved/` |
| **Role** | Compiler integration / composition layer |

## Responsibility

Compose **immutable** published IrSlices + committed Decision records into canonical ResolvedIR.

## Never

- Recompute Layout / Component / Token / Semantic / Responsive / Accessibility  
- Mutate published IrSlices  
- Own domain heuristics  
- Emit HTML/CSS/React  

## Consume

| Input | Required? |
|-------|-----------|
| NDG | Yes (context) |
| LayoutIR | Optional (prefer active pin) |
| ComponentIR / TokenIR / SemanticIR / ResponsiveIR / AccessibilityIR | Optional |
| AssetIR / BehaviorIR | Optional — missing tolerated |
| Committed Decisions | Optional list |

## Produce

ResolvedIR IrSlice (`stageId: resolved-ir`) + Fact `resolved.ir`.

Contract payload fields only: `resolvedId`, `decisionIds`, `slices[]` (`stageId`, `sliceId`, `committed`, `nodeIds`).

Conflict / missing-stage diagnostics live on the Fact report (not in strict contract payload).

## Kernel

`job.projectResolvedIR()`

## Fingerprint

`resolvedIrChecksum`, `resolvedBuilderVersion`, `resolvedSliceId`
