# RFC-002: Compiler Decision System

| Field | Value |
|-------|--------|
| **Status** | Architecture Review — Decision-System Design (authoritative when approved) |
| **Date** | 2026-07-18 |
| **Supersedes for “how the compiler thinks”** | RFC-001 engine lists and linear phase narrative (where they conflict) |
| **Depends on** | RFC-001 for pipeline inventory and problem framing |
| **Non-goals** | Implementation, code, commits, branches, file-level prescriptions |
| **Authority** | After approval, **this document is the single source of truth for compiler reasoning**. No implementation may begin until it is reviewed and approved. |

---

## Preamble — Why this document exists

RFC-001 answered: *What stages and engines might exist?*

It did **not** answer: *How does the compiler decide?*

A compiler without a decision system becomes a pile of heuristics that:

- cannot explain themselves,
- cannot regress safely,
- cannot accept plugins without rewiring,
- optimize for demos,
- and silently disagree with themselves.

This RFC defines the **Compiler Brain**: kernel, decisions, knowledge, confidence, recovery, corpora, testing, plugins, explainability, and long-term evolution.

### Critical stance toward RFC-001

RFC-001 is a useful **inventory and aspiration map**. It is **not** a complete reasoning architecture.

Several of its structural suggestions are weak or wrong if taken literally (especially the linear engine chain and the undifferentiated “missing engines” catalog). This document challenges those assumptions and proposes a better long-term design. Where RFC-001 and RFC-002 conflict on **reasoning**, **RFC-002 wins** after approval. Where they conflict only on **packaging / data-plane inventory**, RFC-001 remains descriptive of history until amended.

### Core thesis

> The compiler is not a pipeline of opinionated transformers.  
> It is a **deterministic substrate** plus a **multi-hypothesis decision system** that produces an **explainable, confidence-annotated ResolvedIR**, then lowers that IR under an explicit **compile policy**.

---

## 1. The Compiler Kernel

### 1.1 Definition

The **Compiler Kernel** is the minimal, stable core that:

1. owns the **compile job lifecycle**,
2. owns the **shared workspace** (facts, hypotheses, decisions, IR stages),
3. schedules **engines** according to a **capability / dependency graph**,
4. runs **arbitration** when hypotheses conflict,
5. enforces **policy profiles** and **gates**,
6. emits **decision traces** and **provenance**,
7. never “knows” what a Navbar is.

The kernel is the **operating system of compilation**. Engines are **processes**. Knowledge is **data**. Decisions are **first-class objects**.

### 1.2 Responsibilities that belong in the kernel

| Responsibility | Why kernel |
|----------------|------------|
| Job identity, policy profile, budgets (time, memory, asset bytes, DOM nodes) | Cross-cutting; engines must not invent global policy |
| Workspace lifecycle (create, snapshot, finalize, discard) | Single source of compile state |
| IR stage registry and schema validation between stages | Prevents silent contract drift |
| Engine registration, capability declaration, scheduling | Plugin surface |
| Decision object creation, identity, immutability rules | Explainability + regression |
| Conflict arbitration protocol (not domain opinions) | Fair, consistent resolution |
| Confidence algebra (combine, decay, floor/ceiling) | Shared math; engines supply scores, not ad-hoc thresholds everywhere |
| Failure taxonomy + recovery orchestration | Prevents each engine inventing stop/continue |
| Gate evaluation (quality / safety / policy) | Product boundary |
| Provenance binding (source node ↔ IR ↔ emit) | Debugging contract |
| Determinism controls (seed, rule-set version, knowledge version) | Reproducible builds |

### 1.3 Responsibilities that must NEVER belong in the kernel

| Forbidden in kernel | Belongs instead |
|---------------------|-----------------|
| Pattern names (“Hero”, “Pricing”, “Carousel”) | Knowledge Base + Pattern engines |
| Layout physics / constraint solving domain rules | Layout Engine (+ solver as its subsystem) |
| Tag guessing (`nav` vs `div`) | Semantic Engine under policy |
| Accessibility role invention | Accessibility Engine |
| Design-token extraction | Token / Design-System Engine |
| Animation / interaction interpretation | Motion / Interaction Engines |
| Network fetch, auth, rate limits | Source / data plane adapters |
| Snapshot disk format, CDN downloads | Data plane |
| HTML string building, CSS pretty-printing | Lowering / Codegen |
| Packaging zip layout | Package plane |
| Corpus curation UX | Corpus / QA plane |
| Model weights, prompt text, “AI vibes” | Optional AI Engine **behind** the same decision contracts |

