# Phase 8 Architecture Notes — Rule Pack Infrastructure

| Field | Value |
|-------|--------|
| **Phase** | 8 |
| **Status** | Notes only — complements PHASE_08_EXECUTION_PLAN / COMPLETION_REPORT |
| **Authority** | RFC-002 §5; PLUGIN_CAPABILITY_CONTRACT; KNOWLEDGE_BUNDLE_ARCHITECTURE; ARCHITECTURE_FREEZE_AUDIT |

---

## Ownership (unchanged)

| Module | Owns | Does not own |
|--------|------|--------------|
| Rule Pack | Deterministic Candidate/Hypothesis/Evidence **proposals** | Decisions, arbitration, Knowledge mutation, Fact mutation |
| Plugin (Phase 6) | Capability enforcement + lifecycle host for packs | Domain rules |
| Knowledge | Immutable ontology | Rule execution |
| Workspace | Passive store | Scoring / ranking |
| Decision Runtime | Rank / arbitrate / commit / traces | Rule evaluation |
| Policy | Thresholds / allowlists | Rule logic |
| Kernel | Register / pin / schedule / invoke | Domain intelligence |

## Integration

```text
RulePack.plugin ──register──► Phase 6 Plugin Registry
RulePack handlers ──execute──► RuleContext (restricted)
                              │
                              ├─ read Facts (plugin scoped)
                              ├─ read Knowledge (handle)
                              ├─ read Policy / Fingerprint
                              └─ stage Evidence + Hypothesis → Workspace commit
Decision Runtime (later) ← Hypotheses / Candidates
```

No `registerRuleEngine()`. No second plugin framework.

## Forbidden (enforced)

- `putDecision` / `putTrace` / `arbitrate` / `emit` on RuleContext  
- Fact / Decision / Trace / Provenance / IrSlice in pack `plugin.writes`  
- Knowledge mutation APIs  
- Raw Workspace / Runtime bypass  

## Synthetic pack

`compiler/rulepack/packs/synthetic-basic` demonstrates infrastructure only — not Navbar/Hero/Card production rules.
