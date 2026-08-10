# FINAL ARCHITECTURE AUDIT & FREEZE REVIEW  
## Phases 1–11b (Post Constraint Solver)

| Field | Value |
|-------|--------|
| **Document type** | Permanent architecture freeze audit |
| **Date** | 2026-07-18 |
| **Role** | Senior Compiler Architect / System Auditor |
| **Code modified** | **None** |
| **Scope** | Contracts, Kernel, Workspace, Decision, Policy, Plugins, Knowledge, Rule Packs, Features, NDG, Layout 11a, Constraint 11b |
| **Authority** | `docs/CURRENT_TRUTH.md` + Foundation Freeze v1 |
| **Superseded for status by** | `CURRENT_TRUTH.md` / `ARCHITECTURE_LOCK_CONTRACT.md` (this audit remains hardening authority) |

---

# Executive Summary

Phases 1–11b deliver a **coherent compiler constitution** with mostly clean ownership:

**Contracts → Kernel → Workspace → Decision Runtime → Policy → Plugins → Knowledge → Rule Packs → Features/Recognition → NDG → LayoutIR₀ → Constraint → LayoutIR₁**

The architecture **does not need a redesign** to start Phase 12 (Component Engine). Decision Runtime remains domain-agnostic. Constraint is correctly a Layout subsystem (no ConstraintIR / ConstraintEngine). LayoutIR slices are immutable. NDG is structural SSOT and is not mutated by Layout.

**This audit does not rubber-stamp excellence.** Several issues will become expensive if ignored:

1. **Contract schema drift** — live `CompileJobFingerprint` fields are rejected by `job-fingerprint.json` (`additionalProperties: false`). Determinism is implemented; the Phase 1 contract no longer describes reality.
2. **No active LayoutIR pin** — LayoutIR₀ and LayoutIR₁ share `stageId: layout-ir`; loaders “last wins” without an explicit active pointer. Downstream engines will guess wrong.
3. **Dual structural / dual proposal paths** — `source.node` vs NDG; IrSlice vs Fact.payload; constraint pack re-solve vs `facts.layout.constraint`. SSOT discipline is documented, not enforced.
4. **Documentation rot** — stale “awaiting approval / not authorized / Phase 11b not implemented” footers contradict completion reports. Auditors will trust the wrong page.
5. **No `compile()`** — the brain is a kit of Kernel methods. Correct for now; dangerous when Phase 12+ assumes an orchestrated pipeline that does not exist.
6. **Constraint solver is thin** — parent-fit / overflow / gap / padding / absolute bounds exist; full alignment, distribution, and hard “required” physics are under-built relative to the proposal’s ambition.

**Verdict:** Architecture is **stable enough to freeze as constitution** and **proceed to Phase 12 with conditions**. Do not declare “excellent and finished.”

---

# Scores

| Dimension | Score | Rationale (short) |
|-----------|------:|-------------------|
| **Architecture** | **8.2 / 10** | Ownership holds; Constraint under Layout; Decision monopoly intact. Dual-SSOT and missing active-slice prevent 9+. |
| **Code Quality** | **7.5 / 10** | Clear modules; dead constants; duplicated load paths; Facts plugin also writing Hypotheses. |
| **Implementation fidelity** | **7.8 / 10** | Matches 11b proposal spine; solver coverage thinner than proposal language; pack/plugin dual path. |
| **Wiring** | **7.0 / 10** | Lazy plugin register; caller-ordered pipeline; dual `registerEngine`/`registerPlugin`. |
| **Testing** | **7.0 / 10** | Strong per-phase suites; weak E2E Raw→LayoutIR₁, malformed graphs, multi-slice ambiguity. |
| **Documentation** | **6.5 / 10** | Volume high; status headers and footers contradict; schema docs lag code. |
| **Maintainability** | **7.5 / 10** | Boundaries help; SSOT duality and doc drift hurt onboarding. |
| **Scalability** | **7.0 / 10** | Fine for mid-size; Fact payload copies + O(nodes×constraints) + no partition story. |
| **Determinism** | **8.5 / 10** | Sorted IDs, frozen slices, fingerprint participation; float epsilon + schema drift remain. |
| **Overall Grade** | **B+ (7.6 / 10)** | **Ship constitution; fix conditions before trusting production dual-run.** |

