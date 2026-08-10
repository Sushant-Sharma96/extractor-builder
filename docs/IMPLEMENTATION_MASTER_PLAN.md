# Implementation Master Plan

| Field | Value |
|-------|--------|
| **Status** | **Foundation Freeze v1** — Phases 1–11b complete; see `docs/CURRENT_TRUTH.md` |
| **Date** | 2026-07-18 |
| **Architecture foundation** | RFC-001 (Compiler Architecture Audit), RFC-002 (Compiler Decision System) |
| **Authority after approval** | **Single execution plan.** No implementation task may exist outside this plan. |
| **Non-goals** | Architecture redesign, code, pseudocode, algorithms, branches, source-file prescriptions |

---

## 1. Executive Summary

### Philosophy

Engineering does not “add engines until it looks smart.”  
Engineering **builds the constitution first** (kernel, workspace, decisions, knowledge, rules), then **migrates domain intelligence onto that constitution**, then **lowers and gates** for production.

RFC-001 defines *what must eventually exist*.  
RFC-002 defines *how the compiler is allowed to think*.  
This Master Plan defines *in what order value is built, proven, and shipped*.

### How engineering should proceed

1. **Approve this plan** (and keep RFC-001 / RFC-002 frozen except via explicit amendment).
2. Execute **one phase at a time**.
3. Each phase ends with **reviewable deliverables + exit criteria + tests**.
4. The next phase may start only after exit criteria pass **or** an explicit waiver is recorded against this plan.
5. Every PR / task cites: **Phase ID + RFC clause**.

### Why implementation must be phase-driven

| Without phases | With phases |
|----------------|-------------|
| Heuristics land before Decision Records | Silent behavior becomes impossible to regress |
| Semantic work precedes kernel | Plugins and arbitration cannot attach cleanly |
| Lowering precedes ResolvedIR | Emit invents policy |
| Quality dashboards precede oracles | Metrics without truth |
| Parallel “engine” builds | Architecture drift and irreversible coupling |

Phase discipline is how a multi-month compiler stays deterministic, explainable, and reversible.

### Document relationship

| Document | Role |
|----------|------|
| RFC-001 | Inventory, pipeline, quality axes, failure modes, IR intent |
| RFC-002 | Normative reasoning: kernel, decisions, knowledge, confidence, plugins |
| **This plan** | Executable sequence, dependencies, DoD, risk controls |
| `BACKLOG.md` lifecycle items | Scheduled under **ops / data-plane phases** — not compiler-brain shortcuts |

---

## 2. Guiding Principles

1. **No implementation before an approved phase** — work not mapped to an open phase is out of order.
2. **No work outside this plan** — new ideas become plan amendments first, code second.
3. **Every feature must satisfy RFC-001 and RFC-002** — RFC-002 wins on reasoning conflicts.
4. **No hidden heuristics** — interpretations are Hypotheses/Decisions with traces.
5. **Facts ≠ interpretations** — source truths are Facts; tags/patterns/layout reinterpretations are Decisions.
6. **Every decision must be testable** — decision-correctness oracles are mandatory where Decisions exist.
7. **Determinism preserved** — same inputs + Knowledge Bundle version + rule-set version + policy ⇒ same Decisions and artifacts (within declared nondeterministic opt-in engines).
8. **Abstain is a valid success** — forced false precision is a defect.
9. **Emit is lowering only** — no new intelligence in codegen.
10. **Data plane ≠ brain** — snapshot/fetch/package must not encode UI ontology.
11. **Kernel has no Navbar** — pattern ontology lives in Knowledge Bundles / packs.
12. **Prefer migration over parallel forever** — legacy analyze/emit paths may coexist briefly only behind an explicit dual-run / shadow phase, then retire.
13. **Corpus before claims of quality** — production readiness requires goldens, not anecdotes.
14. **Budgets are product** — time/memory/bytes/DOM limits are policy, not afterthoughts.
15. **Rollback is a deliverable** — every phase names how to revert.

---

## 3. Dependency Map

### Hard dependencies (must not be violated)

```text
Plan Approval
    → IR / Contract Spine (schemas as engineering artifacts of the plan)
        → Compiler Kernel
            → Workspace
                → Decision Records + Arbitration Protocol
                    → Confidence Algebra (kernel service)
                        → Policy Profiles & Gates (minimal)
                            → Plugin Capability Contract (minimal)
                                → Knowledge Bundle format
                                    → Rule Engine + Rule Pack loading
                                        → Pattern Recognition infrastructure
                                            → Normalization (Fact producer)
                                                → Layout Engine (questions + solver subsystem)
                                                    → Component Engine (facts/hypotheses)
                                                    → Token Engine (facts)
                                                        → Semantic Engine + Pattern Packs
                                                            → Responsive Engine
                                                            → Accessibility Engine
                                                                → Interaction / Animation Engines
                                                                    → Asset Plan Engine
                                                                        → Lowering (EmitPlan → artifacts)
                                                                            → Package plane alignment
                                                                                → Validation Engine
                                                                                    → Quality Scoring
                                                                                        → Explainability export (full)
                                                                                            → Scale / Partition
                                                                                                → Cross-compiler quality bar
```

### Parallelizable after prerequisites (same wave, no mutual hard wait)

| After | May proceed in parallel |
|-------|-------------------------|
| Normalization + Layout baseline | Component facts, Token facts |
| Semantic commits | Responsive hypotheses, Accessibility hypotheses (with declared `requires-committed`) |
| Validation | Corpus ops hardening, Failure corpus ingestion tooling |
| Lowering stable | HTML/CSS optimization passes (as lowering sub-phases), JS generation under policy |

### Explicit non-dependencies (do not block brain)

| Work | Relationship |
|------|----------------|
| Offline snapshot HIT/MISS | Data plane; may harden in dedicated phases; must not gate Decision Records |
| Request abort / temp cleanup (`BACKLOG.md`) | Ops/data-plane phase; must not delay kernel |
| Lovable compiler changes | Out of scope unless Cross-compiler phase |

### Phase order rule

**No phase may start if any hard dependency phase lacks a recorded Exit Criteria pass (or approved waiver).**

---

## 4. Phase Breakdown

Complexity: **S** small · **M** medium · **L** large · **XL** extra-large (multi-sprint).

