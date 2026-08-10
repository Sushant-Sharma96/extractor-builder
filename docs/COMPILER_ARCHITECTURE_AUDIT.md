# RFC: Universal Figma Compiler — Architecture Audit

| Field | Value |
|-------|--------|
| **Status** | Architecture Discovery |
| **Date** | 2026-07-18 |
| **Scope** | Figma → HTML/CSS/JS compiler (production-grade, universal) |
| **Non-goals** | Implementation, refactoring, code changes, commits, branch changes |
| **Audience** | Compiler owners, platform architects, long-term evolution reviewers |

---

## Preamble

### Mission

This system’s goal is **not** to polish one Figma file or one demo.

The goal is a **production-grade universal Figma Compiler**: a deterministic, measurable, evolvable pipeline that consumes arbitrary Figma design trees and emits maintainable web artifacts across product surfaces and design quality levels.

### Design domains the compiler must eventually serve

| Domain | Stress profile |
|--------|----------------|
| Landing / marketing pages | Hero sections, CTAs, mixed media, scroll storytelling |
| SaaS dashboards | Dense grids, charts, sidebars, data tables, filters |
| E-commerce | Product cards, galleries, pricing, filters, carts |
| Blogs / content | Typography scale, reading width, media embeds |
| Portfolios | Visual hierarchy, galleries, case-study layouts |
| Admin panels | Forms, tables, modals, dense controls |
| Design-system–based files | Components, variants, tokens, shared styles |
| Poorly organized files | Naming chaos, absolute spaghetti, unused layers |
| Enterprise-scale files | Huge trees, many assets, deep nesting, multi-page |
| Mobile-first / desktop-first | Breakpoint intent, constraint semantics |
| Highly animated / interactive | Prototypes, motion, stateful UI patterns |

**Audit posture:** assume worst-case inputs. Never optimize architecture for a single gold URL.

### Document contract

- Describe **architecture**, not implementation recipes.
- Record **what exists**, **what is decided**, **what is missing**.
- Propose **target architecture**, **IR strategy**, **quality metrics**, **failure modes**, and a **phased roadmap**.
- Stop at documentation. No code follows from this RFC until separately approved.

### Relationship to Lovable path

The product also contains a Lovable (DOM/CSS reverse) compiler. Architecturally:

| Concern | Lovable | Figma (this RFC) |
|---------|---------|------------------|
| Source of truth | Rendered DOM + site CSS | Design node tree (REST / plugin) |
| Primary problem | Recover semantics from compiled CSS | Synthesize layout & semantics from design intent |
| Interactivity today | Partial reconstruction from DOM behavior | Effectively none (static stub) |
| Shared packaging | Site bundle writer | Same packaging boundary |

This RFC audits the **Figma compiler**. Cross-pollination is architectural (shared quality bars, packaging contracts), not a mandate to merge engines.

---

## SECTION 1 — Current Pipeline

### 1.1 Pipeline diagram

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                         HTTP / Plugin Boundary                           │
│  POST /api/figma/convert          │  POST /api/figma/plugin              │
│  { url, token?, refresh? }        │  { tree, images, svgs, name }        │
└───────────────┬───────────────────┴──────────────────┬───────────────────┘
                │                                      │
                ▼                                      │
┌───────────────────────────────┐                      │
│  URL Parse                    │                      │
│  → fileKey, nodeId            │                      │
└───────────────┬───────────────┘                      │
                │                                      │
        ┌───────┴────────┐                             │
        │ Snapshot gate  │                             │
        │ HIT / MISS     │                             │
        └───────┬────────┘                             │
     HIT        │         MISS                         │
      │         │          │                           │
      │         │          ▼                           │
      │         │  ┌───────────────────┐               │
      │         │  │ Source Adapter    │               │
      │         │  │ (REST)            │               │
      │         │  │ fetch node tree   │               │
      │         │  │ + asset URL maps  │               │
      │         │  │ + SVG fallback    │               │
      │         │  └─────────┬─────────┘               │
      │         │            │                         │
      │         │            ▼                         │
      │         │  ┌───────────────────┐               │
      │         │  │ Snapshot Persist  │               │
      │         │  │ (data plane only) │               │
      │         │  └─────────┬─────────┘               │
      │         │            │                         │
      └─────────┴────────────┘                         │
                │                                      │
                ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ANALYZE (design tree → element tree)                                    │