---

# Architecture Audit

## What is still clean

| Boundary | Status | Evidence |
|----------|--------|----------|
| Decision Runtime sole committer | **Held** | `compiler/decision/` has no layout/ndg domain logic; packs/plugins propose only |
| Knowledge immutable / no reasoning | **Held** | Phase 7 design + handles |
| Workspace passive store | **Held** | No ranking in Workspace |
| NDG structural SSOT | **Held** | Layout/constraint read-only; Workspace Fact immutability |
| Layout owns arrangement + constraint | **Held** | `compiler/layout/` + `constraint/`; no peer ConstraintEngine |
| No ConstraintIR stage | **Held** | Absent from `ir-stages.json`; LayoutIR₁ embeds solve |
| Exporter-neutral LayoutIR | **Held** | Modes like `flow-row`; no CSS `display:` in IR vocabulary |
| Kernel hub without UI ontology | **Held** | Job APIs, fingerprint, budgets |

## Hidden coupling / smells

| Smell | Severity | Why it matters |
|-------|----------|----------------|
| LayoutIR Fact embeds full `payload` | **Medium** | Dual SSOT with IrSlice; pack path depends on Fact blob size |
| Rule packs blank IrSlice, force Facts rebuild | **Medium** | Packs never see canonical IrSlice graph; divergence risk |
| `facts.layout.constraint` writes Evidence **and** Hypotheses | **Low–Medium** | Blurs Facts-plugin vs Rule-Pack proposer roles (works, but extension model muddy) |
| LayoutIR₀/₁ same `stageId` | **Medium** | Consumers must sniff `constraintSolve`; no type system help |
| Kernel lazy-registers facts plugins | **Low** | Implicit dependency; schedules may miss undeclared plugins |
| Dual `registerEngine` + `registerPlugin` | **Medium** (known since Freeze Audit) | Two registries for “engines” — Phase 12 will amplify confusion |
| Phase 9 before Phase 10 historically | **Medium** (acknowledged) | Recognition still transitional on `source.node` patterns |

## Engine smell check

| Temptation | Present? |
|------------|----------|
| ConstraintEngine / ConstraintFramework | **No** |
| GraphEngine / second AST | **No** |
| ConstraintIR peer stage | **No** |
| Layout becoming Semantic | **No** |
| Decision owning layout heuristics | **No** |
| Solver silently flipping modes | **Guarded** (annotate fallback; mode change requires Decision) |

## Subsystem power check

- **Layout + Constraint** is the largest domain module so far. Acceptable: RFC-002 places Constraint under Layout.
- Risk: Layout becomes a dumping ground for “anything spatial.” **Freeze rule:** Responsive breakpoints stay Phase 15; Component instances stay Phase 12; Semantic stays Phase 14.

## Missing abstractions (real)

1. **Active IR pin** (which LayoutIR slice is “current” for the job).  
2. **Pipeline orchestrator** (ordered wave runner with gates) — not `compile()` emit, but a brain schedule.  
3. **Fingerprint contract versioning** aligned with live fields.  
4. **Single NDG load API** used by packs and facts plugins alike (IrSlice-capable rule context or shared loader with explicit prefer).

---

# Code Review

## Folder structure

```text
compiler/
  kernel/ workspace/ decision/ policy/ plugin/ knowledge/ rulepack/
  features/ ndg/ layout/ layout/constraint/ test/
```

**Good:** Domain modules mirror phases. Constraint lives under Layout.  
**Weak:** Suggested `constraint/network|solver|projector|diagnostics/` as directories became flat files — fine for size today; will need split when solver grows.  
**Dead / unused:** `layout/constants.js` re-exports `FACT_KIND_NDG_*` unused (collect correctly imports `ndg/constants`).

## Naming

| Name | Verdict |
|------|---------|
| `facts.layout.constraint` | Acceptable (facts plugin publishing solved IR) |
| `solveLayoutConstraints` | Clear Kernel verb |
| `layout.ir` Fact kind for both₀/₁ | **Weak** — rely on `assertion.solved` / factId suffix |
| `features.normalize` vs NDG “normalization” | **Collision risk** — document heavily or rename later |

## Complexity / over- vs under-engineering

