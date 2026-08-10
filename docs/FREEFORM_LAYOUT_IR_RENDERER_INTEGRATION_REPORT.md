# Freeform Layout IR — Renderer Integration Report

Wires `freeform-layout-ir`'s `RepeatingGroupMembership` facts
(`compiler/freeform-layout/*`, `docs/COMPILER_MIGRATION_BLUEPRINT.md` §10)
into `compiler/artifacts/ir-experimental-renderer.js` and
`compiler/emit/render/css-declarations.js`. Reached ONLY via
`emitArtifacts({ renderer: 'ir-experimental' })` — same opt-in gate every
prior capability in this codebase uses. Validated against all 3 real cached
fixtures under `output/figma-cache/` (Articles, IBM, Challenge Arena).

Companion diagnostic script (read-only, does not modify anything):
`scripts/validate-freeform-renderer-integration.js`. Raw generated output for
each fixture is saved at `output/freeform-render-{articles,ibm,challengearena}.{html,css}`
and a CSS-inlined single-file version at `...-combined.html` (used for the
real-browser verification in section (e) below).

---

## Files touched

**New:**
- `scripts/validate-freeform-renderer-integration.js` — read-only diagnostic, mirrors `scripts/validate-row-set-render.js`'s/`scripts/validate-freeform-layout-ir.js`'s pattern, extended to run all 3 fixtures through both `detectFreeformLayout()` and `renderIrExperimental()`.
- `compiler/test/freeform-render-integration.test.js` — 2 end-to-end tests against the real `renderIrExperimental()` pipeline (synthetic repeating-card doc + synthetic non-repeating doc).
- `docs/FREEFORM_LAYOUT_IR_RENDERER_INTEGRATION_REPORT.md` — this file.

**Modified:**
- `compiler/artifacts/ir-experimental-renderer.js` — new `classifyFreeformMember` function (generalizes `classifyRowSetRow`/`subtreeContainsMember` to the `RepeatingGroupMembership` schema); `detectFreeformLayout` call wired into `renderIrExperimental`; row-set fact collection filtered by mutual exclusion against freeform-claimed node ids; `buildRenderNode` extended with `freeformGroupFact`/`freeformMemberFact`/`isFreeformPassthrough`/`isFreeformChromeHidden`/`isFreeformGridItem`/`freeformPlacement` lookups and the corresponding `layoutChoice` fields.
- `compiler/emit/render/css-declarations.js` — new `freeformGroupContainerDecls`, `freeformGroupMemberDecls`, `freeformChromeHiddenDecls`, `freeformPassthroughDecls`, `freeformGridPlacementDecls`, wired into `buildDecls()`'s overlay chain (layered last, so they take precedence over both generic mode decls and the row-set decls for the same node/property).
- `compiler/test/render.test.js` — 15 new unit/precedence/end-to-end tests for the above.

**Confirmed untouched:** zero `server/*` files touched this pass (`git status --porcelain` shows the same 5 pre-existing modified `server/*` files from prior, unrelated session work — none of them re-touched). `compiler/freeform-layout/*` (the detection stage itself) was read-only reference — only its already-exported `detectFreeformLayout` function was called, no internals modified. `compiler/rulepack/packs/component-detect/geometry-rules.js` read-only (only its already-exported `boxOf`/`isChromeBgRefined` are reused, same as the pre-existing row-set wiring already did). Zero Challenge-Arena-specific node IDs or shapes are hard-coded anywhere in `compiler/` — every branch is keyed off the fact's own `axis`/`columns`/`memberColumnMap` fields, generically.

---

## Design summary