│  Walk · classify · decls · post-passes (flow infer, media clip)          │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ASSET MATERIALIZATION (emit-facing maps)                                │
│  Local SVG reconstruct · merge REST SVG · imageRef URLs · PNG URL map    │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  EMIT (element tree → artifacts)                                         │
│  Class dedupe · sectionization · HTML · CSS · stub JS                    │
└───────────────────────────────────┬──────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PACKAGE                                                                 │
│  Bundle files · localize assets · rewrite references                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Stages — responsibility, inputs, outputs, dependencies

| # | Stage | Responsibility | Input | Output | Depends on |
|---|--------|----------------|-------|--------|------------|
| 0 | **Ingress** | Accept convert or plugin payload; auth | HTTP body | Normalized job | Auth / OAuth / env token |
| 1 | **Identity** | Resolve design identity | URL | `fileKey`, `nodeId` | URL grammar |
| 2 | **Snapshot gate** | Prefer offline validated snapshot | Identity + `refresh` | Document + REST-shaped URL maps + local asset index **or** miss | Snapshot schema / compiler version |
| 3 | **Source adapter (MISS)** | Obtain authoritative node subtree + remote asset URLs | Identity + auth | Document tree, fill/PNG/SVG maps | Figma REST (or future equivalents) |
| 4 | **Snapshot persist (MISS)** | Atomically store offline-capable snapshot | Document + remote maps | Final snapshot dir **or** incomplete temp | CDN downloads; validation rules |
| 5 | **Analyze** | Compile design tree → element tree + asset id lists | Root Figma node | `{ tree, imageNodeIds, svgNodeIds, svgNodes, fonts, … }` | Decl generator |
| 6 | **SVG materialization** | Prefer local geometry reconstruct; fill gaps | `svgNodes` (+ optional REST SVG) | `{ nodeId → markup }` | Path geometry presence |
| 7 | **Emit** | Produce HTML/CSS/JS + section summary | Element tree + URL/SVG maps | `{ html, css, js, sections, … }` | Class naming / section rules |
| 8 | **Package** | Write inspectable site bundle | Emit result + asset set | Output directory + asset list | Filesystem; optional local-by-URL |

**Snapshot Manager is a data plane.** It must not alter analyze/emit semantics. HIT and MISS must present **identical emit-facing map shapes**.

### 1.3 Current module boundaries (architectural)

| Boundary | Owns | Must not own |
|----------|------|--------------|
| Source adapter | Network identity of design data | Layout decisions, semantics |
| Snapshot manager | Durability, validation, offline packaging hints | Compiler transforms |
| Decl / paint layer | Node → CSS declaration map | Document structure, packaging |
| Analyze | Tree shape, classification, layout post-passes | HTTP, disk policy |
| Emit | Document assembly, class system, section chrome | Fetch, cache |
| Package | Localization and file layout | Design interpretation |

### 1.4 Current artifact contract

Emitted product mirrors a fixed trio:

- Structural HTML document
- Stylesheet (semantic-ish classes from layer names)
- Script stub (explicitly non-interactive today)

Plus optional packaged directory for human/QA inspection.

---

## SECTION 2 — Decision Inventory

For each stage: decisions made, decisions deferred, assumptions, ignored information.

### Stage: Ingress / auth

| | |
|--|--|
| **Decided** | Convert vs plugin path; token source precedence |
| **Not decided** | Multi-tenant quotas, job queueing, partial-page selection UX beyond URL node-id |
| **Assumptions** | Caller supplies a reachable design root; auth is sufficient for needed endpoints |
| **Ignored** | File-level permissions matrix beyond failure; collaborative version pinning UX |

### Stage: Identity (URL parse)

| | |
|--|--|
| **Decided** | `fileKey` from path; `node-id` hyphen→colon |
| **Not decided** | Branch URLs, prototype URLs as first-class modes, multi-node selection |
| **Assumptions** | Single root subtree is the compile unit |
| **Ignored** | Page context outside selected node; adjacent frames as artboards unless selected |