### 1.4 Kernel invariants

1. **Kernel has no UI ontology.**
2. **Kernel does not emit HTML.**
3. **Kernel does not call design APIs.**
4. **Every non-deterministic claim enters the workspace as a Hypothesis or Decision, never as a silent mutation.**
5. **Deterministic lowers may proceed only from ResolvedIR + Policy.**
6. **Engines may propose; only Arbitration + Policy may accept.**

---

## 2. Decision Engine

### 2.1 What kind of decision system?

**Hybrid — mandatory.** Pure approaches fail for universal design compilation:

| Style | Strength | Fatal weakness alone |
|-------|----------|----------------------|
| Rule-based | Explainable, regressable, versionable | Brittle on messy files; combinatorial explosion |
| Heuristic-based | Soft matching, useful priors | Opaque if not wrapped as scored hypotheses |
| Graph-based | Structure/layout/component relations | Graphs do not choose tags or behaviors by themselves |
| Confidence-based | Enables fallbacks and gates | Confidence without candidates is theater |
| Ranked | Resolves ambiguity | Ranking without shared features is arbitrary |
| Statistical / learned | Scales with corpus | Unusable as sole authority without traces and overrides |

**Authoritative model: Hypothesis → Score → Rank → Arbitrate → Commit → Lower**

Rules and heuristics **generate candidates**.  
Graphs **supply structure and features**.  
Confidence **annotates**.  
Ranking **orders**.  
Arbitration **commits** under policy.  
Nothing “just becomes” a `<section>`.

### 2.2 Decision as a first-class object

Every meaningful choice is a **Decision Record** (logical schema):

| Field | Meaning |
|-------|---------|
| `id` | Stable within job |
| `subject` | Node id(s), region, or edge set |
| `question` | Typed question (`layout.mode`, `semantic.role`, `html.tag`, …) |
| `candidates[]` | Competing answers |
| `evidence[]` | Features / rule hits / graph matches / overrides |
| `scores[]` | Per-candidate confidence + breakdown |
| `ranking` | Ordered candidate ids |
| `winner` | Accepted candidate or `abstain` |
| `policy` | Which profile and thresholds applied |
| `status` | proposed / arbitrated / overridden / fallen-back / rejected |
| `alternatives_kept` | Near-misses retained for debug |
| `trace_refs` | Links to explainability log |

**Deterministic facts** (e.g., “node has `layoutMode=HORIZONTAL` in source”) are **Facts**, not Decisions.  
**Interpretations** (e.g., “this horizontal stack is navigation”) are Decisions.

### 2.3 Full decision lifecycle

```text
0. Policy bind
   └─ compile profile, thresholds, allowed engines, budgets

1. Fact ingestion
   └─ NormalizedDesignGraph facts enter workspace (immutable)

2. Hypothesis generation (parallel, engine-scoped)
   └─ Rules / pattern matchers / solvers propose Candidates
   └─ Each Candidate carries local confidence + evidence

3. Feature enrichment
   └─ Graph queries, geometry features, token signals, name signals
   └─ No commit yet

4. Scoring
   └─ Confidence Engine normalizes engine-local scores into job-global scores
   └─ Apply priors (knowledge version) and penalties (conflict, rarity)

5. Ranking
   └─ Per Decision Question, order candidates
   └─ Detect ties / multi-modal ambiguity

6. Arbitration
   └─ Conflict Resolution protocol:
        - hard constraints (policy must-not)
        - priority bands (see §5)
        - confidence margins
        - abstain rules
   └─ Winner committed OR abstain with fallback plan

7. Propagation
   └─ Downstream questions may be blocked, re-scored, or invalidated
   └─ Confidence may decay across dependent decisions

8. Gate check
   └─ If critical decisions abstain under strict profile → recovery (§8)
   └─ If quality floor fails → recovery or fail-closed

9. Lowering authorization
   └─ Only ResolvedIR slices marked `committed` may lower to EmitPlan

10. Trace freeze
   └─ Decision graph + traces become part of compile artifact (optional export)
```

### 2.4 Determinism policy

- Same inputs + same **knowledge version** + same **rule-set version** + same **policy** ⇒ same Decisions.
- Optional AI engines may propose candidates **only** if their proposals are reified as scored Candidates with reproducible seeds or are marked `nondeterministic` and disabled in golden regression profiles.
- “Helpful” silent mutations are architectural defects.

---

## 3. Knowledge Base

### 3.1 What reusable UI knowledge is