---

### Phase 0 — Plan & Architecture Freeze

| | |
|--|--|
| **Purpose** | Authorize execution; freeze foundations. |
| **Scope** | Approve RFC-001, RFC-002, this Master Plan; define amendment process; name initial policy profiles (`pixel-faithful`, `semantic-lean`, `static-ok`). |
| **Deliverables** | Approval record; amendment template; owner list per future phase. |
| **Dependencies** | None. |
| **Out of scope** | All product code. |
| **Risks** | Soft approval without enforcement. |
| **Validation** | Written sign-off; plan cited in engineering norms. |
| **Exit criteria** | All three docs marked approved for execution; Phase 1 authorized. |
| **Rollback** | Revoke approval; no code impact. |
| **Complexity** | S |

---

### Phase 1 — Contract & IR Spine

| | |
|--|--|
| **Purpose** | Make RFC contracts engineering-real as versioned schemas/interfaces (not domain logic). |
| **Scope** | Logical contracts for: RawDesignDocument, NormalizedDesignGraph, Fact, Hypothesis, Decision Record, EmitPlan, QualityReport, ProvenanceBundle, Policy Profile; IR stage registry. |
| **Deliverables** | Versioned contract definitions; compatibility rules; empty fixture examples for tests. |
| **Dependencies** | Phase 0. |
| **Out of scope** | Engines, rules, HTML emit, knowledge content. |
| **Risks** | Over-speculating fields; under-specifying Decision Record. |
| **Validation** | Schema validation tests on fixtures; review against RFC-002 Decision Record fields. |
| **Exit criteria** | Contracts review-approved; Decision Record can represent winner/abstain/override; IR stages enumerable. |
| **Rollback** | Revise schemas; no runtime coupling yet. |
| **Complexity** | M |

---

### Phase 2 — Compiler Kernel

| | |
|--|--|
| **Purpose** | Create the OS of compilation. |
| **Scope** | Job lifecycle; policy bind; budgets; engine registry hooks; scheduling skeleton; gate hook points; determinism fingerprint inputs (policy + versions); failure taxonomy surface. |
| **Deliverables** | Kernel that can run an empty job to terminal states (success/fail/abort) with policy attached. |
| **Dependencies** | Phase 1. |
| **Out of scope** | UI patterns, layout math, codegen, network. |
| **Risks** | Kernel absorbs domain knowledge; god-object growth. |
| **Validation** | Unit tests for lifecycle and invariant violations; no ontology strings in kernel. |
| **Exit criteria** | Kernel invariants from RFC-002 enforceable in review checklist; empty job deterministic. |
| **Rollback** | Disable kernel path; retain legacy compile entry until later dual-run. |
| **Complexity** | L |

---

### Phase 3 — Workspace

| | |
|--|--|
| **Purpose** | Shared blackboard for Facts / Hypotheses / Decisions / IR slices. |
| **Scope** | Workspace create/finalize/discard; typed writes; capability checks stub; invalidation hooks; workspace snapshot for debug. |
| **Deliverables** | Workspace usable by registered engines; read/write auditability. |
| **Dependencies** | Phase 2. |
| **Out of scope** | Domain engines; arbitration winners. |
| **Risks** | Mutable soup without immutability rules. |
| **Validation** | Integration: two fake engines communicate only via workspace. |
| **Exit criteria** | No private engine-to-engine pipes required for the fake scenario; write permission denials work. |
| **Rollback** | Remove workspace path; engines not yet production. |
| **Complexity** | M |

---

### Phase 4 — Decision Records, Arbitration, Confidence, Recovery Hooks

| | |
|--|--|
| **Purpose** | Install the brain protocol. |
| **Scope** | Decision lifecycle (propose→score→rank→arbitrate→commit/abstain); priority bands; confidence combine API; margin/accept/fallback thresholds from policy; recovery orchestration hooks; override records. |
| **Deliverables** | End-to-end decision on synthetic questions with traces; abstain path; override path. |
| **Dependencies** | Phase 3. |
| **Out of scope** | Real layout/semantic rules; HTML. |
| **Risks** | Threshold sprawl; arbitration too aggressive/passive. |
| **Validation** | Decision-correctness tests on synthetic fixtures; determinism tests; abstain/tie cases. |
| **Exit criteria** | RFC-002 lifecycle covered for synthetic domain; traces answer why winner/abstain. |
| **Rollback** | Feature-flag decision path; no production engines depend yet. |
| **Complexity** | L |

---

### Phase 5 — Policy Profiles & Minimal Gates

| | |
|--|--|
| **Purpose** | Make product modes real. |
| **Scope** | `pixel-faithful`, `semantic-lean`, `static-ok` (+ placeholders for `interactive-required`); threshold tables; gate fail-closed vs best-effort. |
| **Deliverables** | Policy documents + enforceable profile objects; gate evaluation on QualityReport stubs. |
| **Dependencies** | Phase 4. |
| **Out of scope** | Full quality metrics implementation. |
| **Risks** | Profile explosion; contradictory knobs. |
| **Validation** | Same synthetic decisions differ by profile as expected. |
| **Exit criteria** | Policy corpus stub: one fixture × ≥2 profiles with expected Decision diffs. |
| **Rollback** | Default single profile. |
| **Complexity** | M |

---

### Phase 6 — Plugin Capability Contract

| | |
|--|--|
| **Purpose** | Future engines attach without kernel rewrites. |
| **Scope** | Engine declaration (reads/writes/questions/phase/determinism); registration; crash isolation contract; version in fingerprint. |
| **Deliverables** | Documented plugin contract + harness with fake Animation/AI proposer engines (candidates only). |
| **Dependencies** | Phase 4 (Phase 5 recommended). |
| **Out of scope** | Real Animation/AI product behavior. |
| **Risks** | Over-permissive writes; nondeterminism leaking into goldens. |
| **Validation** | Plugin contract tests; nondeterministic engine disabled under golden profile. |
| **Exit criteria** | Fake plugin proposes Candidates; cannot commit ResolvedIR; crash does not kill kernel. |
| **Rollback** | Built-in engines only. |
| **Complexity** | M |

---

### Phase 7 — Knowledge Bundle

