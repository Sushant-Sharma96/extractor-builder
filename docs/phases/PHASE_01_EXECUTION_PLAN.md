# Phase 1 Execution Plan — Contract & IR Spine

| Field | Value |
|-------|--------|
| **Phase** | 1 — Contract & IR Spine |
| **Status** | Implementation complete — see `docs/phases/PHASE_01_COMPLETION_REPORT.md`. Human review sign-off still required on `contracts/REVIEW_RECORD.md` before Phase 2. |
| **Depends on** | Phase 0 complete (RFC-001, RFC-002, IMPLEMENTATION_MASTER_PLAN approved & frozen) |
| **Unlocks** | Phase 2 — Compiler Kernel (and every later phase) |
| **Authority** | Implements Master Plan Phase 1 only. No architecture redesign. No new RFC concepts unless a critical contradiction is found and escalated. |
| **Non-goals of this document** | Code, pseudocode, algorithms, source paths, branches, commits |

---

## 1. Goals

### 1.1 What Phase 1 is trying to accomplish

Phase 1 turns the **logical contracts** named in RFC-001 and RFC-002 into **versioned, reviewable, fixture-testable engineering artifacts**.

After Phase 1, the project has a single, shared vocabulary for:

- what a compile job’s data looks like at each IR stage,
- what a **Fact** is versus a **Hypothesis** versus a **Decision Record**,
- what **Policy**, **EmitPlan**, **QualityReport**, and **Provenance** mean as data shapes,
- which IR stages exist and in what order they may appear,
- how those contracts **version** and remain **compatible**.

Phase 1 does **not** run a compiler. It does **not** invent layout, semantics, or HTML. It creates the **spine** that Kernel, Workspace, engines, lowering, validation, and corpora will all hang from.

### 1.2 Problems it solves

| Problem today / without Phase 1 | Phase 1 remedy |
|---------------------------------|----------------|
| Informal element trees collapse interpretation into CSS early | Staged IR contracts keep Facts separate from Decisions and EmitPlan |
| Engines would invent private JSON shapes | Shared contracts force interoperability |
| Decision correctness tests have nothing stable to assert | Decision Record schema becomes the oracle target |
| Kernel cannot validate stage transitions | IR stage registry enumerates legal stages and predecessors |
| Corpus / golden entries cannot pin contract versions | Contract versioning rules exist before content accumulates |
| Future phases argue about field meaning | Review-approved definitions freeze the vocabulary |

### 1.3 Why it must exist before every other phase

Per the Master Plan dependency map:

- **Kernel (Phase 2)** needs schemas to know what a job may hold and what “policy bind” attaches to.
- **Workspace (Phase 3)** needs Fact / Hypothesis / Decision envelopes to store.
- **Decision runtime (Phase 4)** needs Decision Record + Candidate shapes before arbitration exists.
- **Knowledge / Rules / Engines (Phases 7–18)** write into contracts; they must not define the contracts.
- **Lowering (Phase 19)** consumes EmitPlan; inventing EmitPlan ad hoc in lowering is forbidden.
- **Validation / Quality / Explainability (Phases 23–25)** emit QualityReport and Provenance; those shapes must preexist.
- **Corpus (Phase 26)** pins contract versions on goldens; without Phase 1, goldens drift.

Starting Kernel or Layout before contracts guarantees irreversible private formats and architecture drift (Risk R1 / R14 in the Master Plan).

### 1.4 What future phases depend on it

| Downstream phase | Assumes from Phase 1 |
|------------------|----------------------|
| 2 Kernel | Policy Profile envelope; job fingerprint inputs named; IR stage registry; failure/report envelopes exist as types |
| 3 Workspace | Fact, Hypothesis, Decision Record, IR slice envelopes |
| 4 Decision runtime | Full Decision Record + Candidate + status enums including abstain/override |
| 5 Policy | Policy Profile schema slots for thresholds (values filled in Phase 5) |
| 6 Plugins | Declared read/write **kinds** aligned to contract type names |
| 7–9 Knowledge/Rules/Patterns | Evidence and candidate payloads reference contract field vocabulary |
| 10 Normalization | NormalizedDesignGraph + Fact contracts |
| 11–18 Domain engines | Specialized IR stage envelopes (LayoutIR, …) registered; domain fill later |
| 19 Lowering | EmitPlan + ResolvedIR commitment markers + ArtifactSet envelope |
| 22–25 Package / Validation / Quality / Explainability | QualityReport, ProvenanceBundle, ArtifactSet |
| 26 Corpus | Version pin rules for contracts on golden entries |