- **Container** (`freeformGroupContainer`): `display:grid` + `grid-template-rows` (axis:`row`) or `grid-template-columns` (axis:`column`) built directly from the fact's `columns` (`px(width)` per column, joined). Since the container's own children (the members) are always forced to the renderer's existing absolute-fallback positioning (see below), this grid declaration is declarative/inert with respect to member arrangement — an absolutely-positioned child is removed from grid flow by the CSS spec, so it does not risk resurrecting the already-fixed document-order-vs-visual-order bug the row-set precedent found. It is still emitted, as directed, so the container carries the same literal track definition its members repeat.
- **Member** (`freeformGroupMember`): the member becomes its OWN CSS Grid with the same track string (byte-identical across every member — the actual cross-member-alignment mechanism, same idiom `rowSetRowDecls` already validated). If the member has a chrome background (found read-only via `isChromeBgRefined`, same helper the row-set path already uses), its color is lifted onto the member and all 4 padding sides are zeroed (same reasoning as `rowSetRowDecls`).
- **Grid item placement** (`freeformGridPlacement`): each resolved column leaf (`memberColumnMap[columnId]`) gets an explicit `grid-column`/`grid-row` (axis-dependent), not left to auto-flow — necessary because a member can genuinely be missing a column (explicit `null`).
- **Pass-through / chrome-hidden** (`freeformPassthrough`/`freeformChromeHidden`): intermediate wrapper nodes on the path from a member down to a resolved leaf get `display:contents`; the member's own chrome rectangle gets `display:none` (color already lifted onto the member) — same idioms as the row-set precedent, re-derived read-only via the new `classifyFreeformMember`.
- **Fallback guarantee**: if `node.id` matches no `freeform-layout-ir` group (container or member), none of the 5 new `layoutChoice` fields are set, and every existing branch (row-set, card/banner chrome, coordinate fallback) runs unchanged — proven by `render.test.js`'s `buildDecls` "no freeform* fields" regression test (byte-identical decl list) and `freeform-render-integration.test.js`'s full-pipeline non-repeating-document test.
- **Mutual exclusion with row-set**: `rowSetFacts` whose container node id is already claimed by a `freeform-layout-ir` group (container or member) are filtered out before the row-set maps are built, so the two mechanisms never both fire on the same node — the generalized mechanism supersedes the narrower one wherever it actually covers a node, per the task's explicit framing.

### A real gap this wiring exposed, and how it was resolved (not Challenge-Arena-specific)

`detectFreeformLayout` walks every parent in the graph unconditionally, so nested/overlapping groups are possible — and the STATUS note in the blueprint already disclosed one such overlap-prone group for Challenge Arena (`group:src:1:4`, "does not yet generalize cleanly", up to 3 nulls per member). Wiring the renderer against the real fixture surfaced the concrete consequence: a table row that is a clean member of its own zero-null group (`1:326`) was ALSO being picked up as a plain column-leaf value inside `group:src:1:4`'s `memberColumnMap` (an unrelated ancestor group). Naively consuming both facts caused two conflicts on the very same node: (1) an extra, meaningless `grid-row` placement landing on a node that is already its own grid, and (2) — the load-bearing one — the row being wrongly *excluded* from the coordinate-absolute fallback it needs for correct real-Y stacking (since "must stay in-flow for its grid" was applied using the WRONG, outer grid).

This was fixed with a general precedence rule in the renderer (not a change to `compiler/freeform-layout/detect.js`, and not gated on any Challenge-Arena-specific id): a node that is itself the container or a member of ANY `freeform-layout-ir` group is never also treated as a plain leaf grid-item of a DIFFERENT group's `memberColumnMap` — innermost/most-specific group role wins. This is a rendering-time consumption policy (which of two potentially-overlapping, already-resolved facts to honor for a given node), not a re-derivation of structure, so it stays within the "renderer must stay dumb" mandate. It generalizes to any future corpus fixture with overlapping groups, not just this one.

---

## Per-fixture results

### Articles (`output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_848`)