Knowledge is **not** hardcoded `if name.includes("hero")` scattered in engines.

Knowledge is a **versioned, queryable library** of:

- **Pattern definitions** (Navbar, Hero, Sidebar, Pricing, FAQ, Timeline, Dashboard, Card, Form, Table, Chart, Modal, Dialog, Carousel, Accordion, …),
- **Structural motifs** (repeated peer, equal gap row, overlay centered, sticky top band),
- **Semantic obligations** (nav needs landmarks; form needs labels),
- **Emit preferences** (default tag/role under profiles),
- **Negative patterns** (what is *not* a carousel),
- **Corpus-derived priors** (optional, versioned).

### 3.2 How knowledge should exist

| Approach | Verdict |
|----------|---------|
| Hardcoded in engine logic | **Rejected** as primary store — unversionable, untestable, couples brain to code |
| Pure rule soup | **Insufficient** — rules need typed pattern targets and shared features |
| Pattern library | **Required** — named patterns with matchers, obligations, emit hints |
| Knowledge graph | **Required** — relations: Pattern ⊃ Motif, Pattern requires A11yObligation, Pattern conflicts With, Pattern specializes Pattern |
| Statistical priors only | **Optional layer** — never sole authority |

**Authoritative design: Pattern Library + Knowledge Graph + Rule Packs**, all versioned together as **Knowledge Bundle `K@semver`**.

### 3.3 Pattern entry (logical)

A Pattern (e.g., `navigation.bar`) declares:

- **identity** and aliases,
- **matchers** (rule ids, graph queries, layout predicates),
- **required / optional evidence**,
- **conflicts** (mutually exclusive patterns),
- **semantic obligations** (roles, naming),
- **default emit hints** per policy profile,
- **confidence calibration** (base prior, caps),
- **examples** linking to corpus ids (not demos-as-truth).

### 3.4 What must not be “knowledge”

- Pixel CSS recipes for one customer file.
- Undocumented tribal “we always wrap root children in section.”
- Engine-private special cases without pattern ids.

---

## 4. Pattern Recognition

### 4.1 Detection strategy: hybrid by necessity

| Method | Role |
|--------|------|
| **Tree matching** | Hierarchical motifs (card = media + title + actions) |
| **Graph matching** | Cross-cutting relations (label↔input, tab↔panel), component instances |
| **Layout matching** | Geometry: alignment, equal gaps, repetition, overlay, sticky bands |
| **Token / style matching** | Shared fills, type ramps, elevation as evidence—not labels |
| **Name / text signals** | Weak priors only; never sole accept under strict profiles |
| **Statistical / learned** | Candidate generation + prior adjustment from Pattern/Failure corpora |
| **Prototype / behavior signals** | When present, strong evidence for interactive patterns |

**Authoritative stance:** Pattern Recognition is a **candidate generator**, not a committer. Detection produces Hypotheses; Arbitration commits.

### 4.2 Ambiguity handling

Ambiguity is normal. Architecture must assume it.

1. **Keep multiple candidates** until arbitration.
2. Prefer **abstain + safe generic emit** over forced false precision when confidence margin is thin.
3. Use **conflict edges** in the knowledge graph (Hero vs AppBar when both match header band).
4. Allow **composition** where patterns nest (Dashboard contains Table contains …) instead of winner-take-all at all granularities.
5. Record **near-misses** for Failure Corpus and explainability.
6. Under **pixel-faithful** profile: suppress aggressive semantic patterns that alter structure.
7. Under **semantic-lean** profile: allow lower confidence for landmark/tag upgrades if layout fidelity gates still pass.

### 4.3 Anti-patterns for recognition

- Single regex on layer name ⇒ tag.
- Global “root children are sections” without Decision Records.
- One-shot greedy labeling that blocks later engines from revising.

---

## 5. Rule Engine

### 5.1 What a rule is

A rule is a **pure, versioned function from Facts/Features → Candidate(s)** with:

- typed `question`,
- predicates (layout, structure, repetition, tokens, names, …),
- produced candidate payload,
- local confidence contribution,
- knowledge references (`pattern:navigation.bar`),
- priority band,
- applicability constraints (policy profiles, file classes).

Example (logical, not code):

> IF parent is horizontal auto-layout  
> AND child gaps are equal within ε  
> AND children are repeated peers (similarity ≥ τ)  
> AND vertical position is within top band of page  
> THEN candidate `pattern:navigation.bar` on subject=parent  
> WITH evidence `{equalGap, repeatedPeers, topBand}`  
> CONFIDENCE base from knowledge prior × feature strengths

