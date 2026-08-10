# Phase 11b Architecture Proposal — Constraint Solver (Layout Subsystem)

| Field | Value |
|-------|--------|
| **Document type** | Architecture review / proposal only |
| **Date** | 2026-07-18 |
| **Status** | **Proposal — authorized; implementation complete** (`PHASE_11B_COMPLETION_REPORT.md`) |
| **Code / Phase 11b created** | `compiler/layout/constraint/` + pack + Kernel API |
| **Authority consulted** | RFC-001, RFC-002 (§amendments: Constraint under Layout), IMPLEMENTATION_MASTER_PLAN, PHASE_11_ARCHITECTURE_PROPOSAL, PHASE_11_COMPLETION_REPORT, Phases 8–10 |
| **Role** | Lead compiler architect |

---

## Executive Summary

**The Constraint Solver is not a peer compiler engine.**  
It is a **deterministic subsystem of Layout** that checks and resolves **geometric / sizing / position consistency** implied by NDG Facts + Layout arrangement Decisions.

### Verdict

| Question | Recommendation |
|----------|----------------|
| What is it? | Layout-owned **constraint network + solve/relax/report** service |
| Framework? | **No** — lives in `compiler/layout/` (+ optional Rule Pack proposers); Phase 6 plugins only |
| Separate ConstraintIR stage? | **No** (default) — solve results land in **LayoutIR payload** + Evidence/Hypotheses |
| LayoutIR immutable? | **Yes, each published slice is immutable** — solver produces a **new LayoutIR projection** (LayoutIR₁), never mutates LayoutIR₀ or NDG |
| Who commits? | **Decision Runtime only** for interpretive choices (e.g. which constraint to relax, sizing conflict) |
| Pipeline? | NDG → Layout interpret → Decisions → LayoutIR₀ → **Constraint wave** → (optional Decisions) → **LayoutIR₁ (solved)** → later domains → ResolvedIR |

**Do not** invent a free-floating Constraint Engine.  
**Do not** treat CSS Flexbox constraint solvers as the architecture.  
**Do not** let the solver silently rewrite arrangement modes.

---

# 1. Architecture Review (post-11a)

## 1.1 What 11a delivered

```text
NDG → layout.interpret → (optional Decision) → LayoutIR₀
```

LayoutIR₀ today carries: mode, axis, childOrder, outOfFlow, gap/padding, sizing hints, empty `unsat: []`.

## 1.2 What is still missing

- Consistency between parent flow + child boxes + source constraints  
- Detecting over-constrained / under-constrained regions  
- Traced relaxation and absolute-box fallback  
- Filling LayoutIR `unsat` / solved sizing fields with provenance  

## 1.3 Roadmap challenges

| Naive claim | Architect position |
|-------------|-------------------|
| “Constraint Solver is the next peer engine” | **Reject** — RFC-002: subsystem of Layout |
| “Solver mutates LayoutIR in place” | **Reject** — violates immutability / fingerprint |
| “Need ConstraintIR as new IR stage” | **Usually reject** — duplicates Layout ownership; prefer LayoutIR solve section |
| “Solver runs before LayoutIR” | **Reject** — needs arrangement Decisions first |
| “Solver commits winners” | **Reject** — Decision Runtime monopoly |
| “11b includes Responsive” | **Reject** — Phase 15 owns breakpoint strategy; may *read* constraints |

---

# 2. Definition (Q1)

**Constraint Solver (in this compiler)** = a **Layout subsystem** that:

1. Builds a **constraint network** from NDG geometry/attributes + LayoutIR arrangement + committed layout Decisions  
2. Attempts **deterministic satisfaction** (or proves unsat)  
3. Emits **Evidence** of consistency / conflict / relaxation  
4. Where interpretation is required (which constraint to drop; hug vs fill under conflict), emits **Hypotheses** for Decision Runtime  
5. Projects a **solved LayoutIR** snapshot (new immutable IrSlice) incorporating solve results  

It is **not**: a CSS engine, a UI toolkit layout pass, Semantic reasoning, or a second Kernel.

---

# 3. Ownership

## 3.1 What it owns (Q2)

