# Phase 11b Architecture Notes — Constraint Solver

| Field | Value |
|-------|--------|
| **Phase** | 11b |
| **Status** | Implemented |
| **Authority** | PHASE_11B_ARCHITECTURE_PROPOSAL.md |

---

## Ownership

| Module | Owns | Does not own |
|--------|------|--------------|
| `layout/constraint/` | Network, solve, relax proposals, LayoutIR₁ fields | Decision commit, NDG, HTML |
| Rule Pack `layout.constraint` | Optional Evidence + Hypotheses proposers | Fact mutation, commit |
| Facts plugin `facts.layout.constraint` | Publish LayoutIR₁ + solver Evidence/Hypotheses | Mutate LayoutIR₀ |
| Decision Runtime | Commit relax Decisions | Solver algorithms |

## Pipeline

```text
LayoutIR₀ → build network → solve → Evidence/Hypotheses
         → (optional Decisions) → LayoutIR₁
```

ConstraintNetwork is **internal only** — never a Workspace IR stage, never ConstraintIR.

## LayoutIR₁ payload (exporter-neutral)

- `constraintSolve.{ fromLayoutIrSliceId, status, relaxations, solverVersion, … }`
- `unsat[]`
- Per-node `solveStatus` only for absolute-box fallback annotation (does **not** flip mode without Decision)

## Fingerprint fields (11b / 11b.1)

- `constraintSolverVersion`
- `solvedLayoutIrChecksum`
- `solvedLayoutSliceId`
- `solverFingerprint`
- `baselineLayoutIrSliceId` / `activeLayoutIrSliceId` (Active LayoutIR pin)
- Baseline `layoutIrChecksum` / `layoutSliceId` retained from 11a
