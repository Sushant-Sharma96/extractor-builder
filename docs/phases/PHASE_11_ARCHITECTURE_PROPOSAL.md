# Phase 11 Architecture Proposal — Layout Engine

| Field | Value |
|-------|--------|
| **Document type** | Architecture review / proposal only |
| **Date** | 2026-07-18 |
| **Status** | **Authorized & implemented** — see `PHASE_11_COMPLETION_REPORT.md` |
| **Code / Phase 11 created** | **None** |
| **Authority consulted** | RFC-001, RFC-002, IMPLEMENTATION_MASTER_PLAN, ARCHITECTURE_FREEZE_AUDIT, PHASE_08–10 docs (esp. PHASE_10_ARCHITECTURE_PROPOSAL / COMPLETION_REPORT) |
| **Role** | Lead compiler architect |

---

## Executive Summary

**Layout is the first interpretive domain engine** after the structural AST (NormalizedDesignGraph).

It answers: *how do these nodes arrange relative to each other in space?* — not *what UI pattern is this?* and not *which HTML tag to emit?*

### Verdict

| Question | Recommendation |
|----------|----------------|
| Consume what? | **NormalizedDesignGraph only** as structural authority; Features/Recognition as optional Evidence |
| Produce what? | **Evidence + Hypotheses/Candidates** → Decision Runtime commits; plus deterministic **LayoutIR** projections (Facts / IrSlice) |
| Who commits? | **Decision Runtime only** |
| Architecture shape? | **Domain module `compiler/layout/` + Phase 6 plugins** (facts + proposers / Rule Packs) — **not** a second framework, **not** Rule-Packs-only |
| Master Plan Phase 11? | Keep intent; **split XL scope**; rename away from “Refactor”; defer sticky perfection & full grid solver |
| Before Layout? | **Nothing new required** — NDG exists. Optional hardening: retire transitional `source.node` dual path |
| Merge with another phase? | **No** — do not merge Responsive, Semantic, or Component into Layout |

**LayoutIR must be exporter-neutral.** HTML/CSS Flexbox is one lowering of LayoutIR, not Layout itself.

---

# 1. Current Architecture Review

## 1.1 What exists (frozen)

```text
Contracts → Kernel → Workspace → Decision Runtime → Policy
         → Plugins → Knowledge → Rule Packs
         → Features / Recognition (proposals)
         → NormalizedDesignGraph (structural SSOT)
```

| Asset | Role today |
|-------|------------|
| NDG | Stable ids, hierarchy, geometry **data**, visibility |
| Phase 9 | Feature bags + block-level recognition Candidates |
| Decision Runtime | Sole rank / arbitrate / commit |
| LayoutIR stage | Registered envelope only — **empty of domain meaning** |
| Questions | `layout.mode`, `layout.sizing` already in registry |

## 1.2 What is missing (the Layout gap)

- No interpretation of auto-layout vs absolute vs mixed  
- No stacking / overflow / alignment Decisions  
- No constraint subsystem  
- No LayoutIR payload  
- Recognition “stack/grid” labels are **not** layout compilation  

## 1.3 Roadmap tensions to challenge

| Master Plan / RFC phrasing | Architect note |
|----------------------------|----------------|
| “Layout Engine **Refactor**” | Misleading in `compiler/` — there is no brain Layout yet. Prefer **Layout Engine (v1)** |
| Constraint Solver as peer engine (RFC-001 §5) | RFC-002 already corrected: **subsystem of Layout** — adopt that |
| Phase 11 Complexity **XL** | Too large for one implementation gate — **split** (see §Alternatives) |
| Dual-run vs legacy `server/build.js` as exit criterion | Product cutover concern; **optional** for brain Phase 11a; do not block LayoutIR |
| Recognition already says “stack/grid” | Must not become silent Layout Decisions |

---

# 2. Layout Definition