| Area | Assessment |
|------|------------|
| Decision / Plugin / Workspace | Appropriately strict |
| Constraint network kinds | **Under-engineered** vs proposal (alignment/distribution sparse) |
| LayoutIR Fact payload duplication | **Slight over-copy** for pack convenience |
| No ConstraintIR | Correct anti-over-engineering |

## Hidden coupling (code)

- Constraint materialize ↔ DecisionRecord shape assumptions (`winner.kind === 'candidate'`).  
- Fingerprint rebuild helper in Kernel duplicates field lists — easy to drop a new field on one path.  
- Pack handlers reconstruct Workspace proxies manually (fragile).

---

# Implementation Review

## Matches architecture?

| Proposal claim | Implementation | Gap |
|----------------|----------------|-----|
| Constraint = Layout subsystem | Yes | — |
| Internal ConstraintNetwork only | Yes | — |
| LayoutIR₁ new slice | Yes | — |
| Never silent relax | Mostly (Evidence on auto-drop) | Interpretive path needs Decision; auto-drop of weak is policy-traced, OK |
| Solver never commits | Yes | — |
| Provenance on solved | Yes (NDG, baseline, evidenceIds, decisionIds, traceIds slot) | Trace IDs often empty unless caller passes |
| Fingerprint solver fields | Yes in Kernel | **Schema contract false** |

## Shortcuts / temporary code

| Item | Nature |
|------|--------|
| `source.node` dual ingest | Explicit transitional (Phase 10) |
| LayoutIR payload on Fact | Convenience for packs lacking IrSlice read |
| 1px epsilon parent-fit | Documented heuristic, not rational arithmetic |
| `maxRelaxations` / soft strengths | Pragmatic, not full CSP |
| `allowSolvedAsBaseline` escape | Test/power hatch — dangerous if misused |

## What should be refactored (not redesign)

1. Unify NDG load for packs (allow IrSlice or pin graphId).  
2. Sync `job-fingerprint.json` with live fields (or version suite).  
3. Remove unused Layout NDG fact-kind aliases.  
4. Fix contradictory Phase 11 completion footer.  
5. Prefer one authoritative hypothesis path (pack **or** constraint facts plugin — not both by default).

---

# Pipeline Review

## Claimed vs actual

```text
Raw / source.node (transitional)
  → NDG (structural SSOT)                    [Kernel materializeNormalizedDesignGraph]
  → Features → Evidence                      [Rule packs; optional]
  → Recognition → Hypotheses                 [Rule packs; optional]
  → layout.interpret → Evidence/Hypotheses   [Pack]
  → Decision Runtime (optional)              [arbitrate]
  → LayoutIR₀                                [projectLayoutIR]
  → layout.constraint proposers (optional)   [Pack]
  → Decision Runtime (optional relax)        [arbitrate]
  → LayoutIR₁                                [solveLayoutConstraints]
  → (future) Component / Token / Semantic / Responsive / …
  → ResolvedIR → EmitPlan → Artifacts        [NOT IMPLEMENTED]
```

## Transition correctness

| Transition | Correct? | Notes |
|------------|----------|-------|
| Raw → NDG | Yes | Collapse policy traced |
| Features before/after NDG | **Ambiguous** | Ideal: after NDG; packs prefer `ndg.node` but history allows source |
| Recognition as Evidence only | Yes | Low-level only |
| Layout before Constraint | Yes | Enforced by requiring LayoutIR₀ |
| Constraint before Semantic | Yes (by roadmap) | Not yet tested with Semantic |
| Bypass to HTML | Forbidden | Still true in compiler brain |

## Wrong pipelines (still possible if caller errs)

- Call `solveLayoutConstraints` without LayoutIR₀ → fail closed (good).  
- Run recognition as structural authority → **not prevented by type system** (policy/docs only).  
- Treat LayoutIR₀ as solved → load helper can return baseline; fingerprint may still hold old solved ids if re-projected oddly.

---

# Wiring Review

## Kernel

- Job methods compose the pipeline; **no automatic wave scheduling** for domain phases.  
- `runEmpty` is a Phase 2 skeleton — must not be mistaken for compile.  
- Fingerprint updates on NDG / LayoutIR₀ / LayoutIR₁ — good.  
- Lazy registration of `facts.ndg.*` / layout plugins — works; obscures required plugin set.

