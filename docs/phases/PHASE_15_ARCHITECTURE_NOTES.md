# Phase 15 Architecture Notes — Responsive Engine

| Field | Value |
|-------|--------|
| **Phase** | 15 |
| **Status** | Implemented |
| **Lifecycle** | collect → detect → project → publish → materialize |

## Ownership

| Module | Owns |
|--------|------|
| `compiler/responsive/` | Responsive interpretation + ResponsiveIR |
| Pack `responsive.detect` | Evidence + Hypotheses only |
| `facts.responsive.project` | Publish ResponsiveIR IrSlice + Fact |
| Decision Runtime | Commit `responsive.strategy` / `responsive.breakpoint` |

## Exporter neutrality

ResponsiveIR uses **breakpoint kinds** + **adaptation strategies** (`stack`, `wrap`, `row`, …).

`widthHint` is design-space intent — **not** a CSS media query string.

## Pipeline

```text
NDG → (optional Layout pin) → responsive.detect (optional)
  → Decision (optional strategy) → Responsive Engine → ResponsiveIR
  → later A11y / ResolvedIR / Emit
```

## ResponsiveIR contents

- `breakpoints` — narrow / medium / wide candidates  
- `adaptations` — node → strategy @ breakpoints  
- `groups` — responsive clusters  
- `ambiguous` — competing strategies  
- `metrics` — coverage / counts  

## Kernel

`job.projectResponsiveIR()` — fingerprint fields  
`responsiveIrChecksum`, `responsiveBuilderVersion`, `responsiveSliceId`.

## Contract note

Phase 1 registry lacked `responsive-ir`. Stage + envelope enum + ResolvedIR predecessor were **additively** registered so Workspace can publish the slice (same class of extension as fingerprint fields).