### 5.2 Organization

Rules organize as **Rule Packs**:

| Pack | Concern |
|------|---------|
| `layout.interpret` | Absolute↔flow, grid suspicion, sticky suspicion |
| `pattern.marketing` | Hero, pricing, FAQ, testimonials |
| `pattern.app` | Sidebar, dashboard chrome, data table |
| `semantic.html` | Tag/role candidates |
| `a11y.obligations` | Required names/roles given patterns |
| `responsive.bind` | Constraint → strategy candidates |
| `interaction.detect` | Carousel/accordion/modal candidates |
| `emit.prefs` | Lowering preferences (never bypass arbitration) |

Packs are enabled/disabled by **policy** and **engine capabilities**.

### 5.3 Priority and conflict resolution

**Priority bands** (high → low), kernel-enforced:

| Band | Meaning | Example |
|------|---------|---------|
| P0 Hard source facts | Cannot be “outvoted” by heuristics | Explicit auto-layout mode in source |
| P1 Safety / policy must | Fail or abstain rather than violate | No invented interactive JS under `static-ok` |
| P2 Solver / layout consistency | Geometric consistency | Non-overlapping claim vs measured overlap |
| P3 Design-system / component graph | Strong structured signal | Instance of known `Nav` component |
| P4 Pattern library matches | Multi-feature pattern hits | Navigation pattern |
| P5 Weak heuristics | Names, single feature | Layer named “Menu” |
| P6 Speculative / AI | Lowest unless human override | LLM guess |

**Conflict resolution algorithm (logical):**

1. Drop candidates violating P0–P1.
2. Among remainder, require **confidence margin** `top − second ≥ δ(profile)`.
3. If margin fails → **abstain** or choose **safe generic** candidate if one exists.
4. If two candidates are **composable** (different subjects or nestable patterns) → allow both.
5. If mutually exclusive → higher band wins; if same band → higher score; if tie → abstain.
6. Human / corpus **overrides** sit above P4–P6 but cannot violate P0–P1 without explicit dangerous-policy flag.

Rules do **not** call each other into spaghetti. They only emit Candidates into the workspace.

---

## 6. Decision Graph — How engines communicate

### 6.1 Critique of the linear chain

RFC-001-style:

```text
Layout → Component → Semantic → Accessibility → Responsive → Emit
```

**This is incorrect as a thinking model.**

Problems:

- Semantics often **inform** layout interpretation (and vice versa).
- Accessibility obligations **depend on** semantic hypotheses but must also **veto** bad semantics.
- Responsive binding needs layout **and** constraints **and** sometimes pattern intent.
- Emit is not an engine peer; it is a **lowering** after resolution.
- Linear pipelines force premature commitment and hidden back-edges.

### 6.2 Authoritative communication model: Workspace + Capability DAG

```text
                    ┌─────────────────────────┐
                    │     COMPILER KERNEL     │
                    │  workspace · arbitrate  │
                    │  schedule · gates       │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
   Fact Producers        Hypothesis Engines      Lowering Consumers
   (normalize,           (layout, component,     (emit plan, codegen,
    source bind)          semantic, a11y,         package)
                          responsive, motion,
                          tokens, patterns, …)
         │                      │                      ▲
         └──────────► Workspace ◄──────────────────────┘
                      Facts
                      Hypotheses
                      Decisions
                      IR slices
```

**Engines do not pipe output privately to the next engine.**  
They **read Facts / committed Decisions** and **write Hypotheses / derived Facts** through the workspace under declared capabilities.

### 6.3 Scheduling graph (not opinion chain)

Engines declare:

- **reads**: fact kinds, decision questions,
- **writes**: hypothesis kinds,
- **requires-committed**: optional hard prerequisites,
- **phase affinity**: early | mid | late | lowering,
- **reentrant**: whether they may re-run after invalidation.

The kernel builds a **capability DAG** for scheduling waves:

1. **Wave A — Facts:** normalization, geometry features, component graph extraction, token extraction (as facts).
2. **Wave B — Structural hypotheses:** layout interpretations, pattern matches, interaction candidates (parallel).
3. **Wave C — Arbitration #1:** commit layout-critical decisions needed for consistency.
4. **Wave D — Dependent hypotheses:** a11y, responsive, semantic refinement using committed layout.
5. **Wave E — Arbitration #2:** commit remaining semantic/a11y/responsive decisions.
6. **Wave F — Lowering:** EmitPlan under policy; codegen; validate.