---

## 2. Architectural References

Frozen documents only. Phase 1 implements these sections; it does not amend them.

### 2.1 RFC-001 — Compiler Architecture Audit

| Section | Relevance to Phase 1 |
|---------|----------------------|
| §5.3 Data contracts | Defines RawDesignDocument, NormalizedDesignGraph, specialized IRs, EmitPlan, ArtifactSet, QualityReport, ProvenanceBundle |
| §5.4 Hard architectural invariants | Informs what contracts must allow (confidence, fallbacks recorded, policies explicit) without encoding engine logic |
| §6 Intermediate Representation | Mandates multi-stage IR; NDG → specialized graphs → ResolvedIR → EmitPlan → optional ArtifactIR; shared node identity space |
| §6.4 Multiple graph representations | Contracts must allow separate graphs linked by stable node ids |
| §7 Compiler Quality | QualityReport must be able to carry multi-axis scores and related signals (field slots; scoring logic is later) |
| §8 Failure analysis | QualityReport / Decision status must be able to express degrade, fail-closed, and recorded fallbacks |
| Architecture roadmap “Contracts & IR spine” | Historical alignment; **execution authority is the Master Plan**, not RFC-001’s old phase numbers |

### 2.2 RFC-002 — Compiler Decision System

| Section | Relevance to Phase 1 |
|---------|----------------------|
| §1 Kernel (boundaries) | Phase 1 must **not** define Kernel runtime; must define data Kernel will later own validation for |
| §1.3 Forbidden in kernel | Contracts must not embed Navbar/Hero ontology |
| §2.2 Decision Record fields | **Normative field set** Phase 1 Decision Record must cover |
| §2.3 Decision lifecycle | Status values and lowering authorization (“committed” slices → EmitPlan) must be representable |
| §2.4 Determinism policy | Contracts must support pinning knowledge/rule/policy versions as data on jobs/reports |
| §3 Knowledge Base | Pattern ids may appear as **references** in evidence/candidates; Knowledge Bundle content is out of scope |
| §5 Priority bands | Representable as metadata on candidates/evidence later; Phase 1 needs extensibility, not band runtime |
| §6 Workspace model | Fact / Hypothesis / Decision / IR slice as distinct contract kinds |
| §7 Confidence | Scores and breakdown slots on Decision Record; algebra is Phase 4/27 |
| §7.5 Overrides | Decision status `overridden` and override-capable representation required |
| §8 Recovery | Fallen-back / rejected statuses; QualityReport violation slots |
| §12 Explainability | `trace_refs` and ProvenanceBundle linkage fields |
| §13 Stable surfaces | Decision Record schema additive evolution; provenance requirements |

### 2.3 Implementation Master Plan

| Section | Relevance |
|---------|-----------|
| §2 Guiding Principles | Facts ≠ interpretations; determinism; Emit lowering-only; no hidden heuristics |
| §3 Dependency Map | Phase 1 before Kernel; hard order |
| §4 Phase 1 table | Purpose, scope, deliverables, exit criteria, rollback, complexity **M** — authoritative for this phase |
| §5 Phase order | Phase 1 is second executable phase after Phase 0 |
| §6 Testing matrix row for Phase 1 | Schema fixtures, contract load, schema compat, Decision schema round-trip |
| §8 Implementation Rules | Traceability to RFC; no inventiveness in later lowering |
| §9 Deliverable Matrix | Decision Records → Phase 1 (schema); Provenance → Phase 1 (schema); multi-stage IR → Phase 1 registry |
| §10 Definition of Done | Downstream; Phase 1 is a prerequisite slice only |

---

## 3. Deliverables

Every deliverable below is a **contract artifact** (definitions, registries, rules, fixtures). Not runtime engines. Not product UI ontology.

### 3.1 Core compile-input / graph contracts