| | |
|--|--|
| **Purpose** | Externalize UI ontology. |
| **Scope** | Bundle format (`K@semver`); pattern entries; conflict edges; priors; obligations hooks; version pinning in job fingerprint. |
| **Deliverables** | Empty/minimal bundle; loader; version mismatch behavior. |
| **Dependencies** | Phase 1, Phase 4. |
| **Out of scope** | Large pattern content library (starts Phase 9+). |
| **Risks** | Bundle becomes dumping ground; unversioned edits. |
| **Validation** | Load/pin tests; golden jobs fail closed on unexpected bundle drift when required. |
| **Exit criteria** | Job records Knowledge Bundle version; patterns addressable by id. |
| **Rollback** | Disable pattern ids; rules cannot resolve patterns. |
| **Complexity** | M |

---

### Phase 8 — Rule Engine & Pack Loader

| | |
|--|--|
| **Purpose** | Versioned, testable rule execution producing Candidates only. |
| **Scope** | Rule Pack organization; pack enablement by policy; priority metadata; no direct IR mutation. |
| **Deliverables** | Pack loader + execution into workspace Hypotheses; sample pack with synthetic rules. |
| **Dependencies** | Phase 4, Phase 7. |
| **Out of scope** | Production marketing/app packs (content phases). |
| **Risks** | Rule explosion; rules calling rules. |
| **Validation** | Unit tests per sample rule; pack isolation tests. |
| **Exit criteria** | Rules only emit Candidates; arbitration still sole committer. |
| **Rollback** | Disable packs. |
| **Complexity** | L |

---

### Phase 9 — Pattern Recognition Infrastructure

| | |
|--|--|
| **Purpose** | Hybrid matchers as candidate generators. |
| **Scope** | Tree/graph/layout/name signal feature extraction interfaces; ambiguity retention; near-miss recording; integration with Knowledge pattern ids. |
| **Deliverables** | Recognition pipeline producing scored Candidates; no commits. |
| **Dependencies** | Phase 8. |
| **Out of scope** | Full pattern catalog; statistical learning (later calibration phase). |
| **Risks** | Name-only accepts; greedy labeling. |
| **Validation** | Pattern corpus micro-fixtures; ambiguity cases keep multi-candidates. |
| **Exit criteria** | Name-only confidence capped by policy; traces show evidence kinds. |
| **Rollback** | Disable recognition packs. |
| **Complexity** | L |

---

### Phase 10 — Normalization Engine (Facts)

| | |
|--|--|
| **Purpose** | Stable NormalizedDesignGraph Facts for all later engines. |
| **Scope** | Visibility, empty wrappers, stable ids, geometry features as Facts; no semantic tagging. |
| **Deliverables** | Norm graph in workspace; provenance to source ids. |
| **Dependencies** | Phase 3, Phase 1. |
| **Out of scope** | Layout reinterpretation Decisions. |
| **Risks** | Normalization silently drops meaning. |
| **Validation** | Fixtures: dropped invisible nodes traced; id stability. |
| **Exit criteria** | Downstream engines can run on Norm Facts alone for geometry questions. |
| **Rollback** | Fall back to raw tree read with explicit degraded mode flag. |
| **Complexity** | L |

---

### Phase 11 — Layout Engine Refactor (incl. Constraint Subsystem)

| | |
|--|--|
| **Purpose** | Move layout intelligence onto Decision protocol; constraints as layout-owned questions. |
| **Scope** | LayoutIR; auto-layout/absolute/mixed modes; conservative flow interpretation as Decisions; constraint solving as subsystem; stacking/overflow questions; replace silent layout heuristics. |
| **Deliverables** | Layout hypotheses + committed Layout decisions; dual-run shadow vs legacy layout for fidelity compare (temporary). |
| **Dependencies** | Phase 4, Phase 8, Phase 10. |
| **Out of scope** | Full responsive strategy (Phase 14); sticky perfection if deferred with waiver. |
| **Risks** | Pixel regressions; solver thrash; coupling to emit. |
| **Validation** | Pixel/box IoU on golden layout fixtures; decision goldens for flow vs absolute; adversarial overlap cases abstain correctly. |
| **Exit criteria** | No silent absolute→flex without Decision; dual-run report reviewed; legacy layout path removable behind flag. |
| **Rollback** | Re-enable legacy layout path. |
| **Complexity** | XL |

---

### Phase 12 — Component Engine

| | |
|--|--|
| **Purpose** | Component/instance/variant Facts and reuse hypotheses. |
| **Scope** | Component graph extraction; instance/override facts; optional emit-reuse hints as Candidates (not forced). |
| **Deliverables** | ComponentIR slice; decisions only where interpretation required. |
| **Dependencies** | Phase 10; Phase 11 recommended for layout-aware composition. |
| **Out of scope** | Full design-system package export. |
| **Risks** | Over-flattening; false reuse. |
| **Validation** | Component fixtures; decision tests for instance treatment under profiles. |
| **Exit criteria** | Component facts available to Semantic; no private flatten without trace. |
| **Rollback** | Treat all as plain frames. |
| **Complexity** | L |

---

### Phase 13 — Design Token Engine

| | |
|--|--|
| **Purpose** | TokenIR facts and bindings as evidence for later CSS plan. |
| **Scope** | Extract variables/styles into TokenIR; bind where confident; magic-value metrics. |
| **Deliverables** | Token graph in workspace; quality signals for token rate. |
| **Dependencies** | Phase 10. |
| **Out of scope** | Multi-brand theme switching product UX (Phase 20). |
| **Risks** | False token merges. |
| **Validation** | Token fixtures; abstain on ambiguous aliases. |
| **Exit criteria** | Lowering can optionally consume tokens under policy without inventing tokens. |
| **Rollback** | Literal values only. |
| **Complexity** | L |

---

### Phase 14 — Semantic Engine & Core Pattern Packs