| Owns | Notes |
|------|--------|
| Constraint network construction | Variables: sizes, positions, gaps; relations from NDG + LayoutIR |
| Parent–child geometric consistency checks | e.g. children fit / overflow parent under declared mode |
| Alignment / distribution consistency | vs LayoutIR align fields when present |
| Sizing consistency | hug / fill / fixed interactions under parent mode |
| Position constraints | absolute child vs in-flow siblings; non-overlap optional under policy |
| Satisfaction / unsat detection | Deterministic |
| Relaxation **proposals** | Ordered candidates — not silent drops |
| Unsat recording | Structured `unsat[]` + Evidence |
| Solver diagnostics / report | Timing, iterations, relaxations applied after Decisions |
| LayoutIR solve projection fields | `unsat`, solved sizing/position annotations |

## 3.2 What it must NEVER own (Q3)

| Never owns | Owner |
|------------|--------|
| NDG identity / hierarchy mutation | NDG |
| Arrangement mode interpretation (`flow-row` vs `absolute`) | Layout 11a + Decisions |
| Semantic / components / a11y / animation | Later engines |
| Responsive breakpoint strategy | Responsive Engine |
| Token binding | Token Engine |
| Ranking / arbitration / Decision commit / Traces authorship | Decision Runtime |
| HTML / CSS / JS / EmitPlan / ResolvedIR | Lowering / later phases |
| Knowledge mutation | Knowledge |
| Second plugin framework | Forbidden |

---

# 4. Inputs (Q4)

| Input | Required? | Role |
|-------|-----------|------|
| **NDG** / `ndg.node` | **Required** | Boxes, constraint attributes, hierarchy (structural SSOT) |
| **LayoutIR₀** | **Required** | Arrangement context (mode, childOrder, outOfFlow, gap/padding) |
| **Committed Layout Decisions** | Strongly recommended | Mode/sizing winners; without them use fact-baseline + mark degraded |
| Layout Evidence (11a) | Optional | Provenance continuity |
| Policy | Required for production | Pixel-faithful → prefer box preservation; budgets; relax order |
| Knowledge | Optional | Priors only (e.g. equal-gap motif) — never hard truth |
| Features / Recognition | Optional Evidence only | Never structural |

**Forbidden input as authority:** RawDesignDocument trees, CSS strings, exporter widgets.

---

# 5. Outputs (Q5)

| Output | Kind | Who writes | Notes |
|--------|------|------------|-------|
| Constraint Evidence | Evidence | Solver / layout proposers | `kind: feature|other`, refs like `layout.constraint.unsat` |
| Constraint / sizing Hypotheses | Hypothesis | Layout Rule Packs or solver proposers | Questions under `layout.*` |
| **Decisions** | DecisionRecord | **Decision Runtime only** | Relaxation choice, conflict sizing |
| **LayoutIR₁ (solved)** | IrSlice `layout-ir` | Facts plugin (layout project) | New slice; does not edit LayoutIR₀ |
| Solver report | Diagnostic Fact or report object | Layout module | Not a Decision |
| ConstraintIR | — | **Not recommended** as separate stage | See §7 |

### Ownership summary

Solver **proposes and projects**.  
Runtime **commits** interpretive relaxations.  
Workspace **stores** passively.

---

# 6. LayoutIR Immutability & ConstraintIR (required review)

## 6.1 Should LayoutIR remain immutable?

**Yes — each published LayoutIR slice is immutable** (same discipline as NDG Facts / IrSlices).

Reasons:

- Fingerprint stability (`layoutIrChecksum`)  
- Provenance (“what did Semantic see?”)  
- Idempotent rebuild  
- Multi-exporter reproducibility  

## 6.2 How does the solver “update” layout then?

**Re-projection, not mutation:**

```text
LayoutIR₀  (arrangement baseline; checksum A)
    │
    ▼ constraint wave + optional Decisions
LayoutIR₁  (solved projection; checksum B; cites LayoutIR₀ + decisionIds)
```

Both may coexist in Workspace. Downstream engines **pin LayoutIR₁** (or policy-selected latest solved). LayoutIR₀ retained for audit.

## 6.3 Separate ConstraintIR?

