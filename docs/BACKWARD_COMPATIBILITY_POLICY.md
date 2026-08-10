# BACKWARD_COMPATIBILITY_POLICY.md — Foundation Freeze v1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Phase** | 11b.1 |

---

## Principles

1. **Additive preferred** over breaking.  
2. **Immutability** of stored Facts/IrSlices is never relaxed.  
3. **Decision monopoly** is never relaxed.  
4. Contract suite bumps require explicit changelog.  
5. `extra` on fingerprint is not a dumping ground for required determinism inputs.

---

## What cannot evolve without RFC

| Artifact | Rule |
|----------|------|
| DecisionRecord required fields / status enum | Additive fields OK; removals/renames = RFC |
| Fact immutability protocol | Frozen |
| Workspace passivity | Frozen |
| NDG as structural SSOT + node identity | Frozen |
| LayoutIR slice immutability | Frozen |
| No ConstraintIR peer stage | Frozen |
| Plugin propose ≠ decide | Frozen |
| Knowledge immutability | Frozen |
| Kernel “no HTML / no UI ontology” | Frozen |

---

## What may evolve (compatible)

| Artifact | Allowed |
|----------|---------|
| Rule Pack heuristics / scores | Yes |
| Knowledge *content* versions | Yes (new bundle versions) |
| Policy threshold *values* / allowlists | Yes |
| Constraint kinds, strengths, epsilon | Yes (Layout-internal) |
| Layout interpretation cues | Yes (packs) |
| Fingerprint **named** fields | Yes **only** with schema sync + docs |
| LayoutIR payload additive fields | Yes if exporter-neutral |
| NDG attributes additive | Yes |
| Experimental Kernel helpers | Yes |

---

## Compatibility by surface

| Surface | Compat rule |
|---------|-------------|
| **NDG** | Readers must tolerate unknown attributes; writers must not change ids/parents silently |
| **LayoutIR** | New slices for new meaning; never overwrite; pins track active/baseline |
| **Decision schema** | Additive optional fields preferred |
| **Facts** | New kinds OK if registered in docs; no mutate-in-place |
| **Workspace APIs** | Additive methods OK; remove = deprecation cycle |
| **Kernel job APIs** | Stable methods kept; `arbitrate` deprecated alias retained |
| **Fingerprint** | Named fields ⊆ schema; unknown keys fail validation |
| **Plugin contracts** | Capability fields additive; removing a write kind = breaking |

---

## Deprecation process

1. Mark **Deprecated** in `API_STABILITY_REPORT.md`.  
2. Keep behavior ≥ one foundation minor.  
3. Remove only with Lock Contract note.