| | |
|--|--|
| **Purpose** | Meaning under confidence; retire name-only tag hacks. |
| **Scope** | SemanticIR; html.tag / landmark / region questions; core packs (nav, hero, card, form, table, modal, …) as Knowledge+Rules; composition/nesting; abstain→generic. |
| **Deliverables** | Semantic decisions with traces; pattern packs v1; policy-differentiated behavior. |
| **Dependencies** | Phase 9, Phase 11, Phase 7; Phase 12/13 strongly recommended. |
| **Out of scope** | Interaction behavior emission; carousel JS. |
| **Risks** | False landmarks; section spam; rule explosion. |
| **Validation** | Decision goldens; semantic oracles; pixel gates under `pixel-faithful` must not regress for structure-changing commits. |
| **Exit criteria** | Explainability demo: section vs div answered via Decision trace; name-only cannot sole-accept under strict profile. |
| **Rollback** | Generic tags only; disable semantic packs. |
| **Complexity** | XL |

---

### Phase 15 — Responsive Engine

| | |
|--|--|
| **Purpose** | Constraint/breakpoint → responsive strategy Decisions. |
| **Scope** | ResponsiveIR candidates; media strategy binding; honor/abstain under ambiguity. |
| **Deliverables** | Responsive decisions feeding EmitPlan. |
| **Dependencies** | Phase 11, Phase 14 (for intent where needed). |
| **Out of scope** | Full multi-frame artboard product workflow polish. |
| **Risks** | Breakage at mobile widths. |
| **Validation** | Responsive oracles; policy corpus. |
| **Exit criteria** | Documented strategy per committed decision; catastrophic overlap tests pass. |
| **Rollback** | Fixed desktop layout only. |
| **Complexity** | L |

---

### Phase 16 — Accessibility Engine

| | |
|--|--|
| **Purpose** | Roles, names, focus-order signals, obligations from patterns. |
| **Scope** | A11y hypotheses/decisions; veto power on unsafe semantics per policy; reduced-motion flags as policy inputs. |
| **Deliverables** | A11y decisions + gate inputs; obligations from Knowledge. |
| **Dependencies** | Phase 14; Phase 5 gates. |
| **Out of scope** | Perfect manual a11y audits as automated certainty. |
| **Risks** | False ARIA; over-verbose roles. |
| **Validation** | Automated a11y oracles; decision tests; fail-closed under a11y-required profile stub. |
| **Exit criteria** | Pattern obligations enforceable; traces for role assignment. |
| **Rollback** | A11y warn-only. |
| **Complexity** | L |

---

### Phase 17 — Interaction & Animation Engines

| | |
|--|--|
| **Purpose** | BehaviorIR / MotionIR candidates under policy. |
| **Scope** | Detect interactive patterns; prototype signals when present; authorize JS/motion only if policy allows; `static-ok` must not emit behavior. |
| **Deliverables** | Interaction/Animation packs; JS generation **authorization** decisions (not ad-hoc stubs). |
| **Dependencies** | Phase 14, Phase 6, Phase 5. |
| **Out of scope** | Full Lottie/video/canvas productization (Phase 21). |
| **Risks** | Invented product logic; unsafe JS. |
| **Validation** | Policy corpus static vs interactive; decision coverage metrics. |
| **Exit criteria** | Stub JS only when policy `static-ok` explicitly allows; otherwise BehaviorIR coverage gated. |
| **Rollback** | Force static-ok. |
| **Complexity** | XL |

---

### Phase 18 — Asset Plan & Optimization Engine

| | |
|--|--|
| **Purpose** | AssetIR plan: format choices, budgets, fallbacks. |
| **Scope** | SVG vs raster policy; payload budgets; placeholder fallbacks as Decisions/Facts; coordination with data-plane locality. |
| **Deliverables** | Asset plan consumed by lowering/package. |
| **Dependencies** | Phase 4, Phase 10; data-plane snapshot compatibility. |
| **Out of scope** | CDN vendor lock-in; changing fetch auth. |
| **Risks** | Quality vs size regressions. |
| **Validation** | Byte budgets; fallback chain tests; missing asset recovery. |
| **Exit criteria** | Asset failures do not silently omit without QualityReport entries. |
| **Rollback** | Pass-through remote URLs. |
| **Complexity** | M |

---

### Phase 19 — Lowering (EmitPlan → HTML/CSS/JS)

| | |
|--|--|
| **Purpose** | Deterministic codegen from ResolvedIR + committed Decisions + Policy. |
| **Scope** | EmitPlan construction; HTML/CSS/JS emission; HTML/CSS optimization as lowering sub-steps; **no new semantic inventiveness**. |
| **Deliverables** | Artifact set from resolved workspace; provenance links emit↔source↔decisions. |
| **Dependencies** | Phases 11–18 as required by profile; minimum Layout+Semantic+Asset for default web profile. |
| **Out of scope** | Framework component libraries (future backend). |
| **Risks** | Intelligence leaks into lowering; class-name chaos. |
| **Validation** | Golden artifacts; decision↔DOM consistency tests; dual-run vs legacy until cutover. |
| **Exit criteria** | Lowering cannot introduce tags/roles absent from committed Decisions (except policy-defined safe generics). |
| **Rollback** | Legacy emit path. |
| **Complexity** | XL |

---

### Phase 20 — Theme & i18n/RTL Engines

| | |
|--|--|
| **Purpose** | Theme modes and bidirectional/locale concerns as Decisions/Facts. |
| **Scope** | ThemeIR; RTL mirroring strategies; locale text expansion warnings. |
| **Deliverables** | Engines + packs; policy hooks. |
| **Dependencies** | Phase 13, Phase 15, Phase 19. |
| **Out of scope** | Full translation pipeline product. |
| **Risks** | Break pixel goldens when theme differs. |
| **Validation** | Policy corpus theme/RTL fixtures. |
| **Exit criteria** | Theme/RTL commits traced; default LTR/light unchanged when disabled. |
| **Rollback** | Disable packs. |
| **Complexity** | L |

---

### Phase 21 — Media, Security/Supply, Edge-Case Packs

| | |
|--|--|
| **Purpose** | Cover remaining RFC-001 domain gaps without kernel pollution. |
| **Scope** | Media policies (video/canvas/charts); SVG/HTML sanitization gates; edge-case rule packs for known pathologies. |
| **Deliverables** | Engines/packs + security gates. |
| **Dependencies** | Phase 19; Phase 6. |
| **Out of scope** | Hosting arbitrary third-party widgets. |
| **Risks** | Over-blocking assets; under-sanitizing SVG. |
| **Validation** | Adversarial corpus; security fixtures. |
| **Exit criteria** | Security gate fail-closed under secure profile; media abstains documented. |
| **Rollback** | Disable media packs; strict sanitize defaults. |
| **Complexity** | L |