| Option | Verdict |
|--------|---------|
| **A. Embed solve in LayoutIR.payload** (`unsat`, `solvedSizing`, `relaxations`) | **Recommended** — Layout owns questions; one consumer surface for exporters |
| **B. New IR stage `constraint-ir`** | **Reject by default** — peer-engine smell; registry churn; Semantic would need two reads |
| **C. Internal-only ConstraintNetwork object** (never Workspace IR) | **Allowed** — working structure inside `compiler/layout/constraint/` | 

**Recommendation:** Internal ConstraintNetwork + **LayoutIR₁ payload extension**. No new public ConstraintIR contract unless a future audit proves LayoutIR overload (unlikely for 11b scope).

---

# 7. Data Model (conceptual)

### Internal ConstraintNetwork (not a Phase 1 contract)

```text
ConstraintNetwork {
  graphId
  layoutIrSliceId          // LayoutIR₀
  variables: [{ id, nodeId, axis|coord, domain }]
  constraints: [{
    id, kind,           // size_eq | size_ineq | pos | align | gap | parent_fit | …
    nodes, strength,    // required | strong | medium | weak
    source,             // ndg.attr | layout.mode | decision | policy
    evidenceRef?
  }]
}
```

### LayoutIR₁ payload additions (exporter-neutral)

```text
payload.constraintSolve: {
  fromLayoutIrSliceId,
  status: satisfied | relaxed | unsat | degraded,
  iterations,
  relaxations: [{ constraintId, action, decisionId? }],
}
payload.unsat: [{ nodeId, constraintId, reason, severity }]
payload.nodes[].sizing  // may reflect decided/solved annotation
payload.nodes[].boxSolve? // optional neutral solved box — NOT CSS
```

Still **no** `display:flex`, CSS, React, Flutter.

---

# 8. Compiler Pipeline (corrected)

The example pipeline in the task prompt is **almost right** but underspecified after the solver.

### Recommended

```text
NDG (structural SSOT)
        │
        ▼
Layout Interpretation (11a) → Evidence + Hypotheses (layout.mode, …)
        │
        ▼
Decision Runtime → committed layout Decisions + Traces
        │
        ▼
LayoutIR₀ project (arrangement baseline; immutable)
        │
        ▼
┌─────────────────────────────────────────┐
│ Constraint Solver (11b, Layout subsystem)│
│  build network → solve → Evidence        │
│  propose relax/sizing Hypotheses if needed│
└─────────────────────────────────────────┘
        │
        ▼
Decision Runtime (only if interpretive conflict) → commit relaxations
        │
        ▼
LayoutIR₁ project (solved; immutable; cites LayoutIR₀ + Decisions)
        │
        ▼
(later) Component / Token / Semantic / Responsive …
        │
        ▼
ResolvedIR → EmitPlan → exporters
```

### Explicitly wrong pipelines

| Wrong | Why |
|-------|-----|
| NDG → Solver → Layout | Arrangement mode unknown |
| LayoutIR₀ mutated by solver | Breaks immutability |
| Solver → ResolvedIR | Skips other domains + arbitration envelope |
| Solver → HTML | Emit coupling |

---

# 9. Interaction with Layout

| Rule | Detail |
|------|--------|
| Module home | `compiler/layout/constraint/` (or equivalent) under Layout |
| Mode ownership | 11a; solver **must not** flip `flow-row`→`absolute` without a Decision Hypothesis |
| Projection | Shared `projectLayoutIR` extended with solve context |
| Rule Packs | Optional `layout.constraint` proposers for relax candidates |
| Facts plugin | Publish LayoutIR₁ only |

---

# 10. Interaction with NDG

- **Read-only**  
- Boxes/attributes are Facts feeding variables  
- Never re-parent / never rebuild graph  
- Solved boxes (if any) live in LayoutIR₁ annotations, not NDG mutation  

---

# 11. Interaction with Decision Runtime (Q6–Q7)

| Concern | Owner |
|---------|--------|
| Detect conflict / unsat | Solver |
| Propose relaxations / alternate sizing | Layout constraint proposers |
| Rank / margin / abstain / fallback | **Decision Runtime** |
| Commit | **Decision Runtime** |
| Ambiguity | Surfaced by solver; **resolved by Runtime** |

Suggested questions (MINOR registry adds when implementing — not now):

- `layout.sizing` (already exists — refine under conflict)  
- `layout.constraint.relax` (which soft constraint to drop)  
- optionally `layout.overflow` under fit failure  