### Stage: Snapshot gate

| | |
|--|--|
| **Decided** | HIT only if schema + compiler version + completeness + asset integrity |
| **Not decided** | Soft versioning, partial HIT, migration from legacy flat caches |
| **Assumptions** | Matching compiler version ⇒ safe reuse of maps |
| **Ignored** | Legacy flat document caches; incomplete `.tmp-*` directories |

### Stage: Source adapter

| | |
|--|--|
| **Decided** | Fetch subtree with path geometry; separate fill URL map; PNG export for unresolved images; SVG export only as fallback |
| **Not decided** | Variable resolution API strategy; styles library expansion; multi-page orchestration |
| **Assumptions** | REST node JSON + exported bitmaps/SVGs are sufficient input |
| **Ignored** | Prototype reactions graph; comments; version history; most Dev Mode extras |

### Stage: Analyze — structure

| | |
|--|--|
| **Decided** | Invisible nodes dropped; vector-only subtrees collapse to one SVG node; containers recurse; text → text/runs; image leaves vs background fills |
| **Not decided** | True component graph; slot/override model; mask node model; boolean ops as DOM vs SVG policy beyond collapse |
| **Assumptions** | Container type set is complete enough for typical UI; non-containers are leaves for recursion |
| **Ignored** | Component property definitions; variant axes; instance swap; most plugin data |

### Stage: Analyze — layout

| | |
|--|--|
| **Decided** | Auto-layout → flex (+ gap, padding, wrap, primary/counter align); freeform children → absolute offsets from bounding boxes; conservative absolute→flex inference when aligned non-overlapping stacks; clipsContent → overflow hidden; media overflow heuristic |
| **Not decided** | Constraint-based responsive behavior; grid layouts; sticky/fixed viewport semantics; min/max sizing beyond what’s implied; HUG as first-class |
| **Assumptions** | Absolute bounding boxes are the geometric truth for freeform; inferred flex must preserve boxes |
| **Ignored** | `constraintsHorizontal` / `constraintsVertical`; layout grids; many auto-layout edge enums; layout positioning absolute-within-auto nuances |

### Stage: Analyze — visuals / type

| | |
|--|--|
| **Decided** | Layered fills → CSS backgrounds; solid strokes → borders; corner radii; opacity; subset of blend modes; drop/inner shadow; layer/background blur; text typography subset; gradient text clip; rotation |
| **Not decided** | Full paint engine parity; variable fonts axes; complex stroke types; effect stacking order edge cases |
| **Assumptions** | CSS can approximate Figma paints for the supported subset |
| **Ignored** | Non-solid strokes; rich gradient fidelity in SVG reconstruct; many text layout features (lists, hanging punctuation, OpenType features) |

### Stage: Semantics / HTML

| | |
|--|--|
| **Decided** | Name/size heuristics → heading/button/nav/header/footer tags; root children → sections; class names from layer name slugs |
| **Not decided** | Landmark roles, form control mapping, list semantics, table semantics, heading outline correctness |
| **Assumptions** | Designer naming is a weak but usable signal |
| **Ignored** | Explicit a11y annotations; ARIA intent; reading order vs z-order conflicts |

### Stage: Interactivity / motion

| | |
|--|--|
| **Decided** | Emit static script stub |
| **Not decided** | Any prototype → behavior mapping; carousel/accordion/modal detection; reduced-motion policy |
| **Assumptions** | Visual static snapshot is an acceptable v1 product boundary |
| **Ignored** | Reactions, overlays, smart animate, after-delay, video, Lottie, canvas |

### Stage: Emit / package

| | |
|--|--|
| **Decided** | Deduped CSS classes; canvas wrapper; Google Fonts link from discovered families; package rewrite of remote URLs |
| **Not decided** | Token extraction; CSS architecture (BEM/layers/container queries); critical CSS; hydration strategy |
| **Assumptions** | Single-document bundle is the primary delivery unit |
| **Ignored** | Multi-route sites; design-system package export; framework components |

---

## SECTION 3 — Missing Engines

