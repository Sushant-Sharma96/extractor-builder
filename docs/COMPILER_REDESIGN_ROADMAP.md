# Compiler Redesign — Final Architecture Audit & Implementation Roadmap

| Field | Value |
|-------|-------|
| **Date** | 2026-07-31 |
| **Status** | Roadmap only — **no implementation in this document or this pass**. Authoritative execution plan once approved: implementation proceeds in the dependency order established in Section 7, phase by phase, each gated on its own proof-of-done. |
| **Revision** | v2 — extends v1 with four additional architectural layers (Section 1.5) and a complete CSS Property Preservation Matrix (Section 6), per explicit user request evaluating whether v1's pipeline was sufficient before implementation begins. |
| **Depends on** | `docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md` Parts 1–13 (all factual claims below cite back to specific parts of that document rather than re-deriving evidence) |
| **Purpose** | Consolidate all findings into one final, execution-ready phase plan — objective/inputs/outputs/invariants/verification/regression-risk/impact per phase, a real dependency graph, and a priority classification — so implementation can begin from one authoritative source. |

---

## 1. Pipeline Review: Capture → NDG → Skeleton → Semantic → Layout → Sizing → Responsive → Render → Verify

Each stage's CURRENT status, stated precisely — several of these names refer to code that exists today; several refer to stages this research proposed and that do not exist yet. Conflating the two is exactly the kind of status-doc drift Part 1's Precedent section already flagged as a recurring, independent risk. (Section 1.5 below extends this table with four more stages this document did not originally propose.)