| Deliverable | Description of expected artifact |
|-------------|----------------------------------|
| **RawDesignDocument contract** | Envelope for untouched design subtree + identity/metadata needed to attribute provenance; explicitly pre-normalization; no layout interpretation fields framed as Decisions |
| **NormalizedDesignGraph contract** | Stable node/edge graph: identity space, visibility, boxes, structural links; paints/geometry as **data**, not semantic conclusions |
| **Shared Node Identity rules** | How stable ids are represented and referenced across all graphs |

### 3.2 Reasoning contracts

| Deliverable | Description |
|-------------|-------------|
| **Fact contract** | Immutable assertions derived from source/normalization (or derived-fact protocol placeholders); distinguishable from Decisions |
| **Hypothesis contract** | Uncommitted proposals: question, subject, candidate payload, producing engine/pack identity slots, local score slots |
| **Candidate contract** | Answer payload shape usable inside Hypotheses and Decision Records |
| **Evidence contract** | Feature / rule hit / graph match / override references without embedding rule engines |
| **Decision Record contract** | Full RFC-002 §2.2 field coverage: id, subject, question, candidates, evidence, scores, ranking, winner, policy, status, alternatives_kept, trace_refs — including **winner = abstain**, statuses including proposed / arbitrated / overridden / fallen-back / rejected |
| **Question type registry (initial)** | Enumerated / namespaced question ids sufficient for later phases (`layout.*`, `semantic.*`, `html.*`, …) as an **extensible registry**, not a closed world of all future questions |

### 3.3 IR stage contracts (spine)

| Deliverable | Description |
|-------------|-------------|
| **IR stage registry** | Ordered, named stages with: stage id, version, allowed predecessors, whether stage holds Facts vs resolved commitments vs lowering plans |
| **Specialized IR envelopes** | Minimal stage contracts for LayoutIR, ComponentIR, TokenIR, AssetIR, BehaviorIR, SemanticIR, A11y-related slice (as named in RFC-001) — **envelopes and identity linkage only**, not full domain field catalogs |
| **ResolvedIR contract** | Post-arbitration compile truth envelope; markers for committed slices authorized for lowering |
| **EmitPlan contract** | Lowering intent only: chosen tags/roles as **references to committed Decisions**, class strategy slots, JS module authorization slots, asset embed plan references — **no** pattern detection fields |
| **ArtifactSet contract** | Emitted artifact map envelope (document kinds + optional maps); not HTML authoring rules |

### 3.4 Policy, quality, provenance

| Deliverable | Description |
|-------------|-------------|
| **Policy Profile contract** | Profile identity; named threshold/budget **slots** (accept_min, margin_min, fallback_below, fail_closed_below, pattern_name_cap, budgets…); allowed-engine / allowed-pack slots; **values and product policy docs are Phase 5** |
| **Compile Job Fingerprint contract** | Named inputs required for determinism: policy id/version, Knowledge Bundle version slot, rule-set version slot, contract suite version |
| **QualityReport contract** | Multi-axis score slots (per RFC-001 §7 names), violations list, decision-trace references, recovery/fallback notations |
| **ProvenanceBundle contract** | Bindings among source node ids ↔ IR node ids ↔ emit anchors ↔ decision ids |

### 3.5 Governance artifacts

| Deliverable | Description |
|-------------|-------------|
| **Contract suite versioning rules** | How the suite versions (semver or equivalent); what constitutes major/minor/patch for contracts |
| **Compatibility rules** | Additive evolution requirements; forbidden breaking changes without major bump; consumer expectations for unknown fields |
| **Cross-contract consistency rules** | e.g., Decision subjects must use Shared Node Identity; EmitPlan tag choices must reference Decision ids; Facts immutable once published under a Fact id |
| **Fixture pack** | Empty/minimal valid examples for each contract; at least one Decision Record fixture each for **winner**, **abstain**, and **overridden** |
| **Phase 1 Contract Catalog** | Index of all contracts + stage registry + version of the suite — the handoff index for Phase 2 |
| **Review record template** | Checklist used to mark Phase 1 exit (see §8) |

### 3.6 Explicitly not deliverables in Phase 1