Each item is an **intelligence layer** absent or only vestigial today. Responsibility is architectural, not an implementation brief.

| Engine | Responsibility |
|--------|----------------|
| **Normalization Engine** | Canonicalize messy Figma trees: visibility, empty frames, duplicate wrappers, inconsistent units, unstable ids → stable compile graph |
| **Layout Engine** | True layout compilation: auto-layout, absolute, constraints, grids, sticky, overlays, overflow, stacking contexts — with explicit conflict rules |
| **Semantic Engine** | Map regions to landmarks, headings, lists, navigation, forms, tables, cards — with confidence and overrides |
| **Component Engine** | Preserve/recover component sets, variants, instances, overrides, slots; emit reusable abstractions where justified |
| **Responsive Engine** | Interpret constraints, multiple frames as breakpoints, and adaptive sizing into responsive CSS strategy |
| **Animation Engine** | Represent motion intent (prototype, smart animate, transitions) as a motion IR; emit CSS/WAAPI/Lottie policy |
| **Interaction Engine** | Map triggers/actions to UI behaviors (tabs, drawers, modals, hover, focus) without inventing product logic |
| **Accessibility Engine** | Roles, names, focus order, contrast checks, keyboard operability signals, reduced-motion |
| **Design Token Engine** | Extract colors, type, space, radii, elevation into token graphs; bind styles to tokens |
| **Asset Optimization Engine** | Choose SVG vs raster, scale, format, sprites, lazy boundaries; bound payload size |
| **CSS Optimization Engine** | Deduplicate, layer, contain, cull dead rules, control specificity, manage cascade |
| **HTML Optimization Engine** | Flatten useless wrappers, choose tags, control DOM depth, preserve semantics |
| **JS Generation Engine** | Emit minimal behavior modules from interaction IR; never silent stubs without explicit policy |
| **Constraint Solver** | Resolve competing size/position constraints into a consistent layout solution |
| **Conflict Resolution Engine** | When signals disagree (name vs structure vs constraints), apply ranked policies and record decisions |
| **Validation Engine** | Structural + semantic + fidelity validators before emit and after package |
| **Quality Scoring Engine** | Produce multi-axis scores (see §7) for gating and regression |
| **Recovery Engine** | Repair partial failures (missing geometry, broken assets) while preserving compile progress |
| **Fallback Engine** | Ordered degradations: local SVG → export SVG → PNG → placeholder; flex → absolute; etc. |
| **Heuristic Engine** | Pattern detectors (card, accordion, mega-menu, carousel) with explicit confidence |
| **Ranking Engine** | Rank candidate interpretations when multiple are plausible |
| **Confidence Engine** | Attach confidence to every non-deterministic decision; drive fallbacks and QA |
| **Edge Case Engine** | Catalog + specialized handlers for known pathological constructs |
| **Explainability Engine** | Human-readable decision traces (“why absolute?”, “why section?”) for debugging enterprise files |
| **Provenance Engine** | Trace each emitted node/rule back to Figma node ids and decision records |
| **Scale / Partition Engine** | Split enormous files into compile units, incremental compile, memory bounds |
| **Theme Engine** | Light/dark / brand themes from variables or parallel frames |
| **i18n / RTL Engine** | Text expansion, bidirectional layout, locale-aware typography |
| **Media Engine** | Video, canvas, charts, embedded content policies |
| **Security / Supply Engine** | Sanitize SVG/HTML, bound external asset trust, package integrity |

**Present-day vestiges (not full engines):** conservative flow inference, name-based tags, local SVG reconstruct, snapshot validation, paint→CSS mapping, packaging rewrite.

---

## SECTION 4 — Edge Case Audit

Difficult cases the universal compiler must eventually confront. Status is architectural readiness, not a bug list.

### Structure & layout

