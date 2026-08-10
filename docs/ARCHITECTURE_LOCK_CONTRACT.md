# ARCHITECTURE_LOCK_CONTRACT.md — Foundation Freeze v1

| Field | Value |
|-------|--------|
| **Name** | Architecture Constitution / Lock Contract |
| **Version** | Foundation Freeze v1 |
| **Effective** | 2026-07-18 (Phase 11b.1) |
| **Scope** | Phases 1–11b foundation |
| **Code** | Hardening only in 11b.1; no Phase 12 engines |

---

## 1. Frozen modules

| Module | Path |
|--------|------|
| Contracts | `contracts/` |
| Kernel | `compiler/kernel/` |
| Workspace | `compiler/workspace/` |
| Decision Runtime | `compiler/decision/` |
| Policy | `compiler/policy/` |
| Plugin infrastructure | `compiler/plugin/` |
| Knowledge | `compiler/knowledge/` |
| Rule Pack infrastructure | `compiler/rulepack/` |
| Features | `compiler/features/` |
| NDG | `compiler/ndg/` |
| Layout (+ constraint) | `compiler/layout/` |

---

## 2. Frozen invariants

1. Decision Runtime is the **sole** committer of Decisions and Traces.  
2. Workspace is **passive** (store only).  
3. Facts and IrSlices are **immutable** after put (identity collision ≠ mutate).  
4. Knowledge is **immutable** ontology; never reasons.  
5. Plugins / Rule Packs **propose**; they do not arbitrate.  
6. NDG is **structural SSOT**; domain engines must not rebuild hierarchy or change node identity.  
7. Layout owns arrangement + constraint; **no ConstraintIR** peer stage; **no ConstraintEngine** framework.  
8. LayoutIR slices are **immutable**; solved state = **new** slice (LayoutIR₁); pin is metadata only.  
9. LayoutIR vocabulary is **exporter-neutral** (no HTML/CSS emit semantics).  
10. Kernel does not contain UI ontology or HTML emit.  
11. Pipeline order: NDG → Layout interpret → (Decisions) → LayoutIR₀ → Constraint → (Decisions) → LayoutIR₁ → later domains.  
12. Fingerprint named fields must match `job-fingerprint.json` (no hidden fields).

---

## 3. Ownership matrix

See `CURRENT_TRUTH.md`. Summary: Kernel hub; Workspace store; Decision commit; Policy config; NDG structure; Layout spatial; later phases own their domains.

---

## 4. Pipeline (locked order)

```text
NDG → Features/Recognition (evidence only) → Layout interpret → Decisions
   → LayoutIR₀ → Constraint → Decisions → LayoutIR₁ → (future) → ResolvedIR → Emit
```

Never: Solver → HTML; LayoutIR mutate in place; Constraint before arrangement; Recognition as structural authority.

---

## 5. Allowed extension points

| Extension | How |
|-----------|-----|
| Rule Packs | Register proposers (Evidence/Hypotheses only) |
| Facts plugins | Publish domain Facts / IrSlices under capability contract |
| Knowledge content | New/updated bundles (immutable versions) |
| Policy profiles / values | Additive profiles; authoritative thresholds |
| Future engines (Component, Token, Semantic, …) | Sibling modules + packs; Decision-committed |
| Layout constraint kinds/strengths | Internal to `layout/constraint/` |
| Fingerprint named fields | **Only with schema + suite sync** |

---

## 6. Forbidden extension points

| Forbidden | Why |
|-----------|-----|
| Decision Runtime domain heuristics | Breaks monopoly / agnosticism |
| Workspace ranking / arbitration | Workspace must stay passive |
| Mutating NDG from Layout/Semantic/… | Breaks structural SSOT |
| ConstraintIR / peer ConstraintEngine | Rejected in 11b |
| HTML/CSS/JS inside Layout or Kernel | Emit is lowering-only (future) |
| Silent Fact mutation | Immutability |
| Bypass Decision for interpretive layout/mode changes | Traceability |

---

## 7. RFC-required changes

Any change to frozen invariants requires:

1. Written RFC amendment (RFC-002 primary), and  
2. Master Plan note, and  
3. Update to this Lock Contract + `CURRENT_TRUTH.md`.

Heuristic/pack/content changes do **not** require RFC.

---

## 8. Backward compatibility

See `BACKWARD_COMPATIBILITY_POLICY.md`.

---

## 9. API classification

See `API_STABILITY_REPORT.md`.

| Class | Meaning |
|-------|---------|
| **Stable** | Semver-sensitive; breaking needs RFC |
| **Experimental** | May change in-phase |
| **Internal** | No external guarantee |
| **Deprecated** | Prefer replacement; remove later |

---

## 10. Public vs internal

| Public (Stable / Experimental) | Internal |
|--------------------------------|----------|
| Kernel `createKernel` / job methods listed Stable | ConstraintNetwork object |
| Workspace put/get for store kinds + LayoutIR pins | Plugin staging maps |
| Decision `createDecisionRuntime` / session | Ranker internals |
| Contract schemas + registries | Pack handler helpers |
| Fingerprint build/key | — |

---

## Future RFC Recommendations (discovered in 11b.1; not implemented)

| ID | Topic | Reason | Impact | Risk | Suggested | Priority |
|----|-------|--------|--------|------|-----------|----------|
| FR-01 | Unify RuleContext IrSlice reads | Packs blank IrSlice → Fact dual SSOT | Medium | Dual graph views | Allow IrSlice read in packs | P1 |
| FR-02 | Collapse dual constraint hypothesis paths | Pack + facts plugin both propose | Medium | Non-repro Evidence | Facts plugin projects IR only | P1 |
| FR-03 | Dual `registerEngine`/`registerPlugin` | Confusing extension surface | Medium | Schedule bugs | Single registry | P1 |
| FR-04 | Pipeline runner (non-emit) | Caller-ordered waves fragile | High for Phase 12+ | Wrong order | Thin orchestrator | P1 |
| FR-05 | Retire `source.node` structural dual | Transitional SSOT | Medium | Drift | Gate after migration | P1 |
| FR-06 | Rename `features.normalize` | Naming collision with NDG | Low | Confusion | Namespace rename | P2 |
| FR-07 | Process plugin sandbox | try_catch only | Low today | Crash blast | Isolate later | P3 |

### Fixed during 11b.1 (not deferred)

| ID | Topic | Fix |
|----|-------|-----|
| FR-08 | Slice-scoped Evidence/Hypothesis ids on re-solve | Include `sliceId` in ids so re-project does not roll back IrSlice |

Future RFC items require RFC or Master Plan amendment if they change frozen boundaries. **Do not implement as silent ownership changes.**