- Working Kernel, Workspace, or engines  
- Rule packs, Knowledge Bundle content, pattern libraries  
- Threshold numeric tables as product policy  
- HTML/CSS/JS emitters  
- Snapshot/disk formats  
- Scoring algorithms, arbitration algorithms, layout solvers  

---

## 4. Scope

### 4.1 In Scope

- Defining and reviewing all deliverables in §3.1–§3.5  
- Aligning Decision Record fields to RFC-002 §2.2 without omission  
- Registering multi-stage IR per RFC-001 §6.3–§6.4 as envelopes + identity rules  
- Versioning + compatibility + consistency rules  
- Fixture examples sufficient for schema validation and Decision round-trip checks  
- Documenting extensibility points for later question types and specialized IR fields  
- Escalating only if a **critical contradiction** between frozen RFCs/Master Plan is discovered  

### 4.2 Out of Scope

- Any compiler runtime behavior  
- Engine registration or scheduling behavior  
- Workspace mutation protocols beyond what field immutability rules state  
- Knowledge content (Navbar, Hero, …)  
- Rule authoring  
- Policy numeric defaults as shipping product config (schema slots only)  
- Dual-run / legacy cutover  
- Corpus platform implementation (fixtures for contracts only)  
- Data-plane snapshot lifecycle  

### 4.3 Non Goals

- Perfect final field catalogs for LayoutIR / SemanticIR / BehaviorIR domain detail  
- Unifying Figma and Lovable IR into one schema  
- Optimizing for storage size or runtime speed  
- Designing debugger UI  
- Adding new architectural engines or decision models  

### 4.4 Deferred Items (mapped)

| Deferred item | Deferred to |
|---------------|-------------|
| Arbitration / confidence algebra runtime | Phase 4 |
| Policy threshold values & gate behavior | Phase 5 |
| Plugin capability enforcement | Phase 6 |
| Knowledge Bundle bytes / patterns | Phase 7+ |
| Rule pack execution | Phase 8 |
| Normalization Fact production | Phase 10 |
| Filling LayoutIR domain fields + solver | Phase 11 |
| Component/Token/Semantic/… domain fill | Phases 12–17 |
| EmitPlan consumption / codegen | Phase 19 |
| Quality score computation | Phase 24 |
| Explainability export productization | Phase 25 |
| Corpus platform | Phase 26 |

---

## 5. Implementation Task Breakdown

Tasks are engineering work units. **No code, no file paths, no algorithms** in this plan — only purpose, outputs, dependencies, validation, completion, and review.

### Task 1.1 — Contract Suite Charter

| | |
|--|--|
| **Purpose** | Fix naming, versioning identity, and catalog structure for the whole Phase 1 suite. |
| **Expected output** | Suite name; initial suite version; catalog outline listing every contract to be produced; owners/reviewers. |
| **Dependencies** | Phase 0 approval. |
| **Validation** | Catalog covers Master Plan Phase 1 scope list with no extras that invent RFC concepts. |
| **Completion criteria** | Charter reviewed; catalog list frozen for Phase 1. |
| **Review checklist** | □ Matches Master Plan Phase 1 scope □ No Kernel/engine APIs □ No UI ontology |

### Task 1.2 — Shared Identity & Cross-Cutting Rules

| | |
|--|--|
| **Purpose** | Define how nodes and decisions are referenced everywhere. |
| **Expected output** | Shared Node Identity rules; Fact immutability rule; reference rules across graphs; forbidden silent reinterpretation of Facts as Decisions. |
| **Dependencies** | Task 1.1. |
| **Validation** | Rules are testable as statements on fixtures (identity present; Fact cannot change fields in place). |
| **Completion criteria** | Written rules accepted; cited by later contract tasks. |
| **Review checklist** | □ Facts ≠ Decisions explicit □ Cross-graph id linkage clear □ No layout solver rules |

### Task 1.3 — RawDesignDocument Contract

| | |
|--|--|
| **Purpose** | Envelope for pre-brain design input. |
| **Expected output** | Contract definition + minimal valid fixture + invalid fixture notes. |
| **Dependencies** | Task 1.2. |
| **Validation** | Fixture validates; document states “no interpretation fields.” |
| **Completion criteria** | Review-approved contract. |
| **Review checklist** | □ Untouched source posture □ Provenance-capable metadata □ No EmitPlan leakage |

