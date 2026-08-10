# Phase 11 Architecture Notes — Layout Interpretation (11a)

| Field | Value |
|-------|--------|
| **Phase** | 11a |
| **Authority** | PHASE_11_ARCHITECTURE_PROPOSAL.md |

---

## Ownership

| Module | Owns | Does not own |
|--------|------|--------------|
| `compiler/layout/` | Interpretation predicates, LayoutIR project, report | Decision commit, NDG mutation, HTML |
| Rule Pack `layout.interpret` | Evidence + Hypotheses | Fact writes, ranking |
| Facts plugin `facts.layout.project` | LayoutIR IrSlice + layout Fact | Decisions |
| Decision Runtime | Rank / arbitrate / commit | Layout predicates |
| NDG | Structural SSOT | Arrangement interpretation |

## Pipeline

```text
NDG → layout.interpret (Hypotheses/Evidence)
    → Decision Runtime (optional commit)
    → projectLayoutIR (LayoutIR IrSlice)
```

## Neutral vocabulary

`flow-row` | `flow-column` | `absolute` | `grid-track` | `mixed` | `unknown`

No `display:flex` / CSS / React / Flutter in LayoutIR.