| Case | Why hard | Current architectural stance |
|------|----------|------------------------------|
| Deep nesting | Cascade, specificity, DOM cost | Walks recursively; no depth strategy |
| Mixed auto-layout + absolute | Containing blocks, stacking | Absolute if parent not auto; limited inference |
| Nested frames / sections | Sectionization vs true structure | Root children → sections; deeper frames mostly generic |
| Absolute overlays | Z-index, hit targets, portals | Absolute positioning; weak stacking model |
| Sticky / fixed | Viewport semantics absent in static boxes | Not modeled |
| Responsive constraints | Left/right pinning, scale | Ignored |
| Huge pages / enterprise trees | Memory, time, asset storms | No partition engine |
| Poorly organized files | Heuristics fail | Relies on names + geometry |

### Components & design systems

| Case | Why hard | Stance |
|------|----------|--------|
| Variants / component sets | Combinatorial UI states | Treated as containers |
| Instances + overrides | Divergent from main | Flattened visually |
| Tokens / variables | Theme & consistency | Not extracted |
| Shared styles libraries | Cross-file truth | Not modeled |

### Visual / vector

| Case | Why hard | Stance |
|------|----------|--------|
| Masks / clip content | Crop vs true mask | `clipsContent` + media heuristic |
| Boolean operations | Complex vectors | Collapsed into SVG when vector-only |
| Blend modes | Compositing | Partial CSS map |
| Gradients | Fidelity vs CSS limits | Approximate; SVG reconstruct simplified |
| Huge SVGs | DOM/parse cost | Prefer local reconstruct; export fallback |
| Variable fonts | Axes | Family/weight only |

### Interaction & media

| Case | Why hard | Stance |
|------|----------|--------|
| Accordions / tabs / modals / tooltips | Stateful UI | Static |
| Mega menus / carousels / infinite lists | Complex behavior + a11y | Static |
| Forms | Controls, labels, validation UX | Visual only |
| Animations / Lottie / video / canvas / charts | Non-HTML or heavy | Not modeled |
| Tables / timelines / pricing / testimonials | Pattern semantics | Visual + weak tags |

### Global modes

| Case | Why hard | Stance |
|------|----------|--------|
| Dark mode / themes | Parallel worlds | Not modeled |
| RTL / localization | Layout mirroring, text | Not modeled |
| Accessibility / keyboard / reduced motion | Product requirements | Not modeled |
| Print mode | Alternate stylesheet intent | Not modeled |

### Operational edge cases

| Case | Why hard | Stance |
|------|----------|--------|
| Rate limits / partial assets | Incomplete MISS | Error or skip asset |
| Aborted requests / orphan temps | Lifecycle | Documented backlog; not engine-complete |
| Plugin vs REST input skew | Divergent maps | Parallel ingress; incomplete parity |

---

## SECTION 5 — Universal Compiler Strategy

### 5.1 Ideal architecture (engines + order)

Architecture only — execution order of **logical phases**:

```text
1. Ingress & Policy
2. Source Acquisition (live | snapshot | plugin)
3. Normalization
4. Graph Construction (raw design graph)
5. Enrichment Graphs (parallel, read-mostly)
      ├─ Layout Graph
      ├─ Component Graph
      ├─ Token Graph
      ├─ Asset Graph
      ├─ Interaction / Motion Graph
      └─ A11y / Reading-Order Graph
6. Constraint Solving & Conflict Resolution
7. Semantic Interpretation (with confidence)
8. Responsive Strategy Binding
9. IR Lowering (multi-stage — see §6)
10. Emit Planning (HTML/CSS/JS/asset plan)
11. Codegen
12. Validation & Quality Scoring
13. Recovery / Fallback (loop back to lowering or emit plan if gated fail)
14. Package & Provenance Bundle
```

### 5.2 Engine responsibilities (target)

| Phase / Engine | Responsibility | Upstream | Downstream |
|----------------|----------------|----------|------------|
| Policy | Compile profile (pixel-faithful vs semantic-lean), budgets | Job | All phases |
| Normalization | Stable tree | Raw document | Graphs |
| Layout Engine | Geometry + flow model | Norm tree | Constraint solver |
| Component Engine | Reuse boundaries | Norm tree | Semantic + emit plan |
| Token Engine | Variables/styles → tokens | Norm + APIs | CSS plan |
| Asset Engine | Media plan | Fills/exports | Package |
| Interaction / Animation | Behavior/motion IR | Prototype + heuristics | JS / CSS motion |
| A11y Engine | Roles, names, order | Semantic + layout | HTML plan |
| Constraint Solver | Consistent sizes/positions | Layout + responsive | Lowered layout IR |
| Conflict Resolution | Ranked decisions | All signals | Annotated IR |
| Semantic / Heuristic / Ranking / Confidence | Meaning under uncertainty | Graphs | Lowered semantic IR |
| Validation / Quality / Recovery / Fallback | Gates and degradations | Artifacts + IR | Accept / retry / degrade |
| Explainability / Provenance | Audit trail | Decisions | QA / debug bundle |