**Hard constraints** (physics impossibilities under Policy): may force `unsat` + abstain + **absolute-box fallback** Decision (pixel-faithful default).

---

# 12. Relaxation model (Q8)

### Principles

1. **Never silent** — every relaxation is Evidence + (if interpretive) Decision  
2. **Deterministic priority order** from Policy (not random)  
3. **Strength bands:** required > strong > medium > weak  
4. **Pixel-faithful:** prefer preserving NDG boxes; relax flow-fit before moving absolute children  
5. **Semantic-lean:** may prefer flow consistency over pixel boxes (still Decision-backed)  
6. **Abstain** when two equal-strength required constraints conflict and Policy forbids preference  
7. **Fallback:** absolute boxes from NDG `box` with `modeSource`/`solveStatus` recorded  

### Traceability

Each relaxation records: `constraintId`, `action`, `policyRule`, `decisionId?`, `evidenceId`.

---

# 13. Unsatisfied constraints (Q9)

Represented as:

1. **Evidence** — `ref: layout.constraint.unsat`, detail `{ constraintId, nodeIds, reason }`  
2. **LayoutIR₁.payload.unsat[]** — durable compile-visible list  
3. **Hypothesis/Decision** — only if a recoverable interpretive choice exists  
4. **Solver report** — aggregate counts / status  

Unsat is a **first-class outcome**, not an exception to swallow.

---

# 14. Determinism (Q10)

| Mechanism | Requirement |
|-----------|-------------|
| Fixed variable/constraint ordering | Sort by nodeId, constraintId |
| Fixed relax order | Policy table, stable sort |
| Iteration budget | Policy; timeout → degraded status + Evidence |
| Seed | Only if stochastic methods ever added — **prefer pure deterministic solver for 11b** |
| Fingerprint | Include solver version + LayoutIR₁ checksum + policy thresholds used |
| Idempotence | Same NDG + LayoutIR₀ + Decisions + Policy ⇒ same network + LayoutIR₁ |

**Ban** floating-point nondeterminism via unstable iteration order; use rational/fixed epsilon policy documented in solver.

---

# 15. Interaction with Policy

| Profile | Solver bias |
|---------|-------------|
| `pixel-faithful` | Preserve boxes; early absolute fallback; high abstain on flow invention |
| `semantic-lean` | Prefer satisfying flow constraints; still Decision for mode-changing relax |
| Budgets | Max constraints, max iterations, fail_closed vs best_effort |

---

# 16. Interaction with Knowledge

- Optional priors (equal gap, repeated peer) as Evidence weight **hints** only  
- No Knowledge mutation  
- No embedding CSS recipes in ontology  

---

# 17. Alternative Designs

### A — Peer Constraint Engine + ConstraintIR

- **Reject** — RFC-002 anti-pattern; ownership split from Layout  

### B — Mutate LayoutIR₀ in place

- **Reject** — immutability / fingerprint / audit failure  

### C — Solver only emits Evidence; never LayoutIR₁

- **Weak** — exporters lack a single solved spatial snapshot  
- **Reject** as sole design  

### D — Solver inside Decision Runtime

- **Reject** — Runtime must stay domain-agnostic  

### E — Recommended: Layout subsystem + LayoutIR₁ re-projection

- Internal network; Evidence/Hypotheses; Runtime commits; new immutable LayoutIR₁  

### F — Defer 11b until after Semantic

- **Reject** — Semantic/Responsive benefit from solved sizing; 11b should precede or at least precede Responsive  

---

# 18. Trade-offs

| Choice | Gain | Cost |
|--------|------|------|
| LayoutIR₁ vs ConstraintIR | One consumer API | LayoutIR payload grows |
| Immutable slices | Auditability | Multiple slice ids to manage |
| Decisions for relax | Explainability | More arbitration sessions |
| Pure deterministic solver | Goldens | Harder “best effort” physics |
| Pixel-faithful absolute fallback | Stability | Weaker flow fidelity |

---

# 19. Migration Strategy (when implementation authorized)

