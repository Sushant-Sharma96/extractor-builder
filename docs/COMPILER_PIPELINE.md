# COMPILER_PIPELINE.md

| Field | Value |
|-------|--------|
| **Entry** | `compile()` in `compiler/compile.js` |
| **Status** | Product integrated (through HTML/CSS/JS) |

## Pipeline

```text
Raw document
  → NDG
  → LayoutIR₀
  → LayoutIR₁ (optional; engines.constraint)
  → ComponentIR
  → TokenIR
  → SemanticIR
  → ResponsiveIR
  → AccessibilityIR
  → ResolvedIR
  → EmitPlan
  → artifacts (product adapter → figma-build → HTML/CSS/JS)
```

Each IR step is a Kernel job method. Artifact emission reuses `server/figma-build` via `compiler/artifacts` — not a second compiler.

## Optional engines

```js
await compile({
  document,
  graphId,
  policyProfileId: 'pixel-faithful',
  outDir: './output/my-design', // optional disk write
  engines: {
    layout: true,
    constraint: true,
    component: true,
    token: true,
    semantic: true,
    responsive: true,
    accessibility: true,
    resolved: true,
    emit: true,
    artifacts: true,
  },
});
```

Set a stage to `false` to skip. Emit requires Resolved. Artifacts require Emit + `document`.

## Rules

| Layer | Owns |
|-------|------|
| Domain engines | Interpretation + specialized IR |
| Decision Runtime | Commits |
| ResolvedIR | Composition |
| EmitPlan | Plan only |
| `compile()` | Orchestration |
| `compiler/artifacts` + `figma-build` | HTML/CSS/JS lowering |

No engine mutates another engine’s IrSlice.