### Task 1.4 — NormalizedDesignGraph Contract

| | |
|--|--|
| **Purpose** | Fact-bearing structural graph contract. |
| **Expected output** | NDG contract + fixture with ≥2 nodes and an edge; paints/geometry as data slots. |
| **Dependencies** | Task 1.2, 1.3. |
| **Validation** | Fixture uses Shared Node Identity; distinguishable from RawDesignDocument. |
| **Completion criteria** | Review-approved. |
| **Review checklist** | □ Stable ids □ No html.tag decisions inside NDG □ Compatible with multi-graph identity space |

### Task 1.5 — Fact, Hypothesis, Candidate, Evidence Contracts

| | |
|--|--|
| **Purpose** | Reasoning envelopes before Decision commit. |
| **Expected output** | Four contracts + fixtures showing Fact vs Hypothesis separation. |
| **Dependencies** | Task 1.2, 1.4. |
| **Validation** | Fixtures rejected if Hypothesis marked as Fact; Candidate reusable inside Decision Record. |
| **Completion criteria** | Review-approved. |
| **Review checklist** | □ Producer identity slots exist □ Scores optional at hypothesis stage □ No arbitration logic |

### Task 1.6 — Decision Record Contract (critical path)

| | |
|--|--|
| **Purpose** | Normative Decision Record per RFC-002 §2.2. |
| **Expected output** | Decision Record contract; fixtures: **winner**, **abstain**, **overridden**; status enum coverage; policy reference slot; trace_refs slot. |
| **Dependencies** | Task 1.5. |
| **Validation** | Field-by-field checklist against RFC-002 §2.2; round-trip fixture test plan asserted. |
| **Completion criteria** | **Exit-critical**: can represent winner, abstain, override; review sign-off. |
| **Review checklist** | □ All RFC-002 §2.2 fields □ abstain as winner form or equivalent explicit □ status includes overridden / fallen-back / rejected □ alternatives_kept present □ No pattern ontology hardcoded |

### Task 1.7 — Question Type Registry (Initial)

| | |
|--|--|
| **Purpose** | Namespaced question ids so Decisions are typed without closing the world. |
| **Expected output** | Initial registry with extension rules; examples for layout/semantic/html namespaces; process to add questions in later phases. |
| **Dependencies** | Task 1.6. |
| **Validation** | Registry does not require Kernel; extension rule prevents silent renames. |
| **Completion criteria** | Review-approved registry + extension policy. |
| **Review checklist** | □ Extensible □ No engine ownership claims □ No duplicate synonyms without alias map |

### Task 1.8 — IR Stage Registry + Specialized Envelopes + ResolvedIR

| | |
|--|--|
| **Purpose** | Make multi-stage IR enumerable and linkable. |
| **Expected output** | Stage registry (NDG, specialized stages, ResolvedIR, EmitPlan, ArtifactSet/ArtifactIR); predecessor rules; minimal envelopes for LayoutIR, ComponentIR, TokenIR, AssetIR, BehaviorIR, SemanticIR (+ a11y slice naming as in RFC-001); ResolvedIR commitment markers. |
| **Dependencies** | Task 1.4, 1.6. |
| **Validation** | Stages enumerable; illegal predecessor pairs documented; envelopes do not include solver/semantic algorithms. |
| **Completion criteria** | **Exit-critical**: IR stages enumerable; review-approved. |
| **Review checklist** | □ Matches RFC-001 stage intent □ Shared ids □ Specialized envelopes minimal □ ResolvedIR distinct from EmitPlan |

### Task 1.9 — EmitPlan + ArtifactSet Contracts

| | |
|--|--|
| **Purpose** | Lowering-only contracts. |
| **Expected output** | EmitPlan contract requiring references to committed Decisions for interpretive choices; ArtifactSet envelope. |
| **Dependencies** | Task 1.6, 1.8. |
| **Validation** | Review confirms EmitPlan cannot express “detect navbar”; only consume decisions/assets/policy. |
| **Completion criteria** | Review-approved. |
| **Review checklist** | □ Lowering-only □ Decision references mandatory for tags/roles □ No fetch/snapshot fields |