### 5.3 Data contracts (logical)

| Contract | Purpose |
|----------|---------|
| **RawDesignDocument** | Untouched Figma subtree + metadata |
| **NormalizedDesignGraph** | Stable nodes/edges, visibility, boxes |
| **LayoutIR** | Flow, absolute, constraints, stacking |
| **ComponentIR** | Components, variants, instances |
| **TokenIR** | Token definitions + bindings |
| **AssetIR** | Refs, formats, local/remote, budgets |
| **BehaviorIR** | Interactions + motion |
| **SemanticIR** | Roles, landmarks, patterns + confidence |
| **EmitPlan** | Chosen tags, class strategy, JS modules, asset embeds |
| **ArtifactSet** | HTML/CSS/JS + maps |
| **QualityReport** | Scores, violations, decision traces |
| **ProvenanceBundle** | nodeId ↔ emit bindings |

### 5.4 Hard architectural invariants

1. **Source adapters never invent layout.**
2. **Snapshot/cache never changes compiler meaning** — only durability and packaging locality.
3. **Every non-deterministic choice carries confidence + rationale.**
4. **Fallbacks are ordered and recorded**, never silent.
5. **Pixel-faithful and semantic-lean profiles are explicit policies**, not accidental mixes.
6. **Worst-case scale is a first-class concern** (partition, budgets), not an afterthought.
7. **Demo URLs do not define architecture.**

---

## SECTION 6 — Intermediate Representation

### 6.1 Current IR evaluation

**What exists today:** an informal **element tree** produced by analyze:

- Kinds such as element / image / svg
- CSS declaration maps per node
- Optional text / runs / image refs
- Bounding boxes retained for some post-passes
- Asset id side-lists and font set

**What does not exist:**

- Versioned multi-stage IR
- Separate layout / component / token / behavior graphs
- Confidence, provenance, or decision records
- Shared IR with Lovable v2 pipeline modules

**Verdict:** **Insufficient** for a universal production compiler. Adequate only for a **static visual approximation** of a selected subtree under a narrow layout subset.

### 6.2 Missing information (representative)

| Category | Missing from current element tree |
|----------|-----------------------------------|
| Layout | Constraints, grids, min/max, sticky, z-model, true HUG semantics |
| Components | Variant axes, properties, overrides, main-component links |
| Tokens / variables | Collections, modes, aliases, bindings |
| Behavior | Reactions, overlays, navigation, state machines |
| Semantics | Roles, labels, heading levels as first-class (beyond tag guess) |
| A11y | Focus order, contrast, live regions |
| Responsive | Breakpoint frames, constraint→media strategy |
| Assets | Optimization plan, SVG complexity metrics |
| Quality | Per-node confidence, rejected alternatives |

### 6.3 Should IR be split into stages?

**Yes.** Recommended staged IR (logical):

1. **NDG — Normalized Design Graph** (structure + geometry + paints as data)
2. **Specialized graphs** (layout, component, token, asset, behavior, a11y) — may share node ids
3. **ResolvedIR** — after constraint solve + conflict resolution (single compile truth)
4. **EmitPlanIR** — web-specific lowering (tags, classes, modules)
5. **ArtifactIR** — optional AST of emitted documents for validation/optimization

Single monolithic “element with Map of CSS” collapses decisions too early and makes engines untestable in isolation.

### 6.4 Multiple graph representations?

**Yes — multiple graphs, one identity space.**