## Plugins / Rule Packs

- Capability model is real (forbidden Decision writes on packs).  
- Five packs: synthetic, feature, recognition, layout.interpret, layout.constraint.  
- Pack dependency graph is weak (Phase 8 debt).

## Initialization / order

Caller must know the order. **This is the #1 wiring risk for Phase 12:** Component Engine authors will invent their own order unless Kernel gains an explicit schedule document or runner.

## Unnecessary coupling

- Constraint Facts plugin duplicates proposers that packs also provide.  
- Publishing full LayoutIR on Facts couples storage size to pack capability gaps.

---

# Plugin Review

| Concern | Assessment |
|---------|------------|
| Capability contract | Sound; still `try_catch` isolation only (no process sandbox) |
| Facts plugins | Correct for NDG / LayoutIR publish |
| `facts.layout.constraint` Hypothesis writes | **Smell** — prefer Rule Pack for Hypotheses long-term |
| Extension model | Add packs + facts plugins; do not add frameworks |
| Future Component Engine | Should be `facts.component.*` + packs — fits if dual-registry cleaned |

---

# Workspace Review

| Concern | Assessment |
|---------|------------|
| Immutability of Facts/IrSlices | Strong (duplicate identity with different content fails) |
| Multiple LayoutIR slices | Allowed; **no active pin** |
| Evidence / Hypotheses / Decisions / Traces | Present; Trace durability improved vs early audit |
| Reports | Embedded in Fact assertions / solver report objects — OK for now |
| Versioning | suiteVersion checks exist; fingerprint schema lag undermines suite story |
| Scalability | Full payload Facts will hurt large documents |

---

# Decision Runtime Review

| Invariant | Status |
|-----------|--------|
| Owns ranking / arbitration / commit / traces | **Held** |
| No domain intelligence | **Held** |
| Layout questions opaque strings | **Held** (`layout.mode`, `layout.constraint.relax`, …) |
| Solver never commits | **Held** |
| Trace refs on LayoutIR₁ | Slot exists; often empty unless passed |

**Violation risk:** Auto-relax of weak constraints without Decision is **policy-traced Evidence**, not a Decision. Architecture allows this for non-interpretive drops; keep the bar clear — any mode-changing or strong interpretive relax **must** go through Runtime (currently hypothesized). Do not expand auto-drop to strong/required without Decision.

---

# Data Model Review

| Artifact | Redundancy / gap |
|----------|------------------|
| NDG | Solid; composite edge ids still no schema `edgeId` |
| LayoutIR₀ | Good; `unsat: []` placeholder from 11a |
| LayoutIR₁ | Good embedding of `constraintSolve` |
| Facts `layout.ir` | Dual with IrSlice; kind shared₀/₁ |
| Evidence refs | Good vocabulary (`layout.constraint.*`) |
| Decisions | Standard; relax answer shape informal |
| Missing | Active slice metadata; formal ConstraintNetwork schema (internal OK) |

---

# Fingerprint Audit

**Live fields (Kernel):** policy, knowledge, rule packs, plugins, seed, NDG trio, LayoutIR₀ trio, solver version, solved LayoutIR checksum/slice, `solverFingerprint`.

**Contract (`job-fingerprint.json`):** only early fields + `extra`; **`additionalProperties: false`**.

**Impact:** Contract harness and implementation **disagree**. Rebuild reproducibility in code is good; **governance reproducibility is broken**.

**Must fix before claiming Phase 1 suite integrity for 11b fingerprints** (condition for freeze hardening — not a Phase 12 blocker if tracked).

---

# Determinism Audit

| Risk | Likelihood | Notes |
|------|------------|-------|
| Unsorted iteration | Low | Constraint/network/solver sort by id |
| Floating geometry | Medium | 1px epsilon; float boxes from source |
| `Date.now` in jobId / timing | Low for IR | Timing in reports only |
| `Math.random` in decisionId defaults | Medium if used | Prefer caller-stable ids in tests/prod |
| Map iteration order | Low | Explicit sorts |
| Concurrency | N/A today | Single-threaded assumption undocumented |
| Dual pack vs plugin hypothesis order | Medium | Two paths → different Evidence ids possible |