**Layout** is the compile domain that turns **structural geometry + hierarchy + source layout signals** into an **exporter-neutral spatial arrangement model**, under explicit uncertainty where interpretation is required.

### Formal split

| Kind | Example | Representation |
|------|---------|----------------|
| **Layout Fact** | Node has `layoutMode=HORIZONTAL` in source attributes | Immutable Fact / NDG attribute (already mostly present) |
| **Layout Decision** | “Treat this container as flow-row rather than absolute overlay” | Hypothesis → Decision Runtime commit |
| **Layout projection** | Solved/participating child order, axis, gap binding for IR | LayoutIR slice (deterministic given Decisions + Facts) |

**One-line definition:**  
Layout owns *arrangement physics and interpretation*; it does not own *meaning, tags, or bytes*.

---

# 3. Ownership

## 3.1 What Layout owns

| Concern | Notes |
|---------|--------|
| Container arrangement mode | flow-row, flow-column, grid-like, absolute, mixed |
| Child participation | in-flow vs out-of-flow / absolute child |
| Alignment & distribution | primary/cross axis align, packing |
| Spacing model | gap, padding as layout parameters (data → binding questions when ambiguous) |
| Sizing interpretation | hug / fill / fixed — as **questions**, not silent CSS |
| Wrapping | wrap vs nowrap candidates when signaled |
| Stacking / z / overlay | stacking context questions where needed |
| Overflow | clip / scroll / visible interpretation candidates |
| Nested & mixed layouts | per-node mode; parent≠child modes allowed |
| Constraint subsystem | size/position constraint satisfaction **owned by Layout** |
| LayoutIR | specialized IR envelope payload for arrangement |
| Layout Evidence | rule hits, geometry features, near-misses |

## 3.2 What Layout must NEVER own

| Forbidden | Owner instead |
|-----------|----------------|
| Components / instances / variants | Component Engine |
| Semantic roles, landmarks, Hero/Navbar | Semantic Engine + Knowledge packs |
| HTML/CSS/JS tags & class strategies | Lowering / Emit |
| Accessibility names/roles | A11y Engine |
| Animation / interaction authorization | Behavior / Animation engines |
| Responsive breakpoints & media strategies | Responsive Engine (consumes Layout + constraints) |
| Token identity / theme binding | Token Engine |
| Ranking / arbitration / Decision commit | Decision Runtime |
| Structural identity / hierarchy rebuild | NDG (Phase 10) |
| Knowledge mutation | Knowledge (immutable) |
| Raw Figma tree as private SSOT | Forbidden — NDG only |

---

# 4. Responsibilities (Phase 11 scope recommendation)

## In scope (recommended Phase 11a — Layout Interpretation Core)

1. Read NDG (+ optional Feature/Recognition Evidence)  
2. Emit layout Evidence  
3. Propose Hypotheses for `layout.mode`, `layout.sizing`, and minimal stacking/overflow questions  
4. Materialize **LayoutIR** IrSlice from Facts + **committed** Decisions (or conservative Fact-only baseline under policy)  
5. Fingerprint layout pack/engine versions  
6. Preserve provenance: every layout claim cites NDG node ids + Evidence  

## In scope but phased (recommended Phase 11b — Constraint Subsystem)

1. Constraint network from NDG geometry + parent constraints attributes  
2. Solve / relax with traced priorities  
3. Feed sizing/position consistency Evidence; abstain → absolute-box fallback Decision  

## Explicitly deferred

- Sticky/fixed viewport perfection  
- Full CSS Grid parity  
- Responsive strategy (Phase 15)  
- Dual-run vs production legacy HTML path (optional shadow job later)  
- EmitPlan / HTML  

---

# 5. Inputs

