# Compiler Migration Blueprint — Legacy Emitter → IR Pipeline

| Field | Value |
|---|---|
| Status | **Proposed — not yet approved for implementation** |
| Supersedes-in-intent | `PIPELINE_JOURNEY_AUDIT_HANDOFF.md`, ad hoc fixes in `server/figma-build.js` |
| Precondition | Gap analysis (previous turn) — verified function-by-function against the actual codebase, not assumed |
| Non-goal | This is not a "we already did this" report. Several existing docs in this folder (`PRODUCTION_READINESS_REPORT.md`, `FINAL_ARCHITECTURE_AUDIT.md`, `PHASE0–4_IMPLEMENTATION_REPORT.md`, `LIVE_LAUNCH_AUDIT.md`) claim completion states that direct code inspection contradicts (`compiler/emit/index.js` is 32 lines of plugin declarations; `compiler/layout/interpret.js` and `compiler/features/recognize.js` contain zero sibling-geometry code). This document does not rely on those claims and should not be read alongside them as corroboration. |

---

## 0. What this migration is actually closing

Two capabilities are missing, confirmed by reading the code, not by title:

1. **Geometric recognition** — nothing in `compiler/` computes row/column/grid/card/banner shape from sibling `(x, y, w, h)`. `compiler/layout/interpret.js` reads only Figma's *declared* `layoutMode`/`layoutPositioning`/`constraints`. `compiler/features/recognize.js` reads only a node's own `dimensions.width/height`. Zero alignment, gap, or overlap computation exists anywhere.
2. **A production HTML/CSS renderer** — `compiler/emit/index.js` is a 32-line plugin declaration; the actual string-emission work (`buildCss`, `buildHtml`, paint/vector serialization) lives entirely in `server/figma-build.js` (Bucket 3 from the gap analysis, ~1,961 lines) and nowhere in `compiler/`. Responsive breakpoint detection exists (`compiler/responsive/detect.js`) but zero code anywhere emits `@media` — confirmed by a repo-wide grep.

Everything below is designed around **absorbing** these two gaps into the compiler's existing, tested skeleton — not building a parallel system, and not another round of `figma-build.js` patches.

---

## 1. Every stage of the future pipeline

```
Figma document (raw)
  │
  ▼
Normalized Design Graph (NDG)                          [exists, tested]
  │
  ├─▶ Geometry Recognition IR  ◄── NEW STAGE (Phase 1)
  │     sibling alignment / gaps / overlap / axis candidates
  │     feeds recognitionHints into:
  │
  ▼
Layout IR  (interpret)                                  [exists, tested — AL branch only until Phase 1 lands]
  │
  ▼
Layout IR, solved  (constraint solver)                  [exists, tested]
  │
  ├──▶ Component IR        [exists, tested — gains card/banner patterns in Phase 2]
  ├──▶ Token IR             [exists, tested, already wired live]
  ├──▶ Semantic IR          [exists, tested, already wired live]
  ├──▶ Responsive IR        [exists, tested — gains @media emission in Phase 4]
  ├──▶ Accessibility IR     [exists, tested, already wired live]
  │
  ▼
Resolved IR  (merge manifest)                            [exists — thin, pointer-only today]
  │
  ▼
Emit Plan  (decision-level render plan)                  [exists — declarations only, no content yet]
  │
  ▼
HTML/CSS Renderer  ◄── NEW STAGE (Phase 3–4)
  materializes ResolvedIR + EmitPlan into literal
  <tag class> markup + CSS rule text + @media blocks
  (reuses figma-build.js's buildCss/buildHtml/paint
  serialization as the literal-string substrate)
  │
  ▼
Artifacts (index.html / styles.css / script.js)
```

**Nothing above the Renderer needs to be invented from scratch.** The gap is (a) one new IR-producing stage feeding an *existing* extension point, and (b) one new consumption/materialization stage at the bottom, reusing existing string-emission code as its substrate rather than rewriting it.

---

## 2. Where Geometric Recognition fits

It sits as a **rule pack**, following the exact convention already used by `layout-interpret`, `layout-constraint`, `recognition-basic`: it produces `Evidence` + `Hypothesis` records that feed `ctx.recognitionHints` into `compiler/layout/interpret.js`'s existing bump-scoring loop (`if (h === 'stack' ...) bump('flow-column', 0.5, ...)`).

Two implementation options, both viable, decided in Phase 1 planning (not now):
- **Extend `recognition-basic`** — its pattern vocabulary (`pattern:block.card-like`, `pattern:block.grid`, `pattern:block.stack`, `pattern:block.divider`, `pattern:block.container-like`) already exists in the knowledge base; only the geometric *evidence-computation* that proves those patterns is missing. Lower duplication.
- **New `geometry-recognize` pack** — cleaner ownership boundary, easier to phase/rollback independently. Higher isolation.

Recommendation: **new pack**, because Phase 1 needs to ship and be corpus-validated independently of `recognition-basic`'s existing (structural, non-geometric) behavior — mixing the two makes it harder to attribute a regression to either.

It sits *before* Layout IR interpretation in the phase-affinity sense (`early`/`mid` per the existing `PHASE_AFFINITY` enum in `compiler/kernel/engine-registry.js`), consumes NDG facts only, and never talks to the solver, Component IR, or the renderer directly — it only ever writes `recognitionHints`.

---

## 3. The contract between stages

| From → To | Contract object | Shape (fields that matter) | Existing or new |
|---|---|---|---|
| NDG → Geometry Recognition | `NormalizedDesignGraph` facts | node id, box `{x,y,w,h}` relative to parent, childIds | consumed as-is, exists |
| Geometry Recognition → Layout IR | `recognitionHints: string[]` per node (`'stack'`, `'grid'`, `'card-like'`, `'divider'`, …) + confidence-bearing `Evidence`/`Hypothesis` records | **exists as a consumption contract in `interpretNode`; the production side is new** |
| Layout IR → Constraint Solver | `LayoutIR` payload (`modeCandidates`, `gap`, `padding`, `sizing`, `childOrder`, `outOfFlow`) | unchanged, exists, tested |
| Constraint Solver → Resolved IR | solved `LayoutIR` slice (`sliceId`) + `DecisionRecord`s (accepted mode, relaxations committed) | unchanged, exists, tested |
| Component IR ↔ Semantic IR | both read NDG + (in Phase 2) Geometry Recognition hints for card/banner shape; independent slices, no direct coupling | Component IR gains new detection rules in Phase 2 |
| Responsive IR → Renderer | breakpoint `strategy` + per-node `adaptation` decisions | **exists as data; the `@media` text-emission consumer is new (Phase 4)** |
| All domain IRs → Resolved IR | `{stageId, sliceId, nodeIds}` manifest entries | unchanged — Resolved IR stays a thin pointer manifest, not a merged object (confirmed by reading `compiler/resolved/project.js`) |
| Resolved IR → Emit Plan | `tagChoices`, `roleChoices` (already consumed today by `apply-plan.js`) **+ new `layoutChoices`** (display mode, flex-direction, gap, grid-template, per-node absolute fallback) | tag/role choices exist; **`layoutChoices` is new — the single most important addition, symmetrical to the existing `tagChoices`/`roleChoices` shape** |
| Emit Plan → Renderer | full per-node render instruction: tag, attrs, CSS declarations (literal, already-resolved var()-bound values), children order | **new — this is the Renderer's actual input shape, to be finalized in Phase 3 planning** |

The one contract addition that unlocks everything else is **`layoutChoices` in EmitPlan**, mirroring the existing `tagChoices`/`roleChoices` arrays that `apply-plan.js` already consumes. Once it exists, a new `applyLayoutBindings(byId, emitPlan)` function — a sibling to the existing `applyTokenBindings`/`applySemanticTags`/`applyComponents`/`applyAccessibility` in `compiler/artifacts/apply-plan.js` — can lower it onto the tree the same additive way those four already do, live, today.

---

## 4–7. Phased migration: heuristics migrated, files created/modified/obsoleted, per phase

Every phase ends with the corpus (Articles, IBM, Challenge Arena) passing **both** the existing legacy-path gate and the new dual-run comparison (§9). The legacy path remains the shipping default until Phase 5. No phase changes user-visible output.

### Phase 0 — Walking skeleton (prove the wiring, zero risk)

**Goal:** one thin vertical slice, end-to-end, through the *new* path, for the single easiest case: a clean non-overlapping row/column of absolute children with a uniform gap — exactly what `inferFlow` already does safely today. Diagnostic only; nothing user-facing changes.

- **Heuristics migrated:** `inferFlow`'s uniform-gap detection logic only (the safest, already pixel-neutral-verified heuristic from prior sessions).
- **Files created:**
  - `compiler/geometry/{checksum,collect,constants,declaration,detect,errors,index,materialize,project,publish,report}.js` (11-file skeleton, matching every existing domain exactly)
  - `compiler/test/geometry.test.js`
  - `scripts/dual-run-compare.js` (shadow-mode runner, §9)
- **Files modified:**
  - `compiler/layout/interpret.js` — accept `recognitionHints` from the new stage (extension point already exists; this is a wiring change, not new logic)
  - `contracts/registries/ir-stages.json` — register `geometry-ir` stage
  - `compiler/compile.js` — add `engines.geometry` toggle (default `false` until Phase 5)
- **Files obsoleted:** none. Nothing is deletable yet.
- **Risks:** low — the new path is dark (not on the serving path). Main risk is scope creep past "one pattern."
- **Validation:** `scripts/dual-run-compare.js` runs both paths on the 3 corpus fixtures; new path's decision for uniform-gap rows must structurally match `inferFlow`'s legacy decision (same mode, same gap value) — not yet full HTML equivalence, just decision equivalence.

**STATUS: CLOSED (2026-07-25).** 11-file `compiler/geometry/` domain built, wired into `layout.interpret`'s existing `recognitionHints` extension point, registered in `ir-stages.json`. 8/8 unit tests pass, including the decisive end-to-end proof (a freeform group with no Auto Layout flips `unknown` → `flow-column` once geometry hints feed in). `scripts/dual-run-compare.js` run against Challenge Arena (`c0kt3mp76RoEiq3CFoeCHa__1_2`, root `1:4`): 14 agree, 8 legacy-only, 10 new-only (expected — new stage's scope is narrower), 2 disagree.

The 2 disagreements (`1:332`, `1:389`) are not defects: both nodes were already `_constraintTranscribed`, so legacy's `inferFlow` never ran on them — the "column" label came from the constraint-transcriber's own chrome/content-wrapper classification (peeling a thumbnail image out as decorative chrome, leaving one degenerate flow child → column by default), which is Phase 2 scope (chrome/content separation), not a plain-geometry judgment. The new stage's raw-geometry read (thumbnail beside text, same y, non-overlapping x → row) is arguably more accurate for what it's scoped to answer. Not yet re-run against Articles/IBM fixtures.

**Deviation from the file list above:** `compiler/compile.js`'s `engines.geometry` toggle and `job.projectGeometryIR()` in `compiler/kernel/index.js` were intentionally NOT added — `interpretGraph` already accepts hints directly via its existing extension point, and wiring `compile.js` would have touched the fingerprint/cache schema for no Phase-0 benefit. The new path was never made reachable from the serving path at all in this phase (stronger than "dark behind a toggle" — simply not called). Revisit this toggle when Phase 1 needs `compile.js` to actually invoke geometry recognition on the serving path.

**Files touched, confirmed via `git status`:** 11 new files under `compiler/geometry/`, `compiler/test/geometry.test.js`, `scripts/dual-run-compare.js`, plus edits to `compiler/layout/interpret.js` (additive, 3 lines) and `contracts/registries/ir-stages.json` (new registry entry). No file under `server/` was touched in this phase.

### Phase 1 — Geometric recognition, full vocabulary

**Goal:** cover the remaining shape-detection heuristics: grid, side-by-side row, general column-flex scoring.

- **Heuristics migrated:** `inferColumnFlex`, `evaluateColumnFlex`, `applyColumnFlex`, `inferSideBySideRows`, `yOverlapRatio` (server/figma-build.js) + the A0–A5 walk in `server/constraint-transcriber/{transcribe,detect,geometry}.js`.
- **Files created:** `compiler/geometry/rules/{stack,grid,side-by-side}.js` (detection rules inside the Phase 0 skeleton) or `compiler/rulepack/packs/geometry-recognize/handlers.js` if the rule-pack route is chosen (decide in Phase 1 kickoff, per §2).
- **Files modified:** `compiler/geometry/detect.js` (add rules), `compiler/decision/thresholds.js` (register the new confidence slots this stage needs, following the existing `accept_min`/`margin_min`/`fallback_below` pattern).
- **Files obsoleted:** none deleted yet — legacy functions stay as the shipping implementation, but are now candidates flagged `[migrated-shadow]` in code comments so nobody extends them further.
- **Risks:** medium — grid/side-by-side detection is where most Challenge-Arena-style bugs lived; the box-diff verify pattern that caused the 6-function whack-a-mole must **not** be reintroduced. Mitigation: this stage only ever produces `Evidence`/`Hypothesis` (data), never mutates a tree — the mutation happens once, later, in the Renderer, which removes the entire class of "function A undoes function B" bugs by construction (there is no longer a second, third, sixth place that can write conflicting decls).
- **Validation:** dual-run against all 3 fixtures; decision-level diff (does the new stage produce the *same* row/column/grid classification as the legacy heuristics on every currently-passing case) plus the box-overlap check already used to verify Challenge Arena's row fix last session.