**Can two runs differ?** Same NDG + LayoutIR₀ + Decisions + Policy + solver version → LayoutIR₁ checksum should match (tested). Different Evidence id generation if both pack and plugin run → fingerprint of *workspace contents* can differ even if LayoutIR₁ matches.

---

# Testing Review

## Strengths

- Per-phase scripts `test:phase1` … `test:phase11b`.  
- Constraint suite covers network, solve, relax, unsat, Decision integration, LayoutIR₁ immutability, fingerprint, determinism, nested/mixed, perf sanity, 11a regression.

## Gaps (brutally)

| Gap | Why it hurts |
|-----|----------------|
| No Raw→…→LayoutIR₁ single orchestrated golden | Phase 12 will invent order |
| Malformed / cyclic NDG into constraint | Fail paths under-tested at 11b |
| Multi LayoutIR slice “last wins” | Active-slice bugs uncaught |
| Pack vs plugin hypothesis parity | Dual path drift |
| Huge graphs / deep nesting stress | Only ~50 node sanity |
| Fingerprint schema validation | Drift invisible to CI |
| Product `server/` vs brain dual-run | Explicitly deferred — still a business risk |

---

# Performance Review

| Concern | Assessment |
|---------|------------|
| Network build | Roughly O(nodes + constraints); acceptable |
| Full LayoutIR on Fact | Memory amplification |
| Plugin execute per wave | Fine until many packs |
| Future | Need partition (Master Plan ~28) before 10k+ node fidelity |

**Bottleneck forecast:** Fact payload duplication + re-interpret in packs + re-solve in pack path.

---

# Security / Fail-safe Review

| Area | Status |
|------|--------|
| Missing NDG | Fail closed (Layout) |
| Missing LayoutIR₀ | Fail closed (Constraint) |
| Corrupt Fact overwrite | Rejected by Workspace |
| Broken plugin capabilities | Enforced |
| Recovery / sandbox | **Weak** (`try_catch` only) |
| Unexpected recognition as structure | **Not hard-blocked** |
| Open writers without capabilities | Residual from early audits — verify still gated |

---

# Documentation Review

| Issue | Severity |
|-------|----------|
| Stale “awaiting approval / not authorized” headers | High for auditors |
| `PHASE_11_COMPLETION_REPORT` footer still says “Stop. Phase 11b not implemented.” while header says Complete | **High — fix immediately (docs only)** |
| Freeze Audit scoped to 1–7; no successor freeze until this doc | Medium |
| RFC-001 vs RFC-002 Constraint peer vs subsystem | Resolved by RFC-002 — still confuse newcomers |
| Master Plan “awaiting approval” | Stale |
| Validation reports good for 11b | Keep as pattern |

**Missing:** Single “Current Truth” index listing which doc wins per topic; fingerprint field changelog; active LayoutIR consumer contract.

---

# Technical Debt

| ID | Item | Priority |
|----|------|----------|
| TD-01 | Sync `job-fingerprint.json` with live fingerprint | **P0** |
| TD-02 | Active LayoutIR slice pin (Workspace or Job) | **P0** for Phase 12 consumers |
| TD-03 | Retire or strictly gate `source.node` structural dual path | **P1** |
| TD-04 | Unify pack NDG load with IrSlice | **P1** |
| TD-05 | Collapse dual constraint hypothesis paths | **P1** |
| TD-06 | Dual `registerEngine` / `registerPlugin` reconciliation | **P1** |
| TD-07 | Doc status header / footer scrub | **P0** (cheap) |
| TD-08 | Remove dead Layout NDG fact-kind aliases | **P2** |
| TD-09 | Constraint coverage: alignment / distribution / required band | **P2** (can deepen in Layout without Phase 12 block) |
| TD-10 | KnowledgeBundle into contracts suite (Freeze Audit leftover) | **P2** |
| TD-11 | Process-level plugin isolation | **P3** |
| TD-12 | Brain pipeline runner (not emit `compile()`) | **P1** before many engines |
| TD-13 | Trace IDs routinely bound into LayoutIR₁ | **P2** |
| TD-14 | E2E golden Raw→LayoutIR₁ | **P1** |

---

# Recommendations (on proposed items)

## Recommendation 1 — Active Layout Slice

**Decision: APPROVE (with design constraints)**

Workspace (or Job fingerprint + Workspace pointer Fact) **should** explicitly maintain:

- `activeLayoutIrSliceId` (and optionally `baselineLayoutIrSliceId`)

**Improve:**

- Do **not** mutate LayoutIR slices.  
- Active pin is metadata only (Fact or Job field + fingerprint).  
- Default policy: after successful solve, pin LayoutIR₁; otherwise LayoutIR₀.  
- Loaders must require pin or explicit `sliceId` — ban silent “last wins.”

**Reject:** Overwriting LayoutIR₀ in place to “update” layout.

## Recommendation 2 — Foundation Freeze (Phases 1–11b)

**Decision: APPROVE — freeze the constitution; allow controlled evolution of content.**

### Frozen (amendments require RFC/Master Plan change)

- Kernel invariants (no UI ontology, no HTML emit in Kernel)  
- Decision Runtime monopoly on commit  
- Workspace Fact/IrSlice immutability protocol  
- Plugin capability model (propose ≠ decide)  
- Knowledge immutability + pin  
- NDG as structural SSOT (no hierarchy rebuild in domain engines)  
- Layout owns arrangement + constraint; **no ConstraintIR peer stage**  
- LayoutIR slice immutability (re-project, don’t mutate)  
- Exporter-neutral LayoutIR vocabulary  
- Pipeline order: NDG → Layout interpret → Decisions → LayoutIR₀ → Constraint → (Decisions) → LayoutIR₁ → later domains  

### May still evolve (without unfreezing constitution)

- Rule pack heuristics and scores  
- Knowledge *content*  
- Constraint kinds/strengths/epsilon (Layout subsystem internals)  
- Policy threshold *values* and allowlists  
- Fingerprint *field additions* (must update contract schema)  
- Active-slice metadata mechanism  
- Engine registry consolidation  
- Deeper solver physics  
- Phase 12+ domain engines as plugins  

---

# Independent Recommendations (Chief Architect)

Ignore the prompt’s suggestions; these are independent:

1. **Publish a Pipeline Contract** — a normative ordered wave list with required inputs/outputs per wave. Kernel methods alone are not enough once Component + Semantic appear.  
2. **Fix the fingerprint schema this week** — otherwise Phase 1 “contracts are law” is theater.  
3. **Ban Fact-embedded full IR payloads** once RuleContext can read IrSlices — or make IrSlice read a first-class pack capability.  
4. **One Hypothesis authority for constraints** — pack proposes; facts plugin only projects LayoutIR₁ + structural Evidence. Today’s dual path will fork.  
5. **Rename or namespace `features.normalize`** before Phase 14 Semantic — naming collisions cause false architecture debates.  
6. **Add malformed-graph fuzz tests** before trusting Constraint for Component nesting.  
7. **Do not start Phase 12 inside `layout/`** — Component must be a sibling engine module.  
8. **Treat `server/build.js` as hostile legacy** for brain purity — dual-run plan (Master Plan ~30) must stay explicit so nobody “temporarily” imports emit into Layout.  
9. **Document concurrency as unsupported** — single-threaded assumption should be written down.  
10. **Create `CURRENT_TRUTH.md`** — one page: which completion report wins, RFC conflict rules, freeze boundaries. Cheaper than another 500-line proposal.

---

# Alternative Designs

| Alternative | Verdict |
|-------------|---------|
| Peer Constraint Engine + ConstraintIR | **Reject** — ownership split; Semantic/Responsive need one spatial surface |
| Mutate LayoutIR₀ in place | **Reject** — fingerprint/audit death |
| Solver inside Decision Runtime | **Reject** — Runtime must stay domain-agnostic |
| Skip LayoutIR₁; Evidence only | **Reject** as sole design — exporters/downstream need solved snapshot |
| Full CSP / Cassowary-style solver now | **Defer** — overkill before Component/Semantic; deepen incrementally under Layout |
| Immediate `compile()` to HTML | **Reject** — violates lowering monopoly and dual-run plan |

**Why current architecture wins:** It preserves a single Decision monopoly, a structural NDG SSOT, and an exporter-neutral Layout surface while keeping Constraint from becoming a second compiler. The costs (caller-ordered pipeline, dual transitional paths, thin solver) are **debt**, not proof the spine is wrong.

---

# Risk Register