| Input | Authority | Use |
|-------|-----------|-----|
| **NormalizedDesignGraph** / `ndg.node` | **Structural SSOT — required** | Subjects, hierarchy, boxes, attributes |
| NDG attributes (`layoutMode`, padding, gap, constraints, positioning) | Facts (data) | Primary signals |
| Phase 9 Features | Derived Evidence only | Enrichment |
| Phase 9 Recognition (`stack`, `grid`, …) | **Candidates only** | Soft Evidence; never sole accept under strict policy |
| Knowledge | Read-only motifs / priors | Cite ids in Evidence |
| Policy | Thresholds, allowlists, `pixel-faithful` vs `semantic-lean` | Cap confidence; choose conservatism |

### Q4 answer (authoritative)

**Layout must consume NormalizedDesignGraph only as structural truth.**

Raw nodes: **no** (bypasses AST).  
Features/Recognition: **yes as Evidence**, never as identity/hierarchy authority.

Rationale: multi-engine consistency, provenance, multi-exporter identity, and Phase 10 success criteria.

---

# 6. Outputs

| Output | Kind | Owner of persistence |
|--------|------|----------------------|
| Layout Evidence | Evidence | Layout proposers via plugin/RuleContext |
| Layout Hypotheses / Candidates | Hypothesis | Layout proposers |
| **Committed Layout Decisions** | DecisionRecord + Trace | **Decision Runtime only** |
| LayoutIR IrSlice | Specialized IR | Layout facts/projection step (plugin `facts` or post-arbitrate projector) |
| Optional `layout.*` Facts | Fact | Only for **deterministic projections**, not interpretations |
| Layout report | Diagnostic | Like NDG report — not a Decision |

### Q5 answer

Layout **creates Evidence + Hypotheses**.  
Layout **may project LayoutIR Facts/IrSlice** after arbitration (or Fact-only baseline).  
Layout **never self-commits Decisions**.  
Layout **does not write ResolvedIR** (later multi-domain commit envelope).

---

# 7. Data Model (LayoutIR — conceptual)

Reuse existing stage `layout-ir` + `SpecializedIrEnvelope`. **Do not invent a parallel graph schema.**

Recommended payload shape (domain fill — future implementation):

```text
LayoutIR.payload {
  graphId                 // NDG link
  nodes: [{
    nodeId,               // NDG id
    mode,                 // decided or fact-baseline
    modeSource,           // fact | decision | fallback
    axis,                 // horizontal | vertical | none
    wrap,
    alignMain, alignCross,
    gap, padding,
    sizing: { horizontal, vertical },
    positioning,          // relative | absolute
    overflow,
    stackingKey,
    childOrder: [nodeId…], // in-flow order
    outOfFlow: [nodeId…],
    decisionIds: [],      // provenance
    evidenceIds: []
  }]
  mixedRegions: [{ parentId, modes: [...] }]
  unsat: [{ nodeId, reason, relaxation }]
}
```

**Exporter-neutral vocabulary:** prefer `flow-row` / `absolute` / `grid-track` over `display:flex`.

---

# 8. Compiler Pipeline

```text
Policy + Knowledge + RulePacks pinned
        │
        ▼
NormalizedDesignGraph (structural SSOT)
        │
        ├─ (optional) Feature / Recognition Evidence
        │
        ▼
┌──────────────────────────────────────────────┐
│ Layout Engine                                │
│  • read NDG                                  │
│  • emit Evidence                             │
│  • propose layout.* Hypotheses               │
└──────────────────────────────────────────────┘
        │
        ▼
Decision Runtime  ← sole committer of layout Decisions + Traces
        │
        ▼
LayoutIR projector (deterministic given NDG + Decisions)
        │
        ▼
(later) Component / Token / Semantic / Responsive …
        │
        ▼
ResolvedIR → EmitPlan → exporters (HTML, React, …)
```

---

# 9. Interaction with NDG

| Rule | Detail |
|------|--------|
| Subjects | Always NDG node ids |
| Hierarchy | Never re-parent privately; if layout needs different participation, record in LayoutIR (`outOfFlow`), don’t mutate NDG |
| Geometry | Boxes remain Facts; Layout interprets *how to use* them |
| Provenance | LayoutIR `nodeId` ↔ NDG `id` ↔ `sourceNodeId` |

