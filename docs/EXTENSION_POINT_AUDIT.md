# EXTENSION_POINT_AUDIT.md — Foundation Freeze v1

| Field | Value |
|-------|--------|
| **Date** | 2026-07-18 |
| **Phase** | 11b.1 |

---

## Allowed extensions

| Extension | Mechanism | Writes | Must not |
|-----------|-----------|--------|----------|
| **Rule Packs** | `registerRulePack` / load directory | Evidence, Hypothesis | Facts, Decisions, IrSlices, Knowledge mutate |
| **Facts Plugins** | `registerPlugin` engineType `facts` | Fact, IrSlice (± Evidence per declaration) | Commit Decisions; mutate NDG identity |
| **Knowledge** | Bundle versions | Registry only | Runtime mutation; reasoning |
| **Policy** | Profiles / overrides | Config bind | Domain heuristics in Kernel |
| **Future Engines** | Sibling modules + packs | Domain Facts/IR + Hypotheses | Steal Decision/Workspace/NDG ownership |
| **Layout constraint internals** | `layout/constraint/` | Evidence/Hypotheses via plugin; LayoutIR₁ | ConstraintIR stage; mode flip without Decision |

### Current facts plugins

- `facts.ndg.materialize`  
- `facts.layout.project`  
- `facts.layout.constraint`  

### Current rule packs

- `synthetic.basic`  
- `feature.extract`  
- `recognition.basic`  
- `layout.interpret`  
- `layout.constraint`  

---

## Forbidden extensions

| Target | Forbidden action |
|--------|------------------|
| **Decision Runtime** | Domain scoring, layout/CSS heuristics, Fact mutation |
| **Workspace ownership** | Ranking, scheduling, emit |
| **NDG ownership** | Re-parent, rebuild tree, change ids from other engines |
| **Compiler contracts** | Silent schema drift; hidden fingerprint fields |
| **Layout** | Owning Semantic/Responsive/Components |
| **Constraint** | Becoming peer engine / ConstraintIR |

---

## Future engines (allowed pattern)

```text
compiler/<domain>/
  + facts.<domain>.* plugin
  + rulepack packs proposing domain questions
  + Kernel job.<verb>() optional
  → Decision Runtime commits
  → IrSlice stage already in ir-stages.json (or RFC to add)
```

Phase 12 Component Engine must follow this pattern — **not** nest under `layout/`.

---

## Dual-registry note

`registerEngine` (Phase 2) and `registerPlugin` (Phase 6) both exist. **Prefer plugins.** Unification is FR-03 (Future RFC) — not silently merged in 11b.1.