| Graph | Why separate |
|-------|----------------|
| Layout graph | Geometry/flow conflicts ≠ component identity |
| Component graph | Reuse boundaries ≠ visual boxes |
| Token graph | Themes span many nodes |
| Behavior graph | Sparse overlay on structure |
| Asset graph | Fan-out to binaries / CDN |
| A11y / reading-order graph | May disagree with paint order |

Edges between graphs are **references by stable node id**, not duplicated subtrees.

---

## SECTION 7 — Compiler Quality

Quality must be **multi-axis**, **objective where possible**, and **regressable**.

### 7.1 Metric suite

| Metric | Question it answers | Example signals |
|--------|---------------------|-----------------|
| **Pixel Fidelity** | Does it look like the design at target viewports? | Screenshot SSIM/ΔE, box IoU |
| **Layout Fidelity** | Are flow/absolute/stacking relationships preserved? | Edge alignment, gap histograms, overflow leaks |
| **Semantic Score** | Is the DOM meaningful? | Landmark coverage, heading outline validity, control labeling |
| **Responsive Score** | Does it adapt without collapse? | Breakpoint reflow tests, constraint honor rate |
| **Accessibility Score** | Can it be used assistively? | axe/ARIA checks, focus order, contrast |
| **Animation Fidelity** | Is motion preserved under policy? | Keyframe presence, timing error, reduced-motion compliance |
| **Interaction Completeness** | Are prototype-critical behaviors present? | BehaviorIR coverage vs prototype graph |
| **Token Quality** | Are styles systematized? | Token binding rate, magic-value rate |
| **DOM Complexity** | Is structure economical? | Depth, node count, wrapper ratio |
| **CSS Complexity** | Is cascade maintainable? | Rule count, specificity histogram, duplicate ratio |
| **Performance** | Is runtime/payload acceptable? | Bytes, LCP proxies, SVG path cost |
| **Maintainability** | Can humans edit output? | Class clarity, section boundaries, dead code |
| **Confidence** | How sure was the compiler? | Mean/min decision confidence; low-confidence area ratio |
| **Recovery Rate** | Did fallbacks keep value? | Successful degrade without hard fail |
| **Provenance Coverage** | Can we explain output? | % emit nodes with source ids |

### 7.2 Scoring principles

- Separate **policy profiles** (e.g., pixel-faithful marketing vs semantic dashboard).
- Never collapse all axes into one vanity number without weights declared per profile.
- Gate releases on **regression deltas**, not absolute perfection.
- Corporate files should contribute **corpus scores**, not single demos.

---

## SECTION 8 — Worst Case Failure Analysis

| Failure locus | Detection | Recovery | Fallback |
|---------------|-----------|----------|----------|
| Auth / permission denied | Ingress status | Surface actionable auth error | No silent empty design |
| Rate limit / API lock | Adapter 429 / plan signals | Prefer snapshot HIT; queue / alternate credential policy | Serve last good snapshot if valid; else hard fail with ETA |
| Missing node / empty tree | Adapter validation | Ask for alternate node-id | Compile nearest page frame only if policy allows |
| Incomplete geometry (no paths) | SVG reconstruct null | Request export SVG | PNG rasterize node; placeholder with provenance |
| Unreachable CDN asset | Download failure | Retry with budget | Omit with CSS placeholder; mark quality hit |
| Snapshot incomplete / orphan temp | Validation / lifecycle probe | Discard temp; force MISS if allowed | Never HIT on incomplete |
| Compiler version mismatch on snapshot | Metadata gate | Rebuild snapshot when network allowed | Offline-only: refuse HIT rather than wrong emit |
| Layout ambiguity (overlap + mixed modes) | Conflict engine | Keep absolute; record confidence | Disable flow inference |
| Constraint contradiction | Solver unsat | Relax lowest-priority constraints | Fixed boxes from absoluteBoundingBox |
| Semantic mis-tag (button that isn’t) | Confidence + heuristics disagreement | Prefer generic `div`/`span` | Name-based tag only above threshold |
| Component explosion | Component graph size budget | Flatten instances | Emit visual-only tree |
| Asset storm / huge SVG | Asset budget metrics | Partition / simplify vectors | Rasterize; lazy boundaries |
| Memory / timeout on enterprise file | Runtime monitors | Partition compile units | Partial emit of selected frames |
| Emit invalid CSS/HTML | Validation engine | Regenerate affected subtree | Strip offending decl; keep box |
| Package rewrite miss | Post-package URL scan | Re-run localize | Leave remote URL + warn |
| Client abort mid-save | Request lifecycle signals | Cancel downloads; delete temp | Leave no final snapshot (see BACKLOG.md) |
| Interaction IR empty but prototype rich | Coverage metric | Warn in QualityReport | Static stub **only** if policy = static-ok |
| A11y catastrophic | A11y gate | Inject roles/labels where confident | Fail gate under a11y-required profile |