Waves may loop **bounded** times on invalidation (recovery), never unbounded “AI debate.”

### 6.4 Emit’s place

**Emit is not a peer reasoner.**  
Emit consumes **ResolvedIR + committed Decisions + Policy**.  
If Emit needs a choice, that choice was missing upstream — an architectural bug.

---

## 7. Confidence System

### 7.1 Confidence generation

Each Candidate receives a score in `[0, 1]` composed from:

| Component | Meaning |
|-----------|---------|
| Evidence strength | How completely matchers fired |
| Evidence independence | Penalize correlated double-counting |
| Knowledge prior | Pattern base rate in Knowledge Bundle |
| Conflict penalty | Concurrent exclusive hypotheses |
| Source authority | Component graph > name string |
| Policy fit | Some patterns disallowed → score 0 |
| Stability | Disagreement under small geometry ε → penalty |

Engines produce **raw scores**; the kernel’s Confidence Engine **calibrates** to a global scale so “0.7” means comparable across engines.

### 7.2 Confidence propagation

Dependent decisions use explicit rules:

- **Min / noisy-OR / weighted** combination declared per question type—not ad hoc.
- If parent decision abstains, children either abstain or switch to **safe defaults**.
- Revising a committed decision **invalidates** dependents and forces re-score (bounded).

### 7.3 Thresholds (policy-owned)

Thresholds live in **Compile Policy**, not scattered engines:

| Knob | Role |
|------|------|
| `accept_min` | Minimum confidence to commit non-generic winner |
| `margin_min` | Minimum gap vs runner-up |
| `fallback_below` | Below this, use safe generic / prior committed layout fact |
| `fail_closed_below` | For critical questions under strict profiles, fail job |
| `pattern_name_cap` | Cap on confidence from name-only evidence |

Example profiles (logical):

- **pixel-faithful:** high `accept_min` for semantic upgrades; aggressive abstain.
- **semantic-lean:** lower `accept_min` for landmarks; still high for structure-changing patterns.
- **static-ok:** interaction pattern commits do not authorize JS.
- **interactive-required:** missing behavior coverage fails gate.

### 7.4 Fallback thresholds

Fallbacks are **tiered**:

1. Safe generic semantic (`div` / no pattern).
2. Layout fact-only (absolute/flex as source says).
3. Asset degrade (vector → raster → placeholder).
4. Partition / partial compile.
5. Fail-closed with QualityReport.

### 7.5 Manual override capability

Overrides are first-class:

- **Subject + question + forced winner + actor + reason + expiry**.
- Stored in corpus / job overlays.
- Appear in traces as `status=overridden`.
- Cannot silently bypass P0 facts or safety policy without `dangerous_override` flag.
- Golden regression profiles may include approved overrides as expected Decisions.

---

## 8. Failure Recovery Architecture

### 8.1 Failure kinds

| Kind | Example |
|------|---------|
| Engine crash / timeout | Layout engine exceeds budget |
| Unsat / contradiction | Constraint solver cannot satisfy |
| Low confidence / ambiguity | Two patterns tied |
| Missing input | No path geometry; no prototype |
| Downstream gate fail | A11y profile not met |
| Resource | Memory / asset storm |

### 8.2 Recovery policy (not one global behavior)

Recovery is **typed** by failure kind + policy:

| Failure | Default stance |
|---------|----------------|
| Timeout in non-critical engine | Disable engine for job; continue with reduced hypothesis set; mark quality penalty |
| Timeout in layout-critical path | Retry once with reduced fidelity mode; then fallback to bounding-box absolute layout |
| Unsat constraints | Relax lowest priority constraints; record; if still unsat → absolute boxes |
| Ambiguity | Abstain + safe generic; keep candidates in trace |
| Missing asset | Fallback chain; continue |
| Gate fail under strict profile | Fail-closed (stop) with report |
| Gate fail under best-effort | Emit with warnings + reduced score |
| Critical kernel/workspace corruption | Stop |

**Compilation does not always stop.** Blind always-continue and blind always-stop are both wrong.

### 8.3 Retry

- Retries are **budgeted**, **mode-changing** (not identical loops), and **traced**.
- No automatic infinite retry.
- Network/data-plane retries are outside the decision brain but must surface as Facts (“asset unavailable”).

### 8.4 Ask another engine?

Yes, via **re-entrant scheduling**, not chatty side channels:

- Arbitration may request `engine.layout` to re-propose under `mode=conservative`.
- Semantic engine may be asked for generic-only candidates.
- AI engine may be invited **only** if policy enables it and results enter as Candidates.