### Task 1.10 — Policy Profile + Job Fingerprint Contracts

| | |
|--|--|
| **Purpose** | Bind determinism and profile slots before Kernel. |
| **Expected output** | Policy Profile contract with named knobs/slots; Compile Job Fingerprint contract listing policy + knowledge + rule-set + contract suite versions. |
| **Dependencies** | Task 1.1, 1.6. |
| **Validation** | Fingerprint fields sufficient for RFC-002 determinism statement; no numeric product defaults required. |
| **Completion criteria** | Review-approved. |
| **Review checklist** | □ Profile ids representable □ Threshold slots named per RFC-002 §7.3 □ Values deferred to Phase 5 noted |

### Task 1.11 — QualityReport + ProvenanceBundle Contracts

| | |
|--|--|
| **Purpose** | QA and explainability data spine. |
| **Expected output** | QualityReport with multi-axis score slots (RFC-001 §7 names), violations, decision/trace references; ProvenanceBundle bindings among source/IR/emit/decision. |
| **Dependencies** | Task 1.6, 1.9. |
| **Validation** | Fixtures link a Decision id to a provenance entry; score axes listed even if empty. |
| **Completion criteria** | Review-approved. |
| **Review checklist** | □ Axes named □ Violations structured □ Provenance covers source↔decision↔emit slots □ No scoring formulas |

### Task 1.12 — Versioning, Compatibility, Consistency Rulebook

| | |
|--|--|
| **Purpose** | Govern evolution so corpora and Kernel do not break silently. |
| **Expected output** | Versioning rules; compatibility rules (additive default); consistency rules across contracts; breaking-change policy. |
| **Dependencies** | Tasks 1.3–1.11 drafts available. |
| **Validation** | Rulebook reviewed against RFC-002 “Decision Record schema additive evolution.” |
| **Completion criteria** | Rulebook approved; suite version assigned. |
| **Review checklist** | □ Semver (or equivalent) clear □ Unknown-field policy clear □ Major bump criteria clear |

### Task 1.13 — Fixture Pack & Validation Harness Spec

| | |
|--|--|
| **Purpose** | Make Phase 1 testable without implementing engines. |
| **Expected output** | Complete fixture pack; written specification of validation checks (schema validity, Decision round-trip, cross-contract references, negative cases). |
| **Dependencies** | Tasks 1.3–1.12. |
| **Validation** | Spec matches Master Plan Phase 1 testing row. |
| **Completion criteria** | Fixtures cover winner/abstain/override; harness spec approved for implementation when Phase 1 coding is authorized. |
| **Review checklist** | □ Positive + negative fixtures □ Decision round-trip called out □ No runtime Kernel assumed |

### Task 1.14 — Phase 1 Catalog Freeze & Exit Review

| | |
|--|--|
| **Purpose** | Close the phase. |
| **Expected output** | Contract Catalog (final index); filled exit checklist; handoff note to Phase 2; rollback note (revise schemas only). |
| **Dependencies** | Tasks 1.1–1.13 complete. |
| **Validation** | §8 acceptance checklist all checked. |
| **Completion criteria** | Phase 1 marked complete; Phase 2 explicitly authorized. |
| **Review checklist** | □ All §3 deliverables present □ Exit criteria met □ No scope creep into Phase 2+ |

---

## 6. Architectural Rules (Constraints for Phase 1 Work)

These constraints bind Phase 1 authors and reviewers. They are derived from frozen RFCs / Master Plan — not new architecture.

