# ENGINE_DEPENDENCY_MAP.md

| Field | Value |
|-------|--------|
| **Document** | Engine dependency & pipeline map |
| **Date** | 2026-07-18 |
| **Rule** | No cycles; Decision Runtime is the only committer |

---

## 1. Structural dependency DAG

```text
                    Raw / source.node
                            │
                            ▼
                           NDG
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
     Features*        Recognition*      layout.interpret*
          │                 │                 │
          └──────── Evidence / Hypotheses ────┘
                            │
                            ▼
                    Decision Runtime*
                            │
                            ▼
                       LayoutIR₀
                            │
                    layout.constraint*
                            │
                    Decision Runtime*
                            │
                            ▼
                       LayoutIR₁ ──────────────────────────┐
                            │                              │
          ┌─────────────────┼──────────────┬───────────────┤
          ▼                 ▼              ▼               ▼
     ComponentIR        TokenIR      SemanticIR      ResponsiveIR
                                                │
                                                ▼
                                          AccessibilityIR
                                                │
                                                ▼
                                         ResolvedIR †
                                                │
                                                ▼
                                          EmitPlan †
                                                │
                                                ▼
                                         Artifacts †

* optional wave (caller-ordered)
† not implemented
```

---

## 2. Hard vs soft edges

| From | To | Edge type | Notes |
|------|----|-----------|-------|
| Raw | NDG | **Hard** | Required |
| NDG | LayoutIR₀ | **Hard** | Required for layout project |
| LayoutIR₀ | LayoutIR₁ | **Hard** | Solve requires baseline |
| NDG | Component / Token / Semantic / Responsive / A11y | **Hard** | Each engine requires NDG |
| LayoutIR (active) | Component / Semantic / Responsive / A11y | Soft | Prefer when present; degrade OK |
| SemanticIR | AccessibilityIR | Soft | Read-only Evidence; degrade OK |
| Any domain IR | Peer domain IR | **Forbidden write** | No cross-mutation |
| Any engine | Decision commit | **Forbidden** | Packs/plugins propose only |
| Specialized IRs | ResolvedIR | Future hard/soft | Predecessor rule: at-least-one specialized |

---

## 3. Independence checklist

| Engine | Independent module? | Can run without peer domain IRs? | Notes |
|--------|---------------------|----------------------------------|-------|
| NDG | Yes | Yes | Root |
| Layout | Yes | Needs NDG | |
| Constraint | Yes (subsystem) | Needs LayoutIR₀ + NDG | Not a peer engine |
| Component | Yes | Needs NDG; Layout optional | |
| Token | Yes | Needs NDG | |
| Semantic | Yes | Needs NDG; Layout optional | |
| Responsive | Yes | Needs NDG; Layout optional | |
| Accessibility | Yes | Needs NDG; Semantic optional | Must not write Semantic |

**Conclusion:** Engines are **sibling modules** with a shared NDG root. Independence holds for implementation ownership; **product completeness** of A11y improves when Semantic exists.

---

## 4. Kernel orchestration surface (caller-ordered)

| Order (recommended) | Job method |
|---------------------|------------|
| 1 | `materializeNormalizedDesignGraph` |
| 2 | `projectLayoutIR` |
| 3 | `solveLayoutConstraints` |
| 4 | `projectComponentIR` |
| 5 | `projectTokenIR` |
| 6 | `projectSemanticIR` |
| 7 | `projectResponsiveIR` |
| 8 | `projectAccessibilityIR` |
| — | `executeRulePack` / `invokeDecisionRuntime` interleaved as needed |
| † | ResolvedIR / Emit / `compile()` — **absent** |

There is **no** automatic pipeline runner (FR-04 deferred). Wrong call order is a **caller risk**, not a cycle.

---

## 5. Plugin & pack ids (no duplicates)

| Facts plugin | Pack |
|--------------|------|
| `facts.ndg.materialize` | — |
| `facts.layout.project` | `layout.interpret` |
| `facts.layout.constraint` | `layout.constraint` |
| `facts.component.project` | `component.detect` |
| `facts.token.project` | `token.detect` |
| `facts.semantic.project` | `semantic.detect` |
| `facts.responsive.project` | `responsive.detect` |
| `facts.accessibility.project` | `accessibility.detect` |

Also present (foundation): `feature-extract`, `recognition-basic`, `synthetic-basic`.

---

## 6. Anti-patterns confirmed absent / residual

| Anti-pattern | Status |
|--------------|--------|
| Engine A mutates Engine B IR | **Absent** (A11y asserts Semantic unchanged) |
| ConstraintIR peer stage | **Absent** (by design) |
| HTML/CSS/ARIA in domain IR | **Absent** (tests assert) |
| Pack commits Decisions | **Absent** |
| Circular stage predecessors | **Absent** (harness) |
| Dual propose paths (constraint) | **Residual** FR-02 |
| Dual SSOT `source.node` | **Residual** FR-05 |