### 8.5 Multiple candidates

- **During reasoning:** always multiple candidates until commit.
- **As emit outputs:** generally **one** ResolvedIR per job; optional **shadow candidates** retained in traces for QA—not multiple shipped HTMLs unless policy `emit_alternates` is explicit (expensive, rare).

---

## 9. Corpus Strategy

Corpora are how the brain **learns without corrupting the kernel**.

### 9.1 Corpus types

| Corpus | Purpose |
|--------|---------|
| **Golden corpus** | Approved input→artifact (and/or Decision) expectations for release gates |
| **Regression corpus** | Historical failures that must not return; includes “fixed” cases |
| **Knowledge corpus** | Exemplars that calibrate pattern priors and matcher tests |
| **Pattern corpus** | Labeled regions: “this subtree is Pricing” with reviewer grade |
| **Failure corpus** | Ambiguity, abstains, wrong commits, orphan temps, rate limits—operational + cognitive |
| **Adversarial / worst-case corpus** | Intentionally pathological files (messy absolute, huge, dark patterns) |
| **Policy corpus** | Same file compiled under multiple profiles with different expected Decisions |

### 9.2 How corpora improve the compiler

1. **Rule/Pack changes** land only with corpus deltas.
2. **Knowledge Bundle versions** bump when patterns/priors change.
3. **Confidence calibration** fits on Knowledge + Pattern corpora; validated on Golden held-out sets.
4. **Failure corpus** drives new negative rules and abstain conditions.
5. Scale goal: hundreds/thousands of files improve **bundles and packs**, not one-off engine forks.

### 9.3 Maintenance rules

- Every golden entry declares **policy profile** and **knowledge version**.
- No golden may be “visual vibe” without measurable oracles (§10).
- Pattern labels require dual review or elevated trust tier.
- Failures must include Decision traces when available.
- Demo marketing URLs may enter Knowledge corpus; they **must not** alone define Golden gates.
- Quarantine flaky entries; flaky goldens are architectural debt.

---

## 10. Testing Architecture

Quality validation is multi-oracle. Decision correctness is first-class.

### 10.1 Oracle layers

| Layer | Validates | Typical oracles |
|-------|-----------|-----------------|
| **Pixel** | Visual fidelity | Screenshot compare at viewports; structural box IoU |
| **DOM** | Structure economy / stability | Depth, node counts, wrapper ratios, stable selectors where required |
| **Semantic** | Meaning | Landmark presence, heading outline, pattern obligations |
| **Accessibility** | Operability | Automated a11y engines + focus order checks under profile |
| **Responsive** | Adaptation | Reflow tests; constraint honor; no catastrophic overlap |
| **Performance** | Budgets | Bytes, rule counts, SVG path cost |
| **Regression** | Change control | Golden diffs on artifacts **and** Decision sets |
| **Decision correctness** | Brain | Expected winners/abstains/margins for labeled questions |

### 10.2 Decision testing (non-negotiable)

For labeled subjects:

- expect `winner`, or expect `abstain`,
- expect confidence **band**, not brittle exact floats,
- expect **evidence keys** present,
- expect **non-winners** excluded,
- run under declared Knowledge Bundle version.

### 10.3 Separation of tests

- **Unit:** rule predicates, confidence combine, arbitration ties.
- **Pack:** pattern matchers on Pattern corpus fixtures.
- **Job:** full compile goldens.
- **Adversarial:** worst-case corpus must not crash kernel; quality may be low but recovery must be correct.
- **Plugin contract:** fake engine registration tests.

Pixel-only CI is insufficient for a reasoning compiler. Decision-only CI is insufficient for a visual compiler. **Both** are required.

---

## 11. Plugin Architecture

### 11.1 Goal

Add Animation, AI, Accessibility, Design-System engines **without rewriting the kernel**.

### 11.2 Engine plugin contract (logical)

An engine plugin declares:

| Declaration | Purpose |
|-------------|---------|
| `id` + `semver` | Identity |
| `capabilities.reads` | Workspace inputs |
| `capabilities.writes` | Hypothesis / derived fact kinds |
| `questions` | Decision questions it may propose for |
| `packs` | Optional rule packs it contributes |
| `phase affinity` | Scheduling hint |
| `budgets` | Time/memory claims |
| `determinism` | `pure` \| `seeded` \| `nondeterministic` |
| `failure modes` | What it may throw / abstain |

Kernel responsibilities for plugins:

- discover/register,
- isolate failure (plugin crash ≠ kernel crash),
- enforce capability permissions,
- strip writes outside declared kinds,
- include plugin version in determinism fingerprint.