## High

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fingerprint contract vs code drift | **High** | Audit/CI false confidence | Update schema; validate in harness |
| Wrong LayoutIR consumed by Phase 12+ | **High** | Silent semantic/layout bugs | Active slice pin; fail closed if ambiguous |
| Doc status contradiction misleads freeze | **High** | Bad go/no-go decisions | Scrub footers; this audit as authority through 11b |

## Medium

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Dual hypothesis paths diverge | Medium | Non-reproducible Workspace | Single proposer path |
| `source.node` dual SSOT linger | Medium | Hierarchy drift | Gate + migrate packs fully to NDG |
| Float epsilon / parent-fit false positives | Medium | Excess relax/unsat | Policy-tunable epsilon; golden corpus |
| Dual engine registries | Medium | Plugin schedule confusion | Consolidate before many engines |
| No pipeline runner | Medium | Phase 12 order bugs | Pipeline Contract + thin orchestrator |
| Fact payload memory | Medium | Large doc failure | Stop embedding full IR on Facts |
| Thin constraint coverage | Medium | “Solved” IR overtrusted | Document limits; deepen under Layout |

## Low

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| try_catch-only plugin isolation | Low today | Crash containment | Sandbox later |
| Empty traceIds on LayoutIR₁ | Low–Med | Explainability gap | Wire trace refs on commit |
| Dead constants / naming collisions | Low | Maintainer confusion | Cleanup pass |

---

# Foundation Freeze Proposal (Normative)

**Freeze name:** Foundation Freeze — Phases 1–11b  
**Effective:** 2026-07-18  
**Authority:** This document supersedes stale “awaiting approval” headers for freeze *status*; RFC-002 still wins on reasoning conflicts with Master Plan.

Phases **1–11b constitution is frozen**. Phase **12 may begin** only under Go/No-Go conditions below.

---

# Go / No-Go Decision

# YES WITH CONDITIONS

**Phase 12 (Component Engine) may begin.**

### Conditions (must track; P0 before claiming production dual-run)

1. **Treat this audit as freeze authority** for 1–11b; scrub contradictory Phase 11 footer / stale headers (docs-only).  
2. **Plan Active LayoutIR pin** before Component/Semantic consume layout (implement in Phase 12 prep or tiny 11b.1 hardening — not a redesign).  
3. **Schedule fingerprint schema sync** (TD-01) immediately.  
4. **Do not** open ConstraintIR, peer ConstraintEngine, or Layout ownership of Components/Responsive.  
5. **Do not** wire emit/`compile()` HTML in Phase 12.  
6. Component Engine must be a **sibling module** (`compiler/components/` or equivalent), Facts + packs, Decision-committed — not nested under Layout.

### Why not unconditional YES

Contract drift + missing active slice + no orchestrated pipeline are enough to cause Phase 12 integration bugs. Why not NO: ownership constitution is sound; waiting for perfect cleanup blocks the roadmap without reducing the main architectural risks of Phase 12 itself.

---

# Final Checklist

| Item | Status |
|------|--------|
| Ownership clean enough to freeze | **YES** |
| Decision monopoly held | **YES** |
| NDG unmutated by Layout/Constraint | **YES** |
| Constraint under Layout (no peer engine) | **YES** |
| LayoutIR immutability (₀ retained, ₁ new) | **YES** |
| No ConstraintIR | **YES** |
| Fingerprint implementation present | **YES** |
| Fingerprint contract accurate | **NO** |
| Active LayoutIR pin | **NO** |
| Dual-SSOT retired | **NO** |
| Pipeline orchestrator | **NO** |
| Docs status consistent | **NO** |
| test:constraint green (as of audit) | **YES** (15/15 reported) |
| Ready for Phase 12 code | **YES WITH CONDITIONS** |
| Ready to claim production compiler brain complete | **NO** |

---

# Closing Statement

The architecture through Phase 11b is a **credible compiler foundation**, not a finished product brain. Its strength is constitutional clarity (who decides, what is structural, what is interpretive, what must never emit). Its weakness is **operational discipline**: schemas lagging code, dual paths, missing active pins, and documentation that argues with itself.

**Freeze the constitution. Fix the conditions. Then build Components without reopening Layout, Decision, or NDG ownership.**

— End of FINAL_ARCHITECTURE_AUDIT —