**(a) Detected groups** (`detectFreeformLayout`, unchanged from §10's already-validated output):

```
group=group:src:1:849 axis=row memberCount=3 columns=3 seedHint=null totalNulls=0   <- the 3-card grid
group=group:src:1:866 axis=row memberCount=2 columns=0 seedHint=null totalNulls=0   <- trivial 2-item pair, no internal columns
group=group:src:1:908 axis=row memberCount=2 columns=0 seedHint=null totalNulls=0   <- trivial 2-item pair, no internal columns
```

**(b) Renderer decision tier:** `1:849`'s container and its 3 members all hit the **freeform-layout-ir fact tier** (`freeformGroupContainer`/`freeformGroupMember`). Component IR's `cardGridPatterns`/`rowSetPatterns` are both empty for this fixture (confirmed again — the documented reason: Articles' thumbnail covers only ~56% of the card height, failing `isChromeBgRefined`'s chrome test), so there was nothing for the row-set/card-grid fallback tiers to have claimed anyway — this fixture would previously have gotten **zero** renderer-side grouping at all. The 2 trivial 2-item groups have 0 columns, so their decls functions return `[]` (no-op) — they resolve to the plain coordinate/absolute fallback tier, unaffected.

**(c) Real generated HTML** (`output/freeform-render-articles.html`):

```html
<div class="group-15">
  <div class="rectangle-5"></div>
  <div class="frame-1171277492">
    <p class="ai-engineering">AI Engineering</p>
  </div>
  <div class="group-1171277909">
    <div class="frame-1171277493">
      <p class="bob-agent">@ BOB_AGENT</p>
      <div class="ellipse-152"></div>
```

Real generated CSS for the container and all 3 members (`output/freeform-render-articles.css`):

```css
.group-1171277963 {
  display: grid;
  flex-direction: row;
  align-items: center;
  min-height: 539px;
  grid-template-rows: 231px 88px 51px;
  box-sizing: border-box;
  position: relative;
}
.group-15 {
  position: absolute; left: 0px; top: 126px; width: 381px; min-height: 413px;
  display: grid; grid-template-rows: 231px 88px 51px; align-items: center;
  box-sizing: border-box;
  padding-top: 0px; padding-right: 0px; padding-bottom: 0px; padding-left: 0px;
}
.group-16 { /* left: 407px, otherwise byte-identical grid-template-rows */ }
.group-17 { /* left: 815px, otherwise byte-identical grid-template-rows */ }
```

(`flex-direction: row` on the container is an inert leftover of the base `modeDecls()` mode string that the grid overlay does not clear — harmless because `flex-direction` has no effect once `display:grid` wins; this exact leftover shape is already present in the blueprint's own previously-validated row-set CSS, so it is a pre-existing, accepted cosmetic artifact, not something newly introduced here.)

**(d) CSS diff vs. pre-integration output:** none exists to diff against — Component IR never produced a `cardGridFacts`/`rowSetFacts` container fact for this fixture (see (b)), and the renderer never consumed `cardGridPatterns` even when present, so **no renderer-side grouping mechanism reached this fixture's card-grid before this task**. The `grid-template-rows`/per-card grid output is entirely net-new, not a modification of prior bytes.

**(e) Visual verification:** no headless-screenshot tool is available in this environment, but the `mcp__Claude_Browser` tool IS available, so real `getBoundingClientRect()` box relationships were captured (same substitute methodology the row-set section's own STATUS note used), loading `output/freeform-render-articles-combined.html` (CSS inlined) and flattening `display:contents`/filtering `display:none` exactly as a browser's grid box-generation algorithm does:

```
card group-15 (left=0,  top=126, width=381): bands topRel/height = 0/231, 104/24, 231/88, 319/51
card group-16 (left=407,top=126, width=381): bands topRel/height = 0/231, 104/24, 231/88, 319/51
card group-17 (left=815,top=126, width=381): bands topRel/height = 0/231, 104/24, 231/88, 319/51
```

All 3 cards' 4 real content bands land at byte-identical relative Y-offsets and heights — confirms the cross-card alignment this stage exists to provide is real in an actual rendered layout, not just plausible from reading CSS text. (The `104/24` band is the badge, landing inside the same 231px row-track as the image at `0/231` — matches the already-disclosed "badge merges with image within tolerance" finding: `align-items:center` centers the 24px badge inside the shared 231px track, `(231-24)/2 ≈ 104`.)

**(f) Improvements:** Articles' 3-card grid previously received **no** renderer-side structural grouping at all (row-set only covered Component IR's narrower `rowSetFacts`, which never fired here); it now gets a real, verified, cross-card-aligned CSS Grid.

**(g) Regressions:** none found. Checked via: full `compiler/test/*.test.js` suite (same 2 pre-existing `.canvas`-CSS failures only, see Test Results below); `node scripts/validate-figma-corpus.js` → `pass: true` unchanged for `articles`; `git status --porcelain` shows zero new `server/*` modifications.

**(h) Unknown/unhandled:** the 2 trivial 2-item groups (`1:866`, `1:908`) have 0 columns and contribute no visible change (empty decls) — not specifically hand-verified beyond "doesn't crash, doesn't emit anything."

**(i) Verdict: PASS** — freeform-layout-ir fact fired for the card-grid, 0 nulls, real cross-card-verified grid alignment, no regression to the existing corpus gate.

---

### Challenge Arena (`output/figma-cache/c0kt3mp76RoEiq3CFoeCHa__1_2`, section `1:4`)

**(a) Detected groups:**

```
group=group:src:1:161 axis=row    memberCount=3 columns=2 seedHint=null    totalNulls=0
group=group:src:1:326 axis=column memberCount=4 columns=5 seedHint=row-set totalNulls=0   <- the table
group=group:src:1:4   axis=row    memberCount=2 columns=9 seedHint=null    totalNulls=5   <- already-disclosed gap (§10)
group=group:src:1:6   axis=row    memberCount=2 columns=4 seedHint=null    totalNulls=0
group=group:src:1:7   axis=row    memberCount=3 columns=2 seedHint=null    totalNulls=0
```

**(b) Renderer decision tier:** the table (`1:326`) and its 4 rows hit the **freeform-layout-ir fact tier**. Confirmed via the diagnostic's mutual-exclusion check: Component IR's `rowSetPatterns` still fires for this same container (1 pattern), but is explicitly **SUPERSEDED** (filtered out before the row-set maps are built) — the row-set-specific tier did not fire for this run. The narrower row-set mechanism remains wired and available as a deeper fallback (rule #1 — nothing removed) but is provably dormant for this fixture post-integration.

**(c) Real generated HTML** (`output/freeform-render-challengearena.html`):

```html
<div class="table">
  <article class="group-1171278042">
    <div class="rectangle-34624617"></div>
    <div class="group-1171278044">
      <p class="n-001">001</p>
      <div class="frame-1171277998">...</div>
      <div class="group-1171278040">...</div>
      <div class="group-1171278041">...</div>
      <div class="frame-1171277510">
        <p class="register-now">Register Now</p>
      </div>
    </div>
  </article>
  <div class="group-1171278044-2">
    <div class="rectangle-34624617"></div>
    <div class="group-1171278044">
      <p class="n-001">003</p>
      ...
```

Real generated CSS for all 4 rows (`output/freeform-render-challengearena.css`):

```css
.group-1171278042 {
  position: absolute; left: 0px; top: 49px; width: 1196px; min-height: 177px;
  display: grid; flex-direction: column; align-items: center; box-sizing: border-box;
  padding-top: 0px; padding-right: 0px; padding-bottom: 0px; padding-left: 0px;
  grid-template-columns: 40px 424px 212px 87px 123px;
}
.group-1171278043 {
  position: absolute; left: 0px; top: 226px; width: 1196px; min-height: 177px;
  display: grid; grid-template-columns: 40px 424px 212px 87px 123px; align-items: center;
  box-sizing: border-box;
  padding-top: 0px; padding-right: 0px; padding-bottom: 0px; padding-left: 0px;
  background-color: rgba(172, 200, 251, 0.3);
}
.group-1171278044-2 { /* top: 403px, byte-identical grid-template-columns */ }
.group-1171278045   { /* top: 580px, byte-identical grid-template-columns */ }
```

Explicit grid-column placements found in the full CSS: `grid-column: 1;` through `grid-column: 5;` (row 1's 5 unwrapped columns) plus `grid-column: 2;`/`grid-column: 5;` (rows 2-4's shared class, deduped by signature — same value at the same position across rows 2-4 collapses to one rule, same dedupe behavior the pre-existing row-set END-TO-END test already exercises).

**(d) CSS diff vs. pre-integration output — a real byte-for-byte comparison exists here** (unlike Articles/IBM), because the blueprint's "Row-set renderer wiring" section already quotes the exact pre-integration CSS the OLD, narrower `rowSetFacts` mechanism produced for these same 2 classes:

```
Pre-integration (row-set-only, quoted verbatim from docs/COMPILER_MIGRATION_BLUEPRINT.md):
.group-1171278042 { position:absolute; left:0px; top:49px; width:1196px; min-height:177px;
  display:grid; flex-direction:column; align-items:center; box-sizing:border-box;
  padding-top:0px; padding-right:0px; padding-bottom:0px; padding-left:0px;
  grid-template-columns: 40px 424px 212px 87px 123px; }

Post-integration (freeform-layout-ir mechanism, this task):
.group-1171278042 { position:absolute; left:0px; top:49px; width:1196px; min-height:177px;
  display:grid; flex-direction:column; align-items:center; box-sizing:border-box;
  padding-top:0px; padding-right:0px; padding-bottom:0px; padding-left:0px;
  grid-template-columns: 40px 424px 212px 87px 123px; }
```

**Byte diff: 0.** Same result for `.group-1171278043` (both quote `top:226px`, identical `grid-template-columns`, identical `background-color: rgba(172, 200, 251, 0.3)`). The generalized mechanism reproduces the narrower one exactly for the fixture the narrower one was built against, while additionally covering Articles/IBM's axis:`row` shape the row-set mechanism never handled.

**(e) Visual verification** (via `output/freeform-render-challengearena-combined.html`, real `getBoundingClientRect()`, `display:contents` flattened / `display:none` filtered):

```
row group-1171278042    (top=99):  leaves left/width = 0/40, 40/424, 464/212, 676/87, 763/123
row group-1171278043    (top=276): leaves left/width = 0/40, 40/424, 464/212, 676/87, 763/123
row group-1171278044-2  (top=453): leaves left/width = 0/40, 40/424, 464/212, 676/87, 763/123
row group-1171278045    (top=630): leaves left/width = 0/40, 40/424, 464/212, 676/87, 763/123
```

All 4 rows' 5 real leaf columns land at byte-identical relative left-offsets — the exact alignment guarantee this stage exists to provide, confirmed in an actual rendered layout. Row-to-row vertical spacing is a constant 177px (99→276→453→630), ascending correctly (the original document-order bug this mechanism must avoid).

**(f) Improvements:** the table's alignment guarantee is now provided by the general mechanism instead of a Component-IR-specific one, with byte-identical output — a strict generalization, not a change in behavior for this fixture.

**(g) Regressions:** **none found**, with one caveat that was found and fixed during this same validation pass (see "A real gap..." above) — before the precedence fix, row 1 (`1:327`) was losing its own absolute positioning (because it was incorrectly excluded from the coordinate fallback by an overlapping, already-disclosed-as-flawed outer group, `group:src:1:4`). This was caught by re-running the diagnostic script and inspecting the literal generated CSS (row 1's rule was missing `position:absolute`/`top` entirely on the first attempt), fixed with the general precedence rule described above, and re-verified — the CSS quoted in (d) above is the POST-FIX, correct output. Checked further via: full test suite (no new failures beyond the 2 pre-existing), `node scripts/validate-figma-corpus.js` (`pass:true`, but note this gate does not cover Challenge Arena — see Corpus Validation section below), and `node scripts/validate-freeform-layout-ir.js` re-run to confirm the detection stage itself (untouched) still reports the exact same documented numbers.

**(h) Unknown/unhandled:** `group:src:1:4` (5 nulls across its 2 members) is the same already-disclosed generalization gap from §10 — this task did not attempt to close it (out of scope, and rule #7 prohibits fixture-specific tuning to force it closed). Its 2 members do get `freeformGroupMember`/grid decls (best-effort, non-crashing), but with several `null` columns meaning some of their internal content is not explicitly grid-placed (falls back to plain in-flow/auto-placement within the grid, not lost, just not explicitly positioned) — a graceful degrade, not a crash, but not a fully "closed" case either.

**(i) Verdict: PARTIAL** for the fixture as a whole, precisely because of `group:src:1:4`'s disclosed, unresolved nulls — but **PASS** for the specific case this stage's real-fixture validation targets (the table, `group:src:1:326`): 0 nulls, byte-identical CSS vs. the pre-integration mechanism, browser-verified alignment. Reporting the fixture-level PARTIAL rather than rounding up to PASS, per the task's explicit instruction not to round a PARTIAL up.

---

### IBM (`output/figma-cache/oPJPuHvvZOPo4nkzVxr11M__11_79`)

**(a) Detected groups:**

```
group=group:src:11:643 axis=row memberCount=4 columns=3 seedHint=card-grid totalNulls=0   <- the 4-card grid
group=group:src:11:686 axis=row memberCount=2 columns=0 seedHint=null      totalNulls=0   <- trivial 2-item pair, no columns
```

**(b) Renderer decision tier:** `11:643`'s container and 4 members hit the **freeform-layout-ir fact tier**; `seedHint=card-grid` confirms agreement with Component IR's `cardGridPatterns` (1 detected), which is consulted only as optional cross-reference metadata (never a hard gate, per detect.js's own design). `rowSetPatterns`: 0 (none expected — this fixture has no table shape). No mutual-exclusion supersession needed here (nothing to supersede).

**(c) Real generated HTML/CSS** (`output/freeform-render-ibm.{html,css}`):

```css
.frame-1171277929 {
  background-color: #ffffff; position: absolute; left: 0px; top: 0px; width: 291px; min-height: 435.81px;
  display: grid; flex-direction: column; align-items: center; box-sizing: border-box;
  padding-top: 0px; padding-right: 0px; padding-bottom: 0px; padding-left: 0px;
  grid-template-rows: 142px 12px 106px;
}
.frame-1171277936 { /* left: 302px, byte-identical grid-template-rows */ }
.frame-1171277937 { /* left: 604px, byte-identical grid-template-rows */ }
.frame-1171277938 { /* left: 905px, byte-identical grid-template-rows */ }
```

**(d) CSS diff vs. pre-integration output:** none exists to diff against, same reasoning as Articles — the renderer never consumed `cardGridPatterns` before this task (only `rowSetFacts` had a renderer consumer), so this card-grid grid-template output is net-new.

**(e) Visual verification** (via `output/freeform-render-ibm-combined.html`):

```
card frame-1171277929 (left=122):  bands topRel = 71(h0), 20(h18), 233(h18-37, varies by text length), 148(h0), 207(h0)
card frame-1171277936 (left=424):  bands topRel = 71(h0), 20(h18), 233(h18),           148(h0), 207(h0)
card frame-1171277937 (left=726):  bands topRel = 71(h0), 20(h18), 233(h18),           148(h0), 207(h0)
card frame-1171277938 (left=1027): bands topRel = 71(h0), 20(h18), 233(h18),           148(h0), 207(h0)
```

All 4 cards' bands land at byte-identical relative Y-offsets. Three of the 5 bands report `height:0` (`group-1171277928`, `rectangle-34624594`, `rectangle-34624610`) — these are vector/icon shapes with no explicit box height reaching this minimal-vocabulary renderer, a pre-existing, unrelated limitation of the Phase 3 renderer (documented as an intentional scope reduction, not something this task touched or should fix) — confirmed harmless here since it doesn't block alignment of the real text/content bands.

**(f) Improvements:** IBM's 4-card grid, like Articles', gets real structural grid alignment for the first time via any renderer path.

**(g) Regressions:** none found. Checked the same way as Articles/Challenge Arena: full test suite, `node scripts/validate-figma-corpus.js` → `pass:true` for `ibm` unchanged (`etCard:5`, `etBanner:true`, `etCardGrid:true` — all legacy-gate fields unaffected, since that gate runs the untouched legacy pipeline).

**(h) Unknown/unhandled:** the trivial `group:src:11:686` (0 columns) contributes no visible change, same as Articles' 2 trivial groups.

**(i) Verdict: PASS** — freeform-layout-ir fact fired for the card-grid, 0 nulls, `seedHint` cross-reference agreement with Component IR confirmed, browser-verified cross-card alignment, no regression to the existing corpus gate.

---

## Fallback-tier trigger summary (across all 3 fixtures, this integration pass)

| Tier | Triggered? | Where |
|---|---|---|
| `freeform-layout-ir` fact (new, this task) | **Yes** — 3 real card/table groups (1 per fixture), + 2 further already-disclosed/degenerate groups in Challenge Arena, + trivial 0-column groups in Articles/IBM | Articles `1:849`, Challenge Arena `1:326` (+ `1:4`,`1:6`,`1:7`,`1:161`), IBM `11:643` |
| Row-set fact (`rowSetFacts`, pre-existing) | **No** — provably dormant this pass; the only fixture with a `rowSetFacts` container (Challenge Arena) had it fully superseded | n/a (fallback preserved unused, per rule #1) |
| Card/banner chrome (pre-existing) | **Yes**, unaffected — banner facts still resolve to their own chrome decls (`etBanner:true` in the corpus gate for IBM); individual card chrome facts (`cardFacts`, distinct from the grid-container-level `cardGridPatterns`) are consumed exactly as before | IBM's banner; any standalone card node |
| Raw coordinate/absolute fallback (pre-existing) | **Yes**, still the primary mechanism for every freeform group's own top-level member positioning (forced via `forcedAbsoluteFreeformMember`, generalizing the row-set precedent's `forcedAbsoluteRow`) and for the majority of leaf content not part of any repeating group | All 3 fixtures |

---

## Test results

```
compiler/test/render.test.js:                       45 passed, 0 failed  (30 pre-existing + 15 new)
compiler/test/freeform-render-integration.test.js:    2 passed, 0 failed  (new file, full-pipeline proof)
compiler/test/freeform-layout.test.js:               11 passed, 0 failed  (unchanged — detection stage untouched)
compiler/test/renderer-toggle.test.js:                6 passed, 0 failed  (unchanged — legacy/default path proof)
```

Full suite, `for f in compiler/test/*.test.js; do node "$f"; done`: same 2 pre-existing documented `.canvas`-CSS failures only (`artifacts.test.js`, `compile.test.js`) — nothing newly broken. Every other file passes, including all Phase-numbered suites (kernel, workspace, layout, component-geometry, responsive-render, etc.).

## Corpus validation

`node scripts/validate-figma-corpus.js` → `pass: true` for both `articles` and `ibm`, unchanged (this gate exercises the legacy pipeline via `scripts/recompile-{articles,ibm}-offline.js`, which this task never touches — `renderer: 'ir-experimental'` is a separate, opt-in code path). Challenge Arena is not part of this particular legacy gate's fixture list (it never was, pre-existing scope), so its verdict above rests on the direct `renderIrExperimental()` + browser-verification evidence in this report instead.

`node scripts/validate-freeform-layout-ir.js` re-run post-integration: identical documented numbers (Articles 3-column/0-null PASS, Challenge Arena 5-column/0-null row-1-asymmetry-CLOSED) — confirms the detection stage itself was not regressed by this renderer-side work.

## Confirmation checklist

- [x] `server/*`: zero files touched this pass (`git status --porcelain` — same 5 pre-existing modified files from prior sessions, none re-touched, no new ones).
- [x] Default/`legacy` renderer path: untouched — `compiler/test/renderer-toggle.test.js`'s 3 tests (including the byte-identical default-unchanged proof) pass unmodified; `apply-plan.js`'s use of `buildDecls()` never sets any of the 5 new `layoutChoice` fields, so its output is unaffected by construction (only new, additively-gated overlay branches were added).
- [x] Zero Challenge-Arena-specific special-casing introduced anywhere in `compiler/` — every new branch keys off the fact's own `axis`/`columns`/`memberColumnMap`/node-id-membership, never a hardcoded node id or fixture name. The one genuine engineering judgment call made (container-level grid being declaratively inert for absolutely-positioned members; the group-overlap precedence rule) is documented above as general, not fixture-scoped.
- [x] `compiler/freeform-layout/` (the IR itself): not modified. Its own test suite (`compiler/test/freeform-layout.test.js`, 11/11) and real-fixture validation script (`scripts/validate-freeform-layout-ir.js`) both re-run clean, unchanged from §10's documented numbers.