### 11.3 What plugins must not do

- Mutate NormalizedFacts in place without derived-fact protocol.
- Bypass arbitration to write ResolvedIR.
- Perform codegen.
- Own global thresholds.
- Reach into another engine’s private memory.

### 11.4 AI Engine specifically

AI is a **Candidate Proposer**:

- outputs scored Candidates + natural-language evidence (stored as trace notes),
- never silently final,
- disabled in determinism-strict goldens unless snapshotting proposals,
- subject to P6 band.

---

## 12. Explainability

### 12.1 Decision traces

For every committed or abstained Decision, the trace answers:

1. **Question** — what was asked  
2. **Subject** — which nodes  
3. **Candidates** — what was considered  
4. **Evidence** — why each scored  
5. **Ranking** — order and margins  
6. **Arbitration rule** — which band/threshold fired  
7. **Winner / abstain** — result  
8. **Policy** — profile and knobs  
9. **Invalidations** — if later revised  

### 12.2 Debugging workflow (architectural)

Developer asks: *Why is this a `<section>` instead of `<div>`?*

Debugger shows:

- `question=html.tag` (or `semantic.region` → lowering hint),
- candidates `{section@0.62, div@0.55, …}`,
- evidence `{rootChildRegion, pattern:marketing.block, name:weak}`,
- margin vs `margin_min`,
- knowledge pattern id,
- rule pack ids,
- whether override applied.

If the answer is “because legacy always wraps root children,” that is an **illegal unexplained policy** under this RFC—such behavior must appear as an explicit Decision or be removed.

### 12.3 Explainability artifacts

- Optional `decisions.json` / trace bundle beside compile output under debug policy.
- Provenance map: emit node → source node ids → decision ids.
- Diff tool concept: compare Decision sets across Knowledge Bundle versions.

---

## 13. Long-Term Evolution (5-year horizon)

### 13.1 What must remain stable

| Stable surface | Reason |
|----------------|--------|
| Kernel invariants | Ecosystem depends on them |
| Decision Record schema (additive evolution) | Corpora and traces |
| Workspace fact/hypothesis protocol | Plugins |
| Policy profile concept | Product contracts |
| Provenance requirements | Enterprise trust |
| Corpus roles (golden/regression/failure/…) | Quality system |
| Separation: data plane ≠ brain ≠ lowering | Avoid monolith relapse |

### 13.2 What should be replaceable

| Replaceable | Reason |
|-------------|--------|
| Individual engines | Better layout solver, better a11y |
| Rule packs / Knowledge Bundles | Main learning locus |
| Ranking / calibration models | Improve without kernel fork |
| Codegen backends | React/Vue/web components later |
| Source adapters | REST vs plugin vs other design tools |
| Packaging | Multiple distribution shapes |

### 13.3 What must NEVER become coupled

1. Kernel ↔ pattern names  
2. Data plane (fetch/snapshot) ↔ semantic decisions  
3. Codegen ↔ pattern detection  
4. AI proposals ↔ committed IR without arbitration  
5. One customer file ↔ rule pack truth  
6. Lovable DOM compiler internals ↔ Figma brain (shared **metrics/policy** only, not shared god-module)  
7. Confidence thresholds hardcoded inside random engines  

### 13.4 Evolutionary path

Years 0–1: Kernel + workspace + Decision Records + layout/semantic packs + traces + corpora skeleton.  
Years 1–3: Rich knowledge graph, responsive/a11y/interaction packs, calibration.  
Years 3–5: Strong plugin ecosystem, optional AI proposers, multi-backend lowering—**same brain contracts**.

---

## FINAL SECTION — Critique of RFC-001

### Strong architectural decisions in RFC-001

1. **Universal / worst-case mission** — correct north star; anti-demo stance is essential.  
2. **Data plane vs compiler intelligence separation** (snapshot must not change meaning) — correct and must be preserved.  
3. **Multi-stage IR intuition** — right direction versus a single early CSS Map tree.  
4. **Multi-axis quality metrics** — necessary for a visual+semantic compiler.  
5. **Failure detection / recovery / fallback thinking** — necessary operationally.  
6. **Explicit acknowledgment that current element tree is insufficient** — honest and useful.  
7. **Policy profiles (pixel vs semantic)** — nascent but correct product idea.

### Weak architectural decisions in RFC-001