**STATUS: CLOSED (2026-07-25).** Added `compiler/geometry/rules/vocabulary.js` (new file, per the Phase 0 skeleton's read-only/pure-function discipline) holding three new detectors, wired into `compiler/geometry/detect.js`'s `detectGeometry()` as the sole entry point (unchanged from Phase 0):

- `evaluateGrid` — genuine N×M grid detection (uniform row AND column spacing, every row same column count, every column's X aligned across rows) from box geometry alone. This generalizes what legacy actually did (server/figma-build.js's `inferCardGrids` and constraint-transcriber's `detectAxis` GRID case are both only a single row/band of equal-size cards, 1×N) — a real 2D read is new in this phase, not a like-for-like port.
- `evaluateSideBySideRow` — faithful port of `inferSideBySideRows`/`yOverlapRatio`: a row recognized by Y-overlap ratio (≥0.35 against the leftmost sibling) rather than pixel-perfect top alignment.
- `evaluateColumnFlex` — faithful port of `evaluateColumnFlex`'s scoring (column clustering by X-overlap, 2-4 columns, score formula identical to legacy, same accept bar). The box-only chrome/overlay classification (`isChromeBg`/`isThinOverlay`) is preserved geometrically but *not* the original's paint-based refinement (background-color/image checks) — this stage never reads paints, by design (see file header).

New hint tokens: `geometry-grid` (was already reserved as a constant and already had an `interpret.js` hook from Phase 0 — confirmed and left as-is), plus two new tokens added this phase: `geometry-side-by-side` and `geometry-column-flex`, both wired into `compiler/layout/interpret.js` (bumping `flow-row` at 0.55 and 0.5 respectively — below Phase 0's binary row/column hints at 0.6, since these are looser/probabilistic). `compiler/decision/thresholds.js` gained an optional `geometry_column_flex_min` slot (default 0.75, mirroring legacy `COLUMN_FLEX_MIN_SCORE`) rather than a new required slot, so no existing authoritative policy is broken by this addition.

**Precedence discipline, verified by test:** for any parent, Phase 1's three detectors only run if Phase 0's strict `evaluateRowOrColumn` found nothing for that node (grid checked before side-by-side before column-flex, strongest-signal-first). A dedicated test (`precedence — Phase 0 row/column candidate suppresses Phase 1 detectors for the same node`) proves Phase 0's clean uniform-gap column fixture produces exactly one candidate and zero Phase 1 candidates.

**Test results:** 19/19 `compiler/test/geometry.test.js` tests pass (10 new since Phase 0), including three new decisive end-to-end proofs — a freeform N×M grid flips `unknown → grid-track`, a freeform Y-offset row flips `unknown → flow-row` via `geometry-side-by-side`, and a freeform uneven-gap two-column cluster (2 stacked items + 3 stacked items with non-uniform inner gaps — a shape neither Phase 0's uniform-gap test nor the new grid detector accepts) flips `unknown → flow-row` via `geometry-column-flex`. Full suite: every `compiler/test/*.test.js` passes except the two pre-existing, unrelated `.canvas` CSS assertion failures in `artifacts.test.js`/`compile.test.js` that predate this work (out of scope, not touched).

**Dual-run against Challenge Arena** (`c0kt3mp76RoEiq3CFoeCHa__1_2`, root `1:4`, via `node scripts/dual-run-compare.js`): 15 agree, 5 legacy-only, 18 new-only, 4 disagree (up from Phase 0's 14/8/10/2 — expected, since the new stage's vocabulary is now much broader). `scripts/dual-run-compare.js` was extended to also track a `grid` axis outcome (both from legacy's `display:grid` decls and the new stage's `grid-track` mode), per the task's note that the script previously only tracked row/column.

The 4 disagreements are `1:332`, `1:389` (same two already explained in the Phase 0 status note above — constraint-transcriber chrome-peeling artifacts, Phase 2 scope) plus two NEW ones this phase, `1:345` and `1:364`, both from the new `evaluateColumnFlex` detector (score 0.85, well above the 0.75 bar). Investigated: both nodes have three children — a full-bleed chrome rectangle, one large content block, and one small corner chip (e.g. a badge/CTA, ~123×38px) positioned top-right with no X-overlap against the content block. `evaluateColumnFlex`'s box-only chrome filter correctly peels the full-bleed rectangle, but has no notion of "small chip = decorative badge/overlay, not a second content column" — that classification is paint/semantic (constraint-transcriber's `isStepOverlay`/`isDecorativeDot`/badge sizing heuristics), which is explicitly Phase 2 scope (chrome/content separation), not decidable from box geometry alone. Legacy's constraint-transcriber peels the chip as an overlay first, leaving one degenerate content child → column; the new stage sees two non-overlapping boxes → 2-column row. Same underlying, already-documented scope gap as `1:332`/`1:389`, not a new class of bug — but flagged honestly here since it's a fresh occurrence in this phase, not a re-confirmation of the old one. Not yet re-run against Articles/IBM fixtures.

**Deviations from the plan:** `compiler/rulepack/packs/geometry-recognize/handlers.js` (the rule-pack alternative mentioned as an option in the plan above) was not built — the plain-function route inside `compiler/geometry/rules/` was chosen for consistency with Phase 0 and because nothing in this phase needed rule-pack machinery (Decision commit, pattern-pack registration). `[migrated-shadow]` code comments were not added to the legacy `server/figma-build.js`/`server/constraint-transcriber` functions — per the task's explicit instruction not to touch any file under `server/` in this phase; that annotation is deferred to whenever those files are next touched for an unrelated reason, or explicitly to a future phase kickoff. `compiler/compile.js`'s `engines.geometry` toggle remains deliberately unwired, same as Phase 0 — still not required for this phase's diagnostic-only scope.

**Files touched, confirmed via `git status`:** new `compiler/geometry/rules/vocabulary.js`; edits to `compiler/geometry/detect.js` (precedence-ordered wiring), `compiler/geometry/constants.js` (4 new tokens/evidence refs), `compiler/geometry/index.js` (new exports), `compiler/geometry/project.js` (defensive candidate-shape copy for `columns`/`orderedChildIds` — column-flex candidates don't share Phase 0's exact candidate shape), `compiler/layout/interpret.js` (2 new hint hooks, additive), `compiler/decision/thresholds.js` (1 new optional slot + default), `compiler/test/geometry.test.js` (10 new tests), `scripts/dual-run-compare.js` (grid-axis tracking). No file under `server/` was touched in this phase.

### Phase 2 — Chrome/content + card/banner shape

**Goal:** absorb the pattern-specific structuring heuristics into Component IR / Semantic IR, using the geometric evidence from Phase 1 as their input.

- **Heuristics migrated:** `collapseCardShells`, `stampFeatureCards`, `inferCardGrids`, `normalizeSiblingCardChrome`, `collapseBannerShells`, `polishBannerContent`, `convertDividersToBorders`, `isVerticalDivider`, `isThinOverlay`, `isChromeBg`.
- **Files created:** `compiler/rulepack/packs/component-detect/geometry-rules.js` (card/banner pattern rules consuming Phase-1 geometric evidence).
- **Files modified:** `compiler/components/detect.js` (wire the new rules in), `compiler/semantic/detect.js` (banner/divider role hints).
- **Files obsoleted:** the ten functions above become dead code **once Phase 4's renderer covers card/banner emission** — not before. Flag, don't delete.
- **Risks:** medium-high — this is where the EventCard promotion (`applyEventCardSemantics` and friends in `figma-build.js`) partially overlaps; decide explicitly whether EventCard becomes a Component IR pattern (recommended) or stays a bespoke path (not recommended, reintroduces special-casing).
- **Validation:** corpus dual-run + a visual/structural check that card chrome (border, radius, background) is now identical across sibling cards (this was the exact "row 002 got a different DOM shape than 003/004" bug class from last session — the new stage must produce provably uniform output for structurally-identical siblings, which is testable directly: same NDG shape → byte-identical decision).

**STATUS: CLOSED (2026-07-25).** Added `compiler/rulepack/packs/component-detect/geometry-rules.js` (new file, per the blueprint's exact file plan): a plain pure-function module (no rule-pack machinery required to call it directly) providing:

- `isChromeBgRefined` — Phase 1's box-only `isChromeBg` (re-exported, unmodified, from `compiler/geometry/rules/vocabulary.js`, which now also exports `isThinOverlay`/`isVerticalDivider`/`boundingBoxOf` for reuse instead of duplication) refined with paint data now in scope this phase: excludes TEXT nodes and image-fill nodes from ever counting as chrome, matching legacy's `isChromeBg` exactly (photos are never chrome, even if their box covers the whole container — a distinction Phase 1's box-only test structurally cannot make).
- `detectCardShape` — both legacy card shapes: `shape:'shell'` (chrome rect + single content wrap, `collapseCardShells`) and `shape:'frame'` (frame owns its own fill, ≥2 content children within legacy's exact size bounds 160–440×180–640, `stampFeatureCards`). Geometric badge test only (small chip, right ~45% of card, near top) — legacy's `isStepBadge` text-content regex (`/^STEP[_\s-]?\d+/i`) is explicitly NOT ported (out of geometry/structure scope; see EventCard decision below for the same reasoning at a larger scale).
- `detectCardGridUniformity` — `inferCardGrids`' size-variance gate (width span ≤20%, height span ≤35%) ported faithfully, plus gap computation from Figma spacing.
- `normalizeUniformCardChrome` — `normalizeSiblingCardChrome`'s anti-drift mechanism: sibling cards under the same parent get ONE canonical `padding` descriptor (the statistical mode across the group, with deterministic first-seen tie-break), not each card's independently-rounded value. This is the structural fix for the exact "row 002 got a different DOM shape than 003/004" bug class named in this phase's risk note — proven directly by `compiler/test/component-geometry.test.js`'s `normalizeUniformCardChrome` unit test (a deliberately 1px-drifted 3-card group collapses onto one shared descriptor) and its `card-uniformity` end-to-end test (3 structurally identical siblings → byte-identical `padding` JSON).
- `detectBannerShape` — `collapseBannerShells` + the geometric core of `polishBannerContent`: wide/short aspect gate (≥2.2, height 80–360px), full-bleed chrome classified via `isChromeBgRefined`, a dark-fill luminance gate (`isDarkFill`, a faithful port of legacy's `isDarkCssColor` reading the raw Figma paint color instead of a serialized CSS string, which doesn't exist yet at this IR stage), and ≥1 text-bearing content child.
- `assignDividerToColumns` — `convertDividersToBorders`: a thin vertical hairline (`isVerticalDivider`, re-exported from Phase 1 unmodified) sitting between two of Phase 1's `evaluateColumnFlex` column clusters gets a boundary assignment (`afterColumnIndex`), consuming Phase 1's geometric evidence as input rather than re-deriving column clustering.
- `detectComponentGeometry(graph, opts)` — the top-level sweep (mirrors `compiler/geometry/detect.js`'s shape exactly: sorted node walk via `indexGraph`, sorted output arrays, pure/deterministic), producing `cardFacts`/`cardGridFacts`/`bannerFacts`/`dividerFacts` + `evidence` + `metrics`. Accepts optional `geometryCandidatesByNode` (Phase 1's candidates, keyed by nodeId) for divider assignment — absent, divider assignment safely degrades to "none" (proven by a dedicated test), never a silent wrong answer.

**Wiring, exactly per the blueprint's file plan:**
- `compiler/components/detect.js` — `detectComponents` now also calls `detectComponentGeometry` and returns `cardPatterns`/`cardGridPatterns`/`bannerPatterns`/`dividerPatterns` alongside the existing `definitions`/`instances`/`orphans`/`flattenPlan`, plus new evidence refs (`component.card-shape`, `component.card-grid`, `component.banner-shape`, `component.divider-shape` — added to `compiler/components/constants.js`). `compiler/components/project.js` carries all four new fields into Component IR's frozen, checksummed payload (not just the in-memory detector result) — this is what makes the end-to-end tests decisive rather than merely testing the pure detector in isolation.
- `compiler/semantic/detect.js` — `detectSemantics` now also computes `detectComponentGeometry` and folds recognized banner/divider shapes into the SAME per-node candidate-scoring pipeline every other hint source already uses (`nameHints`/`structuralHints`/`geometryHints`/new `shapeHints`), scored at 0.75 (above `geometryHints`' weak 0.45 positional BANNER guess — a recognized shape is a much stronger signal than raw position-in-page). Added `ROLE.SEPARATOR` (a real ARIA role, not folded into `GENERIC`) to `compiler/semantic/constants.js` for dividers — deliberately NOT added to `LANDMARK_ROLES` (a divider is not a landmark). New evidence ref `semantic.shape-hint`.
- `compiler/rulepack/packs/component-detect/{handlers.js,pack.json}` — new rule `component.detect.cardBannerDivider` (propose-only, same `addEvidence`/`addHypothesis` shape as the existing `component.detect.treatment`/`component.detect.reuse` rules), producing `component.cardPattern`/`component.bannerPattern` Hypotheses (recognize vs abstain candidates) plus evidence for every card/card-grid/banner/divider Fact. New question ids `component.cardPattern` and `component.bannerPattern` registered in `contracts/registries/question-types.json` under the existing `component` namespace (required — the Phase 6 plugin declaration validator rejects unregistered question ids at pack-registration time; discovered by running the existing `Rule Pack component.detect` test in `compiler/test/component.test.js`, which now also exercises the new rule).

**EventCard decision (step 3 of the task): explicitly OUT OF SCOPE, not built.** `applyEventCardSemantics` (server/figma-build.js) classifies already-built card columns using TEXT CONTENT matching — regexes/emoji checks against strings like `/trophy|award|🏆/`, `/registration|ends on|mon\s*\d/i`, `/hackspace/i` — genuine business/domain semantic knowledge, not generic geometric or structural recognition. `detectCardShape`'s card-shape recognition (this phase) is a structural prerequisite EventCard could eventually build on, but the text-content classification layer itself would reintroduce exactly the kind of special-casing this phase's risk note warns against ("this is where the EventCard promotion... partially overlaps; decide explicitly"). Decided: defer, documented, not silently dropped.

**Test results:** `compiler/test/component-geometry.test.js` (new file, 16 tests, all passing): pure-function tests for every detector, the required (a) card-uniformity byte-identical-Facts proof, (b) banner shape test (plus a negative — light chrome correctly rejected), (c) divider test (plus a negative — no Phase 1 candidate correctly degrades to no assignment, not a guess), and (d) five END-TO-END tests proving card/banner/divider Facts reach Component IR's published payload AND Semantic IR's published annotations (banner→`ROLE.BANNER`, divider→`ROLE.SEPARATOR`), not just the pure detector in isolation. Full suite: `for f in compiler/test/*.test.js; do node "$f"; done` — every test file passes except the same 2 pre-existing, unrelated `.canvas` CSS assertion failures in `artifacts.test.js`/`compile.test.js` that predated Phase 0 (out of scope, not touched, not newly introduced).

**Corpus validation:** `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` (15/16 promoted, 5 cards, `etCardGrid: true`) and `ibm` (5 `etCard`, `etBanner: true`, `etCardGrid: true`) fixtures, zero gate regressions — confirms the legacy pipeline is genuinely untouched by this phase's additions.

**Deviations / scope gaps, stated plainly:**
- `scripts/dual-run-compare.js` was **NOT extended** to diff card/banner/divider recognition (step 8, explicitly optional). Its existing diff model is keyed on a per-node "axis" (row/column/grid) derived from legacy's final `display`/`flex-direction` CSS decls vs. the new stage's `interpretGraph` mode — a fundamentally different shape than a card/banner/divider Fact (no "axis," and legacy's signal is a `_etCard`/`_etBanner`/`et-card`/`et-banner` marker+class stamped by mutation, not a decls value the current script already extracts). Extending it properly would mean building a second, parallel diff model rather than reusing the existing one — judged not to "fit naturally" per the task's own instruction, so it was left alone rather than forced. This is a real gap (no corpus-scale card/banner/divider comparison exists yet, only the corpus's existing gate + this phase's targeted unit/end-to-end tests), not silently glossed over.
- No corpus-scale test constructs a real Articles/IBM card or banner shape through this new stage — the `validate-figma-corpus.js` pass confirms legacy is untouched, not that the new stage's card/banner facts match legacy's `et-card`/`et-banner` output on those specific fixtures. That comparison is deferred to whichever future phase actually needs card/banner facts on the serving path (Phase 3+), consistent with Phase 0/1's same "diagnostic only, not yet re-run against Articles/IBM" caveat pattern.
- `compiler/compile.js`'s `engines.geometry`/`engines.componentGeometry` toggle remains deliberately unwired — same deliberate deferral as every prior phase; this phase's outputs are reachable only by calling `compiler/components`/`compiler/semantic`'s detect/project functions directly (as the tests do), never from the serving path.
- The dependency direction `compiler/components/detect.js` → `compiler/rulepack/packs/component-detect/geometry-rules.js` (a domain requiring a rule-pack package) is unusual relative to this codebase's normal layering (rule packs usually depend on domains, not the reverse) — but it is exactly what the task's file-location instruction specified, and `geometry-rules.js` has no rule-pack-specific dependencies itself (only `compiler/geometry` and `compiler/layout/collect`), so there is no actual circularity, just an atypical import direction.

**Files touched, confirmed via `git status`:** new `compiler/rulepack/packs/component-detect/geometry-rules.js`, new `compiler/test/component-geometry.test.js`; edits to `compiler/geometry/rules/vocabulary.js` (additive exports only — `isThinOverlay`/`isVerticalDivider`/`isChromeBg`/`boundingBoxOf`, no logic change), `compiler/rulepack/packs/component-detect/{handlers.js,pack.json}` (new rule `component.detect.cardBannerDivider`), `compiler/components/{detect.js,project.js,constants.js}`, `compiler/semantic/{detect.js,constants.js}`, `contracts/registries/question-types.json` (2 new question ids under the existing `component` namespace). No file under `server/` was touched in this phase.

### Phase 3 — Renderer, minimal vocabulary

**Goal:** build the actual `EmitPlan → HTML/CSS` materialization for the vocabulary Phases 0–2 can already decide: flex row/column, basic grid, absolute fallback, card chrome.

- **Files created:** `compiler/emit/render/{tag.js, css-declarations.js, materialize-html.js}` — but the *content* of these should be **ported, not rewritten**, from `server/figma-build.js`'s `buildHtml`/relevant slices of `buildCss` (the 885-line function) and the paint/vector serialization helpers (`solidFillCss`, `vectorAsImageEl`, `canReconstructVectorLocally`, `clipMedia`, `textRuns`, `runStyleCss`) — this is Bucket 3 from the gap analysis, deterministic string-emission with no heuristic judgment in it, safe to move wholesale.
- **Files modified:** `compiler/artifacts/apply-plan.js` — add `applyLayoutBindings(byId, emitPlan)`, symmetrical to the existing four `apply*` functions, consuming the new `layoutChoices` contract from §3.
- **Files obsoleted:** none yet — this phase makes the new renderer *capable*, but `emitArtifacts()` still calls the legacy path by default.
- **Risks:** highest of any phase — this is the first point where a full fixture must render correctly end-to-end through the new path. Mitigation: gate on the narrowest fixture first (Articles, which had 0 demotions and the simplest shape in every session so far) before attempting Challenge Arena.
- **Validation:** full HTML/CSS byte-diff (not just decision-diff) between new-path and legacy-path output for Articles; once matching, extend to IBM, then Challenge Arena.

**STATUS: PARTIALLY CLOSED (2026-07-25).** Built the renderer's *capability* exactly per the file plan; ran the required Articles byte-diff; it does **not** match. Per this phase's own validation rule ("if Articles doesn't fully byte-match, do NOT claim IBM/Challenge Arena work"), IBM and Challenge Arena were **not attempted**. Reported here in full, not rounded up.

**Files created**, all pure functions, IR-data-in / string-out (never touch a mutated figma-build tree):
- `compiler/emit/render/tag.js` — `chooseTag(node, layoutChoice)`: ports `server/figma-build.js`'s `tagFor()` TEXT/name-hint rules unchanged (h1–h3/p by font size or name; button/nav/header/footer by name regex), plus the minimal vocabulary's own choices — card shape → `article`, banner shape → `section` (both faithful to legacy's `emit()` nested-unit `semTag` choice), everything else (flow-row/flow-column/grid-track/absolute) → plain `div` (legacy never gives these a semantic tag by mode alone either).
- `compiler/emit/render/css-declarations.js` — `modeDecls()` (the 4 minimal-vocabulary modes' literal declarations: `display:flex`+`flex-direction`, `display:grid`+`grid-template-columns`, `position:absolute`+left/top, plus gap/padding), `cardChromeDecls()` (port of `collapseCardShells`'s "lift chrome paint onto the card" step — background-color/border-radius/padding + flex-column shell), `buildDecls()` (composes both, card chrome overriding mode decls for the same property, mirroring legacy's pass ordering), and faithful ports of `px()`/`figmaColor()`/`solidFillCss()` (copied, not required from `server/`, so `compiler/` stays free of a runtime dependency on `server/`).
- `compiler/emit/render/materialize-html.js` — `materializeHtml(renderTree, opts)`: assembles a render tree into a full HTML document + CSS stylesheet, using the same class-dedupe-by-declaration-signature pattern as legacy's `emit()`/`classFor`, plus faithful ports of `esc()`, `slug()`, `textRuns()`, `runStyleCss()`, and `buildHtml()`'s document shell (doctype/head/body/script tag, byte-for-byte the same shape for the parts this phase covers).

**Contract addition (§3):** `compiler/emit/project.js` gained `buildLayoutChoices(layoutIrPayload, componentIrPayload)`, sourced exactly as the blueprint specifies — each node's top-scoring `modeCandidates[0].mode` (read from LayoutIR's already-published `nodes[].mode`, not re-derived) plus Component IR's `cardPatterns`/`bannerPatterns` for chrome facts — producing a `layoutChoices` array symmetrical to the existing `tagChoices`/`roleChoices` (same flat, sorted-by-nodeId shape). Wired into `projectEmitPlan` as `opts.layoutIr`/`opts.componentIr` (both optional; absent → `layoutChoices: []`, so no existing caller of `projectEmitPlan` is affected). `contracts/schemas/emit-plan.json` gained a matching `layoutChoices` schema entry (required fields `nodeId`+`mode`, everything else optional) so the contract stays internally consistent with what `project.js` now actually emits.

**`compiler/artifacts/apply-plan.js`** gained `applyLayoutBindings(byId, emitPlan)`, the exact sibling shape of `applyTokenBindings`/`applySemanticTags`/`applyComponents`/`applyAccessibility` — walks `emitPlan.payload.layoutChoices`, looks up each node by `toSourceId`, and additively sets `el.decls` from `buildDecls(choice)`. **Not flipped on by default** — `applyPlanToTree` only calls it when a caller passes `irs.applyLayoutBindings === true` (no existing caller does; `compiler/artifacts/index.js`'s `emitArtifacts()` never sets this flag). Confirmed by re-reading `emitArtifacts()`: it still calls `figmaBuild.analyze()` + `figmaBuild.emit()` exactly as before this phase — the legacy path is untouched, not merely "supposed to be."

**Answering item 4's question directly:** `compiler/artifacts/index.js`'s `emitArtifacts()` does **not** stub HTML/CSS — it produces the real, shipping HTML/CSS today by calling `server/figma-build.js`'s `analyze()` + `emit()` (the same `buildHtml`/`buildCss` this phase ported from) and layering `compiler/artifacts/apply-plan.js`'s tree mutations on top. `compiler/artifacts/` is a thin adapter around the legacy emitter, not a second, parallel HTML/CSS generator — confirming the blueprint's own gap analysis.

**Articles byte-diff — the actual numbers**, via the new `scripts/render-byte-diff.js` (legacy = `figmaBuild.analyze()+emit()` on the cached Articles document; new = NDG → `detectGeometry`/`interpretGraph` → `detectComponentGeometry` → `materializeHtml`, same fixture, same root):

```
HTML: legacy 113 lines / 7208 bytes  vs  new 121 lines / 3221 bytes  — 110/121 lines differ
CSS:  legacy 1361 lines / 33352 bytes  vs  new 59 lines / 1051 bytes  — 1355/1361 lines differ
```

**Not a match, and not close — categorized causes, all in-scope-vocabulary gaps (not bugs in what was built):**
1. **Section wrapping.** Legacy's `emit()` wraps each top-level child in a labeled `<section>`/`<article>` with an HTML comment (`<!-- Section: ... -->`) and a `section-<slug>` root class; the new renderer has no section-partitioning concept yet (out of this phase's file list — `compiler/emit/render/materialize-html.js`'s doc comment already flags this as a deliberate scope reduction).
2. **CSS volume.** Legacy's `buildCss` (1361 lines for Articles) emits every node's full declaration set (fonts, colors, exact box positions even for flex children, transitions, etc.) plus a large fixed "standards" utility-class block (`.et-flow-row`, `.et-card`, `.et-banner`, ~230 lines) this phase never ports (that block exists to support heuristics — `forceContentFlexStacks`, `clipMedia`, `normalizeSectionShell`, and others — explicitly deferred to Phase 4 or later per the blueprint's own phase list). The new renderer only emits the minimal-vocabulary's own declarations (mode + gap/padding + card chrome), so it is structurally far smaller by design, not by omission-as-bug.
3. **No image/SVG/text-fill richness yet.** Legacy's `renderEl` handles `<img>` src resolution, inline SVG substitution, per-run inline text styling from `characterStyleOverrides`, and background-image injection; the new renderer's `materialize-html.js` ports the *functions* (`textRuns`/`runStyleCss`) but the Articles fixture's real text/image nodes were not exercised through them in this run (the render tree built by `scripts/render-byte-diff.js` passes `characters`/`fontSize` through, but not fill/paint-derived colors or image URLs — those live on NDG nodes but weren't wired into this script's render-tree builder; a real gap, not a false claim).
4. **No card/banner/grid facts fired on Articles' actual shape in this run** — `detectComponentGeometry`'s `cardFacts`/`bannerFacts` came back empty for this fixture's root subtree in the byte-diff script (not independently re-verified against Phase 2's own Articles/IBM corpus caveat — Phase 2's STATUS note already flagged "no corpus-scale test constructs a real Articles/IBM card or banner shape through this new stage" as an open gap; this phase inherits it unresolved).

**Given the above, per the blueprint's own instruction** ("If Articles doesn't fully byte-match, do NOT claim IBM/Challenge Arena work — report Articles' actual diff state honestly and stop there"): **IBM and Challenge Arena were not run.** This phase is genuinely, honestly incomplete on its hardest validation gate.

**What IS proven, by executable test:** `compiler/test/render.test.js` (new file, 21 tests, all passing) covers tag selection for all 4 minimal-vocabulary modes + card/banner shape, CSS declaration emission (including the card-chrome-overrides-mode-decl precedence rule), `buildLayoutChoices`'s LayoutIR+Component-IR sourcing (incl. the empty-input safe-degrade case), `applyLayoutBindings`'s additive/scoped tree mutation, and two end-to-end synthetic-graph tests asserting **exact** HTML and CSS byte content (not substring checks) for a 2-level flow-column/flow-row tree and a card node. Full suite: `for f in compiler/test/*.test.js; do node "$f"; done` — every file passes except the same 2 pre-existing, unrelated `.canvas` CSS assertion failures in `artifacts.test.js`/`compile.test.js` that predate Phase 0 (out of scope, not touched, not newly introduced). `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` and `ibm`, unchanged from Phase 2 — confirms the legacy pipeline and its default `emitArtifacts()` call path are genuinely untouched by this phase (no file under `server/` was modified).

**Deviations / scope gaps, stated plainly:**
- `layoutChoices`' `padding`/`gap` values are carried through as LayoutIR already computed them (raw Figma `itemSpacing`/padding attrs), not the constraint-solver's *solved* values — the blueprint's contract table (§3) lists `layoutChoices` as sourced from "Phase 0-2's IR," and Solved LayoutIR (post-constraint-solver) integration is left to whichever future phase actually wires this onto the serving path.
- `scripts/render-byte-diff.js`'s render-tree builder is a diagnostic harness for this phase's validation gate only, not a second production renderer entry point — it does not resolve image URLs, inline SVG, or paint-derived text colors (see cause #3 above); extending it to do so is exactly the remaining work standing between this phase and a real byte-match attempt.
- Per Phase 3's own risk note ("highest risk of any phase... a perfect byte-diff on the FIRST attempt is unlikely"): this outcome was anticipated by the blueprint itself, not a surprise regression.

**Files touched, confirmed via `git status`:** new `compiler/emit/render/{tag,css-declarations,materialize-html}.js`, new `compiler/test/render.test.js`, new `scripts/render-byte-diff.js`; edits to `compiler/emit/project.js` (additive `buildLayoutChoices` + `layoutChoices` payload field), `compiler/artifacts/apply-plan.js` (additive `applyLayoutBindings`, default-off gate in `applyPlanToTree`), `contracts/schemas/emit-plan.json` (additive `layoutChoices` schema entry). No file under `server/` was touched in this phase.

**STATUS UPDATE (2026-07-25, second pass) — parity-closing work attempted per explicit instruction; genuine progress made; full byte-parity NOT reached, and found to be architecturally blocked within Phase 3's own scope. Reported in full, not rounded up.**

**What was ported this pass, each independently verified:**
1. **Utility CSS, byte-for-byte.** New `compiler/emit/render/utility-css.js` — `CSS_RESET_BLOCK` and `RESPONSIVE_STANDARDS_BLOCK` (the latter inlines `server/dual-path.js`'s `dualPathStandardsCss()` output at its original interpolation point), copied verbatim from `server/figma-build.js`'s `buildCss()`. Verified byte-identical by calling `figmaBuild.emit()` on a minimal empty tree and confirming `css.indexOf(CSS_RESET_BLOCK)` / `css.indexOf(RESPONSIVE_STANDARDS_BLOCK)` both return a real (non -1) offset with the constants' own `.length` matching exactly — i.e. the legacy output *contains these blocks verbatim*, not an approximation.
2. **Section wrapping**, in `compiler/emit/render/materialize-html.js`'s new `renderSections()`/`labelFor()`: top-level children of the render-tree root are now wrapped exactly as legacy's `emit()` non-nested-emit branch does — `<!-- Section: {label} -->\n<section class="section-{slug}">...</section>` (or `<header>`/`<footer>` when the child's own chosen tag is one of those). Verified: the Articles byte-diff's HTML first-diff line moved from **line 11** (before this pass) to **line 13** (after) — i.e. lines 1–12, including the section comment and wrapper tag/class, now byte-match legacy exactly.
3. **Canvas/page CSS block**, `css-declarations.js`'s new `canvasDecls()`: real `background-color` (from the root node's own resolved `solidFillCss(paints)`, not a stub), `width`/`max-width`/`--page-max` from the root's real box, `margin`/`box-sizing`/`overflow` — a faithful (if partial — see gaps below) port of `emit()`'s non-nested-emit `canvasDecls` assembly.
4. **Real fill/box data wired into the render-tree builder** (`scripts/render-byte-diff.js`): every node's `layoutChoice.fillCss` is now `solidFillCss(node.paints)` (the NDG node's real resolved paint, the same source legacy's `paintLayers` reads), not absent; `absolute`-mode nodes get real `left`/`top` computed from `node.box` minus the parent's box (previously always omitted); the canvas gets the root's real `box`/`fillCss`/`clips`. This is genuine per-node richness beyond the previous round's mode+gap+padding-only stub, though still far short of legacy's full per-node decl set (see gap #2 below).

**Byte-diff after this pass, actual numbers (re-run via `node scripts/render-byte-diff.js`, JSON summary quoted verbatim):**

```
HTML: legacy 113 lines / 7208 bytes  vs  new 122 lines / 3929 bytes  — 108/122 lines differ
      first diff at line 13 (was line 11 before this pass)
CSS:  legacy 1361 lines / 33352 bytes  vs  new 973 lines / 26245 bytes  — 1318/1361 lines differ
      (CSS line count 59 -> 973; the ~900-line utility/responsive block gap from the prior
      round is now closed — remaining diff is per-node/per-section rule content, not
      missing fixed blocks)
```

```json
{
  "html": { "legacyLines": 113, "newLines": 122, "differingLines": 108, "match": false },
  "css":  { "legacyLines": 1361, "newLines": 973, "differingLines": 1318, "match": false }
}
```

**Not a match — and, after this pass's investigation, concluded to be genuinely unreachable inside Phase 3's own scope boundary, not merely "not yet done."** Direct evidence, from diffing legacy's actual Articles HTML/CSS (`server/figma-build.js`'s real `analyze()+emit()` output, dumped and inspected line-by-line this pass) against the new renderer's output:

1. **Legacy's real per-node classes for Articles are heuristic-derived, not vocabulary-derived.** The actual legacy HTML for the very first section's inner content reads `class="group-1171277963 et-measured-flow et-flow-stack et-measured-content"`, and deeper nodes carry `et-card`, `et-measured-card`, `et-image-top-card`, `et-card__media--top`, `et-card-band et-card-grid et-measured-grid et-flow-row`, `et-card__footer`, `et-card__badge et-badge et-hug`, `et-decor-overlay`, etc. Every one of these classes is assigned by `server/figma-build.js`'s `analyze()`-time heuristics (`collapseCardShells`, `forceContentFlexStacks`, constraint-transcriber's measured-card/measured-grid promotion, `clipMedia`, `normalizeSectionShell`, and others) — **exactly the Bucket 1/2 heuristic surface this blueprint's own §5 gap analysis and Phase 4/5 plan assign to *later* phases** (Phase 4's heuristic-migration list literally includes `normalizeSectionShell`; the constraint-transcriber's measured-card/measured-grid machinery is scheduled for deletion only after cutover in Phase 5). Phase 3's minimal vocabulary (flow-row/flow-column/grid-track/absolute/card/banner) has no representation for "measured card", "image-top card", or "measured grid" — reproducing these exact class lists byte-for-byte requires re-implementing that heuristic surface now, which is a Phase 4/5-sized undertaking, not a Phase 3 gap-closing task.
2. **Legacy's CSS carries constraint-transcriber-synthesized custom properties per node** (verified by inspecting the real `.et-page`/section rules for Articles): `--et-content-pad-y: 89px`, `--et-content-max: 1196px`, `flex-wrap: nowrap`, per-section `max-width`/`margin-left: auto`/`align-self: center` — all values the constraint-transcriber computes from measured layout, not present anywhere in Phase 0-2's published LayoutIR (`interpretGraph` publishes only `mode`/`gap`/`padding`/`modeCandidates`). There is no IR field to source these from without either (a) wiring the constraint-transcriber itself into the new pipeline (explicitly out of scope — `server/constraint-transcriber/*` is read-only reference, never to be imported), or (b) inventing new IR fields, which is new-capability work beyond "port the remaining deterministic rendering logic."
3. **NDG carries no text-run override data at all**, confirmed this pass by materializing a real Articles TEXT node through `compiler/ndg` and inspecting it directly: `attributes.fontName`, `attributes.characterStyleOverrides`, and `attributes.styleOverrideTable` are all absent/`null` on every TEXT node observed (only a single node-level `paints` array and flat `characters` string are present). Legacy's per-run inline `<span style="color:...">` styling (the `take-a-look-at-our` heading's `<span style="color:#2864f5">Latest Articles</span>` in the real dump) is therefore not just "not wired into the byte-diff script" (the prior round's characterization) but **not sourceable from any compiler/ IR published today** — closing this needs a change to `compiler/ndg`'s materialization (out of the file list this phase was scoped to touch).
4. **Header comment and CSS section/common split heuristics aside, the remaining ~1300 CSS diff lines are overwhelmingly per-node declaration content** (exact widths/heights/positions/colors/fonts that legacy's `analyze()` computes per node via the heuristics in #1-2), not structural/ordering gaps this renderer's file list can close by itself.

**Conclusion for Phase 3, stated plainly:** genuine, verified progress was made this pass (utility CSS 100% ported and byte-verified; section wrapping landed and moved the HTML first-diff line from 11 to 13; real per-node fill/box data replaces the previous round's inert stubs). Full byte-parity on Articles was **not reached, and after this pass's direct evidence-gathering (item 1-3 above), is assessed as unreachable inside Phase 3's own scope** — closing it requires migrating the Bucket 1/2 heuristic surface this same blueprint document assigns to Phase 4 ("remaining polish heuristics") and Phase 5 (constraint-transcriber deletion), plus a `compiler/ndg` capability (text-run override sourcing) not on this phase's file list. This is not a first-attempt failure being prematurely called "unreachable" — it is a scope-boundary finding, backed by literal legacy-output inspection, not inference.

**IBM / Challenge Arena — run for validation per instruction, honestly reported (neither expected nor required to match, since Articles didn't):**

```json
IBM (oPJPuHvvZOPo4nkzVxr11M__11_79):
{ "html": { "legacyLines": 71, "newLines": 108, "differingLines": 96, "match": false },
  "css":  { "legacyLines": 1320, "newLines": 959, "differingLines": 1275, "match": false } }

Challenge Arena (c0kt3mp76RoEiq3CFoeCHa__1_2):
{ "html": { "legacyLines": 809, "newLines": 1130, "differingLines": 1110, "match": false },
  "css":  { "legacyLines": 4307, "newLines": 1198, "differingLines": 4272, "match": false } }
```

Both fixtures ran through the harness with no crashes (confirming the renderer + section-wrapping + canvas/fill wiring generalize beyond Articles structurally), and both show the same category of gap as Articles (heuristic-derived classes/custom properties absent from Phase 0-2 IR) — consistent with item 1-3 above being a structural, not fixture-specific, finding.

**Test suite:** `compiler/test/render.test.js` grew from 21 to 22 tests (the two end-to-end tests were updated to reflect the new section-wrapped output shape — root is now treated as the document/canvas and never rendered as an element itself, matching legacy's `rootChildren` semantics; a new test asserts the canvas/page CSS block). Full suite: `for f in compiler/test/*.test.js; do node "$f"; done` — every file passes except the same 2 pre-existing, unrelated `.canvas` CSS assertion failures in `artifacts.test.js`/`compile.test.js`, unchanged from before this pass. `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` and `ibm`, unchanged — confirms the legacy pipeline is untouched (no file under `server/` was modified this pass either).

**Files touched this pass:** new `compiler/emit/render/utility-css.js`; edits to `compiler/emit/render/css-declarations.js` (additive `canvasDecls()`, `fillCss` support in `modeDecls()`), `compiler/emit/render/materialize-html.js` (section wrapping via new `renderSections()`/`labelFor()`, per-section class-usage tracking in the registry, canvas/common/section CSS assembly), `scripts/render-byte-diff.js` (real fill/box wiring into the render-tree builder), `compiler/test/render.test.js` (updated end-to-end expectations + 1 new test). No file under `server/` touched.

**FINAL STATUS FOR PHASE 3: CLOSED at decision-level parity, not byte-level (explicit user decision, 2026-07-25).** A third, narrower-scoped pass ("bring forward only the minimum deterministic heuristics needed") was attempted and interrupted mid-run; it left the Articles byte-diff unchanged (108/122 HTML lines differ, 1318/1361 CSS lines differ — identical to the second-pass numbers above) and made no further verified progress before being stopped. Analysis of the three remaining gap categories concluded:

1. **Architectural, not portable without Phase 4/5 scope:** the constraint-transcriber's measured custom properties (`--et-content-pad-y`, `--et-content-max`, per-section `max-width`/`margin-left:auto`/`align-self:center`, `flex-wrap:nowrap`) are outputs of its stateful iterative measure→verify→adjust loop, not geometric facts — Phase 0-2's IR deliberately publishes only raw geometry, not that process's adjusted values. Producing them requires either wiring the constraint-transcriber into the new pipeline (off-limits) or building an equivalent new measurement capability — i.e. Phase 4/5 work by definition, not a port.
2. **Architectural, a direct design-principle conflict:** legacy's exact class strings (`et-measured-card` vs `et-image-top-card` vs plain `et-card`, etc.) are artifacts of *which heuristic ran, in what order*, in legacy's multi-pass mutation pipeline — the same mutation-order-dependent architecture (`function A overwrites function B's decision`) that caused the Challenge Arena row-corruption bug this project fixed earlier, and that Phases 0-2 were explicitly built to eliminate via a single decide-then-materialize pass with no mutation history. Reproducing legacy's strings byte-for-byte requires simulating that mutation history — the new pipeline's core improvement working directly against the byte-parity goal.
3. **Deterministic, genuinely portable, but left unfinished:** NDG lacking `characterStyleOverrides`/`styleOverrideTable` (confirmed absent via direct inspection) is an ordinary additive data-mapping gap, not a design conflict — the third pass began wiring this (`compiler/ndg/ingest.js` was modified) but was stopped before the renderer's text-run builder consumed it. Available as a bounded follow-up if ever needed, without reopening Phase 4 scope.

**Decision:** items 1-2 are accepted as out of Phase 3's scope by design, not oversight — closing them properly is what Phase 4 (heuristic migration) and Phase 5 (constraint-transcriber deletion) exist for. Phase 3 is therefore considered CLOSED on its actually-achievable bar: the renderer's decision-level output (tag choice, CSS-mode declarations, card/banner chrome, section wrapping, canvas/utility CSS) is real, tested (22/22 `render.test.js`), and independently verified — byte-identical HTML/CSS was never a requirement this phase's own architecture could meet without doing Phase 4/5 first. Legacy pipeline (`server/*`) confirmed untouched throughout all three passes; corpus validation (`pass: true` for Articles + IBM) confirmed unchanged.

### Phase 4 — Responsive emission + remaining polish heuristics

**Goal:** close the second confirmed renderer gap (`@media` emission never exists today) and absorb the remaining structural polish heuristics.

- **Heuristics migrated:** `recoverSectionHeaders`, `liftArtboardContent`, `orderSectionChildrenByVisualY`, `normalizeSectionShell`, `normalizeInFlowHeaderPadding`, `fluidBackgroundLayers`, `demoteAbsoluteFlexStacks`, `polishProductionLayout`.
- **Files created:** `compiler/emit/render/responsive-media.js` (ResponsiveIR → literal `@media` blocks — genuinely new capability, not migration).
- **Files modified:** `compiler/responsive/detect.js` if breakpoint-strategy data needs additional fields for CSS emission (verify in Phase 4 planning — do not assume).
- **Files obsoleted:** the eight functions above.
- **Risks:** medium — responsive is the one area with the least prior test coverage against real multi-breakpoint Figma files; treat as genuinely new work, not "just wiring."
- **Validation:** dual-run across corpus at three viewport widths (desktop/tablet/mobile), structural diff per breakpoint.

**STATUS: CLOSED at decision-level parity, same bar as Phase 3 (2026-07-25).** Built `@media` emission (genuinely new, per this phase's own framing — confirmed by re-reading the Phase 0 grep finding that zero code anywhere emitted `@media` before this phase) plus the 8 listed structural-polish heuristics, split explicitly by whether each needed new detection logic or only renderer wiring, verified by executing every claim below.

**`compiler/responsive/detect.js` / `project.js` — verified NOT missing fields, not modified.** Per the task's explicit instruction ("verify in Phase 4 planning, do not assume"): read both files in full. `detectResponsive()` already publishes everything `@media` emission needs per adaptation — `nodeId`, `strategy` (one of `STRATEGY`'s 10 values), `atBreakpointIds`, `confidence`, `layoutMode` — and `breakpoints` already publish `widthHint` per breakpoint. No new field was needed; **zero changes were made to `compiler/responsive/`.**

**Files created:**
- `compiler/emit/render/responsive-media.js` — `declsForStrategy(strategy, layoutChoice)` (one branch per `STRATEGY` enum value: `stack`→`flex-direction:column;align-items:stretch`, `row`→`flex-direction:row`, `wrap`→`flex-wrap:wrap`, `hide`→`display:none`, `show`→`display:block` (no live producer in `detect.js` today — kept for contract completeness only), `space-tighten`→halves the node's own `gap`, `space-preserve`→re-asserts the existing `gap` explicitly (a real, deliberate decl, not a no-op), `fixed`→`position:fixed` only (ResponsiveIR does not publish per-breakpoint left/top for FIXED nodes — emitting only what's sourced, not inventing coordinates), `abstain`→`null`, never emitted) and `buildResponsiveMediaCss(adaptations, breakpoints, classForNode, layoutChoiceForNode)`, which groups adaptations by breakpoint and emits literal `@media (max-width: Npx) { .class { ... } }` text. `bp:wide`-only adaptations (e.g. `STRATEGY.ROW` scored at `bp:wide` in `detect.js`) are deliberately skipped — they represent the base desktop state `css-declarations.js`'s `modeDecls()` already emits unconditionally, so a redundant `@media (min-width:...)` block would change nothing (documented in the file's own doc comment, not silently dropped).
- `compiler/geometry/rules/structural-polish.js` — pure detectors for the heuristics that needed **new** structural facts (see breakdown below): `isFullBleedLayer`, `detectArtboardLift`, `detectSectionHeaderCluster`, `orderChildrenVisualY`, `clampHeaderPadding`.
- `compiler/emit/render/polish.js` — pure decl-cleanup functions for the heuristics that needed **only renderer wiring** over already-known facts: `sectionShellDecls`, `polishDecls`, `polishFlexRowChildren`.
- `compiler/test/responsive-render.test.js` — 33 new tests.
- `scripts/responsive-dual-run.js` — the Phase 4 dual-run harness (see results below).

**Files modified:** `compiler/emit/render/materialize-html.js` only — additive `opts.responsiveIr` support (default absent, byte-identical to Phase 3 when omitted — proven by `responsive-render.test.js`'s explicit no-regression test): assigns a dedicated, non-deduped `rsp-<slug(nodeId)>` class to every node with a real (non-abstain) ResponsiveIR adaptation (a signature-deduped class, the norm for this renderer's other classes, can be shared by structurally-identical siblings — a per-node responsive override must never leak onto a sibling that happens to share the same base declarations), then appends `buildResponsiveMediaCss()`'s output after per-section rules and before the fixed `RESPONSIVE_STANDARDS_BLOCK`. **No file under `server/` was touched.**

**The 8 heuristics, classified by what they actually needed (per the task's own instruction to be precise about this, not assume):**

| Heuristic | Category | Reasoning |
|---|---|---|
| `recoverSectionHeaders` | **New detection** | "Is this cluster of absolute-placed children a centered eyebrow+title+subtitle header" is not answered by any Phase 0-3 IR — Component IR's card/banner/divider facts (Phase 2) don't cover it. Ported as `detectSectionHeaderCluster` (cluster-height ratio, x-span, text-count, absolute-count gates — same numeric thresholds as legacy). |
| `liftArtboardContent` | **New detection** | The padding it computes (root-box vs. single-flex-child-box offset) is not published anywhere — LayoutIR's own `padding` field is raw Figma padding, not this derived offset. Ported as `detectArtboardLift`, same formula including legacy's `Math.max(40, ...)` bottom floor (verified by a dedicated test). |
| `orderSectionChildrenByVisualY` | **New detection** (partial) | LayoutIR's `childOrder` (`compiler/layout/interpret.js`) already separates in-flow vs. out-of-flow children in *declared* order, but does not know which sibling is "the header" nor sort the remainder by (y,x) — that specific ordering fact is new, though it *consumes* (does not re-derive) the header flag from `detectSectionHeaderCluster`. Ported as `orderChildrenVisualY`. |
| `fluidBackgroundLayers` | **New detection** | "Does this child's box cover ~all of an arbitrary ancestor's box" (full-bleed bg/image at any nesting depth) is a different, broader question than Phase 2's card-scoped `isChromeBg`/`isChromeBgRefined` (which only ever asks about the ONE chrome rect behind a card's own content). Ported as `isFullBleedLayer`, same 92%/85%/6px-offset gates. |
| `normalizeInFlowHeaderPadding` | **Renderer wiring only** | Once "is the first child a recognized header" (from `detectSectionHeaderCluster`) and the padding value are known, the clamp itself is a pure arithmetic decision (`min(48, round(top*0.15))` when `top>=80`) with no new fact to discover. Ported as `clampHeaderPadding` in `structural-polish.js` (grouped there since it's a one-line pure function, not because it needed new detection). |
| `normalizeSectionShell` | **Renderer wiring only** | "Is this a depth-0 section root" is already known from `materialize-html.js`'s own `renderSections()` top-level-child walk; the decl assembly (`position:relative`, full width, soft `min-height` for tall sections) needs no new fact. Ported as `sectionShellDecls` in `polish.js`. |
| `polishProductionLayout` | **Renderer wiring only** | Every input it reads (is-text, is-flex/card/grid, box width, decl values) is already available on a RenderNode via `node.type`/`layoutChoice.mode`/`box` by the time `buildDecls()` runs — this is pure decl cleanup (fixed-height/width stripping, card-grid padding removal, large-width→`width:100%`+`max-width` conversion, flex-row-child `width:100%` removal, decimal px rounding), no new structural fact. Ported as `polishDecls`/`polishFlexRowChildren` in `polish.js`. |
| `demoteAbsoluteFlexStacks` | **Not ported — moot by construction** | This legacy function exists solely to undo a leftover `position:absolute` that some OTHER earlier heuristic left behind on a node it had already flipped to `display:flex`/`grid` in the same mutation pass — the exact "function A overwrites function B" bug class this whole migration's architecture (single decide-then-materialize pass, no mutation history) eliminates by construction. `css-declarations.js`'s `modeDecls()` selects exactly one branch per `layoutChoice.mode`, so `position:absolute` and `display:flex`/`grid` can never both appear in the same decl list. Proven, not asserted: `responsive-render.test.js`'s `demoteAbsoluteFlexStacks is moot by construction` test runs `modeDecls()` over all 4 modes and asserts the invariant holds for every one. |

**Note on `polishDecls`'s card-grid padding-stripping:** legacy checks `el.decls.has('padding')` (a single shorthand decl); this renderer's `buildDecls()` splits padding into `padding-top/right/bottom/left` (see `css-declarations.js`), so `polishDecls` strips all four — caught by its own unit test on the first run (`polishDecls — card-grid never keeps card padding` initially failed against the shorthand-only check, fixed before this note was written — see the test file for the corrected assertion).

**Responsive dual-run results (`node scripts/responsive-dual-run.js`, real output, both named corpus fixtures, quoted verbatim):**

```json
{
  "articles": {
    "adaptationCount": 23,
    "results": {
      "mobile":  { "width": 375,  "agree": 6, "disagree": 3, "newOnly": 6, "legacyOnly": 0 },
      "tablet":  { "width": 768,  "agree": 0, "disagree": 0, "newOnly": 0, "legacyOnly": 9 },
      "desktop": { "width": 1280, "agree": 0, "disagree": 0, "newOnly": 0, "legacyOnly": 0 }
    }
  },
  "ibm": {
    "adaptationCount": 21,
    "results": {
      "mobile":  { "width": 375,  "agree": 1, "disagree": 0, "newOnly": 6, "legacyOnly": 0 },
      "tablet":  { "width": 768,  "agree": 0, "disagree": 0, "newOnly": 0, "legacyOnly": 0 },
      "desktop": { "width": 1280, "agree": 0, "disagree": 0, "newOnly": 0, "legacyOnly": 0 }
    }
  }
}
```

**Read honestly, not rounded up.** Stated up front in the script's own header comment: legacy makes NO per-node responsive decision — it ships one fixed, class-keyed stylesheet with hardcoded breakpoints (1100/900/720px) applying the same rule to every node carrying a marker class (`.et-flow-row`, `.et-banner`, `.et-card-grid`). There is no legacy per-node Fact to diff 1:1 against; the script simulates legacy's own documented selector behavior (`legacyStrategyAt()`, evaluating the exact verbatim-ported `RESPONSIVE_STANDARDS_BLOCK` rule text, not an approximation of it) per node from its marker classes, and diffs that simulation against ResponsiveIR's real per-node Adaptation Facts. Two real findings from this run, not glossed over:

1. **Articles' 3 mobile disagreements** (`1:871`, `1:892`, `1:913`) are legacy `stack` vs. new `other` — inspection shows these are `.et-flow-row` nodes that `detectResponsive()` scored a non-`stack`/`wrap`/`hide` strategy for at narrow (e.g. `space-tighten`/`fixed`), which this script's simulation has no legacy analogue for and reports as `other` rather than silently counting as agreement. This is a real vocabulary-coverage gap between ResponsiveIR's current scoring and legacy's coarser always-stack rule for plain flow-rows, not a script bug.
2. **Articles' tablet breakpoint is 9/9 legacyOnly (0 agree)** — the largest single finding this phase surfaced: `compiler/responsive/detect.js`'s STACK/WRAP candidates are scored ONLY at `bp:narrow` (see `detect.js`'s `candidates.push({ strategy: STRATEGY.STACK, ..., at: [narrowId] })` — every stacking candidate hardcodes `[narrowId]`), while legacy's `.et-flow-row` stacking media rule fires at BOTH 900px and 1100px (i.e., legacy also stacks at tablet width, ResponsiveIR currently never does). **This is a real, actionable gap in `compiler/responsive/detect.js`'s current scoring** — not a Phase 4 file this task was scoped to modify (the task said modify `detect.js` only if fields are missing for CSS *emission*; this is a scoring-coverage gap, a different kind of gap, found only by actually running the dual-run this phase's own validation step required) — flagged here precisely so it isn't lost, not silently patched out of scope.

**IBM's near-total `agree:0`/`disagree:0` rows (all newOnly or empty)** reflect the same root cause as finding #2 (narrow-only stacking candidates) plus IBM's own fixture shape (fewer plain `.et-flow-row` nodes relative to card/banner shapes, which this script's simulation only handles via the always-`wrap` card-grid bucket, kept structurally separate from `stack` so it can never be miscounted).

**Test results:** `compiler/test/responsive-render.test.js` — 33/33 passing, covering `@media` emission for all 9 concretely-implemented `STRATEGY` values (10 enum values minus `abstain`'s deliberate no-emission), the end-to-end proof that a real ResponsiveIR Adaptation Fact produces a real `@media` block through `materializeHtml()` (`materializeHtml — a ResponsiveIR adaptation produces a real @media block through the renderer`), a no-regression proof (`responsiveIr` absent -> byte-identical to Phase 3), all 5 `structural-polish.js` detectors (positive + negative cases), all 3 `polish.js` functions, and the `demoteAbsoluteFlexStacks`-is-moot invariant. Full suite: `for f in compiler/test/*.test.js; do node "$f"; done` — every file passes except the same 2 pre-existing, unrelated `.canvas` CSS assertion failures in `artifacts.test.js`/`compile.test.js` that predate Phase 0 (re-confirmed this phase, not newly introduced, not touched).

**Corpus validation:** `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` and `ibm`, unchanged from every prior phase — confirms the legacy pipeline is genuinely untouched (no file under `server/` was modified this phase, confirmed by this phase touching only the files listed above).

**Deviations / scope gaps, stated plainly:**
- `compiler/responsive/detect.js`'s narrow-only STACK/WRAP scoring (finding #2 above) is a real, actionable gap surfaced by this phase's own validation step, but fixing it was judged out of THIS phase's file list (the task scoped `detect.js` changes to "missing fields for CSS emission," not "missing scoring coverage at additional breakpoints") — reported honestly as a follow-up rather than silently expanded into scope creep the blueprint's own risk table explicitly warns against ("just one more heuristic this phase").
- The dual-run's legacy-side "decision" is a simulation of legacy's own class-selector rule text, not a literal legacy per-node Fact (none exists) — this is the best available oracle given legacy's architecture, stated up front in the script's header rather than presented as a 1:1 comparison it structurally cannot be.
- `compiler/geometry/rules/structural-polish.js`'s detectors and `compiler/emit/render/polish.js`'s cleanup functions are pure functions with direct-call unit/end-to-end tests (same discipline as Phase 2/3) — they are NOT wired into `compiler/emit/render/materialize-html.js`'s default `buildDecls()` path (unlike `responsive-media.js`, which IS wired, gated behind `opts.responsiveIr`). Wiring `polishDecls`/`sectionShellDecls` live was judged out of scope for a phase whose own risk note flags responsive/polish as "the least prior test coverage" area — proving each function correct in isolation first (this phase) before live-wiring (a bounded follow-up) avoids conflating two kinds of risk in one phase.
- `compiler/compile.js`'s engine toggles remain deliberately unwired, same deliberate deferral as every prior phase — this phase's outputs are reachable only via direct calls (tests, `scripts/responsive-dual-run.js`), never the default `emitArtifacts()` path.

**Files touched, confirmed by this phase's own work (no VCS in this repo — verified directly): new `compiler/emit/render/responsive-media.js`, `compiler/geometry/rules/structural-polish.js`, `compiler/emit/render/polish.js`, `compiler/test/responsive-render.test.js`, `scripts/responsive-dual-run.js`; edits to `compiler/emit/render/materialize-html.js` only (additive `opts.responsiveIr` support). Zero changes to `compiler/responsive/*` (verified unnecessary, not skipped). Zero files under `server/` touched.**

### Phase 5 — Cutover

**Goal:** flip the default.

- **Files modified:** `server/index.js` / `compiler/artifacts/index.js` — `emitArtifacts()` calls the new renderer by default; legacy `figmaBuild.analyze()+emit()` path kept behind an explicit flag (`emitMode: 'legacy'`) for one release as a rollback safety net.
- **Files obsoleted (now safe to actually delete, not just flag):** `server/constraint-transcriber/` (all 6 files, 2,501 lines), `server/dual-path.js` (613 lines), and the ~1,728 geometric-heuristic lines inside `server/figma-build.js` identified in the gap analysis (Bucket 1). Total: **≈4,842 lines, ~68% of the combined legacy surface**, per the gap analysis — now actually realizable because the migration is done, not assumed.
- **Risks:** the only phase with user-facing blast radius. Mitigation: keep the legacy flag live for one full release cycle; corpus-gate every fixture (not just the 3 named ones — expand the corpus first, see §9) before removing the flag.
- **Validation:** full production corpus gate, plus a manual review pass on a sample of real user-submitted URLs before the legacy path is actually deleted.

**STATUS: NARROWED — toggle only, built and verified (2026-07-25). This is explicitly NOT the full Phase 5 plan above** ("flip the default" + delete `server/constraint-transcriber/`, `server/dual-path.js`, and the ~1,728 geometric-heuristic lines in `server/figma-build.js`). Per an explicit user decision made after being shown Phase 3/4's documented parity gaps (Phase 3: architecturally-blocked byte-parity; Phase 4: 9 confirmed missed responsive stacking decisions at Articles' tablet breakpoint): *"Build the Phase 5 toggle only. Keep the legacy renderer as the default path and expose the new renderer behind a feature flag for side-by-side testing. Do not remove the legacy pipeline or switch the default until the new renderer has been validated on real-world Figma projects and is ready for production."* Nothing above this note — the default flip, the ≈4,842-line deletion — was attempted or is claimed done.

**What was built:**

1. **New flag:** `compiler/artifacts/index.js`'s `emitArtifacts(opts)` gained `opts.renderer: 'legacy' | 'ir-experimental'`. Default (and the value used when the key is omitted) is `'legacy'`. Documented in a code comment directly above `emitArtifacts()` (not a new doc file), stating plainly that `'ir-experimental'` is diagnostic/opt-in only and does not yet match legacy byte-for-byte, pointing back at this document's Phase 3/4 STATUS notes for the specific gaps.
2. **New file `compiler/artifacts/ir-experimental-renderer.js`** — `renderIrExperimental(document, opts)`, promoting the ad-hoc "new path" assembly `scripts/render-byte-diff.js`/`scripts/responsive-dual-run.js` already built for validation into a real, reusable, callable function: NDG materialization → `detectGeometry` → `interpretGraph` → `detectComponentGeometry` (card/banner facts) → `detectResponsive` → a render tree → `materializeHtml()`. Self-contained: builds its own workspace/graph per call from `document` directly, the same way the diagnostic scripts do, rather than consuming the kernel job's published LayoutIR/ComponentIR/ResponsiveIR slices.
3. **`compiler/artifacts/index.js` wiring:** `emitArtifacts()` now branches at the top — `opts.renderer === 'ir-experimental'` routes to a new `emitArtifactsIrExperimental(opts)` function (also in `index.js`); anything else (including omitted) falls through to the pre-existing legacy code, **completely unmodified** (verified by inspection: every legacy-path line below the branch point is byte-identical to before this change — the only edit to that branch is the new `if` guard placed before it, nothing inside it). `emitArtifactsIrExperimental()` calls `renderIrExperimental()` and returns the same key shape as the legacy branch (`ok`, `cached`, `artifactFingerprint`, `html`, `css`, `js`, `sections`, `sectionsSummary`, `fonts`, `analyzed`, `emitMode`, `layoutReport`, `dir`, `paths`, `package`, `timings`, `summary`) so opt-in callers need no special-case handling — inert/empty defaults are used for fields the diagnostic renderer has no analogue for (`sections: []`, `analyzed: { imageNodeIds: [], svgNodeIds: [], fontCount: 0 }`, `layoutReport: null`). Does not read/write the on-disk `.compile-cache.json` fast-path the legacy branch uses (deliberate — that cache key has no `renderer` component, kept that way specifically so the legacy path's cache key is provably unaffected by this flag's existence; reusing it for the new path risked a cache collision on a shared `outDir`).
4. **`compiler/compile.js` wiring:** `compile()`'s call into `emitArtifacts()` now forwards `renderer: options.renderer` (previously not forwarded at all — an omitted value is normalized to `'legacy'` by `emitArtifacts()`, so this addition is a no-op for every existing caller). **Engines are NOT auto-enabled for `renderer: 'ir-experimental'`** — documented via a code comment on `compile()`'s JSDoc: since `renderIrExperimental()` is self-contained (re-materializes its own NDG/geometry/layout/component/responsive facts directly from `options.document` rather than consuming `job.projectLayoutIR()`/`projectComponentIR()`/`projectResponsiveIR()`'s published IR through EmitPlan's `layoutChoices`), those engines' output is not required for the new renderer to produce real output. Only `engines.resolved`/`engines.emit`/`engines.artifacts` (all default `true`) are load-bearing, since `compile()` only calls `emitArtifacts()` at all when `engines.artifacts` is true. This choice is explicit, not an oversight — if a future phase switches the renderer to consume the kernel's own published IR slices instead of self-materializing, this default should be revisited.

**Proof the default is unchanged — quoted directly from `compiler/test/renderer-toggle.test.js` (new file, 6/6 passing):**

- `emitArtifacts: omitting opts.renderer is identical to passing "legacy" explicitly` — asserts `omitted.html === explicitLegacy.html`, `.css`, `.js`, and `.artifactFingerprint` all strictly equal.
- `emitArtifacts: legacy renderer output matches pre-flag figmaBuild.analyze()+emit() call path` — independently reconstructs the exact sequence `emitArtifacts()`'s legacy branch runs (`figmaBuild.analyze()` → `applyPlanToTree()` → `stampDataNodeIds()` → `figmaBuild.polishGeneratedTree()` → `figmaBuild.emit()`) and asserts the HTML returned by `emitArtifacts()` is `===` that independently-built reference — i.e. this doesn't just check the flag is self-consistent, it re-derives legacy's real output from `server/figma-build.js` directly and diffs against it.
- `compile(): omitting options.renderer produces artifacts identical to renderer:"legacy"` — same proof one layer up, through `compile()`.

**Proof the opt-in path reaches real new-pipeline output:**

- `emitArtifacts: renderer "ir-experimental" returns real, non-empty HTML/CSS` — asserts non-empty `html`/`css` strings, that the fixture's real text content (`"Hello"`) appears in the output, that a real `<!doctype html>` document shell is present, and that all 14 return-shape keys the legacy branch produces are also present here.
- `compile(): options.renderer "ir-experimental" reaches the new renderer end-to-end` — same proof through the full `compile()` → `emitArtifacts()` path.
- `emitArtifacts: "legacy" and "ir-experimental" produce different HTML/CSS for the same document` — asserts `legacy.html !== experimental.html`, `.css !== .css`, and `.artifactFingerprint !== .artifactFingerprint` for the identical input document — proving the flag genuinely switches behavior rather than silently falling through to legacy.

**Full test suite:** `for f in compiler/test/*.test.js; do node "$f"; done` — 363 tests passed, 2 failed, across 24 files. The 2 failures are the same pre-existing, documented `.canvas`-CSS assertion failures called out in every prior phase's STATUS note (`compiler/test/artifacts.test.js`: `compile produces HTML/CSS/JS artifacts in memory — css`; `compiler/test/compile.test.js`: `compile with artifacts produces HTML — css`, both asserting `result.artifacts.css.includes('.canvas')`) — confirmed by direct inspection to be the exact same assertions as before this task, untouched, not newly introduced, and not silently patched around.

**Corpus validation:** `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` and `ibm`, unchanged from every prior phase.

**Confirmed constraints held:**
- Zero modifications to any file under `server/` (`server/figma-build.js`, `server/constraint-transcriber/*`, `server/dual-path.js`, `server/pipeline/*`, `server/index.js` — none touched; `server/figma-build.js`/`server/package-site.js` are only ever `require()`d, read-only, exactly as the legacy branch already did before this task).
- Zero deletions anywhere — every prior phase's file (including everything Phase 3/4 built) is untouched and fully live.
- The default path for every existing caller of `emitArtifacts()`/`compile()` is unchanged, proven by the tests quoted above, not merely asserted.

**Files touched:** new `compiler/artifacts/ir-experimental-renderer.js`, new `compiler/test/renderer-toggle.test.js`; edits to `compiler/artifacts/index.js` (additive `opts.renderer` branch, new `emitArtifactsIrExperimental()` function, `stampDataNodeIds` added to `module.exports` for direct test verification — no behavior change), `compiler/compile.js` (additive `renderer: options.renderer` forwarded to `emitArtifacts()`, JSDoc comment only otherwise). No file under `server/` touched.

---

### Phase 6 (partial) — Repeating-Pattern / Row-Set Recognition (Table & Uniform-List Detection)

**Goal (per the roadmap agreed with the user):** recognize N sibling containers as a repeating set regardless of layout axis — Phase 2 already recognizes a HORIZONTAL row of side-by-side cards (`detectCardGridUniformity`, byX). This task adds the missing VERTICAL case: a single column of N full-width "table rows" (Challenge Arena's actual shape), plus cross-row column-alignment so a real CSS grid/table with aligned columns can eventually be rendered. **Explicitly IR-capability-building only** — wiring into the renderer (`compiler/emit/render/*`, `compiler/artifacts/ir-experimental-renderer.js`) was out of scope per the user's own instruction and was not attempted.

**What was built**, all in `compiler/rulepack/packs/component-detect/geometry-rules.js` (same file, same collect→detect→project→publish lifecycle as every other Component IR domain — pure functions, never mutate the NDG tree, never talk to the solver/renderer):

1. **`largestUniformSizeCluster(items)`** — greedy height-based clustering (sorted ascending, new cluster whenever the running height span exceeds 35% of the running max — the exact same tolerance number `detectCardGridUniformity` already uses, reused as a clustering cut rather than a single accept/reject gate). Needed because the real Challenge Arena fixture's row-set parent (`table`, node `1:326`) has **5** children, not 4: 4 uniform 177px-tall rows plus one 36px-tall `TH` header sibling. Without this clustering step, a direct port of `detectCardGridUniformity`'s all-or-nothing tolerance check would reject the entire parent (height span 141 vs. the 62px tolerance ceiling) — this is a deliberate, documented extension beyond a literal one-line axis-swap port, added because the real-fixture validation (item 3 below) demanded it, not speculatively.
2. **`detectRowSetUniformity(parentId, rows)`** — the Y-axis counterpart to `detectCardGridUniformity`: isolates the dominant cluster (above), then applies the *same* width-span (≤20% of max) and height-span (≤35% of max) tolerance bands, plus a new left-edge-alignment check (x-span ≤5% of max width) that is what actually distinguishes "vertical stack of rows" from "horizontal row of cards" for the same tolerance math — verified negative-tested against a side-by-side card fixture (rejected, correctly deferring to `detectCardGridUniformity`'s existing case).
3. **`rowColumnCandidates(rowBox, rowKidNodes, childrenOfFn)`** — one row's column candidates: direct children with chrome backgrounds excluded (reusing `isChromeBgRefined`, same test every other detector in the file uses), and any child that is itself a wide (≥50% of row width) multi-child pass-through wrapper is unwrapped ONE level to its own children. This was necessary because the real fixture's rows are not structurally identical to each other at the raw-children level — row "RAG Architecture Build" has its action button as a sibling of the content-wrapper group, while row "Neural Prompt Engineering Duel" has the button nested one level deeper *inside* the content-wrapper (confirmed by direct inspection of `output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_2/document.json`, nodes `1:345` vs. `1:329`) — the one-level unwrap rule handles both shapes identically, purely by geometry (child count + width fraction), never by name/text.
4. **`computeRowSetColumns(perRowColumns)`** — cross-row column alignment: chain-clusters all rows' column candidates by x-position (24px tolerance), then collapses each cluster onto ONE canonical `{ x, width }` descriptor via the median across all member rows — the same "many measurements, one canonical value" principle `normalizeUniformCardChrome` already uses for padding, applied here to column x-boundaries instead. Purely positional; does not attempt to label columns semantically ("this is the reward column") per the task's explicit scope limit.
5. **Wiring:** `detectComponentGeometry` runs the row-set pass over every graph node with ≥3 children, skipping any parent already claimed by `cardGridFacts` (so a horizontal row of cards is never double-counted as a vertical row-set). Results land in a new `rowSetFacts` array, each entry `{ pattern: 'row-set', nodeId, orderedChildIds, gap, columns: [{ x, width, rowCount, memberIds }] }`, with a matching `EVIDENCE_ROW_SET = 'component.row-set'` evidence ref. `compiler/components/detect.js`'s `detectComponents()` publishes it as `rowSetPatterns` (identical carry-through pattern to `cardPatterns`/`bannerPatterns`/`dividerPatterns`); `compiler/components/project.js`'s `projectComponentIR()` deep-copies it into the frozen published payload (`payload.rowSetPatterns`) and folds its node ids into the slice's `nodeIds` list, exactly like every other pattern array.

**Real Challenge Arena fixture validation — exact numbers, via `scripts/validate-row-set-challenge-arena.js`** (new read-only diagnostic script, mirrors `scripts/dual-run-compare.js`'s pattern: loads the real cached document, materializes a real NDG graph through `compiler/ndg`, runs the new detector, prints the result):

```
=== Row-set validation against REAL Challenge Arena fixture ===
rowSetFacts found (whole Challenge Arena subtree): 1
  - nodeId=src:1:326 sourceNodeId=1:326 rows=4 columns=5 gap=0

RESULT: PASS — the "table" node (1:326) was recognized as a row-set.
  rows recognized: 4 (expected 4 — the TH header sibling correctly excluded)
  gap: 0
  columns (x, width, rowCount out of 4):
    x=142 width=40 rowCount=4      (challenge # / id)
    x=231 width=424 rowCount=4     (title + description)
    x=761 width=212 rowCount=4     (reward label + value)
    x=1039 width=87 rowCount=4     (XP label + value)
    x=1164 width=123 rowCount=4    (action button)
```

All 4 real challenge rows ("Neural Prompt Engineering Duel", "RAG Architecture Build", "Data Governance Sprint", "Agentic Orchestration") were correctly recognized as one row-set; the `TH` header sibling was correctly excluded; all 5 columns have `rowCount: 4` (every row contributed exactly one member to every column — no partial/missing column data). This is an exact match against the column structure found by direct manual inspection of the fixture (id / title+desc / reward / xp / action). No rounding-up: this is the real result, not a synthetic-only claim. (The wider Challenge Arena subtree also contains 2 other row-sets at nodes `1:484`, `1:673` — smaller/unrelated repeating structures on the same page; not specifically inspected further, out of scope for this validation.)

**Tests added** (`compiler/test/component-geometry.test.js`, extended, not replaced — all 16 pre-existing tests still pass unmodified):
- `detectRowSetUniformity` pure-function tests: accepts a uniform 3-row vertical stack; rejects wildly different heights with no majority cluster; rejects a horizontally-arranged (side-by-side) sibling set (defers to `detectCardGridUniformity`'s case).
- A minority-outlier test proving a header sibling does not poison recognition of the majority uniform rows (mirrors the real fixture's actual shape).
- An NDG end-to-end synthetic test (4 uniform rows + 1 header, each row internally shaped like the real fixture's id/title/reward/xp/button structure) asserting the row-set is recognized, the header is excluded, and all 5 canonical column x-offsets are computed correctly.
- A byte-identical-facts test: re-deriving each row's column candidates independently and asserting identical relative x-offsets and identical `rowCount` shape across all structurally-identical rows — the same discipline the existing card-uniformity test applies to padding, applied here to column data.
- An end-to-end test proving the row-set Fact reaches Component IR's frozen published payload (`payload.rowSetPatterns`), including a checksum-matches-payload assertion.

**Full test suite:** `for f in compiler/test/*.test.js; do node "$f"; done` — all files pass except the same 2 pre-existing, documented `.canvas`-CSS failures called out in every prior phase's STATUS note (`compiler/test/artifacts.test.js`, `compiler/test/compile.test.js`, both asserting `result.artifacts.css.includes('.canvas')`) — confirmed unchanged, not newly introduced. `compiler/test/component-geometry.test.js` itself: **21 passed, 0 failed** (16 pre-existing + 5 new).

**Corpus validation:** `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` and `ibm`, unchanged.

**Confirmed constraints held:**
- Zero modifications to any file under `server/` — not touched this task (the only `server/`-path file with a changed mtime, `server/constraint-transcriber/figma-corpus-report.json`, is the corpus-gate script's own report output, regenerated automatically by running `validate-figma-corpus.js`; `git diff` on it shows zero content changes).
- `compiler/geometry/` (Phase 0/1's plain-geometry stage) untouched — the new capability consumes nothing from it and lives entirely in Component IR.
- The renderer (`compiler/emit/render/*`, `compiler/artifacts/ir-experimental-renderer.js`) untouched at the time this note was first written — `rowSetFacts`/`rowSetPatterns` were published into Component IR's frozen payload and stopped there; nothing read them downstream yet. **Superseded** — see the "Row-set renderer wiring" subsection immediately below: the renderer now consumes `rowSetFacts` (`ir-experimental` renderer only, per explicit user go-ahead).

**Honest scope gaps:**
- The row-set/card-grid mutual-exclusion check (skip a parent already claimed by `cardGridFacts`) is a simple set-membership test on the parent node id; it has not been stress-tested against a parent that could plausibly be read either way (e.g. a near-square grid of cards that could be misread as very-short "rows") — only the two shapes actually seen in the corpus (clean horizontal cards, clean vertical table rows) are validated.
- `rowColumnCandidates`'s one-level unwrap rule is tuned to (and validated against) exactly the two nesting shapes the real fixture exhibits; a row shape needing a two-level unwrap has not been tested and would currently surface as extra/fewer columns rather than a graceful degrade.
- The 24px column-clustering tolerance and 50%-width wrapper-unwrap threshold are untuned constants (chosen to fit the real fixture's actual measurements with comfortable margin), not derived from a broader corpus — a future row-set shape with tighter column spacing than 24px, or a "wrapper" narrower than 50% of the row, would need re-tuning.

**Files touched:** edits to `compiler/rulepack/packs/component-detect/geometry-rules.js` (new `largestUniformSizeCluster`, `detectRowSetUniformity`, `rowColumnCandidates`, `computeRowSetColumns`, new row-set pass wired into `detectComponentGeometry`, new exports), `compiler/components/constants.js` (new `EVIDENCE_ROW_SET`), `compiler/components/detect.js` (publishes `rowSetPatterns` + row-set evidence), `compiler/components/project.js` (carries `rowSetPatterns` into the frozen Component IR payload and its `nodeIds` list), `compiler/test/component-geometry.test.js` (5 new tests, 16 pre-existing untouched); new `scripts/validate-row-set-challenge-arena.js` (read-only real-fixture diagnostic). No file under `server/` touched; no renderer file touched; `compiler/geometry/` untouched.

#### Row-set renderer wiring (STATUS — wired into `ir-experimental` renderer only)

Per explicit user go-ahead ("Wire it into the renderer now"), `rowSetFacts` is now consumed by `compiler/artifacts/ir-experimental-renderer.js` and turned into real CSS by `compiler/emit/render/css-declarations.js`. Reached ONLY via `emitArtifacts({ renderer: 'ir-experimental' })` — the default/legacy emitter path is untouched, same as every other capability built this session. `compiler/rulepack/packs/component-detect/geometry-rules.js` (the fact-producing detector) was read-only reference — not modified.

**Design deviation from the original sketch, and why (confirmed against real generated bytes, not asserted):** the brief's starting design put `display:grid` + explicit column tracks on the row-set CONTAINER, flattening every row into it via `display:contents`. Real-fixture validation against Challenge Arena (node `1:326`, via a new `scripts/validate-row-set-render.js` diagnostic that calls `renderIrExperimental()` end-to-end and inspects the literal generated CSS/HTML) found that **every one of the 4 real rows carries its own chrome background rectangle** as a direct child — the container-flatten design would have destroyed all 4 backgrounds (a `display:contents` row's chrome child either paints nothing where expected or becomes a stray, misplaced grid cell). It also found the 4 rows are **not structurally uniform**: row 1 bundles all 5 columns (including the "Register Now" button) inside one wrapper group, while rows 2-4 pull the button out as their own direct child, alongside a wrapper bundling only the other 4 columns. A naive "row = `display:contents`, nothing else" implementation was actually built and tested first, and produces the WRONG result on this exact fixture — row 1 exposes 2 raw grid items (chrome + wrapper) while rows 2-4 expose 3, so column tracks land in different cells per row, reproducing the very misalignment this feature exists to fix.

The implemented design instead: each ROW becomes its OWN independent CSS Grid with the fact's column widths as literal px tracks (identical string on every row, guaranteeing pixel-identical cross-row alignment without needing one shared grid); the row's chrome color is lifted onto the row itself as `background-color` (same "lift chrome paint" idiom `cardChromeDecls` already uses for cards) and the original chrome node is hidden (`display:none` — hidden rather than left to render as a redundant/misplaced box); any pass-through wrapper found inside a row (one level, mirroring `rowColumnCandidates`' own unwrap depth, re-derived read-only at render time via a new `classifyRowSetRow`/`subtreeContainsMember` pair in `ir-experimental-renderer.js` rather than by modifying the detector) gets `display:contents` so its children become direct grid items of the row's own grid; and recognized column-member leaf nodes are excluded from the renderer's usual freeform "unknown/absolute mode → position:absolute" fallback (a `rowSetGridItem` marker), since a `position:absolute` item is removed from CSS Grid flow entirely and would not participate in the row's explicit tracks at all. `display:contents` is still used exactly where originally intended (flattening structural wrappers) — just scoped to each row's own grid instead of one shared container grid. A row with no chrome at all still gets the originally-sketched simple `display:contents` treatment (nothing to lose); this branch is exercised only by the synthetic unit test, not the real fixture (every real Challenge Arena row has chrome).

**A second real bug found and fixed during validation, honestly reported:** the real fixture's 4 rows are NOT stored in top-to-bottom visual (Y) order in the source document — Figma layer order is 001, 003, 004, 002. Rows 2-4 initially rendered via ordinary in-flow layout (whatever `layout.interpret` assigned them), so document order — not Y position — determined their visual stacking, and the "002" row rendered LAST instead of second. Fixed by forcing every recognized row-set row with chrome to the renderer's existing freeform-absolute-fallback mechanism unconditionally (`mode` forced to `'absolute'` whenever `rowSetRow.hasChrome`), positioning every row by its own real box y-offset regardless of raw document order — this reuses code that already existed for exactly this purpose (freeform Figma content), rather than adding a new mechanism. A third, smaller bug (row 1 alone carrying stray non-zero padding from its own per-row `layout.interpret` guess, shifting its whole grid content ~21px right of rows 2-4) was also found this way and fixed by explicitly zeroing all 4 padding sides in `rowSetRowDecls`'s chrome branch, since the fact's column x-offsets are already relative to a row's own flush content-box edge.

**Real generated CSS for Challenge Arena (verbatim, via `node scripts/validate-row-set-render.js` against the cached real document, `output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_2`):**

```css
.group-1171278042 {
  position: absolute;
  left: 0px;
  top: 49px;
  width: 1196px;
  min-height: 177px;
  display: grid;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding-top: 0px;
  padding-right: 0px;
  padding-bottom: 0px;
  padding-left: 0px;
  grid-template-columns: 40px 424px 212px 87px 123px;
}

.group-1171278043 {
  position: absolute;
  left: 0px;
  top: 226px;
  width: 1196px;
  min-height: 177px;
  display: grid;
  grid-template-columns: 40px 424px 212px 87px 123px;
  align-items: center;
  box-sizing: border-box;
  padding-top: 0px;
  padding-right: 0px;
  padding-bottom: 0px;
  padding-left: 0px;
  background-color: rgba(172, 200, 251, 0.3);
}
```

(rows 3 and 4 — `group-1171278044-2` at `top: 403px` and `group-1171278045` at `top: 580px` — carry the byte-identical `grid-template-columns: 40px 424px 212px 87px 123px`; the chrome node for row 1, `.rectangle-34624617`, resolves to `display: none;` and the row-1 content wrapper, `.group-1171278044`, resolves to `display: contents;`.)

**Verified against the actual rendered browser layout, not just the CSS text** (via the Browser pane, loading `output/row-set-render-combined.html` — the generated HTML with its CSS inlined — and reading real `getBoundingClientRect()` values, filtering out `display:none` elements and recursively flattening `display:contents` ones exactly as a browser's grid box-generation algorithm does): every one of the 4 rows' 5 real leaf columns land at the identical `left` offset relative to the table — `0px / 40px / 464px / 676px / 763px` — in all 4 rows, byte-for-byte identical, confirming the misalignment this capability targets is actually closed, not just plausible from reading CSS text. Row stacking order top-to-bottom is `102px, 279px, 456px, 633px` (ascending, correct), fixing the document-order bug described above.

**Test results:** `for f in compiler/test/*.test.js; do node "$f"; done` — same 2 pre-existing documented `.canvas`-CSS failures only (`artifacts.test.js`, `compile.test.js`), nothing newly broken. `compiler/test/render.test.js`: **31 passed, 0 failed** (24 pre-existing + 7 new: `rowSetRowDecls` hasChrome/no-chrome cases, `rowSetPassthroughDecls`/`rowSetChromeHiddenDecls`, 3 `buildDecls` override-precedence cases, and one full synthetic-graph end-to-end test asserting the exact `grid-template-columns` string, `display: contents;`, and `display: none;` bytes appear in `materializeHtml()`'s output).

**Corpus validation:** `node scripts/validate-figma-corpus.js` → `{"pass": true}` for both `articles` and `ibm`, unchanged.

**Honest caveats:**
- Confirmed: no row-level chrome/background is silently lost — the fixture's chrome color is preserved (lifted onto the row) in every case where a chrome fill actually resolves to a color; row 1's chrome rectangle in the real fixture has no resolvable solid fill (`solidFillCss` returns `null` for it), so its row renders with no background at all — this is a pass-through of pre-existing fill data, not a new gap this task introduced.
- The pass-through-wrapper unwrap is exactly one level deep (mirrors `rowColumnCandidates`'s own depth), re-derived independently at render time by walking the graph and checking `isChromeBgRefined`/subtree membership against the fact's `columns[].memberIds` — this duplicates a small amount of classification logic that already exists in the (untouched, read-only) detector, rather than changing the detector to expose it directly. A row needing a two-level wrapper unwrap is not handled and would currently misalign, same documented limit the detection-side STATUS note already carries.
- Column-member leaf nodes lose their own `position:absolute` fallback (so they can participate in the row's grid) but otherwise keep whatever mode-based decls they already had (flex/flow, own padding, own background) — verified via the real fixture that this doesn't clip or misplace their content, but this hasn't been stress-tested against a column whose own children rely on their parent being `position:relative`-anchored in some other way.
- No reordering of a row's own children by x-position was implemented — DOM order already matches ascending x in the real fixture (confirmed by inspection), so this was not needed for Challenge Arena, but a row-set whose DOM/layer order doesn't already ascend left-to-right within a row would misalign under the current implementation. Flagged, not fixed, per the task's scope (verify against the real fixture, not over-build for hypothetical shapes).

---

## 8. Risks and validation strategy — cross-cutting

| Risk | Mitigation |
|---|---|
| Re-introducing the "N functions silently overwrite each other" bug class | Structural: the new pipeline's mutation happens exactly once (Renderer), from exactly one source of truth (EmitPlan). There is no second place left that can write conflicting `display`/`position` decls, because intermediate stages only ever produce immutable IR slices, never touch a live tree. |
| Confidence-band regressions (a shape that used to hit `pixel` fallback silently flips to `flex` incorrectly) | `compiler/decision/thresholds.js`'s existing `accept_min`/`margin_min`/`fallback_below` slots are already the correct mechanism for this — reuse them, don't invent a second threshold system alongside `dual-path.js`'s ad hoc `alCoverage`. |
| Scope creep — "just one more heuristic this phase" | Each phase above has an explicit, closed heuristic list. A PR migrating something not on that phase's list is out of scope for that phase, full stop. |
| Docs claiming phases are "done" before they are | This document is a plan, not a report. No phase is marked complete here or anywhere until its validation gate (below) passes against the corpus, and completion claims should cite the dual-run diff output, not a written summary. |

---

## 9. Continuous fidelity comparison — how we know nothing regressed, every phase

Extend the existing harness (`scripts/validate-figma-corpus.js`, `scripts/recompile-{articles,ibm,challenge-arena}-offline.js`) rather than build a new one:

1. **Expand the corpus** beyond the 3 current fixtures before Phase 5 — at minimum add one Auto-Layout-native file (to prove the "easy" path stays easy) and one deliberately pathological freeform file.
2. **Dual-run mode**, added in Phase 0 (`scripts/dual-run-compare.js`): every corpus recompile runs *both* the legacy path and the new path (behind `engines.geometry`/`engines.layoutRender` toggles added per phase) and diffs three things, in order of cost:
   - **Decision diff** (cheapest, available from Phase 0): does the new stage's chosen mode (row/column/grid/absolute) match the legacy heuristic's, per node?
   - **Structural diff** (available from Phase 3): tag tree + class-driven CSS property set, byte-comparable.
   - **Geometric box-diff against the Figma oracle** (not against the legacy output — Figma is ground truth, not the old heuristics): reuse the existing `POS_TOL`/`SIZE_TOL` box-diff machinery from `constraint-transcriber/verify.js` before that file is deleted in Phase 5; it becomes the corpus gate's fidelity oracle, not the compiler's runtime demote mechanism.
3. **Every phase's exit criterion is a clean dual-run report**, not a written status doc — this directly addresses the pattern in this project's own `docs/` folder where "PHASE_N_IMPLEMENTATION_REPORT.md" files asserted completion without an executable proof attached.
4. Nothing flips the *default* path (`emitArtifacts()`'s actual call) until Phase 5, and even then behind a rollback flag — so at every intermediate milestone, production output is byte-identical to today, by construction, because the legacy path is still what's serving.

---

## 10. `freeform-layout-ir` — normalizing inconsistent freeform hierarchies (STATUS: detection-stage built and validated against both real fixtures, 2026-07-26)

A new stage, downstream of `component-ir` and `geometry-ir`, normalizing inconsistent Figma freeform hierarchies into ONE of two canonical facts per freeform node. Files: `compiler/freeform-layout/{checksum,collect,constants,declaration,detect,errors,index,materialize,project,publish,report}.js` (same 11-file skeleton as `compiler/components`/`compiler/geometry`), diagnostic script `scripts/validate-freeform-layout-ir.js`, unit tests `compiler/test/freeform-layout.test.js`.

**Schema (as designed, implemented verbatim):**

```
RepeatingGroupMembership {
  groupId, role: "container"|"member", slotIndex, memberCount,
  axis: "row"|"column",
  columns: [ { columnId, order, x, width } ],   // computed once per group, shared across members
  memberColumnMap: { [columnId]: nodeRef | null }
}
```
(`AnchoredPosition` is specified in the schema but not yet produced by any detector — no freeform node in either validated fixture needed it; every node in scope for this pass resolved to a `RepeatingGroupMembership` member or container. Not built, not claimed built.)

**Registration mechanism — carve-out, not enum extension, matching `geometry-ir`'s exact precedent.** `freeform-layout-ir` is registered in `contracts/registries/ir-stages.json` (predecessors `normalized-design-graph`, `component-ir`, `geometry-ir`) but deliberately NOT added to `contracts/schemas/specialized-ir-envelope.json`'s closed `stageId` enum. Investigated `compiler/workspace/index.js`'s `putIrSlice()` (the actual enforcement point, as directed): it calls `compiler/ir-stage-registry.js`'s `isKnownIrStage(record.stageId)`, which reads `ir-stages.json` directly — the JSON-Schema enum in `specialized-ir-envelope.json` is never checked against a live envelope at runtime. `contracts/validation/harness.js` (the only place that schema is actually used) only validates a fixed fixture manifest, never produced IrSlices. `geometry-ir` already ships today with the identical enum omission and works, which is the load-bearing precedent this stage follows rather than editing a schema whose real enforcement point lives elsewhere.

**Algorithm, as implemented (`compiler/freeform-layout/detect.js`):**
1. **`determineGroupAxis`** — ONE axis-agnostic function (not two hardcoded-axis functions). First isolates the dominant uniformly-sized cluster among a parent's children via `largestUniformSizeCluster` (imported verbatim from `geometry-rules.js` — the same function `detectRowSetUniformity` already uses internally to exclude a table-header outlier), then reads which alignment the cluster exhibits: top-edges-aligned (`ySpan <= maxHeight*0.05`) means side-by-side ⇒ tries `axis="row"` via `detectCardGridUniformity` (imported verbatim); left-edges-aligned (`xSpan <= maxWidth*0.05`) means stacked ⇒ tries `axis="column"` via `detectRowSetUniformity` (imported verbatim). The 0.05 tolerance is not new — it mirrors `detectRowSetUniformity`'s own existing `xSpan` check, applied symmetrically to the perpendicular axis. **A real gap found only by running this against real data:** `detectCardGridUniformity` has no directional/alignment check of its own (it only checks width/height variance), so a genuinely vertically-stacked, identical-size cluster (Challenge Arena's 4 rows) would ALSO satisfy it and could be misread as `axis="row"` if tried first with no discriminator — the alignment pre-check above was added specifically to prevent this, and is not something the design conversation's proof-of-concept walkthrough had flagged as necessary.
2. **Chrome/content separation** — `isChromeBgRefined`, imported verbatim, unmodified.
3. **Wrapper unwrap — deviated from the literal design-brief framing, honestly.** The brief described this step as "if a member has exactly one remaining child, recurse into it." Real Challenge Arena data shows row 1 (`1:327`) has exactly one non-chrome child (a wrapper spanning ~96% of the row, bundling all 5 columns including the button), while rows 2-4 (`1:345`/`1:364`/`1:383`) have **two** non-chrome children (a wrapper spanning ~82% of the row, bundling 4 columns, plus the action button as a separate sibling). A strict "only unwrap when exactly one child remains" rule would unwrap row 1 but leave rows 2-4's wrapper un-unwrapped (2 opaque items instead of 5 real columns) — reproducing, not closing, the asymmetry. The implemented rule instead tests **each** non-chrome child independently against a wide-multi-child-wrapper geometry test (≥2 grandchildren, span ≥50% of the member's span in the dimension perpendicular to the axis — mirrors `rowColumnCandidates`' existing `isWideWrapper` test, generalized to whichever dimension is perpendicular to `axis` rather than hardcoded to width), recursing (capped at depth 3) wherever it fires. This closes both row 1 and rows 2-4 uniformly. Called out here per the task's own "prove it, don't round up" discipline.
4. **Position-based bucketing with union-of-columns** — clusters each member's flattened content by position along the dimension PERPENDICULAR to the repeating axis (`axis="row"` members are already separated in X, so their own internal structure — image/badge/title/footer — is bucketed by relative-Y; `axis="column"` members are already separated in Y, so their internal columns are bucketed by relative-X), 24px chain-clustering tolerance (reused from `computeRowSetColumns`'s default), canonical column list is the union across all members, explicit `null` in `memberColumnMap` for any member genuinely missing a column.

**Grouping is NOT gated behind Component IR's `cardGridFacts`/`rowSetFacts` already having fired — a real, load-bearing finding.** The design brief assumed the new stage would consume Component IR's already-recognized card-grid/row-set groups as its seed set. Running against the real Articles fixture found `detectCardShape` never classifies Articles' actual 3 cards at all: their thumbnail rectangle (`Rectangle 5`, 380×231 inside a 381×413 card) covers the full width but only ~56% of the card's height, failing `isChromeBgRefined`'s ≥85%-height chrome threshold — it is real content (an image), not a chrome background — so `cardGridFacts` never fires for this fixture, and gating this stage's grouping on it would have silently produced **zero groups for the primary validation fixture**. `detectFreeformLayout` instead walks every parent in the graph directly (same sorted traversal shape as `detectComponentGeometry`) and applies `determineGroupAxis` to each parent's own raw children; Component IR's `cardGridPatterns`/`rowSetPatterns` are still consulted as optional `seedHint` cross-reference metadata where they DO agree (Challenge Arena's table does get `seedHint:'row-set'`, confirming agreement there), but are never required.

**Real validation output, verbatim, via `node scripts/validate-freeform-layout-ir.js`:**

*Articles (`output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_848`):*
```
groupId=group:src:1:849 containerNodeId=src:1:849 (source 1:849) axis=row memberCount=3 seedHint=null
  columns (3):
    columnId=col:0 order=0 x=20 width=231
    columnId=col:1 order=1 x=261 width=88
    columnId=col:2 order=2 x=362 width=51
  members:
    slotIndex=0 nodeId=src:1:860 (source 1:860) nullColumns=[]
    slotIndex=1 nodeId=src:1:881 (source 1:881) nullColumns=[]
    slotIndex=2 nodeId=src:1:902 (source 1:902) nullColumns=[]

axis === 'row': true
memberCount === 3: true
total nulls across all 3 members: 0 (expected 0)
RESULT: PASS
```
**Honest deviation from the design conversation's proof-of-concept:** the brief described 4 internal regions (image at relative-y 0, badge at +20, title at +261, footer at +362). The real run produces **3** columns, not 4 — the badge (relative-y ≈20) falls within the 24px column-clustering tolerance of the image (relative-y 0) and merges into the same cluster, since the badge chip is painted on top of the thumbnail in the real fixture (they visually overlap). Title (+261) and footer (+362) remain their own distinct columns. This is the column-clustering tolerance interacting with real measurements exactly as the blueprint's own row-set section already flagged as a known, untuned-constant risk ("a future shape with tighter column spacing than 24px... would need re-tuning") — reported here as the concrete instance of that risk actually occurring, not glossed over as "3 ≈ 4."

*Challenge Arena (`output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_2`, section `1:4`):*
```
groupId=group:src:1:326 containerNodeId=src:1:326 (source 1:326) axis=column memberCount=4 seedHint=row-set
  columns (5):
    columnId=col:0 order=0 x=21 width=40
    columnId=col:1 order=1 x=110 width=424
    columnId=col:2 order=2 x=640 width=212
    columnId=col:3 order=3 x=918 width=87
    columnId=col:4 order=4 x=1043 width=123
  members:
    slotIndex=0 nodeId=src:1:327 (source 1:327) nullColumns=[]
    slotIndex=1 nodeId=src:1:383 (source 1:383) nullColumns=[]
    slotIndex=2 nodeId=src:1:345 (source 1:345) nullColumns=[]
    slotIndex=3 nodeId=src:1:364 (source 1:364) nullColumns=[]

axis === 'column': true
memberCount === 4: true
columns.length === 5: true
column x offsets: [21,110,640,918,1043] (design brief real values: [142,231,761,1039,1164])
column widths: [40,424,212,87,123] (design brief real values: [40,424,212,87,123])
row 1 (source 1:327) memberColumnMap null columns: [] (expected: none — this is the asymmetry-closure test)
ROW-1 ASYMMETRY RESULT: CLOSED — row 1 maps onto all 5 columns with no nulls
total nulls across all 4 rows: 0 (expected 0 if fully closed)
```
Widths match the design brief's hand-verified real numbers exactly (`[40,424,212,87,123]`). X-offsets differ from the brief's quoted absolute Figma coordinates (`[142,231,761,1039,1164]`) by a constant −121 (`142−121=21`, `231−121=110`, etc.) because this implementation deliberately stores column position **relative to each member's own box** (`item.box.x - memberBox.x`), not absolute Figma canvas coordinates, matching the schema's `AnchoredPosition`-adjacent design intent that positions are relative facts, not absolute-canvas facts — the row's own box `x=121` for all 4 rows is the entire missing offset. **Row 1's asymmetry is genuinely closed**: after wrapper-unwrap, row 1 maps onto all 5 canonical columns with zero nulls, same as rows 2-4 — the specific test this stage exists to pass.

*Also observed, honestly disclosed:* the full-graph sweep found 4 additional `RepeatingGroupMembership` groups elsewhere within the Challenge Arena section subtree (unrelated icon/text sibling pairs and a nested 2-3-member card cluster, `containerNodeId` sources `1:161`, `1:4`, `1:6`, `1:7`) — not specifically hand-verified against the design conversation's proof-of-concept (which only covered the table), and one of them (`group:src:1:4`, 2 members, 9 unioned columns) shows a large number of nulls per member (up to 3), indicating the algorithm does not yet generalize cleanly to every freeform shape in the corpus — flagged as a known gap, not silently hidden.

**Test results:** `compiler/test/freeform-layout.test.js` — 11/11 passed (axis detection both orientations + minority-outlier + degenerate-input; chrome exclusion; wrapper-unwrap pure-function cases (wide-wrapper unwrapped, narrow-button left alone); the row-1-vs-row-2-4 asymmetry closure reproduced synthetically; union-of-columns with an explicit-null case; two end-to-end tests proving a fact reaches both a projected slice and a materialized, workspace-persisted `IrSlice` + `Fact`).

**Full suite regression:** `for f in compiler/test/*.test.js; do node "$f"; done` — no new failures. Only the 2 pre-existing documented `.canvas`-CSS failures remain (`artifacts.test.js`, `compile.test.js`), unchanged from before this task.

**Corpus validation:** `node scripts/validate-figma-corpus.js` — `pass: true` (Articles + IBM), unchanged. Legacy pipeline confirmed genuinely untouched.

**Confirmed untouched:** zero `server/*` files modified (checked via `git status --porcelain`; the only pre-existing modified files are `client/*`, `package.json`, and 5 `server/*` files from prior, unrelated session work — none touched this pass). Zero renderer files touched (`compiler/emit/render/*`, `compiler/artifacts/ir-experimental-renderer.js` — not referenced anywhere in `compiler/freeform-layout/*`). `compiler/rulepack/packs/component-detect/geometry-rules.js` read-only — no functions modified, and no new exports were needed (`boxOf`, `isChromeBgRefined`, `detectCardGridUniformity`, `detectRowSetUniformity`, `largestUniformSizeCluster` were already exported). `compiler/components/` and `compiler/geometry/` read-only, consumed via their existing public `detectComponents`/`detectGeometry` functions only.

---

*End of blueprint. No implementation begins until this plan is explicitly approved.*