**Invariant:** Layout that rebuilds a tree from RawDesignDocument is an architecture defect.

---

# 10. Interaction with Decision Runtime

### Q6 answer

| Role | Owner |
|------|-------|
| Propose competing arrangement answers | Layout |
| Retain ambiguity (multi-candidate) | Layout Hypotheses |
| Score / rank / margin / abstain / fallback | **Decision Runtime** |
| Commit winners + traces | **Decision Runtime** |
| Policy thresholds (`accept_min`, `pattern_name_cap`, …) | Policy → Runtime |

**Ambiguity ownership:** Layout *surfaces* it; Runtime *resolves or abstains*.  
**Silent absolute→flex:** forbidden — must be a Decision (or explicit Fact-only baseline under a named policy mode).

Recommended layout questions (initial set — registry already has first two):

- `layout.mode`  
- `layout.sizing`  
- (MINOR adds later) `layout.overflow`, `layout.stacking`, `layout.childParticipation`

---

# 11. Interaction with Rule Packs

| Mechanism | Use |
|-----------|-----|
| Rule Packs / proposer plugins | Pattern-ish layout cues, name-capped heuristics, Evidence packaging |
| `compiler/layout/` module | Pure deterministic geometry predicates + constraint subsystem |
| Facts plugin | LayoutIR publish / baseline Fact projections |

**Do not** encode the solver as opaque Rule Pack spaghetti.  
**Do not** forbid Rule Packs from proposing layout Candidates — they must remain capability-scoped proposers.

---

# 12. Interaction with Knowledge

- Read motifs / feature_defs / priors (e.g., equal gap, repeated peers)  
- Cite ontology ids on Evidence  
- **Never** mutate Knowledge  
- Layout does not dump CSS recipes into Knowledge  

---

# 13. Interaction with Policy

| Profile intent | Layout behavior |
|----------------|-----------------|
| `pixel-faithful` | Prefer absolute/box-preserving candidates; high abstain→absolute fallback |
| `semantic-lean` | Allow flow interpretation at lower margins (still Decision-backed) |
| `static-ok` / interactive | Mostly orthogonal; Layout must not authorize JS |

Name-only layout cues (if any) capped by `pattern_name_cap`.

---

# 14. Future Exporters (Q8)

```text
LayoutIR (neutral)
    │
    ├─ HTML/CSS lowering     → display/flex/grid/position
    ├─ React/CSS-in-JS       → same spatial model, different syntax
    ├─ Flutter               → Row/Column/Stack/Positioned
    ├─ Native                → AutoLayout / ConstraintKit mappings
    ├─ PDF                   → fixed boxes / flow frames
    └─ Email                 → table/stack fallbacks under policy
```

**Coupling ban:** Layout must not emit `display:flex` strings or React elements.  
Exporters consume LayoutIR + ResolvedIR + Policy.

---

# 15. Nested & Mixed Layouts (Q9)

| Case | Representation |
|------|----------------|
| Nested same mode | Parent and child each have LayoutIR node entries; child participates in parent `childOrder` |
| Nested different modes | Allowed; e.g., absolute parent + flow child |
| Mixed siblings | Some in-flow, some absolute → `childOrder` + `outOfFlow` |
| Grid suspicion | Multi-candidate (`grid` vs `flow-wrap` vs `absolute`); Runtime decides or abstains |
| Recognition “grid” | Evidence only until Decision |

**No global page layout mode.** Layout is **node-local** with parent/child consistency checks as Evidence (conflicts → abstain/fallback).

---

# 16. Provenance, Traceability, Determinism (Q10)