1. Keep 11a LayoutIR₀ path unchanged.  
2. Add `compiler/layout/constraint/` pure module (network build + solve).  
3. Optional Rule Pack `layout.constraint` for relax Hypotheses.  
4. Extend projector to emit LayoutIR₁ with `constraintSolve` + `unsat`.  
5. Kernel: `job.solveLayoutConstraints()` → optional arbitrate → `projectLayoutIR({ solved })`.  
6. Fingerprint LayoutIR₁; retain LayoutIR₀.  
7. Downstream docs: Semantic/Responsive consume LayoutIR₁ when present.  
8. **Do not** modify Decision Runtime algorithms.  

---

# 20. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Solver silently changes mode | High | Forbid mode writes without Decision |
| Non-deterministic float loops | High | Ordered iteration; epsilon policy; budgets |
| LayoutIR₀/₁ confusion | Medium | Explicit `constraintSolve.fromLayoutIrSliceId`; Kernel pin “active” slice |
| Scope creep into Responsive | Medium | No breakpoint questions in 11b |
| Peer ConstraintIR temptation | Medium | Architecture freeze: embed in LayoutIR |
| Performance on huge graphs | Medium | Partition later (Phase 28); budgets now |

---

# 21. Recommendations

1. **Authorize 11b as Layout Constraint Subsystem**, not a new engine.  
2. **Keep LayoutIR slices immutable**; publish **LayoutIR₁** for solved state.  
3. **Do not create ConstraintIR** as a registry stage for 11b.  
4. **Outputs:** Evidence + Hypotheses; Decisions via Runtime; LayoutIR₁ projection.  
5. **Pipeline:** after LayoutIR₀, before Semantic/Responsive/ResolvedIR.  
6. **Relaxation:** policy-ordered, traced, Decision-backed when interpretive.  
7. **Unsat:** Evidence + LayoutIR₁.unsat (+ abstain/fallback).  
8. **Determinism:** pure solver, stable ordering, fingerprint participation.  
9. **Implement nothing in this task** — proposal only.

### Direct answers checklist

1. **What?** Layout-owned constraint network + solve/relax/project service.  
2. **Owns?** Consistency, position/size/align constraints, unsat, relaxation proposals, LayoutIR solve fields.  
3. **Never?** Semantics, components, responsive strategy, animation, HTML/CSS, Runtime, NDG mutation.  
4. **Inputs?** NDG + LayoutIR₀ + layout Decisions + Policy (+ optional Evidence/Knowledge).  
5. **Outputs?** Evidence, Hypotheses, LayoutIR₁; Decisions only via Runtime.  
6. **Modify LayoutIR?** Not in place — **new immutable projection**.  
7. **Runtime?** Solver surfaces ambiguity; Runtime commits.  
8. **Relaxation?** Strength + policy order; Decision if interpretive; always traced.  
9. **Unsat?** Evidence + LayoutIR₁.unsat (+ optional Decision/abstain).  
10. **Determinism?** Ordered pure solve, budgets, fingerprint, idempotent LayoutIR₁.

---

# 22. Architecture Diagrams

## 22.1 Ownership

```text
┌──────────────────────────────────────────┐
│ Layout (compiler/layout)                 │
│  ┌─────────────┐   ┌──────────────────┐  │
│  │ Interpret   │   │ Constraint       │  │
│  │ (11a)       │   │ Subsystem (11b)  │  │
│  └──────┬──────┘   └────────┬─────────┘  │
└─────────┼───────────────────┼────────────┘
          │ Hypotheses        │ Evidence/Hypotheses
          ▼                   ▼
     Decision Runtime (sole commit)
          │
          ▼
     LayoutIR₀ / LayoutIR₁ (immutable slices)
```

## 22.2 Pipeline

```text
NDG ──► Interpret ──► Decisions ──► LayoutIR₀
                                      │
                                      ▼
                               Constraint Solver
                                      │
                        ┌─────────────┴─────────────┐
                        ▼                           ▼
                 Evidence/Hypotheses         (if needed)
                        │                           │
                        └──────────► Decisions ◄────┘
                                      │
                                      ▼
                                 LayoutIR₁
                                      │
                                      ▼
                          Semantic / Responsive / …
                                      │
                                      ▼
                                 ResolvedIR
```

---

## Document control

| Item | Value |
|------|--------|
| Implementation | **Forbidden by this task** |
| Phase 11b execution plan / code | **Not created** |
| Follow-up | Human authorization required before `PHASE_11B_EXECUTION_PLAN.md` or constraint module work |
