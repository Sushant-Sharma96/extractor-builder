# Phase 10 Architecture Notes — Canonical Design Graph

| Field | Value |
|-------|--------|
| **Phase** | 10 |
| **Status** | Notes — complements EXECUTION_PLAN / COMPLETION_REPORT |
| **Authority** | PHASE_10_ARCHITECTURE_PROPOSAL.md |

---

## Ownership (unchanged)

| Module | Owns | Does not own |
|--------|------|--------------|
| **`compiler/ndg/`** | Deterministic graph build, validate, report; Fact/IrSlice publish via facts plugin | Decisions, semantics, emit, Knowledge mutation |
| **Plugin (Phase 6)** | Capability enforcement for Fact + IrSlice + Evidence writes | Domain algorithms (live in `ndg/`) |
| **Rule Packs (Phase 8/9)** | Candidates from **graph Facts** | Fact mutation / graph rebuild |
| **Workspace** | Passive store | Scoring / ranking / graph algorithms |
| **Decision Runtime** | Rank / arbitrate / commit | Structural Facts |
| **Kernel** | `materializeNormalizedDesignGraph` invoke + fingerprint pin | Domain transforms |

No `GraphEngine` framework. No second plugin system.

---

## Structural SSOT

```text
RawDesignDocument / source.node (ingress, transitional)
        │
        ▼
NormalizedDesignGraph  ← structural SSOT (this phase)
        │
        ├─ IrSlice stageId=normalized-design-graph
        ├─ Fact kind=ndg.graph
        └─ Fact kind=ndg.node  (+ Evidence for drops/collapses)
        │
        ▼
Phase 9 features / recognition (proposals only)
        │
        ▼
Later: Layout / Semantic / … → Decisions → ResolvedIR → Emit
```

**Edge identity:** NDG contract edges have no `edgeId` field (schema frozen). Stable edge identity is the composite key `kind:from:to:index`, also recorded on report / optional Fact projections.

---

## Fact kinds

| Kind | Role |
|------|------|
| `ndg.graph` | Graph metadata, checksum, counts, builderVersion |
| `ndg.node` | Per-node structural Fact (preferred Phase 9 input) |
| `source.node` | **Transitional** ingress; used when NDG not yet built |

---

## Collapse policy (deterministic, traced)

1. **Invisible** (`visible === false`): drop node; reparent children to grandparent (order preserved); Evidence `ref: ndg.dropped.invisible`
2. **Empty leaf wrapper**: FRAME/GROUP with zero children and no paints/strokes/effects/text: drop; Evidence `ref: ndg.dropped.empty`
3. **Pass-through wrapper**: FRAME/GROUP with exactly one child, no fills/strokes/effects/radius: collapse (replace with child); Evidence `ref: ndg.collapsed.passthrough`

No semantic interpretation of names.

---

## Migration

Phase 9 packs prefer `ndg.node`. If none exist, fall back to `source.node` and log transitional diagnostic.