---

### Phase 22 — Package Plane Alignment

| | |
|--|--|
| **Purpose** | Packaging consumes AssetIR/local maps without compiler meaning changes. |
| **Scope** | Align package rewrite with Asset plan; provenance bundle drop; ensure snapshot HIT/MISS still meaning-invariant. |
| **Deliverables** | Package outputs + provenance optional export. |
| **Dependencies** | Phase 19, Phase 18. |
| **Out of scope** | Redesigning snapshot schema unless version bump approved. |
| **Risks** | Cache meaning drift. |
| **Validation** | HIT/MISS artifact fingerprint compare under same ResolvedIR. |
| **Exit criteria** | Documented invariant test: brain outputs identical whether assets local or remote maps. |
| **Rollback** | Prior package behavior. |
| **Complexity** | M |

---

### Phase 23 — Validation Engine

| | |
|--|--|
| **Purpose** | Structural/semantic/fidelity validators before accept. |
| **Scope** | Pre-lower and post-package validation; wire to gates; produce machine-readable violations. |
| **Deliverables** | Validation Engine + integration with Policy gates. |
| **Dependencies** | Phase 19; Phase 5. |
| **Out of scope** | Human design critique. |
| **Risks** | Noisy validators; ignored failures. |
| **Validation** | Validators catch seeded defects; fail-closed profiles stop jobs. |
| **Exit criteria** | No production profile ships without validation pass definition. |
| **Rollback** | Warn-only mode. |
| **Complexity** | M |

---

### Phase 24 — Quality Scoring Engine

| | |
|--|--|
| **Purpose** | Multi-axis scores from RFC-001 §7 as release signals. |
| **Scope** | Pixel, layout, semantic, a11y, responsive, animation, interaction, token, DOM/CSS complexity, performance, confidence, recovery, provenance coverage. |
| **Deliverables** | QualityReport populated; weights per profile; regression deltas. |
| **Dependencies** | Phase 23; oracles from testing strategy. |
| **Out of scope** | Vanity single score without weights. |
| **Risks** | Gaming metrics; unstable scores. |
| **Validation** | Score stability on goldens; held-out calibration. |
| **Exit criteria** | Profiles declare thresholds; CI can gate on deltas. |
| **Rollback** | Report-only. |
| **Complexity** | L |

---

### Phase 25 — Explainability Export & Debug UX Contract

| | |
|--|--|
| **Purpose** | Make traces a product artifact, not only logs. |
| **Scope** | Decision trace export; provenance map; “why section vs div” debug contract; Decision diff across Knowledge versions. |
| **Deliverables** | Export format + documented debugger workflow. |
| **Dependencies** | Phase 4 (partial traces exist earlier); Phase 19 for emit binding; Phase 24 optional enrichment. |
| **Out of scope** | Full GUI product (may be separate). |
| **Risks** | Traces too heavy; PII in names. |
| **Validation** | Golden includes expected trace keys; size budgets. |
| **Exit criteria** | Any semantic commit explainable from export alone. |
| **Rollback** | Log-only traces. |
| **Complexity** | M |

---

### Phase 26 — Corpus Platform

| | |
|--|--|
| **Purpose** | Operationalize Golden / Regression / Knowledge / Pattern / Failure / Adversarial / Policy corpora. |
| **Scope** | Corpus layout, ownership, promotion rules, quarantine, version pins; ingestion of failure traces. |
| **Deliverables** | Corpus repo/process; CI wiring; maintenance runbook. |
| **Dependencies** | Phase 1; grows with Phases 11–24. |
| **Out of scope** | Unlimited file hoarding without labels. |
| **Risks** | Flaky goldens; demo-driven gates. |
| **Validation** | Corpus policy audit; flaky quarantine works. |
| **Exit criteria** | Release gate uses Golden + Regression + Decision oracles; Failure corpus triage SLA defined. |
| **Rollback** | Manual curated mini-corpus. |
| **Complexity** | L |

---

### Phase 27 — Confidence Calibration & Ranking Hardening

| | |
|--|--|
| **Purpose** | Make scores comparable; reduce miscalibration. |
| **Scope** | Calibration against Knowledge/Pattern corpora; ranking margin tuning per profile; statistical prior updates (versioned). |
| **Deliverables** | Calibrated Confidence Bundle notes; before/after reports. |
| **Dependencies** | Phase 4, Phase 9, Phase 26. |
| **Out of scope** | Unbounded online learning in production jobs. |
| **Risks** | Overfit to corpus. |
| **Validation** | Held-out decision accuracy; calibration curves. |
| **Exit criteria** | Calibration version pinned; goldens updated deliberately. |
| **Rollback** | Previous calibration version. |
| **Complexity** | M |

---

### Phase 28 — Scale / Partition Engine

| | |
|--|--|
| **Purpose** | Enterprise-size files compile within budgets. |
| **Scope** | Partition compile units; incremental strategies; memory/time budgets enforced by kernel. |
| **Deliverables** | Partition engine + adversarial large-file tests. |
| **Dependencies** | Phase 2 budgets; Phase 19; Phase 26 adversarial corpus. |
| **Out of scope** | Distributed multi-machine compile (unless later amendment). |
| **Risks** | Incorrect partition seams. |
| **Validation** | Large-file jobs complete or fail-closed with partial policy; no OOM as silent success. |
| **Exit criteria** | Documented size classes and behaviors. |
| **Rollback** | Reject over-budget files. |
| **Complexity** | L |

---

### Phase 29 — Data-Plane Lifecycle Hardening

| | |
|--|--|
| **Purpose** | Execute `BACKLOG.md` lifecycle items without touching brain ontology. |
| **Scope** | AbortSignal through long work; request cancellation; temp cleanup; orphan snapshot cleanup; background download cancellation. |
| **Deliverables** | Lifecycle behavior meeting backlog intents; Failure corpus entries for orphans. |
| **Dependencies** | Stable package/snapshot (Phase 22); kernel abort hooks (Phase 2). |
| **Out of scope** | New compiler semantics. |
| **Risks** | Cancel leaves corrupt finals (must not). |
| **Validation** | Abort mid-save leaves no final snapshot; orphans swept. |
| **Exit criteria** | Backlog lifecycle items checked off with tests. |
| **Rollback** | Prior best-effort cleanup. |
| **Complexity** | M |