1. **Facts are immutable** once published under a Fact identity; corrections are new derived Facts or invalidation records — not in-place edits disguised as the same Fact.  
2. **Interpretations are never Facts**; tags, patterns, “this is navigation,” flow reinterpretations belong in Hypotheses/Decisions.  
3. **Decision Records are versioned** as part of the contract suite; evolution is **additive** by default.  
4. **Decision Records must represent** winner, **abstain**, and **override** without schema gymnastics.  
5. **Schemas must not leak implementation** — no engine APIs, no scheduler queues, no storage engines, no HTTP, no snapshot directories.  
6. **Contracts must not embed UI ontology** (Navbar/Hero/Carousel as hardwired enum required for schema validity). Pattern ids may appear only as **open string references**.  
7. **EmitPlan is lowering-only** — may reference committed Decisions; must not detect or invent semantics.  
8. **Kernel concepts are not implemented here** — Phase 1 defines data Kernel will later validate/schedule; it does not define Kernel behavior, budgets enforcement, or engine processes.  
9. **Specialized IR envelopes stay minimal** — enough to register stages and identity; domain field depth is deferred to engine phases.  
10. **Shared node identity space** across graphs; no duplicated conflicting id schemes.  
11. **Compatibility: consumers ignore unknown additive fields**; removals/renames require major suite bump.  
12. **Determinism fingerprint inputs are named** even if Kernel does not yet compute fingerprints.  
13. **No silent behavior encoded as defaults** that later phases would treat as product policy without Phase 5 review (threshold *values* stay unset or clearly marked non-authoritative).  
14. **No new RFC concepts** without escalation of a critical contradiction.  
15. **Provenance must be expressible** from source through Decision to emit anchors.  

---

## 7. Risks

| ID | Risk | Why it matters | Mitigation in this phase |
|----|------|----------------|--------------------------|
| P1-R1 | Over-specifying contracts | Locks bad domain guesses; blocks engines | Keep specialized IR as envelopes; defer field catalogs |
| P1-R2 | Under-specifying Decision Record | Phase 4 cannot implement lifecycle | Field-by-field RFC-002 §2.2 checklist; abstain/override fixtures mandatory |
| P1-R3 | Premature optimization | Wastes time on storage/perf | Forbid perf goals in review checklist |
| P1-R4 | Leaking future engine details | Couples Layout/Semantic into spine | Reject solver/pattern-match fields in Phase 1 reviews |
| P1-R5 | Collapsing Fact/Decision | Recreates today’s silent heuristics | Explicit separation rules + negative fixtures |
| P1-R6 | EmitPlan inventiveness slots | Lowers intelligence into codegen later | Require Decision references for interpretive choices |
| P1-R7 | Closed question enum | Forces constant major bumps | Extensible question registry |
| P1-R8 | Policy values sneaking in | Skips Phase 5 governance | Slots only; values non-authoritative |
| P1-R9 | Catalog incompleteness | Downstream phases invent private types | Master Plan scope list as coverage gate |
| P1-R10 | Breaking changes without rules | Corpora rot immediately | Task 1.12 rulebook before exit |
| P1-R11 | Scope creep into Kernel/Workspace | Violates phase order | Exit review rejects runtime behavior |
| P1-R12 | Contradiction discovery paralysis | Blocks progress | Escalate critical contradictions only; do not redesign casually |

---

## 8. Validation Plan

### 8.1 How reviewers know Phase 1 is complete

Reviewers inspect **artifacts**, not demos:

1. Contract Catalog lists every §3 deliverable with suite version.  
2. Each contract has a definition + at least one valid fixture.  
3. Decision Record fixtures demonstrate winner, abstain, override.  
4. IR stage registry enumerates stages with predecessors.  
5. Versioning/compatibility/consistency rulebook exists.  
6. Validation harness **specification** matches Master Plan Phase 1 testing expectations.  
7. No artifact requires Kernel/engines to “make sense.”  
8. Exit checklist (§8.3) is fully signed.

### 8.2 Review questions

1. Can a Decision Record represent **abstain** and **override** as first-class outcomes?  
2. Is every RFC-002 §2.2 field accounted for?  
3. Are Facts clearly immutable and distinct from Hypotheses/Decisions?  
4. Does EmitPlan **forbid** semantic detection and **require** Decision references for interpretive choices?  
5. Are IR stages enumerable, and are specialized IRs **envelopes** rather than full engine designs?  
6. Does the Job Fingerprint name policy, knowledge, rule-set, and contract suite versions?  
7. Can ProvenanceBundle link source ↔ decision ↔ emit?  
8. Does QualityReport reserve RFC-001 §7 axis names?  
9. Is UI ontology absent from required enums?  
10. Are compatibility rules strong enough for additive evolution?  
11. Did any task smuggle Kernel scheduling, arbitration math, or HTML emission?  
12. Is anything in the catalog **not** justified by RFC-001 / RFC-002 / Master Plan Phase 1?