| Stage | Exists today? | What it actually does now | Key weaknesses (cited) |
|---|---|---|---|
| **Capture** | Yes | `server/figma-snapshot.js` + REST/Plugin fetch — acquires raw Figma JSON, caches it | Two source dialects (REST vs. Plugin API) with no unified translation layer (Research Part 1.13) |
| **NDG** | Yes | `compiler/ndg/*` — ingests raw JSON into a flat working-node set (`ingest.js`), then structurally collapses paint-less wrapper nodes (`build.js`'s `hasPaintSignal`) | Under-captures several real, populated fields (multi-fill, radial/diamond gradients, `absoluteRenderBounds`, `cornerSmoothing` consumption) — Research Part 4.1/5. Also conflates two genuinely distinct responsibilities (raw capture vs. structural collapse) — see Section 1.5.1 |
| **Skeleton** | Partial (v0 shipped, not fully authoritative) | `compiler/skeleton/*` — role classification (content/decorative-chrome/container) and reading-order ARE built and wired into accessibility + chrome-detection (task history #25–30) | Still coexists ALONGSIDE, rather than replacing, three independent clustering mechanisms (`compiler/geometry`, `compiler/freeform-layout`, `compiler/rulepack/component-detect`) — Research Part 7.5.3. Also currently has no explicit precedence rule over real declared Component/Instance data — see Section 1.5.3 |
| **Semantic** | No | Nothing plays this role today. Alignment (`primaryAxisAlignItems`/`counterAxisAlignItems`), `constraints`-based anchoring, and component-override VALUES are all ingested but never resolved into an authoritative per-node fact | Research Part 8 (Flexbox row), Part 10 (Navbar/Sidebar/Floating rows), Part 5 ("Components/Instances" row) |
| **Layout** | Yes, but bypassed | `compiler/layout/interpret.js` correctly computes mode candidates (row/column/grid/absolute) and publishes `LayoutIR`/`ComponentIR`/`ResponsiveIR` | The ACTIVE renderer never consumes these — it re-materializes NDG and re-runs its own detection stack instead (Research Part 7.5.8, confirmed by direct source inspection) |
| **Sizing** | Computed, never consumed | `layout/interpret.js`'s `sizingAxis()` correctly computes `fill`/`hug`/`fixed` per axis, per node, right now, on every compile | **Never read anywhere in the active renderer** — Research Part 9.0, the single highest-value finding in this whole research effort |
| **Responsive** | Yes, largely working | `compiler/responsive/*` computes a real breakpoint/strategy IR and DOES reach literal `@media` CSS end-to-end (Phase 4, confirmed wired) | Undermined, not broken: it patches per-breakpoint overrides onto a baseline that itself has no fluid relationship to its container (Research Part 8's Responsive row) |
| **Render** | Yes (active path) | `ir-experimental-renderer.js` + `css-declarations.js` — the renderer every bug this whole research effort investigated actually ships from | Monolithic (~1,400-line single-pass function doing parsing+checking+optimizing+codegen at once, Research Part 13.1); makes real semantic decisions at codegen time it shouldn't (hardcoded `align-items`, unconditional `min-width`, Research Part 9.1) — see Section 1.5.4 |
| **Verify** | No | Nothing plays this role. `validate.js` and the existing test suite are structural, not property-level (Research Part 7.5.9) | A graph where every node has a systematically wrong or orphaned fact validates cleanly today — this is precisely how Part 9.0's dead `interp.sizing` went unnoticed across multiple "fixed" sessions |

---

## 1.5 — Evaluation of Four Proposed Additional Layers

Each proposal evaluated on its own merits — accept, accept-with-scoping-correction, or caution — not accepted wholesale by default. All four are ultimately **accepted**, but two required a scoping correction to avoid duplicating work this roadmap already assigned elsewhere, and one raises a real risk worth stating before proceeding (1.5.5).

### 1.5.1 — "A dedicated Parser/Semantic AST between NDG and Skeleton"

**Verdict: Accept, narrower than proposed, and mostly a rename/relocation rather than new work.**

`compiler/ndg/build.js` already contains exactly this stage's real content — `hasPaintSignal()`'s wrapper-collapse pass is PURELY STRUCTURAL (does a node have enough of its own paint/geometry signal to survive, independent of what it MEANS). It is currently bundled inside "NDG," which also does raw field capture — two genuinely distinct responsibilities (raw capture = lexer-equivalent; structural collapse/normalization = parser-equivalent) sitting in one module with one name. The fix is to split this out into its own explicitly-named stage — call it **Parser AST** — sitting between NDG (Phase 1) and Skeleton (renamed Phase 3 below).

**The scoping correction, and why it matters**: a real language parser can fully separate "structure" from "meaning" because its grammar is unambiguous (Research Part 13.0). Figma's cannot — Research Part 2 already established that two designers can produce the same visual result from different raw trees, meaning "should these 3 rectangles be treated as one card" is ITSELF a semantic judgment, not a prior structural fact a pure parser can resolve. **Parser AST's scope must therefore stay deliberately narrow**: wrapper/passthrough collapse, coordinate normalization, parent/child geometry resolution — anything that requires no judgment about what a node represents. Any temptation to let this stage also decide roles or clusters should be resisted; that work stays in Skeleton (Phase 3), which runs immediately after and consumes Parser AST's clean output.

### 1.5.2 — "A Design Language / Visual AST responsible for preserving every visual property before CSS generation"

**Verdict: Accept in full — this is a genuine, previously-missing gap in v1 of this roadmap.**

v1 built a dedicated resolution stage for the LAYOUT axis of properties (Sizing, Phase 5) but never proposed an equivalent for the PAINT/VISUAL axis (fills, strokes, effects, masks, corner radius, blend modes) — Research Part 5/8's property-loss findings were treated as a bag of independent point-fixes (gradient-text, object-fit, box-shadow, all landed ad hoc, directly in `css-declarations.js`, this session) rather than one canonical resolution stage. That asymmetry was a real gap.

**One naming correction**: visual/paint properties are per-node LEAF facts, not tree-structural groupings — "AST" is the wrong compiler term for this stage (an AST's defining feature is hierarchical grouping; resolving "what's this node's final fill" needs no tree restructuring at all). This document names it **Visual/Paint Resolution** instead, parallel in spirit and dependency shape to Sizing (both depend only on Skeleton, both produce per-node resolved facts, both are consumed identically by codegen) — see Phase 5.5 below, and the full property list in Section 6.

### 1.5.3 — "A separate Component Recognition Engine instead of mixing recognition responsibilities into Skeleton"

**Verdict: Accept — real component/instance data is declared (like `layoutMode`), not inferred (like geometric clustering), and mixing the two risks the exact "declared vs. inferred, coincidentally not colliding" problem Section 2.6 (Confidence Loss) already flags for layout mode.**

Skeleton's job, as scoped in v1 (old Phase 2), was retiring three GEOMETRIC clustering mechanisms — all of which are inference over sibling positions. Real Figma `componentId`/`mainComponentId`/`variantProperties` (Research Part 5's "Components/Instances" row) is a fundamentally different kind of fact: a direct, authoritative declaration, not a guess. If both mechanisms live inside one undifferentiated "Skeleton" stage with no enforced precedence, a real component instance could still be geometrically re-clustered by the wrong tolerance heuristic — the same failure shape already proven for layout mode (Research Part 7.5.4: "declared beats inferred" is an accident of two separately-maintained scoring tables today, not an enforced rule).

**Separated as its own stage** (Component Recognition, Phase 2.5 below), running BEFORE Skeleton's geometric clustering and claiming any node with real component/instance identity first — Skeleton's clustering then only ever runs on the remainder. Kept as a distinct pipeline stage rather than a Skeleton sub-phase specifically because it has a different input (declared fields, not geometry) and a different failure mode (a wrong data lookup, not a wrong tolerance threshold) — worth the separation for independent testability, matching Research Part 13.2's Clang lesson (design the canonical tree to serve future consumers cleanly, not just today's one renderer).

### 1.5.4 — "A Style Resolver between Responsive and Render so the renderer becomes a pure mechanical emitter with zero semantic decisions"

**Verdict: Accept in full — this sharpens something v1 left underspecified.**

v1's "Phase 7: Render Migration" already stated the GOAL (codegen makes no new semantic decisions) but conflated two responsibilities inside one phase: consolidating every upstream-resolved fact into one final answer per node, and printing that answer as CSS/HTML text. Research Part 13.1 already drew the relevant analogy without acting on it: LLVM separates instruction SELECTION (deciding which target instruction implements an IR operation) from the AsmPrinter (turning a selected instruction into literal text) — two passes, not one. Splitting v1's Phase 7 into **Style Resolver** (Phase 8 below — consumes Skeleton + Component Recognition + Semantic + Sizing + Visual/Paint + Responsive, produces one final, fully-decided style-fact object per node) and **Render** (Phase 9, narrowed — now genuinely just template/string emission from that object) is the direct, correct fix, and it changes Render's dependency surface for the better: instead of depending on five separate upstream stages, it depends on exactly one.

### 1.5.5 — Net effect and one honest caution

Four new/refined stages (Parser AST, Component Recognition, Visual/Paint Resolution, Style Resolver) are added to v1's pipeline. Before treating this as settled: **the same reasoning that justified each of these four does NOT justify adding a new stage for every remaining gap this document finds.** The test applied above, each time, was "does this represent a genuinely different kind of input, a genuinely different failure mode, or a genuinely different consumer than an existing stage" — not "is this a distinct enough concept to deserve a name." The CSS Property Preservation Matrix in Section 6 lists ~35 individual properties; **all of them belong inside the single Visual/Paint Resolution stage**, not 35 new pipeline phases. Research Part 13.0's own honesty section is the standing check against over-layering: Figma's format is genuinely ambiguous in a way real compiler source languages are not, which means some irreducible heuristic/inference component will always remain — the goal of this redesign is fewer, clearer, non-duplicated stages, not maximal decomposition for its own sake.

---

## 2. Structural Weaknesses, Mapped to Failure Categories

Six named failure categories. Each weakness below is cited to where it was originally found, not re-derived — this section's job is classification, not new discovery. (Unchanged from v1 except 2.5, which now points to Section 6's full matrix instead of only Part 5's summary rows.)

### 2.1 — Pixel drift
- Every dimension emitted as a hardcoded pixel number (Research Part 9.0) is, by construction, only correct at the exact canvas width Figma captured — any other render width is drift by definition, not an edge case.
- No property-level fixture safety net (Research Part 7.5.9) — drift isn't caught mechanically; it's caught when a human notices a screenshot looks wrong.
- Measured-vs-captured-box mismatches: the `min-` (never hard) sizing convention used throughout the renderer (Research Part 9.1) is a deliberate anti-drift mechanism for TEXT/content overflow, but has no equivalent for the CONTAINER shrinking below its content's captured size (the hero-row overflow is exactly this).

### 2.2 — Absolute-position fallback
- The `!parentHasAutoLayout` fallback (Research Part 9.1, row 1) is only correct when upstream recognition genuinely found nothing — but uncoordinated detectors (2.4) can each independently fail to recognize a real pattern for different reasons, with no way to tell "genuinely freeform" from "a detector was starved by iteration order" (Research Part 6.5).
- `constraints` (Figma's real pin/stretch signal) is ingested but never consulted for anchoring (Research Part 10) — a node that SHOULD be `position:sticky` or percentage-anchored has no path to become that.

### 2.3 — Non-responsive layouts
- Direct restatement of 2.1's root mechanism: Research Part 9.0 (dead `interp.sizing`), Part 8's Flexbox row (hardcoded `align-items`/never-emitted `justify-content`), Part 11.2's table (aspect-ratio never emitted, overlay offsets are pixels not percentages).

### 2.4 — Duplicated detection logic
- Three independent, non-consolidated geometric clustering mechanisms (`compiler/geometry`, `compiler/freeform-layout`, `compiler/rulepack/component-detect`) — Research Part 7.5.3, tolerance constants literally duplicated verbatim in more than one place.
- Two independent "is this positioned absolutely" fact-computations exist (one live, one dead) — Research Part 9.3's background audit — currently harmless only because the second is unreachable.

### 2.5 — Property loss
Research Part 5's Information Preservation Matrix (~50 rows, all properties) remains the general canonical source. **Section 6 below is now the canonical source specifically for VISUAL properties** (fills/gradients/strokes/shadows/blur/masks/blend/filters/corner-radius/object-fit/aspect-ratio/transforms/transitions/animations) at full per-property granularity, superseding Part 5/8's summarized versions of the same ground for that subset.

### 2.6 — Confidence loss
`layout/interpret.js`'s `bump()` mechanism computes a real per-candidate confidence score (`localScore`) for every layout-mode decision, sorted but then discarded — only the top candidate survives past `interpretNode()`. Two concrete consequences:
- **"Declared beats inferred" is an emergent coincidence between two separately-maintained scoring tables, not an enforced invariant** (Research Part 7.5.4) — and, per Section 1.5.3 above, this exact risk now also applies to Component Recognition vs. Skeleton's geometric clustering unless their precedence is enforced structurally, not just by convention.
- **Silent first-match tie-breaks decide node identity with no verification** (Research Part 7.5.6) — a near-tie decision is indistinguishable, after the fact, from a confident one.

---

## 3. Dependency Graph

Not a strict linear chain — several stages fork and can proceed in parallel once their one real prerequisite lands. Updated to include the four stages from Section 1.5.

```
                         ┌─────────┐
                         │ Capture │  (no dependencies)
                         └────┬────┘
                              ▼
                         ┌─────────┐
                         │  NDG    │  (Phase 1: gap-filling — additive, independent)
                         └────┬────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  ┌───────────┐         ┌───────────┐         ┌───────────┐
  │ Phase 0   │         │ Phase 1.5 │         │ Phase 2   │
  │(verify-   │         │(tactical  │         │ Parser    │
  │ lint,     │         │ sizing    │         │ AST       │
  │ static)   │         │ wire-in)  │         │(structural│
  └───────────┘         └───────────┘         │normaliz.) │
 independent,          independent,            └─────┬─────┘
 ships now,            ships now,                    │
 no IR needed          superseded by                 ▼
 at all                Phase 5 later           ┌───────────┐
                                                │ Phase 2.5 │
                                                │ Component │
                                                │Recognition│
                                                └─────┬─────┘
                                                      │ (claims component/
                                                      │  instance nodes FIRST,
                                                      │  higher precedence)
                                                      ▼
                                                ┌───────────┐
                                                │ Phase 3   │
                                                │ Skeleton  │
                                                │(geometric │
                                                │ role/     │
                                                │ cluster,  │
                                                │ remainder │
                                                │ only)     │
                                                └─────┬─────┘
                        ┌─────────────┬───────────────┼───────────────┐
                        │             │               │               │
                        ▼             ▼               ▼               ▼
                  ┌──────────┐ ┌───────────┐   ┌───────────┐   ┌───────────┐
                  │ Phase 4  │ │ Phase 5   │   │Phase 5.5  │   │ Phase 6   │
                  │ Semantic │ │ Sizing    │   │Visual/    │   │ Layout    │
                  │(align/   │ │(fill/hug/ │   │Paint      │   │ wiring    │
                  │ anchor/  │ │ fixed)    │   │Resolution │   │(consume   │
                  │ overrides)│ └─────┬─────┘   │(fills/    │   │ IR, stop  │
                  └────┬─────┘       │         │strokes/   │   │re-deriving)│
                       │             │         │effects/   │   └─────┬─────┘
                       │             │         │masks — §6)│         │
                       │             │         └─────┬─────┘         │
                       │             │               │               │
                       └──────┬──────┴───────┬───────┴───────────────┘
                              │              │
                              ▼              ▼
                        ┌───────────┐  (Phase 7, Responsive, soft-depends
                        │ Phase 7   │   on Phase 5 only — can run in parallel
                        │Responsive │   with 4/5.5/6, re-validated once 5 lands)
                        │re-validate│
                        └─────┬─────┘
                              │
                              ▼  (Phase 8 depends on ALL of 4,5,5.5,6,7 — the
                        ┌───────────┐  true consolidation point)
                        │ Phase 8   │
                        │  Style    │
                        │ Resolver  │
                        └─────┬─────┘
                              │
                              ▼  (Phase 9 depends ONLY on Phase 8 — this
                        ┌───────────┐  collapse is the whole point of 1.5.4)
                        │ Phase 9   │
                        │  Render   │
                        │(mechanical│
                        │ emitter)  │
                        └───────────┘

  ┌───────────┐
  │ Phase 10  │  independent of the whole chain — best run after Phase 3 so
  │Prior-art  │  ported logic lands in the new Skeleton shape, not the old one
  │ salvage   │
  └───────────┘

  Phase 11 (Verify): invariants land incrementally, one per dependency,
  as each phase above ships — see Section 5's Phase 11 table.
```

**Read this graph as**: Capture→NDG→Parser AST→Component Recognition→Skeleton is now the strict prerequisite chain (longer than v1's, because Section 1.5 split what v1 called "NDG"/"Skeleton" into more precise stages). Once Skeleton (Phase 3) ships, **four phases fork in parallel** (Semantic, Sizing, Visual/Paint Resolution, Layout wiring) — more parallelism than v1 offered, since Visual/Paint Resolution is a new, independent fork. Style Resolver (Phase 8) is the single re-convergence point everything downstream passes through, and Render (Phase 9) now has the narrowest possible dependency surface (one stage, not five) — the direct architectural win Section 1.5.4 argued for.

---

## 4. Independence Classification

| Can start immediately, zero dependency on anything else | Requires a prior phase first |
|---|---|
| Phase 0 (verify-lint, static code cross-reference) | Phase 2 (Parser AST) requires Phase 1's NDG fields complete |
| Phase 1 (NDG gap-filling — additive only) | Phase 2.5 (Component Recognition) requires Phase 2's normalized structure |
| Phase 1.5 (tactical sizing wire-in against TODAY's renderer shape) | Phase 3 (Skeleton) requires Phase 2.5 (so its geometric clustering only runs on the remainder) |
| Phase 10 (prior-art salvage research) — though best EXECUTED after Phase 3 | Phases 4, 5, 5.5, 6 all require Phase 3, and only Phase 3 — safe to parallelize across 4 independent workstreams once it ships |
| | Phase 7 (Responsive) soft-requires Phase 5 for its output to be meaningful |
| | Phase 8 (Style Resolver) requires 4, 5, 5.5, 6, 7 all shipped — the one true late-stage convergence point |
| | Phase 9 (Render) requires ONLY Phase 8 — by design, per Section 1.5.4 |
| | Phase 11's invariants land one at a time, each gated on its own specific dependency (see Section 5) |

**The one deliberate exception worth flagging explicitly**: Phase 1.5 and Phase 5 both touch "sizing," and Phase 1.5 is explicitly a **throwaway/tactical** fix — it wires today's already-correct `interp.sizing` value into today's renderer shape, at the cost of needing to be re-wired again once Phases 2/3/5 land and the renderer's shape changes. Accepted, bounded, known-in-advance duplicated effort in exchange for shipping two confirmed live bugs' fix immediately.

---

## 5. Phase-by-Phase Roadmap

Each phase: objective, inputs, outputs, invariants, verification, regression risk, impact, classification.

### 5.0 — Phase 0: Verify-Lint (static ingest/emission cross-reference)
- **Objective**: Catch the "ingested but never emitted" bug class (gradient text, object-fit, box-shadow — all found only by a human noticing a rendered discrepancy) mechanically, at build/CI time.
- **Inputs**: `compiler/ndg/ingest.js`'s field list, every read-site across `compiler/artifacts/*` and `compiler/emit/*`.
- **Outputs**: A report/CI failure listing any ingested field with zero downstream readers, and any field read with no ingest source.
- **Invariants**: Every field in `workingNodeFromRaw()`'s object literal has ≥1 consumer OR an explicit `// intentionally structural-only` annotation.
- **Verification**: Pure static analysis script, no fixtures needed.
- **Regression risk**: None — additive, read-only tool.
- **Impact**: Cheapest single action in this roadmap; would have caught the last three "ingested but dropped" bugs before a user reported them.
- **Classification**: **HIGH PRIORITY**.

### 5.1 — Phase 1: NDG Completion
- **Objective**: Close remaining additive ingest gaps (multi-fill, radial/diamond gradients, `absoluteRenderBounds`, minimal `SECTION`/`BOOLEAN_OPERATION`/`TABLE` type recognition, and every "Ingested?: No" row in Section 6).
- **Inputs**: Raw Figma JSON (existing cached fixtures + corpus).
- **Outputs**: Extended `WorkingNode` shape; no behavior change for existing fixtures.
- **Invariants**: No existing field's shape changes; new fields default to `null`/`[]`, matching every other field's contract.
- **Verification**: Property-level fixture assertions against real cached snapshots for each newly-captured field.
- **Regression risk**: Low — additive-only; risk limited to collapse logic accidentally treating a new field as eligibility signal.
- **Impact**: Medium directly, high indirectly (removes "next 1,000 files" risk for component libraries/Sections/Tables and unblocks most of Section 6's "Ingested: No" rows).
- **Classification**: **HIGH PRIORITY**.

### 5.1.5 — Phase 1.5: Tactical Sizing Wire-In (superseded by Phase 5)
- **Objective**: Stop the two live, user-reported bugs (hero-row overflow, `Group 357` misalignment) by reading the already-correct `interp.sizing.horizontal/vertical` at the two known emission sites in TODAY's renderer shape.
- **Inputs**: `interp.sizing` (already computed, already correct, currently orphaned).
- **Outputs**: `fill` → `flex:1 1 0`/`width:100%`; `hug` → no explicit width; `fixed`/absent → today's behavior, unchanged.
- **Invariants**: Zero existing fixture's CSS changes unless its source data has real, previously-unexercised `FILL`/`HUG` sizing.
- **Verification**: Full existing test suite stays clean; new fixture test reproducing the hero-row/`Group 357` shape resolves fluidly.
- **Regression risk**: Named explicitly: targets today's renderer shape, which Phases 2/3/5 will restructure — some of this code will need rework once the permanent Sizing stage lands.
- **Impact**: Very high, immediate — cheapest fix-to-impact ratio of any item in this roadmap.
- **Classification**: **BLOCKER** (tactical bridge, not the architectural answer).

### 5.2 — Phase 2: Parser AST (Structural Normalization) — NEW (Section 1.5.1)
- **Objective**: Split NDG's currently-bundled "raw capture" and "structural collapse" responsibilities into two explicit stages; this phase is the second one — wrapper/passthrough collapse, coordinate normalization, parent/child geometry resolution, with NO role/semantic judgment (that stays in Phase 3).
- **Inputs**: Completed NDG (Phase 1); the EXISTING `hasPaintSignal()`/collapse logic in `compiler/ndg/build.js`, relocated rather than rewritten.
- **Outputs**: A normalized node tree — collapsed wrappers, resolved coordinates — with the exact same content NDG produces today, just relocated into its own named, independently-testable stage.
- **Invariants**: Byte-identical collapse decisions to today's `hasPaintSignal()` for every existing fixture (this is a relocation, not a behavior change) — a good place to ALSO close Research Part 7.5.2's finding (opacity/rotation/mixed-radius not checked before collapse) as a scoped, explicit addition.
- **Verification**: Existing NDG collapse tests, ported to run against the relocated module; full-corpus byte-diff to confirm zero behavior change beyond the explicitly-tracked opacity/rotation fix.
- **Regression risk**: Low for the relocation itself (pure move); medium for the opacity/rotation/mixed-radius addition (touches collapse eligibility, needs the same cross-corpus validation discipline as prior consolidations this session).
- **Impact**: Medium directly (mostly organizational), high as an enabler — Component Recognition and Skeleton both get a cleaner, more clearly-scoped input.
- **Classification**: **MEDIUM** (valuable, low urgency on its own — the value is mostly realized by unblocking Phase 2.5/3 cleanly).

### 5.2.5 — Phase 2.5: Component Recognition Engine — NEW (Section 1.5.3)
- **Objective**: Recognize real Figma `COMPONENT`/`COMPONENT_SET`/`INSTANCE` structures directly from declared fields (`componentId`, `mainComponentId`, `variantProperties`, `overrides`) — including override VALUES, not just key names (Research Part 5) — running BEFORE and at HIGHER PRECEDENCE than Skeleton's geometric clustering.
- **Inputs**: Parser AST output (Phase 2); already-ingested `componentKey`/`componentId`/`overrides`/`variantProperties` fields (existing NDG).
- **Outputs**: A per-node "claimed by Component Recognition" fact (with resolved override values) for every real component/instance node; everything else passes through unclaimed to Phase 3.
- **Invariants**: A node claimed by Component Recognition is NEVER also independently re-clustered by Skeleton's geometric mechanisms (Research Part 13.4's invariant #2, extended — see Phase 11).
- **Verification**: New fixture tests against a real component-library-sourced Figma file (Research Part 6.1 flagged this project has never tested against one) — a corpus gap this phase should also close.
- **Regression risk**: Low for existing fixtures (none in this project's current corpus exercise real components, per Research Part 1.2/6.1 — meaning this phase is close to purely additive against today's test suite, but genuinely untested against its actual target case until a real component-library fixture is added).
- **Impact**: High for the "next 1,000 files" risk (Research Part 6's highest-flagged gap: professionally-maintained component libraries have zero code path today); low measured impact against this project's OWN current 5-file corpus, which doesn't exercise this at all.
- **Classification**: **HIGH PRIORITY** (architecturally necessary before Phase 3, but not blocking any CURRENTLY reported bug).

### 5.3 — Phase 3: Skeleton (Geometric Role & Cluster Consolidation)
- **Objective**: Retire the three independent geometric clustering mechanisms (`compiler/geometry`, `compiler/freeform-layout`, `compiler/rulepack/component-detect`) into one canonical role/cluster/reading-order authority, scoped to nodes Component Recognition (Phase 2.5) didn't already claim.
- **Inputs**: Parser AST (Phase 2), Component Recognition's claimed-node set (Phase 2.5), existing v0 Skeleton module, the three detectors' accumulated tolerance constants/logic.
- **Outputs**: Role (content/decorative-chrome/structural-wrapper/repeating-member/composited-overlay/real-layout-container/inferred-layout-container), cluster membership, resolved reading order — for every remaining node.
- **Invariants**: Every node has exactly one role; every node is claimed by at most one recognition mechanism total, counting Component Recognition (Research Part 13.4's invariant #2, extended).
- **Verification**: The three existing detectors' full test suites, ported to assert against Skeleton's unified output; full-corpus byte-diff.
- **Regression risk**: **Highest in this roadmap** — touches core recognition logic behind every rendered pattern. Same rigor as the `isRealOverlap`/`clusterByPosition` merges already proven out this session (cross-corpus validation BEFORE implementation).
- **Impact**: Very high — the fork point unblocking Phases 4, 5, 5.5, and 6 in parallel.
- **Classification**: **BLOCKER**.

### 5.4 — Phase 4: Semantic Resolution (alignment / anchoring / component-override values)
- **Objective**: Resolve `primaryAxisAlignItems`/`counterAxisAlignItems` → real `justify-content`/`align-items`, `constraints` → `position:sticky`/percentage-anchoring, and (in coordination with Phase 2.5) component-override VALUES into authoritative per-node facts.
- **Inputs**: Skeleton (Phase 3), Component Recognition's override data (Phase 2.5), already-ingested `primaryAxisAlignItems`/`constraints` fields.
- **Outputs**: Per-node resolved alignment/anchor/override facts.
- **Invariants**: A node's alignment fact is read from Figma's declared value whenever present, falling back to today's hardcoded default only in genuine absence.
- **Verification**: New fixture tests for each sub-area against real cached snapshots exercising non-default values.
- **Regression risk**: Medium — existing fixtures asserting hardcoded `align-items` defaults need review for whether they were asserting the default (unchanged) or coincidentally matching a declared value (needs updating).
- **Impact**: High — closes Part 8's largest CSS-category gap (Flexbox, Ceiling ~90%, Current ~40%).
- **Classification**: **HIGH PRIORITY**.

### 5.5 — Phase 5: Sizing Resolution (architectural, supersedes Phase 1.5)
- **Objective**: The permanent version of Phase 1.5 — sizing resolved once against Skeleton-classified nodes, consumed by Style Resolver (Phase 8) with no re-derivation.
- **Inputs**: Skeleton (Phase 3), `layoutSizingHorizontal/Vertical` (already ingested).
- **Outputs**: `sizing: 'fill'|'hug'|'fixed'` fact per axis per node.
- **Invariants**: Every node has a non-null resolved sizing strategy by the time Style Resolver runs (Phase 11's invariant #1).
- **Verification**: Same fixture tests as Phase 1.5, now passing through the new architecture; Phase 11's invariant #1 as a permanent regression guard.
- **Regression risk**: Medium — must match Phase 1.5's already-shipped output for every case it covers; new risk surface only where Phase 1.5's narrower implementation didn't reach.
- **Impact**: Very high — the permanent fix for this document's single most-cited finding.
- **Classification**: **BLOCKER**.

### 5.5.5 — Phase 5.5: Visual/Paint Resolution — NEW (Section 1.5.2)
- **Objective**: One canonical resolution stage for every VISUAL property (fills, gradients, strokes, shadows, blur, masks, blend modes, corner radius/smoothing) — replacing the current pattern of fixing each ad hoc, directly in `css-declarations.js`, one bug report at a time. Full property list and current status: Section 6.
- **Inputs**: Skeleton (Phase 3), already-ingested `paints`/`strokes`/`effects`/`geometry.cornerRadius` etc. (existing NDG, extended by Phase 1's gap-filling).
- **Outputs**: A per-node resolved visual-style fact set: final fill (solid/gradient/multi-layer), final stroke (including per-side/dash/cap-join where SVG-relevant), final effect list (shadow + blur, comma-composed), final mask/clip strategy, final corner-radius (uniform or per-corner).
- **Invariants**: Every "Ingested: Yes" row in Section 6 has a corresponding "Emitted: Yes" outcome after this phase, or an explicit, documented reason it remains a known gap (e.g. `cornerSmoothing` — no CSS primitive exists).
- **Verification**: New fixture tests per property category in Section 6, prioritized by the Priority column there; Phase 0/11's verify-lint as an ongoing regression guard against this exact bug class recurring.
- **Regression risk**: Low-medium — mostly additive (new properties reaching CSS that previously emitted nothing); risk is concentrated in multi-fill support, which changes an existing code path (`paintCss()`'s current "exactly one fill" assumption).
- **Impact**: Very high per the user's own explicit framing this pass ("complete information preservation with zero property loss") — this is now a co-equal priority to Sizing, not a secondary cleanup.
- **Classification**: **HIGH PRIORITY** (elevated from where property-loss fixes have sat implicitly in v1 — no single smoking-gun bug the way Sizing has, but broad, explicitly user-prioritized scope).

### 5.6 — Phase 6: Layout Wiring
- **Objective**: Close Research Part 7.5.8's confirmed architecture-contract violation — the renderer consumes Skeleton + previously-computed `LayoutIR`/`ComponentIR`/`ResponsiveIR` instead of re-materializing NDG and re-running its own detection stack.
- **Inputs**: Skeleton (Phase 3), existing `LayoutIR`/`ComponentIR`/`ResponsiveIR`.
- **Outputs**: Renderer restructured to accept pre-computed IR rather than raw NDG + its own detection calls.
- **Invariants**: Byte-identical output to today's renderer for every existing fixture, unless a difference is an intentional, separately-tracked fix from another phase.
- **Verification**: Full-corpus byte-diff.
- **Regression risk**: High — genuine architectural rewire; must be incremental (one detection mechanism's consumption at a time), not a single cutover.
- **Impact**: High — removes "which of the detectors' output actually reached the renderer" ambiguity.
- **Classification**: **HIGH PRIORITY**.
- **Status: COMPLETE (5 increments, each watcher-approved).** `renderIrExperimental()` now accepts `opts.precomputedNdg`/`opts.precomputedInterpretations`/`opts.precomputedComponentRecognition`/`opts.precomputedResponsive` — additive escape hatches, `||`-guarded, zero behavior change when omitted. This closed the *capability* gap; the real values were not yet threaded through from `compile()` at the time Phase 6 was declared done.

### 5.6.1 — Kernel Integration (follow-on to Phase 6)
- **Objective**: Actually feed compile()'s real Kernel-projected `NDG`/`LayoutIR`/`ComponentIR`/`ResponsiveIR` into the Phase 6 escape hatches, replacing the renderer's synthetic self-materialization — `compile() → Kernel → real projectLayoutIR/projectComponentIR/projectResponsiveIR → Renderer`, without recomputation.
- **Discipline**: Same as Phase 6 — one integration slice at a time, byte-identical verification, watcher approval, no unrelated fixes.
- **Slice 1 (NDG) — COMPLETE, watcher-approved.** `compile.js` hoists its Kernel-materialized `ndg` to outer scope and threads it (plus `graphId`) through `emitArtifacts()` → `emitArtifactsIrExperimental()` → `renderIrExperimental()`'s `precomputedNdg`. Verified empirically (not just by reading code): `buildNormalizedDesignGraph()` is called exactly once per compile (no duplicate materialization), `graphId` is consistent end-to-end, all 6 real fixtures byte-identical.
  - **Disclosed, non-blocking finding**: `job.materializeNormalizedDesignGraph()` resolves its policy profile to `'default'` when `compile()` isn't given an explicit `policyProfileId` (none of the 6 fixture regen scripts pass one), while `renderIrExperimental()`'s own self-materialization default is `'pixel-faithful'` — a real profile mismatch between the two paths. Traced and confirmed dormant: `compiler/ndg/build.js`'s `buildNormalizedDesignGraph()` never reads `policy` at all, so both profiles produce structurally identical graphs today. Flagged for awareness only — if a future policy profile ever gates NDG construction, this dormant mismatch would surface silently. Not fixed now (no unrelated fixes); worth a one-line note if/when NDG construction ever becomes policy-sensitive.
- **Slice 2 (LayoutIR) — COMPLETE, watcher-approved.** `compile.js` hoists `layout` (from `job.projectLayoutIR()`) and threads `layout.interpretations` through to `renderIrExperimental()`'s `precomputedInterpretations`. This slice DID surface a real divergence, not just a theoretical one (see next paragraph) — it was root-caused and fixed as part of completing the slice, not deferred, since without the fix the substitution was not actually equivalent.
  - **Real bug found and fixed**: `compiler/layout/materialize.js`'s `materializeLayoutIR()` defaults `recognitionHintsByNode` to `{}` when its caller doesn't supply one, and `compile.js` never did — invisible before this integration because nothing consumed the Kernel's LayoutIR for rendering. `ir-experimental-renderer.js`'s own self-materialized path always computed real hints via `detectGeometry(graph, {})`. Empirically isolated on the why-participate fixture (same graph, controlled comparison): the Kernel path and a direct call with hints forced to `{}` produced *identical* results (77/77 "unknown"), while the direct call with real hints recovered 2 nodes (`src:39:9`, `src:39:22` — the two-cards-same-row geometry case) to `flow-row` — confirming `recognitionHintsByNode` as the sole, exact cause. Those 2 container nodes' misclassification cascaded into a large wrong-rendering diff for their entire subtree (children falling back to absolute positioning instead of flex layout), which is what the initial byte-diff surfaced as a major regression across 5 of 6 fixtures.
  - **Fix**: `compile.js` now computes `detectGeometry(ndg.graph, {})` (same call, same empty opts as the renderer already used — no detector redesign, no new heuristic) and passes its `recognitionHintsByNode` into `job.projectLayoutIR()`, which already accepted that parameter (`execOpts.recognitionHintsByNode`) — a dormant, already-existing integration point, not new API surface.
  - **Verification**: full suite clean, all 6 real fixtures byte-identical, plus a new permanent regression test (`compiler/test/compile.test.js`, "recovers pure-geometry row recognition through the real Kernel LayoutIR") using a synthetic container with NO declared `layoutMode` that only geometry recognition can classify as a row.
- **Slice 3 (ComponentIR) — COMPLETE, watcher-approved.** `compile.js` hoists `componentIr` (from `job.projectComponentIR()`) and threads `componentIr.detected` through to `renderIrExperimental()`'s `precomputedComponentRecognition`.
  - **Rigor applied** (per Slice 2's lesson that a clean top-level CSS byte-diff can hide a real divergence a fixture doesn't happen to exercise): compared the exact real Kernel call shape (`detectComponents(graph, {layoutIr: <real pinned LayoutIR envelope>, layoutDegraded, decisions, policy})`, no `componentGeometryDetected`) against the exact real renderer call shape (`detectComponents(graph, {componentGeometryDetected: <real detectComponentGeometry() result>})`, no `layoutIr`) — the two genuinely different sets of inputs each path supplies today. Deep-equality-checked (not just shape-summarized) across all 6 real fixtures (49 to 729 nodes) — **byte-for-byte identical** in every case. No fix was needed for this slice; the divergence risk Slice 2 found real did not materialize here for the current corpus.
  - **Verification**: full suite clean, all 6 real fixtures byte-identical CSS, plus the controlled `detectComponents()`-output-level comparison above.
- **Slice 4 (ResponsiveIR) — COMPLETE, watcher-approved.** `compile.js` hoists `responsiveIr` (from `job.projectResponsiveIR()`) and threads `responsiveIr.detected` through to `renderIrExperimental()`'s `precomputedResponsive`.
  - **Rigor applied**: same as Slice 3 — compared the exact real Kernel call shape (`detectResponsive(graph, {layoutIr: <real pinned LayoutIR envelope>, layoutDegraded, decisions, policy})`) against the exact real renderer call shape (`detectResponsive(graph, {layoutIr: <synthetic {payload:{nodes:[{nodeId,mode}]}} built from interpretations>, policy: {}})`) — deep-equality-checked across all 6 real fixtures (49 to 729 nodes). **Byte-for-byte identical** in every case, consistent with the structural reasoning that both `layoutIr` shapes ultimately supply the same `(nodeId, mode)` pairs once Slice 2's `recognitionHintsByNode` fix made `interpretations` the shared source for both paths.
  - **Verification**: full suite clean, all 6 real fixtures byte-identical CSS, plus the controlled `detectResponsive()`-output-level comparison above.
- **Kernel Integration: all 4 slices complete.** `compile() → Kernel → real projectLayoutIR/projectComponentIR/projectResponsiveIR → Renderer` now happens without recomputation for every engine that's enabled (the default). No detector was redesigned; the one code change beyond pure plumbing (Slice 2's `recognitionHintsByNode` fix) completed an already-existing, previously-unfed parameter rather than introducing new heuristic surface.

### 5.7 — Phase 7: Responsive Re-Validation + Closure
- **Objective**: Re-verify `compiler/responsive/*`'s breakpoint/strategy output once Phase 5 changes the baseline it overrides; close remaining aspect-ratio/percentage-overlay-offset gaps.
- **Inputs**: Phase 5's resolved sizing facts, existing Responsive IR.
- **Outputs**: Confirmed-compatible `@media` output; `aspect-ratio` emission for scale-locked media; percentage offsets for the Overlay pattern.
- **Invariants**: Every existing breakpoint/strategy test continues to pass unchanged.
- **Verification**: Existing `responsive`/`responsive-render` suites (43 tests) plus new targeted tests.
- **Regression risk**: Low-medium — re-validation of existing logic against a changed input, not a rewrite.
- **Impact**: Medium — closes specific remaining gaps in this project's most-complete category.
- **Classification**: **MEDIUM**.

### 5.8 — Phase 8: Style Resolver — NEW (Section 1.5.4)
- **Objective**: Consolidate every upstream-resolved fact (Skeleton role, Component Recognition identity/overrides, Semantic alignment/anchoring, Sizing, Visual/Paint, Responsive strategy) into ONE final, fully-decided style-fact object per node — leaving Render (Phase 9) nothing left to decide.
- **Inputs**: Phases 3, 4, 5, 5.5, 6, 7 — the true late-stage convergence point.
- **Outputs**: A resolved per-node style-fact object (final CSS-property-shaped values, not raw Figma facts) — the direct analogue of a fully-selected instruction, pre-printing.
- **Invariants**: No field this object exposes is ever null/undefined in a way that would require Render to guess or fall back to a hardcoded default of its own — any remaining default is resolved HERE, explicitly, not left implicit downstream.
- **Verification**: A new, dedicated test suite asserting the resolver's OUTPUT ALONE (no CSS text involved) against expected fact objects for representative fixtures — the first stage in this whole pipeline that can be unit-tested in true isolation from string generation.
- **Regression risk**: Medium — this is new consolidation logic, but it's consuming already-verified facts from Phases 3–7, not deriving anything new itself; risk is in correctly MERGING multiple sources' facts (e.g. Sizing's `fill` interacting with Responsive's per-breakpoint override for the same property) rather than in any single source being wrong.
- **Impact**: High — this is what makes Render (Phase 9) genuinely mechanical, closing Research Part 13.1's "layering violation" finding for good.
- **Classification**: **HIGH PRIORITY**.
- **Known tracked bug this phase must fix**: Section 6.2's `strokeAlign` finding — three separate emission paths (`modeDecls()`'s single-node branch, `freeformGroupMemberDecls()`, `rowSetRowDecls()`) each independently decide how to render a node's stroke, and only one honors `strokeAlign` correctly. This is exactly the "MERGING multiple sources' facts" risk named above, concretely instantiated — Style Resolver should own the single `strokeAlign`-aware decision once, so Render has nothing left to get wrong here.
- **Status: increment 1 COMPLETE (strokeAlign consolidation).** A shared `strokeDecls()` function now owns the single strokeAlign-aware stroke decision; `rowSetRowDecls()`/`freeformGroupMemberDecls()` consume it instead of independently hardcoding `border`. This is a narrow, targeted first slice of the full Style Resolver consolidation this phase describes — not yet the full per-node style-fact object covering every upstream-resolved fact (Skeleton role, Sizing, Visual/Paint, Responsive strategy, etc.). See Section 6.2's "TRACKED BUG — FIXED" note for full detail and verification.

### 5.9 — Phase 9: Render (Mechanical Emitter, narrowed)
- **Objective**: `modeDecls()`/`buildRenderNode` restructured to be a table-driven lowering from Style Resolver's output ONLY — zero raw-geometry re-derivation, zero hardcoded semantic defaults of its own.
- **Inputs**: Phase 8's resolved style-fact object — nothing else.
- **Outputs**: CSS/HTML text.
- **Invariants**: Every codegen branch is a direct lookup from the resolved fact object; any remaining raw fallback is an explicit, named, documented last resort (Research Part 9's "legitimate last-resort" cases), never an accident of layering.
- **Verification**: Full corpus regeneration + browser-based overlap/measurement sweep (this session's established discipline), plus Phase 11's invariants as a final gate.
- **Regression risk**: High-effort; strongly recommend incremental migration (one field's source at a time), matching this document's repeated finding that large rewrites are where this project's history has gone wrong.
- **Impact**: Very high, but back-loaded — most user-facing value is already realized by Phases 1.5/4/5/5.5; this phase is architectural closure that prevents the next gap of this shape from recurring.
- **Classification**: **HIGH PRIORITY** (not BLOCKER for the same reason as v1: earlier phases already deliver the user-facing fixes).

### 5.10 — Phase 10: Prior-Art Salvage
- **Objective**: Before implementing any new pattern-specific recognizer, check whether `server/figma-build.js`'s ~10 existing recovery passes already solve it.
- **Inputs**: `server/figma-build.js` (read-only reference), the Layout Pattern Taxonomy (Research Part 10).
- **Outputs**: A per-pattern decision record ("port" vs. "genuinely needs new logic") for at least the 3 highest-overlap patterns (Card, Dashboard, Hero).
- **Invariants**: No new pattern-recognition code is written without first checking this record.
- **Verification**: Side-by-side comparison (same real fixture, both code paths).
- **Regression risk**: None on its own; prevents future regression risk by avoiding a third reimplementation of existing logic.
- **Impact**: Medium — cost-avoidance, high leverage if several Phase 3/6 gaps are already solved.
- **Classification**: **MEDIUM**.

### 5.11 — Phase 11: Verify (`verifyIR()`, built incrementally)
Not one phase — independent invariants, each gated on its own dependency:

| Invariant | Depends on | Classification |
|---|---|---|
| Ingest/emission static cross-reference | Nothing | Same item as Phase 0; **HIGH PRIORITY**, ship first |
| Every node has a resolved sizing strategy | Phase 5 | **BLOCKER** once Phase 5 ships |
| No node double-claimed by a recognition mechanism (extended to include Component Recognition, Section 1.5.3) | Phases 2.5 + 3 | **HIGH PRIORITY** once Phase 3 ships |
| No `'unknown'` mode inside a Skeleton real-Auto-Layout container | Phases 3 + 6 | **HIGH PRIORITY** once Phase 6 ships |
| Absolute node has a real positioned ancestor | Phase 9 | **MEDIUM** |
| Style Resolver's output has no field Render would need to guess at (Section 1.5.4, new) | Phase 8 | **HIGH PRIORITY** once Phase 8 ships — the mechanical proof that Render is genuinely decision-free |

**Explicit roadmap rule**: no phase above is considered actually DONE until its corresponding invariant is live and passing in CI — a wiring fix with no verifier is indistinguishable from no fix at all until the next new file happens to expose the gap.

---

## 6. CSS Property Preservation Matrix

Every visual property Figma can express, individually — the complete, property-level version of Research Part 5/8's summarized rows for this specific axis, per the explicit goal: **not just responsive layout — complete information preservation, zero property loss.** All rows below are owned by **Phase 5.5 (Visual/Paint Resolution)** unless otherwise noted; see Section 1.5.5 for why this is one stage, not 35.

Legend: **Ingested** = captured by NDG today. **Emitted** = reaches real CSS in the active renderer today. **Done** = both yes, no further work needed.

### 6.1 — Fills & Gradients

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| Solid fill color | `paints[].color` (SOLID) | Yes | Yes | Done |
| Linear/angular gradient (fill) | `paints[].gradientHandlePositions/gradientStops` | Yes | Yes (this session) | Done |
| Linear/angular gradient (TEXT fill) | Same, on a TEXT node | Yes | Yes (this session) | Done |
| Radial gradient | `GRADIENT_RADIAL` | Yes (raw array) | No — `paintCss()` only branches on LINEAR/ANGULAR | **HIGH** — direct `radial-gradient()` mapping, no approximation needed |
| Diamond gradient | `GRADIENT_DIAMOND` | Yes (raw array) | No | **MEDIUM** — no exact CSS primitive; needs a documented approximation strategy (closest: `conic-gradient()` or nested `radial-gradient()`) |
| Multiple stacked fills (e.g. solid + image overlay) | `paints[]` with >1 entry | Yes (full array) | No — `paintCss()`/`solidFillCss()` both hard-require exactly 1 entry | **HIGH** — CSS natively supports comma-separated `background-image` layers; ordinary, not exotic, real-world pattern |
| Per-fill opacity/visibility | `paints[].opacity`/`.visible` | Yes | Yes for the single-fill case; moot until multi-fill ships | Tied to multi-fill row above |
| Per-fill blend mode | `paints[].blendMode` | Yes (part of raw paint) | No — only per-NODE blend mode is read | **MEDIUM** — real CSS `background-blend-mode` property exists for exactly this |
| Image fill scale mode (FILL/FIT/CROP/TILE) | `paints[].scaleMode` | Yes | Yes (this session, `object-fit`) | Done — CROP/TILE approximated as `cover`, documented known limitation |
| Image fill transform matrix (STRETCH mode) | `paints[].imageTransform` | Yes (raw) | No | **MEDIUM** — 7 confirmed real occurrences (Research Part 5); needs `object-position`/transform composition, non-trivial |
| Video fill | `paints[].type: VIDEO` | Unconfirmed | No | **OPTIONAL** — zero confirmed real occurrence in this project's corpus |

### 6.2 — Strokes / Borders

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| Uniform stroke color/weight | `strokes[]`/`strokeWeight` | Yes | Yes | Done |
| Per-side stroke weights | `individualStrokeWeights` | Yes | Yes (this session) | Done |
| Stroke align (INSIDE/CENTER/OUTSIDE) | `strokeAlign` | Yes | Yes — **FIXED, see below** | Done for the uniform-stroke case; per-side-weight+strokeAlign combo remains a genuine CSS-capability gap, see note |
| Stroke dash pattern | `strokeDashes` | Yes | Yes (this session, `border-style:dashed`) | Done — approximated as the `dashed` keyword only; exact dash/gap lengths have no plain-CSS-border equivalent (SVG stroke-dasharray would, out of scope for non-vector nodes) |
| Stroke cap (ROUND/SQUARE/arrow variants) | `strokeCap` | Yes | No — meaningless for a plain CSS border, only for SVG path strokes | **MEDIUM**, scoped narrowly to the SVG-reconstruction path (Research Part 4.1's SVG-collapse work), not `css-declarations.js` |
| Stroke join (MITER/BEVEL/ROUND) | `strokeJoin` | Yes | No | Same as stroke cap — **MEDIUM**, SVG-path-only |
| Multiple strokes on one node | `strokes[]` with >1 entry | Yes (array) | No — only the first/single stroke is read | **LOW** — rare in real designs |

**TRACKED BUG — FIXED (Phase 8, Style Resolver, first increment).** Found by
the Phase 6 parallel-execution Property Preservation Watcher, explicitly
deferred until after Phase 6 + Kernel Integration completed, per this
document's own "do not mix unrelated fixes into an architecture migration"
rule. Original finding: `strokeAlign:OUTSIDE`/`CENTER` rendered correctly
(via the `outline` trick) only on a standalone chrome node emitted through
`modeDecls()`'s single-node stroke branch. The moment the identical stroke
fact was *lifted* onto a repeating card/row/freeform-group member —
`freeformGroupMemberDecls()` and `rowSetRowDecls()` — both hardcoded a
plain CSS `border`, silently downgrading OUTSIDE/CENTER to
INSIDE-equivalent rendering. Proven end-to-end on a real node (INCENTIVES
`fYKUEGHAxVkJwn8CwvJCsp:50:206`, confirmed `strokeAlign:"OUTSIDE"` against
raw Figma data): correct as a lone chrome node, wrong once lifted onto a
visible repeating-card member.

**Fix**: extracted `modeDecls()`'s existing strokeAlign-aware decision into
a new shared, pure function, `strokeDecls()`
(`compiler/emit/render/css-declarations.js`) — the first concrete piece of
the Style Resolver consolidation this document's Section 5.8 called for
("Style Resolver should own the single strokeAlign-aware decision once").
`chromeStrokeAlign` is now captured in `classifyRowSetRow()`/
`classifyFreeformMember()` (`ir-experimental-renderer.js`, alongside the
existing `chromeStrokeCss`/`chromeStrokeWeight` capture) and threaded
through to both lift paths, which now call the shared `strokeDecls()`
instead of independently hardcoding `border`. Verified: unit tests for
`strokeDecls()` in isolation (OUTSIDE/CENTER/INSIDE/absent-stroke cases) +
regression tests for both lift paths + full-corpus byte-diff — the ONLY
change across all 6 real fixtures is exactly the expected one (INCENTIVES'
2 repeating-card instances of node `50:206`'s stroke: `border` →
`outline`/`outline-offset:0px`), independently re-verified against raw
Figma data.

**Remaining, separate, lower-priority gap (NOT fixed, genuinely different
in kind)**: `modeDecls()`'s per-side-weight branch (`individualStrokeWeights`)
still never reads `strokeAlign` — but this is a real CSS-capability limit,
not a wrong-code-path bug: `outline` is always a single uniform ring around
the whole box, so it cannot express 4 independently-different per-side
stroke weights the way `border-top`/`border-right`/etc. can. Zero real
occurrences of `individualStrokeWeights` + non-INSIDE `strokeAlign`
together found anywhere in the current 6-fixture corpus (confirmed by the
byte-diff showing no other change) — left open, matching this document's
established practice of not building speculative handling for a
combination with zero real-data justification (see the Mask Relationship
Design doc's identical reasoning for LUMINANCE masks).

### 6.3 — Corner Radius

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| Uniform corner radius | `geometry.cornerRadius` | Yes | Yes | Done |
| Per-corner radius | `rectangleCornerRadii` | Yes | No — read ONLY for structural collapse-protection (Research Part 5), never for visual `border-radius` | **HIGH** — CSS `border-radius` natively supports 4 independent corner values; trivial mapping, purely unbuilt |
| Corner smoothing ("squircle") | `cornerSmoothing` | Yes | No — **no CSS primitive exists** | **OPTIONAL/LOW** — would require `clip-path:path()` with a computed superellipse SVG path or CSS Houdini; low visual impact at typical smoothing values, architecturally expensive for the payoff |

### 6.4 — Effects (Shadow / Blur / Blend / Opacity)

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| Drop shadow | `effects[]` DROP_SHADOW | Yes | Yes (this session) | Done |
| Inner shadow | `effects[]` INNER_SHADOW | Yes | Yes (this session, `inset`) | Done |
| Multiple shadows on one node | `effects[]` with >1 shadow | Yes | Yes (this session, comma-composed) | Done |
| Layer blur | `effects[]` LAYER_BLUR | Yes | No | **HIGH** — direct `filter:blur()` mapping, architecturally easy, simply unbuilt |
| Background blur | `effects[]` BACKGROUND_BLUR | Yes | No | **HIGH** — direct `backdrop-filter:blur()` mapping (note: real-world browser-support caveat worth documenting, not a reason to skip) |
| Node-level opacity | `geometry.opacity` | Yes | Yes | Done |
| Node-level blend mode | `geometry.blendMode` | Yes | Yes (earlier session) | Done |

### 6.5 — Masks & Clipping

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| `clipsContent` (overflow clip) | `attributes.clipsContent` | Yes | Yes (earlier session) | Done |
| Real vector/alpha mask (`isMask`/`maskType`) | `geometry.isMask`/`.maskType` | Yes | No — consumed ONLY to protect a mask shape from accidental structural collapse; never turned into `mask-image`/`clip-path` | **HIGH** — a real, previously-unaddressed visual-fidelity gap: a masked layer today renders as an ordinary opaque sibling, not clipped to its mask shape at all |

### 6.6 — Transforms

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| Rotation, 180°, non-GROUP | `geometry.rotation` | Yes | Yes | Done |
| Rotation, arbitrary angle | Same field | Yes (raw) | No — explicitly gated off (unresolved width/height-swap basis conflict, Research Part 5) | **MEDIUM** — needs the basis-conflict resolved before it can ship safely |
| Skew / non-uniform scale | `relativeTransform` matrix | No — not ingested at all | No | **LOW** — zero confirmed real occurrences in this project's corpus to date |

### 6.7 — Object-Fit / Aspect-Ratio / Filters

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| `object-fit` | `paints[].scaleMode` | Yes | Yes (this session) | Done — see 6.1 |
| `aspect-ratio` (CSS property) | Derivable from box width/height when Sizing (Phase 5) resolves a node to `fill` and its content is image/video | N/A (derived, not a raw field) | No — this pipeline always falls back to hard pixel width+height instead | **MEDIUM** — a cross-cutting item at the Sizing/Visual-Paint boundary; own by Phase 5.5, informed by Phase 5's output |
| Hue-rotate/saturate/contrast/brightness filters | No first-class Figma effect type maps to these | No — no source field exists | No | **N/A — hard ceiling, not a gap.** Figma has no general per-node adjustment-filter concept comparable to CSS `filter:hue-rotate()` etc.; nothing to ingest |

### 6.8 — Transitions & Animations

| Property | Figma source | Ingested | Emitted | Priority |
|---|---|---|---|---|
| CSS transitions/keyframe animations | Figma's "Smart Animate"/prototyping "reactions" data — a completely separate API surface from the static node tree this pipeline reads | No — confirmed zero matches for `reaction`/`prototype` anywhere in `compiler/` | No | **OPTIONAL / OUT OF SCOPE** — Figma Ceiling ~5% (Research Part 8): static frames carry no keyframe data by definition; would require a deliberate, separate effort to ingest prototype data at all, not a gap in the current pipeline's own scope |

**Summary**: of ~35 individual properties audited, **14 are Done**, **9 are HIGH priority** (multi-fill, radial gradient, per-corner radius, layer/background blur, real masks — the highest-leverage, lowest-effort remaining set), **7 are MEDIUM**, **3 are LOW**, **2 are OPTIONAL/out-of-scope for architectural reasons** (`cornerSmoothing`, video fill), and **1 is a hard ceiling, not a gap** (generic CSS filters with no Figma-side concept). The 9 HIGH-priority rows should be Phase 5.5's first implementation pass, in the order listed, before any MEDIUM-priority row is attempted.

---

## 7. Recommended Execution Order

Respecting Section 3's dependency graph and Section 5's classifications.

1. **Immediately, in parallel**: Phase 0 (verify-lint), Phase 1 (NDG completion), Phase 1.5 (tactical sizing fix — ships the two live bug fixes now).
2. **Next**: Phase 2 (Parser AST) — low regression risk, mostly relocation; unblocks Phase 2.5.
3. **Next**: Phase 2.5 (Component Recognition) — architecturally required before Phase 3's clustering can be correctly scoped.
4. **Next, blocking**: Phase 3 (Skeleton consolidation) — the highest-regression-risk, highest-leverage phase; do not start Phases 4/5/5.5/6 before this lands and is byte-diff-verified against the full corpus.
5. **Then, in parallel** (all four depend only on Phase 3): Phase 4 (Semantic), Phase 5 (Sizing — supersedes 1.5), Phase 5.5 (Visual/Paint Resolution, starting with Section 6's 9 HIGH-priority rows), Phase 6 (Layout wiring). Phase 10 (prior-art salvage research) can run alongside these.
6. **Then**: Phase 7 (Responsive re-validation), once Phase 5 has shipped.
7. **Then**: Phase 8 (Style Resolver), once Phases 4, 5, 5.5, 6, 7 are all stable — the true late-stage convergence point.
8. **Then**: Phase 9 (Render, mechanical emitter), incrementally, one field/mechanism at a time, once Phase 8 is stable.
9. **Continuously, gated per-phase, not deferred to the end**: Phase 11's invariants, each landing immediately after the phase it depends on ships.

No implementation begins until this document is reviewed and this order is confirmed.