---

### Phase 30 — Legacy Cutover & Shadow Retirement

| | |
|--|--|
| **Purpose** | Make Decision-system path the default compile path. |
| **Scope** | Shadow compare reports; cutover flag; remove or quarantine legacy silent-heuristic path. |
| **Deliverables** | Default path = kernel/workspace/decisions/lowering; migration notes. |
| **Dependencies** | Phases 11, 14, 19, 23, 24, 26 meeting exit criteria. |
| **Out of scope** | New features during cutover. |
| **Risks** | User-visible regressions. |
| **Validation** | Golden+regression green on new default; decision goldens green. |
| **Exit criteria** | Legacy path off by default; waiver process for emergencies only. |
| **Rollback** | Re-enable legacy flag. |
| **Complexity** | L |

---

### Phase 31 — Cross-Compiler Quality Bar

| | |
|--|--|
| **Purpose** | Shared product definition of “good compile” with Lovable path (metrics/policy only). |
| **Scope** | Shared score axes, packaging expectations, corpus doctrine alignment—not engine merge. |
| **Deliverables** | Cross-compiler quality charter + CI signals. |
| **Dependencies** | Phase 24, Phase 26. |
| **Out of scope** | Merging Figma and Lovable brains. |
| **Risks** | False unification forcing bad abstractions. |
| **Validation** | Charter review; sample jobs on both paths report comparable axes. |
| **Exit criteria** | Documented shared bar; explicitly non-shared internals listed. |
| **Rollback** | Path-specific bars only. |
| **Complexity** | M |

---

### Phase 32 — Production Readiness Hardening

| | |
|--|--|
| **Purpose** | Meet Definition of Done (§10). |
| **Scope** | Performance budgets in CI; explainability on by debug policy; operational runbooks; security profile; corpus SLAs; final gate tuning. |
| **Deliverables** | Production readiness report. |
| **Dependencies** | Phases 23–31 as applicable. |
| **Out of scope** | Net-new engines. |
| **Risks** | Declaring done without corpus breadth. |
| **Validation** | Full §10 checklist signed. |
| **Exit criteria** | Definition of Done satisfied. |
| **Rollback** | Remain in pre-production profile. |
| **Complexity** | L |

---

## 5. Suggested Phase Order (authoritative sequence)

Adjusted from the example order to match the RFC-002 dependency graph:

| Order | Phase | Name |
|------:|-------|------|
| 0 | 0 | Plan & Architecture Freeze |
| 1 | 1 | Contract & IR Spine |
| 2 | 2 | Compiler Kernel |
| 3 | 3 | Workspace |
| 4 | 4 | Decision Records / Arbitration / Confidence / Recovery Hooks |
| 5 | 5 | Policy Profiles & Minimal Gates |
| 6 | 6 | Plugin Capability Contract |
| 7 | 7 | Knowledge Bundle |
| 8 | 8 | Rule Engine & Pack Loader |
| 9 | 9 | Pattern Recognition Infrastructure |
| 10 | 10 | Normalization Engine |
| 11 | 11 | Layout Engine Refactor (+ Constraint Subsystem) |
| 12 | 12 | Component Engine |
| 13 | 13 | Design Token Engine |
| 14 | 14 | Semantic Engine & Core Pattern Packs |
| 15 | 15 | Responsive Engine |
| 16 | 16 | Accessibility Engine |
| 17 | 17 | Interaction & Animation Engines |
| 18 | 18 | Asset Plan & Optimization |
| 19 | 19 | Lowering (EmitPlan → artifacts) |
| 20 | 20 | Theme & i18n/RTL |
| 21 | 21 | Media, Security/Supply, Edge-Case Packs |
| 22 | 22 | Package Plane Alignment |
| 23 | 23 | Validation Engine |
| 24 | 24 | Quality Scoring Engine |
| 25 | 25 | Explainability Export |
| 26 | 26 | Corpus Platform |
| 27 | 27 | Confidence Calibration |
| 28 | 28 | Scale / Partition |
| 29 | 29 | Data-Plane Lifecycle Hardening |
| 30 | 30 | Legacy Cutover |
| 31 | 31 | Cross-Compiler Quality Bar |
| 32 | 32 | Production Readiness Hardening |

**Note:** Phase 26 (Corpus) may begin scaffolding as early as Phase 1 and expand continuously; its **exit criteria** still land late. Early corpus work must not invent brain features outside open phases.

---

## 6. Testing Strategy

### Cross-cutting rules

- Every phase that introduces Decisions ships **decision-correctness** tests.
- Every phase that can change pixels ships **pixel/layout** checks on an agreed fixture set.
- Golden entries always pin: **policy**, **Knowledge Bundle version**, **rule-set version**.
- Nondeterministic plugins **off** in golden profiles.

### Per-phase testing matrix