### 8.3 Acceptance checklist

- [ ] Task 1.1–1.14 completion criteria met  
- [ ] All §3.1–§3.5 deliverables present in Catalog  
- [ ] Decision Record ↔ RFC-002 §2.2 matrix attached and complete  
- [ ] Fixtures: winner / abstain / overridden  
- [ ] IR stages enumerable with predecessors documented  
- [ ] EmitPlan reviewed as lowering-only  
- [ ] Policy Profile = slots only (or clearly non-authoritative placeholders)  
- [ ] Versioning + compatibility + consistency rulebook approved  
- [ ] Validation harness spec approved  
- [ ] No new RFC concepts introduced (or contradiction escalation recorded)  
- [ ] Handoff to Phase 2 written (§9)  
- [ ] Phase owner + reviewer sign-off  

### 8.4 Exit criteria (authoritative)

From Master Plan Phase 1, restated for execution:

1. **Contracts review-approved.**  
2. **Decision Record can represent winner, abstain, and override.**  
3. **IR stages enumerable.**  
4. Fixture pack + validation harness spec ready so implementation of Phase 1 artifacts can be verified immediately upon coding authorization.  
5. **Rollback posture** confirmed: schemas may be revised; nothing runtime depends on them yet.  

Phase 1 is **not** complete if only narrative docs exist without fixture-testable contract definitions.

---

## 9. Handoff to Phase 2 (Compiler Kernel)

### 9.1 What Phase 2 may assume

After Phase 1 exit:

1. A **versioned contract suite** exists and is the vocabulary for job data.  
2. **IR stage registry** tells Kernel which stages exist and which predecessor constraints apply.  
3. **Fact / Hypothesis / Decision Record / Candidate / Evidence** shapes are fixed enough to store and validate.  
4. **Policy Profile** envelope exists so Kernel can **bind a profile identity** and carry threshold **slots** (even if values are filled in Phase 5).  
5. **Job Fingerprint** field names exist so Kernel can record determinism inputs.  
6. **QualityReport** and **ProvenanceBundle** envelopes exist so Kernel gate hooks have types to attach later.  
7. **ResolvedIR** commitment markers exist so Kernel can later enforce “lowering only from committed slices.”  
8. **Compatibility rules** constrain how Kernel may evolve stored job snapshots.  
9. Fixtures exist that Kernel tests may reuse as opaque payloads.  

### 9.2 What Phase 2 must NOT redefine

1. Decision Record field meanings or status vocabulary (extend only under suite versioning rules).  
2. Fact vs Decision distinction.  
3. EmitPlan’s lowering-only posture.  
4. IR stage names/order already registered (additions follow extension rules; silent renames forbidden).  
5. Shared Node Identity rules.  
6. UI ontology (still forbidden in Kernel).  
7. Arbitration math, confidence formulas, rule execution — those are Phase 4/8, not “Kernel redefinition of Decision shape.”  
8. Policy threshold **product values** — Phase 5 owns authoritative values; Kernel may bind but not invent ontology.  
9. Specialized IR domain field catalogs — still owned by later engine phases.  
10. Contract suite governance — Kernel consumes versions; it does not become a second schema authority.  

### 9.3 Immediate Phase 2 entry condition

Phase 2 starts only when §8.3 is signed and this handoff section is acknowledged by the Phase 2 owner.

---

## 10. Rollback Strategy

If Phase 1 is rejected mid-review or found wrong after approval but before Phase 2 dependency:

- Revise contract artifacts under suite versioning rules.  
- Do not partially implement Kernel against draft contracts.  
- Discard or quarantine fixtures tied to rejected shapes.  
- No production compile path depends on Phase 1 yet — rollback cost is documentation/suite revision only.  

---

## 11. Authorization to Implement

Implementation of Phase 1 artifacts may begin **only after** this Execution Plan is approved.

Until then:

- Do not implement.  
- Do not modify product code.  
- Do not create branches for Phase 1 work.  
- Do not start Phase 2.  

---

**End of Phase 1 Execution Plan. Stop. Await review and approval.**