| Property | Mechanism |
|----------|-----------|
| Provenance | NDG ids on every Candidate subject; Evidence refs; Decision `trace_refs` |
| Traceability | DecisionTrace after commit; Layout report for projections |
| Determinism | Same NDG checksum + Knowledge + RulePacks + Policy + seed ⇒ same Hypotheses & LayoutIR |
| Fingerprint | Include layout engine/pack versions + LayoutIR checksum when projected |
| Idempotence | Re-project LayoutIR identical under same Decisions |

---

# 17. Architecture Diagrams

## 17.1 Ownership diagram

```text
                    ┌─────────────┐
                    │   Policy    │
                    └──────┬──────┘
                           │ thresholds
                           ▼
┌──────────┐  read   ┌─────────────┐  propose  ┌──────────────────┐
│   NDG    │────────►│   Layout    │──────────►│ Decision Runtime │
│ (Facts)  │         │  module +   │           │  rank/arbitrate  │
└──────────┘         │  proposers  │◄──────────│  commit/traces   │
                    └──────┬──────┘  commit    └────────┬─────────┘
                           │                            │
                           │ project                    │ winners
                           ▼                            ▼
                    ┌─────────────┐              ┌─────────────┐
                    │  LayoutIR   │◄─────────────│ Decisions   │
                    └─────────────┘              └─────────────┘
```

## 17.2 Multi-exporter

```text
NDG ──► Layout Decisions ──► LayoutIR ──► ResolvedIR ──► EmitPlan
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                       HTML                 Flutter              Email
```

---

# 18. Alternative Designs

### A — Master Plan monolith (“Layout Engine Refactor” XL)

One phase: interpretation + full constraints + sticky + dual-run legacy.

- **Pros:** Single milestone narrative  
- **Cons:** Un-reviewable blast radius; delays LayoutIR for Semantic  
- **Verdict:** **Reject as single gate**

### B — Rule Packs only

All layout as packs; no `compiler/layout/` module.

- **Pros:** Uniform plugin story  
- **Cons:** Solver/geometry predicates become untestable mush  
- **Verdict:** **Reject**

### C — Dedicated free-floating “LayoutEngine” framework

New lifecycle parallel to Plugins.

- **Pros:** Familiar engine naming  
- **Cons:** Violates Phase 6 freeze; second framework  
- **Verdict:** **Reject**

### D — Skip Layout; Semantic next

- **Pros:** Faster “tags” demos  
- **Cons:** Semantic without arrangement truth; exporter hell  
- **Verdict:** **Reject**

### E — Merge Layout + Responsive

- **Pros:** One spatial story  
- **Cons:** Confuses present arrangement vs breakpoint strategy; RFC separates them  
- **Verdict:** **Reject merge**

### F — Recommended: Split Layout into 11a / 11b under one architecture

| Sub-phase | Name | Deliverable |
|-----------|------|-------------|
| **11a** | Layout Interpretation Core | `layout.mode` / sizing Hypotheses + Runtime commits + LayoutIR baseline |
| **11b** | Constraint Subsystem | Solver/relax + sizing consistency + unsat fallbacks |

Shared module `compiler/layout/`; still “Phase 11” programmatically, two exit gates.

### G — Fact-only Layout (no Decisions)

Always copy source `layoutMode` into LayoutIR.

- **Pros:** Simple  
- **Cons:** Violates RFC-002 (interpretations are Decisions); fails mixed/absolute reality  
- **Verdict:** Allowed only as **explicit Policy degraded mode**, not the architecture  

---

# 19. Trade-offs

| Choice | Gain | Cost |
|--------|------|------|
| NDG-only structural input | Consistency | Must finish transitional `source.node` migration |
| Split 11a/11b | Ship interpretable LayoutIR earlier | Two completion reports |
| Neutral LayoutIR | Multi-exporter | Extra lowering work later |
| Recognition as Evidence | Reuse Phase 9 | Risk of over-trust — mitigate with policy caps |
| Defer sticky/grid perfection | Finish core | Temporary pixel gaps under waiver |
| Dual-run legacy optional | Faster brain progress | Product HTML may diverge until cutover |

