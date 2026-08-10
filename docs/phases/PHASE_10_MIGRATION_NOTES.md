# Phase 10 Migration Notes — Phase 9 → NDG Consumers

| Field | Value |
|-------|--------|
| **Phase** | 10 |
| **Audience** | Feature Extraction / Recognition pack maintainers |

---

## What changed

| Before | After |
|--------|--------|
| Packs read `Fact.kind === source.node` | Prefer `Fact.kind === ndg.node` |
| Assertion = raw tool node | Assertion = NDG node projection (`type`, `box`, `attributes`, …) |
| Dual trees possible | **One** structural SSOT after materialization |

---

## Transitional compatibility

If Workspace has **no** `ndg.node` Facts, packs may still read `source.node`.

This path is **degraded / transitional**. Diagnostics should note `inputMode: transitional-source-node`.

After `job.materializeNormalizedDesignGraph()`, packs must use NDG.

---

## Do not

- Duplicate hierarchy into Recognition Evidence as a second graph
- Write Facts from Rule Packs
- Treat recognition Candidates as structural truth