---

## SECTION 9 — Roadmap (Architecture Phases)

Each phase is **independently reviewable**. No phase assumes undocumented future work.

### Phase 0 — Architecture freeze & corpus doctrine

**Deliverable:** This RFC + agreement on worst-case corpus categories + quality axes.  
**Exit:** Stakeholders accept profiles (pixel vs semantic) and “no demo-driven architecture” rule.

### Phase 1 — Contracts & IR spine

**Deliverable:** Formal contracts for RawDesignDocument, NormalizedDesignGraph, EmitPlan, QualityReport, ProvenanceBundle (schemas as architecture, not code).  
**Exit:** Reviewers can point to where every engine reads/writes.

### Phase 2 — Decision & confidence accounting

**Deliverable:** Architecture for decision records on layout/semantic choices; confidence model.  
**Exit:** Every current heuristic mapped to “recorded decision vs silent.”

### Phase 3 — Layout & constraint architecture

**Deliverable:** LayoutIR + Constraint Solver + Conflict Resolution responsibilities and invariants (including constraints, grids, sticky, mixed modes).  
**Exit:** Clear policy for absolute vs flow vs responsive without referencing one file.

### Phase 4 — Semantics, components, tokens

**Deliverable:** SemanticIR + ComponentIR + TokenIR boundaries; ranking/heuristic engines’ interfaces.  
**Exit:** Design-system files and messy files have distinct strategies under one architecture.

### Phase 5 — Behavior, motion, a11y, i18n

**Deliverable:** BehaviorIR + Animation + A11y + Theme/RTL engine contracts; static-ok vs interactive-required profiles.  
**Exit:** Explicit product boundary for when stub JS is forbidden.

### Phase 6 — Validation, scoring, recovery

**Deliverable:** Validation Engine + Quality Scoring + Recovery/Fallback matrices wired to gates.  
**Exit:** Corpus can fail phases for measurable reasons.

### Phase 7 — Scale & operational lifecycle

**Deliverable:** Partition/scale engine architecture; snapshot lifecycle (align with BACKLOG: abort, cancel, temp/orphan cleanup) as operational architecture.  
**Exit:** Enterprise-size and aborted-job scenarios have designed behavior.

### Phase 8 — Cross-compiler quality bar

**Deliverable:** Shared quality doctrine with Lovable path (metrics, packaging contract) without forcing engine merge.  
**Exit:** One product-level definition of “good compile.”

---

## Appendix A — Current system summary (one page)

The present Figma compiler is a **linear visual codegen pipeline**:

**Acquire design JSON → walk to an element tree with CSS maps → approximate layout (flex/absolute + light inference) → emit static HTML/CSS → package assets.**

It is **not** yet a universal compiler architecture. Missing are multi-graph IR, constraint solving, semantics/components/tokens as engines, behavior/motion/a11y, systematic validation/scoring, and scale/lifecycle intelligence.

Snapshot/offline work strengthens the **data plane**, not the **compiler intelligence plane**.

## Appendix B — Related documents

- `BACKLOG.md` — request lifecycle / abort / temp cleanup (implementation deferred)
- Offline snapshot plans / validation notes — data plane only

## Appendix C — RFC change policy

Amendments to this document should:

1. Preserve worst-case / universal mission.
2. Separate **architecture** from **implementation approval**.
3. Update Phase exits when contracts change.
4. Never redefine success as “works on one Figma URL.”

---

**End of Architecture Discovery document. No implementation follows from this RFC until explicitly approved.**