---

# 20. Migration Strategy

1. **Pre-req:** Call sites materialize NDG before Layout (mark `source.node`-only as degraded in fingerprint).  
2. **11a:** Introduce `compiler/layout/` predicates + layout Rule Packs/proposers; wire Kernel invoke; Runtime commits; LayoutIR projector.  
3. **Shadow (optional):** Compare LayoutIR to legacy analyze tree metrics — not a hard brain exit.  
4. **11b:** Constraint subsystem behind same module API.  
5. **Consumers:** Semantic/Responsive read LayoutIR + Decisions; never raw heuristics.  
6. **Do not** change Decision Runtime ownership.

---

# 21. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Layout silently emits CSS | High | Ban stringly CSS in LayoutIR; contract review |
| Recognition→Decision bypass | High | Caps; Evidence kinds; Runtime margins |
| Solver thrash / non-determinism | High | Budgets; seed; relax order fixed; fingerprint |
| Mutating NDG hierarchy | High | Read-only NDG; outOfFlow in LayoutIR only |
| XL scope slip | High | Enforce 11a/11b gates |
| Coupling to `server/build.js` | Medium | Keep dual-run optional |
| Premature Responsive creep | Medium | Separate questions (`responsive.*`) |

---

# 22. Recommendations

## Authorize when ready (documentation → later implementation)

**Phase 11 program: Layout Engine**

1. **Rename** Master Plan “Refactor” → **Layout Engine (Interpretation + Constraint Subsystem)**.  
2. **Split delivery:** **11a Interpretation Core**, then **11b Constraints**.  
3. **Structural input:** NDG only.  
4. **Outputs:** Evidence + Hypotheses; Runtime commits; LayoutIR projection.  
5. **Shape:** `compiler/layout/` + Phase 6 plugins / Rule Packs — **no new framework**.  
6. **Constraint Solver:** subsystem of Layout (RFC-002), not peer engine.  
7. **Exporters:** LayoutIR neutral; no HTML in Phase 11.  
8. **Do not** merge Responsive/Semantic/Component into Layout.  
9. **Do not** implement Phase 11 in this proposal task.

## Direct answers (checklist)

1. **What is Layout?** Arrangement interpretation + LayoutIR projection over NDG.  
2. **Owns?** Mode, flow/grid/absolute/mixed, align/distribute/spacing, sizing questions, stacking/overflow, constraints subsystem, LayoutIR.  
3. **Never owns?** Components, semantics, tags, a11y, animation, responsive strategy, tokens, Decision commit, NDG rebuild.  
4. **Consume?** **NDG only** structurally; Features/Recognition as Evidence.  
5. **Create?** Evidence, Hypotheses, LayoutIR/Facts projections; Decisions only via Runtime.  
6. **Runtime?** Layout proposes; Runtime owns ambiguity resolution & commit.  
7. **Architecture?** Domain module + plugins/packs — not Rule-Packs-only, not new engine framework.  
8. **Exporters?** Neutral LayoutIR → per-exporter lowering.  
9. **Nested/mixed?** Per-node LayoutIR; `childOrder` + `outOfFlow`.  
10. **Provenance/determinism?** NDG ids, Evidence, Traces, fingerprint, idempotent project.

## Roadmap change summary

| Keep | Change |
|------|--------|
| Layout before Semantic/Responsive | Split Phase 11 into 11a/11b |
| Constraints under Layout | Drop “Refactor” framing for brain |
| Decision protocol for interpretation | Make legacy dual-run optional |

---

## Document control

| Item | Value |
|------|--------|
| Implementation | **Forbidden by this task** |
| Phase 11 execution plan / code | **Not created** |
| Follow-up | Human authorization required before `PHASE_11_EXECUTION_PLAN.md` or any `compiler/layout/` work |