1. **Linear engine chain as the thinking model** — premature and wrong; encourages early commit and fake modularity.  
2. **Undifferentiated laundry list of ~30 “engines”** — mixes kernel services, domain engines, optimizers, and ops concerns; invites over-fragmentation and no ownership of decisions.  
3. **“Missing engines” without a Decision object** — engines without a brain protocol will reintroduce silent heuristics.  
4. **Emit treated like a peer stage in the intelligence pipeline** — Emit must be lowering after resolution.  
5. **Constraint Solver listed as a peer “engine” beside Layout** — better as a **subsystem of Layout** (or shared solver service with layout-owned questions), not a free-floating opinionator.  
6. **Confidence named but not defined** — without generation/propagation/thresholds/overrides, “confidence” becomes decorative.  
7. **Roadmap phases ordered by engine fashion** rather than by **kernel + decision contracts first**.  
8. **Insufficient hard line between Facts and Interpretations** — the current compiler’s failure mode is interpretation disguised as fact.

### Missing architectural concepts in RFC-001

- Compiler Kernel definition  
- Workspace / blackboard communication  
- Decision Record as first-class citizen  
- Hypothesis vs commit  
- Knowledge Bundle + pattern knowledge graph  
- Rule packs and priority bands  
- Arbitration protocol  
- Capability-based plugin contract  
- Determinism fingerprint (knowledge + rules + policy)  
- Decision-correctness testing as a primary oracle  
- Explicit abstain as a valid, desirable outcome  
- Bounded invalidation / re-entry waves  
- Override system  
- Separation of Candidate Producers vs Lowering Consumers  

### Over-engineering risks (RFC-001 and naive readings of it)

- Implementing 30 engines before a kernel exists  
- Building animation/AI/i18n scaffolds with nowhere to put decisions  
- Multiple IR formats with no Decision graph tying them together  
- Quality score dashboards without decision goldens  
- “Explainability engine” as a bolt-on essay generator instead of structured traces  

### Under-engineering risks

- Keeping analyze→emit with more heuristics and calling it “engines”  
- Snapshot/offline work mistaken for compiler intelligence progress  
- Name-based tags forever  
- No abstain path (forced wrong semantics)  
- No corpus strategy beyond a few demos  
- Plugins as open mutation of a global tree  

### Alternative designs considered

| Alternative | Verdict |
|-------------|---------|
| Pure pipeline of transformers | Rejected — premature commit, poor plugins |
| Single mega-prompt AI compiler | Rejected — non-explainable, non-regressable as sole brain |
| Hardcoded pattern switchyard | Rejected — does not scale; couples ontology to code |
| **Workspace + hybrid decision system (this RFC)** | **Selected** |
| Fully parallel unconstrained engines writing final IR | Rejected — requires arbitration anyway; chaos without kernel |

### Required changes to RFC-001 (amendments)

If RFC-001 remains the “working architecture” inventory, it should be amended as follows:

1. **Replace linear engine narrative** with **Kernel + Workspace + capability-scheduled waves** (pointer to RFC-002).  
2. **Promote Decision Records, Facts vs Hypotheses, Arbitration** to normative architecture—not optional “confidence engine” bullet.  
3. **Reclassify the engine list** into: Kernel services · Domain hypothesis engines · Lowering · Data plane · QA/corpus plane.  
4. **Move Constraint Solving under Layout** (shared solver service allowed, but questions owned by layout).  
5. **Define Emit as lowering-only.**  
6. **Put Knowledge Bundle + Rule Packs** ahead of most domain engines in the roadmap.  
7. **Add Decision-correctness oracles** to §7 quality.  
8. **State explicitly:** pattern detection never commits; abstain is success when appropriate.  
9. **Lifecycle backlog** (abort/temp cleanup) stays ops/data-plane—do not confuse with Decision recovery.  
10. **Mark RFC-001 descriptive inventory; RFC-002 normative for reasoning** after approval.

### Bottom line

RFC-001 is a strong **map of the territory**.  
It is a weak **constitution for judgment**.

**RFC-002 is the constitution.**  
Until it is approved, implementation of “more engines” would likely reproduce today’s silent-heuristic compiler at larger scale.

---

## Document control

| Item | Rule |
|------|------|
| Implementation | **Forbidden** until this RFC is reviewed and approved |
| Conflict with RFC-001 on reasoning | **RFC-002 prevails** after approval |
| Changes | Require explicit amendment; preserve kernel invariants |
| Success criterion | A new engineer can explain why any node became `<section>` vs `<div>` using only Decision traces and Knowledge Bundle ids |

**End of RFC-002. Stop. No implementation follows.**