| Phase | Unit | Integration | Regression | Golden corpus | Decision correctness |
|-------|------|-------------|------------|---------------|----------------------|
| 0 | — | — | — | — | — |
| 1 | Schema fixtures | Contract load | Schema compat | Fixture examples only | Decision schema round-trip |
| 2 | Lifecycle, budgets, invariants | Empty job | Fingerprint stability | — | — |
| 3 | Typed writes/denies | Dual fake engines | Workspace snapshot stability | — | — |
| 4 | Score/arbitrate/tie/abstain/override | Full synthetic lifecycle | Determinism | Synthetic decision goldens | **Required** |
| 5 | Threshold tables | Profile diffs | Policy corpus stub | Policy×fixture | Profile expected winners |
| 6 | Capability enforce | Fake plugin crash | Nondeterminism excluded | — | Plugin candidates only |
| 7 | Bundle load/pin | Mismatch fail | Bundle drift | — | Pattern id resolution |
| 8 | Rule purity | Pack enable/disable | Pack version | Sample pack goldens | Candidate expectations |
| 9 | Feature extractors | Multi-candidate retain | Ambiguity cases | Pattern micro-corpus | Evidence kinds present |
| 10 | Norm transforms | Provenance ids | Norm stability | Norm fixtures | Facts-only (no tag decisions) |
| 11 | Layout predicates/solver cases | Dual-run shadow | Layout goldens | Layout pixel/IoU goldens | Flow vs absolute decisions |
| 12 | Component graph | Instance fixtures | Component goldens | Component labels | Instance treatment |
| 13 | Token extract | Bind/abstain | Token rate signals | Token fixtures | Binding decisions |
| 14 | Pack rules | Semantic+layout | Semantic+pixel | Pattern+semantic goldens | **Primary** tag/landmark |
| 15 | Strategy candidates | Reflow harness | Responsive goldens | Multi-width | Responsive commits |
| 16 | Obligations | A11y oracle integrate | A11y goldens | A11y fixtures | Role/name decisions |
| 17 | Behavior candidates | static-ok vs interactive | Interaction goldens | Prototype fixtures | JS authorization |
| 18 | Fallback chain | Missing asset | Byte budgets | Asset fixtures | Degrade decisions |
| 19 | Lowering pure maps | Emit↔decision consistency | Artifact goldens | Full job goldens | No inventiveness checks |
| 20 | Theme/RTL packs | Policy corpus | Theme goldens | Theme/RTL fixtures | Theme decisions |
| 21 | Sanitize cases | Adversarial | Security goldens | Adversarial corpus | Media abstains |
| 22 | Rewrite maps | HIT/MISS invariant | Package goldens | Offline fixtures | — (meaning invariant) |
| 23 | Validators | Gate integrate | Seeded defects | — | — |
| 24 | Score units | Profile weights | Score deltas | Held-out set | Confidence coverage axis |
| 25 | Trace schema | Why-section scenario | Trace size | Trace keys in goldens | Trace↔decision match |
| 26 | Corpus tools | CI wiring | Flaky quarantine | All corpus types live | Promotion rules |
| 27 | Calibration math | Before/after | Held-out | Calibration set | Accuracy bands |
| 28 | Partition seams | Large jobs | Size-class | Adversarial large | — |
| 29 | Abort/cleanup | Mid-save abort | Orphan sweep | Failure corpus ops | — |
| 30 | Flag matrix | Shadow report | Full regression | Full golden | Full decision suite |
| 31 | Shared axes | Dual-path sample | Charter | Shared fixtures subset | — |
| 32 | Budgets | Readiness suite | Release gate | Production corpus slice | Final sign-off suite |

---

## 7. Risk Register

| ID | Risk | Impact | Likelihood | Mitigation (plan-level) |
|----|------|--------|------------|-------------------------|
| R1 | Architecture drift from RFCs | High | Medium | Phase cites RFC clauses; amendment required for deviations |
| R2 | Hidden heuristics reappear in lowering | High | High | Phase 19 inventiveness tests; code review checklist |
| R3 | Rule explosion | High | High | Pack ownership; Pattern corpus required for new rules; periodic rule audits in Phase 26/27 |
| R4 | Knowledge inconsistency | High | Medium | Bundle semver; pin in goldens; conflict edges required for exclusives |
| R5 | Premature domain engines | High | Medium | Hard dependency map; reject PRs outside open phase |
| R6 | Performance regressions | Medium | High | Budgets in kernel; Phase 28; CI perf oracles from Phase 24 |
| R7 | Large Figma files OOM/timeout | High | High | Phase 28; fail-closed; adversarial corpus |
| R8 | Feature coupling (brain↔data plane) | High | Medium | Phase 22 invariant; separate Phase 29 |
| R9 | Dual-run forever (never cut over) | Medium | Medium | Phase 30 time-boxed; exit criteria mandatory |
| R10 | Confidence theater (uncalibrated scores) | Medium | High | Phase 27; decision goldens use bands |
| R11 | Demo-driven goldens | High | Medium | Corpus doctrine; worst-case corpus weight |
| R12 | Plugin nondeterminism in CI | Medium | Medium | Golden profile disables nondeterministic engines |
| R13 | Over-engineering before corpus | Medium | Medium | Phase 26 scaffolding early; content gates later |
| R14 | Under-engineering (skip decisions) | High | Medium | Phase 4 exit before layout/semantic |
| R15 | Pixel vs semantic profile conflict | Medium | High | Policy corpus; explicit profile in every golden |
| R16 | Recovery loops unbounded | Medium | Low | Kernel bounded re-entry; Phase 4 tests |
| R17 | Security SVG XSS | High | Medium | Phase 21 gates; secure profile fail-closed |
| R18 | Snapshot orphans / abort races | Medium | High | Phase 29; Failure corpus |
| R19 | Staffing: XL phases stall | Medium | Medium | Split only via plan amendment; no silent sub-scope creep |
| R20 | Cross-compiler forced merge | Medium | Low | Phase 31 explicitly forbids engine merge |

---

## 8. Implementation Rules

1. **No shortcuts** that skip Decision Records for “just this tag.”
2. **No temporary hacks** without a Phase ID, expiry, and rollback.
3. **No phase skipping** without written waiver referencing dependency risk.
4. **No silent behavior** — if users can observe it, traces or Facts must explain it.
5. **Every architectural choice traceable** to RFC-001 / RFC-002 clause in the task brief.
6. **No new pattern names in kernel.**
7. **No network in brain phases** except explicit data-plane phases.
8. **No Emit inventiveness** — missing Decision ⇒ abstain/generic or fail, not guess in lowering.
9. **No golden updates to hide regressions** without Failure corpus entry + review.
10. **No bundle edits without semver bump** when behavior changes.
11. **No parallel forever dual paths** past Phase 30 exit.
12. **Performance budgets enforced**, not advisory-only, in production profiles.
13. **Security profile cannot be weaker** than declared secure baseline after Phase 21.
14. **AI proposers remain P6** and off in determinism-strict goldens.
15. **Plan amendments required** before adding phases or reordering hard dependencies.

---

## 9. Deliverable Matrix (RFC → Phase)

Nothing from the foundation RFCs should remain unmapped.

### RFC-002 (Decision System)

| Concept | Phase(s) |
|---------|----------|
| Compiler Kernel | 2 |
| Kernel invariants / forbidden ontology | 2, review continuous |
| Workspace / blackboard | 3 |
| Decision Records | 1 (schema), 4 (runtime) |
| Decision lifecycle | 4 |
| Hybrid decision model | 4, 8, 9 |
| Facts vs Hypotheses | 1, 3, 4, 10 |
| Confidence generation/propagation | 4, 27 |
| Thresholds / fallback thresholds | 5, 4 |
| Manual overrides | 4, 26 |
| Knowledge Bundle / Pattern library / Knowledge graph | 7, 14+ content |
| Pattern recognition (hybrid) | 9 |
| Ambiguity / abstain | 4, 9, 14 |
| Rule Engine / Rule Packs / priority bands | 8, 4 |
| Conflict arbitration | 4 |
| Capability DAG scheduling | 2, 6 |
| Emit = lowering only | 19 |
| Failure recovery architecture | 4 (hooks), 18, 23, 28 |
| Corpus types & maintenance | 26 (scaffold from 1) |
| Testing architecture / decision correctness | 6 (strategy), continuous |
| Plugin architecture | 6 |
| AI as candidate proposer | 6, 17 (optional later use) |
| Explainability / traces | 4 (core), 25 (export) |
| Provenance | 1, 10, 19, 22, 25 |
| Determinism fingerprint | 2, 7, 8 |
| Long-term stable vs replaceable surfaces | Continuous governance; Phase 0/32 |
| Policy profiles | 5 |

### RFC-001 (Architecture inventory & quality)

| Concept | Phase(s) |
|---------|----------|
| Pipeline stages (ingress→package) as planes | Data plane ongoing; brain via 2–22; dual-run 30 |
| Snapshot gate / persist (data plane) | 22, 29 (lifecycle); meaning-invariant tests |
| Source adapter boundary | Data plane + Phase 10 input Facts |
| Normalization Engine | 10 |
| Layout Engine | 11 |
| Constraint Solver (subsystem of Layout) | 11 |
| Semantic Engine | 14 |
| Component Engine | 12 |
| Responsive Engine | 15 |
| Animation Engine | 17 |
| Interaction Engine | 17 |
| Accessibility Engine | 16 |
| Design Token Engine | 13 |
| Asset Optimization Engine | 18 |
| CSS Optimization Engine | 19 (lowering sub-step) |
| HTML Optimization Engine | 19 (lowering sub-step) |
| JS Generation Engine | 17 (authorize), 19 (emit) |
| Conflict Resolution Engine | 4 (kernel arbitration) |
| Validation Engine | 23 |
| Quality Scoring Engine | 24 |
| Recovery Engine | 4, 23, 28 |
| Fallback Engine | 4, 18, 11 |
| Heuristic Engine | 8–9, 14 (as scored rules/patterns—not silent) |
| Ranking Engine | 4, 27 |
| Confidence Engine | 4, 27 |
| Edge Case Engine | 21 (packs) |
| Explainability Engine | 25 (structured traces, not essays) |
| Provenance Engine | 19, 22, 25 |
| Scale / Partition Engine | 28 |
| Theme Engine | 20 |
| i18n / RTL Engine | 20 |
| Media Engine | 21 |
| Security / Supply Engine | 21 |
| Multi-stage IR (NDG, specialized graphs, ResolvedIR, EmitPlan) | 1, 10–19 |
| Multiple graph representations | 10–17 |
| Quality metrics suite | 24 |
| Worst-case failure analysis matrix | 4, 18, 23, 28, 29 |
| Universal domains / worst-case posture | 26 adversarial + continuous |
| Package & provenance bundle | 22, 25 |
| Cross-compiler quality bar | 31 |
| RFC-001 roadmap phases 0–8 | Superseded by this plan’s Phase 0–32 execution order |

### Backlog lifecycle (`BACKLOG.md`)

| Item | Phase |
|------|-------|
| AbortController / request cancellation / temp cleanup / orphan cleanup / background download cancellation | 29 |

---

## 10. Definition of Done (Production Ready)

The compiler is **production ready** only when **all** of the following are true:

### Architecture & reasoning

- [ ] RFC-001 and RFC-002 remain the approved foundation (amendments recorded).
- [ ] This Master Plan’s Phases **0–30** exit criteria are met (Phase 31–32 may be waived only with explicit product sign-off).
- [ ] Compiler Kernel + Workspace + Decision Records are on the **default** compile path.
- [ ] No hidden heuristics on the default path (inventiveness tests green).
- [ ] Knowledge Bundle + Rule Packs version-pinned in releases.

### Decision system

- [ ] Non-deterministic interpretations produce Decision Records with traces.
- [ ] Abstain/fallback/override paths proven in CI.
- [ ] Confidence calibrated (Phase 27) or explicitly waived with risk acceptance.
- [ ] Explainability export answers tag/role questions without reading engine source.

### Quality & corpora

- [ ] Golden corpus passing under declared profiles.
- [ ] Regression corpus passing.
- [ ] Decision-correctness suite passing (bands, not brittle floats).
- [ ] Adversarial/worst-case corpus: no crash; recovery behavior correct.
- [ ] Quality thresholds achieved for the **production profile set** (Phase 24 gates).
- [ ] Pixel/layout fidelity gates green for `pixel-faithful` production corpus slice.

### Operations

- [ ] Validation Engine gating production profiles.
- [ ] Data-plane lifecycle hardening complete (Phase 29) or risk-accepted.
- [ ] Scale/partition behavior defined for size classes (Phase 28) or hard reject policy documented.
- [ ] Package meaning-invariant under snapshot HIT/MISS.
- [ ] Runbooks for failure corpus triage and Knowledge Bundle release.

### Explicit non-claims

Production ready does **not** require:

- every RFC-001 edge case perfected,
- AI engine enabled,
- Lovable/Figma engine merge,
- infinite pattern coverage.

It **does** require a **honest, gated, explainable, deterministic** compiler whose extensions happen through this plan’s remaining phases—not through side doors.

---

## Document control

| Rule | |
|------|--|
| Implementation outside this plan | **Forbidden** after approval |
| Phase reorder of hard dependencies | Requires plan amendment |
| New engines/features | New or extended phase via amendment |
| Conflict with RFC-002 reasoning | RFC-002 wins; amend this plan to match |
| Success | Staff engineers can pick the next task solely from the next open phase’s Scope + Exit Criteria |

**End of Implementation Master Plan. Stop. No implementation follows until this document is approved.**
