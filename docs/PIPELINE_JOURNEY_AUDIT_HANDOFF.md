# Figma → HTML/CSS Pipeline — Journey, Implementation & Audit Handoff

| Field | Value |
|-------|--------|
| **Branch** | `feat/offline-snapshot-cache` |
| **Product** | stripmine — paste Figma URL → get HTML + CSS + preview |
| **Audience** | External audit (e.g. Claude) + engineering handoff |
| **Date** | 2026-07-24 |
| **Related docs** | `docs/LAYOUT_PIPELINE_ROOT_CAUSE.md`, `docs/STAKEHOLDER_FIGMA_SCALE_MODEL.md`, `docs/COMPILER_PIPELINE.md`, `docs/EVENT_CARD_COMPONENT_STANDARD.md` |

---

## 0. Why this document exists

We built a large converter pipeline on a **separate branch**. Output quality is still uneven on real Figma sections (HackSpace event card, Incentives / Premium Rewards grid). We need an independent audit of:

1. Whether the **architecture / approach** is sound for 100+ Figma URLs  
2. What we **implemented** vs what still **fails**  
3. Whether we should **double down**, **pivot**, or **narrow the product promise**

**Product requirement (unchanged):**  
User pastes a Figma URL → always receives generated HTML + CSS (and preview). No per-section hand CSS as the scale plan.

---

## 1. Product goal (beginning → now)

### Beginning (intent)

| Goal | Description |
|------|-------------|
| Input | Figma design URL (+ token / OAuth) |
| Output | Self-contained static site: `index.html`, `styles.css`, `script.js`, `assets/` |
| Scale | Work across **100+ Figma files / sections** without hand-tuning each one |
| Quality | Visually close to Figma; preferably semantic / responsive HTML |

### Now (actual promise we aligned to)

| Promise | Detail |
|---------|--------|
| **Always** return HTML/CSS on successful convert | Never withhold code because “not production-ready” |
| Modes under the hood | `auto` (default → standard/flex), `standard` (flex recovery), `pixel` (absolute QA) |
| Quality scorecard | Grade A/B/C + warnings on every convert |
| Scale strategy | Fix failure *classes* in pipeline + promote repeated patterns to design-system — not section-by-section Desktop edits |

---

## 2. Pipeline architecture (what Claude should audit)

### 2.1 End-to-end flow

```text
Figma URL
  → parse fileKey / nodeId
  → Budget / auth (PAT or OAuth)
  → Snapshot cache (HIT / MISS / SUBTREE)
  → Fetch document (geometry=paths when possible)
  → Asset plan (image fills, PNG for nodes, SVG reconstruct / fallback)
  → analyze() [server/figma-build.js]
       • nodeDecls (fills, strokes, AL→flex, freeform→absolute)
       • inferFlow (1D stacks → flex)
       • forceContentFlexStacks (standard: icon/title/body → flex column)
       • inferColumnFlex (scored freeform → columns; LINE → border)
       • EventCard semantics stamp (optional promote)
       • demoteFalseButtons (decorative rect ≠ <button>)
  → compile() [compiler/] Raw → NDG → TokenIR / SemanticIR / A11y / EmitPlan
       • applyPlanToTree (tags, tokens, a11y)
  → emit HTML/CSS
       • Promoted EventCard path OR layer dump with BEM-ish classes
  → packageSite (download assets, write output/<slug>/)
  → API response: html, css, previewUrl, layoutReport.quality
```

### 2.2 Key modules

| Module | Role |
|--------|------|
| `server/index.js` | HTTP convert API, orchestrates cache + compile |
| `server/figma-fetch.js` | Figma REST (nodes, images, SVG export) |
| `server/figma-snapshot.js` | Offline snapshot cache |
| `server/figma-generate.js` | `nodeDecls`, `figmaColor`, `reconstructSvg` |
| `server/figma-build.js` | analyze / emit / layout recovery / emit modes |
| `server/figma-event-card-emit.js` | Promoted EventCard HTML/CSS when detected |
| `server/scalability/*` | Budget, planner, executor (Tier-1 cost) |
| `compiler/*` | IR pipeline, TokenIR, SemanticIR, EmitPlan |
| `design-system/event-card/` | Owned EventCard React + CSS |
| `client/src/App.jsx` | UI: URL → Generate → preview + quality chip |

### 2.3 Emit modes

| Mode | Behavior | When to use |
|------|----------|-------------|
| **`auto`** (default) | Resolves to **`standard`** | Normal user path |
| **`standard`** | AL→flex; freeform recovery; content stacks→flex; EventCard promote | Want d-flex / less absolute |
| **`pixel`** | Preserves freeform **absolute** for artboard QA | Visual QA only — **not** production flex |

**Important UX bug we hit:** Users selecting `pixel` expected flex; `pixel` intentionally keeps absolute. Labels were updated to say “absolute only (QA)”.

### 2.4 Emit adapter versions (recent fidelity work)

| Version | Intent |
|---------|--------|
| `emit-modes-v6…` | EventCard image handling |
| `v7` | EventCard color chrome (later rolled back inventing) |
| `v8` | Figma-faithful EventCard tokens |
| `v9` | URL→HTML always + auto emit + quality scorecard |
| `v10` | Incentives paint opacity / false buttons / SVG bbox |
| `v11` | Flex stacks (icon parent coords + forceContentFlexStacks) |
| `v12` | Icon PNG fallback + per-item margin-top spacing |

---

## 3. Journey — what we implemented (chronological)

### Phase A — Foundation (pre / early branch)

- Figma URL convert → HTML/CSS generator  
- Snapshot / offline cache to reduce REST cost  
- Scalability shell: budget, planner, executor  
- Compiler IR path (NDG → tokens / semantic / emit plan)  
- Client UI for Generate + preview  

### Phase B — Layout root cause (HackSpace event card)

**Problem:** Freeform Figma **Group** (no Auto Layout) → absolute collage; dividers as LINE overlays; mobile “reflow” looked wrong.

**Implemented:**

- Documented root cause: `docs/LAYOUT_PIPELINE_ROOT_CAUSE.md`  
- `emitMode`: `pixel` vs `standard`  
- Scored `inferColumnFlex` (threshold ~0.75)  
- Vertical LINE → `border-right` instead of absolute overlay  
- `layoutReport` warnings (`FREEFORM_GROUP`, `FREEFORM_RECOVERY`, …)  
- Budget soft-limit UX fixes (avoid accidental `refresh:true`)  

### Phase C — EventCard promotion

**Problem:** Layer dump (`group-1171276007`) not reusable for large apps.

**Implemented:**

- Spec: `docs/EVENT_CARD_COMPONENT_STANDARD.md`  
- DS: `design-system/event-card/`  
- `applyEventCardSemantics()` + `emitPromotedEventCard()`  
- Image URL packaging / SVG data-URI fallbacks for thumbs  

**Side effect:** Promoted CSS sometimes **invented** chrome (gray panels, borders) that diverged from Figma → later corrected to “Figma as source of truth; don’t invent styles.”

### Phase D — Scale model / product clarity

**Problem:** Fixing section-by-section doesn’t scale to 100+ URLs.

**Research conclusion (industry-aligned):**

- Locofy / Anima / Builder succeed with **Auto Layout + components**  
- Freeform Groups cannot reliably become production flex for all files  
- Split **pixel QA** vs **production/flex** internally; user still gets HTML always  

**Implemented docs:**

- `docs/STAKEHOLDER_FIGMA_SCALE_MODEL.md` — UX stays URL→HTML/CSS; gates/scorecard internal  

**Implemented code:**

- Default `emitMode: auto` → standard  
- `layoutReport.quality` (`grade`, `summary`, `alwaysReturnsHtmlCss`)  
- UI quality chip  

### Phase E — Incentives section fidelity (current battle)

**Fixture:** “THE INCENTIVES / Premium Rewards” dark section with 5 glass cards + colored icons (Figma) vs broken generated output.

**Bugs found & patched (pipeline):**

| Bug | Cause | Fix direction |
|-----|--------|----------------|
| White solid cards / invisible white text | TokenIR bound opaque `rgb(255,255,255)` over translucent `rgba` / `paint.opacity` | Preserve opacity in token detect; don’t replace rgba with opaque token |
| Card surfaces as `<button>` | Semantic/emit plan promoted decorative rectangles | `demoteFalseButtons` / skip chrome names |
| Black / empty icons | `reconstructSvg` bbox-only or missing geometry → empty `data-figma-kind=vector` div; vectors excluded from PNG | Treat non-reconstructable vectors as **PNG `<img>`**; planner PNG includes failures |
| Absolute text inside “flex” parents | `inferFlow` skipped stacks containing SVG; icons called `nodeDecls(node, false)` → no left/top | Pass real parent; allow svg/img in stacks; `forceContentFlexStacks` |
| Averaged flex `gap` | Icon→title and title→body gaps averaged | Per-item `margin-top` from Figma Y deltas |
| User on `pixel` mode | Absolute preserved by design | UI copy + auto never picks pixel |

---

## 4. Issues — beginning vs right now

### 4.1 Beginning (first painful symptoms)

| Area | Symptom |
|------|---------|
| Layout | Absolute positioning everywhere; “not responsive” |
| Dividers | LINE layers misaligned after any reflow |
| Event card | Offline / Register alignment drift |
| Process | Desire to fix each screenshot by editing Desktop HTML/CSS |
| Scale fear | “We have 100+ Figma URLs — can’t do this per section” |

### 4.2 Right now (after many pipeline fixes — still open)

| Area | Symptom | Severity |
|------|---------|----------|
| **Icons (Incentives)** | Empty vector placeholders or missing trophy/bolt/medal vs Figma | **High** — visual fail |
| **Spacing / alignment** | Card internal rhythm still off vs Figma; header/grid balance imperfect | **High** |
| **Absolute remains** | Page shell / card chrome / unrecovered freeform still absolute; only some stacks become flex | **Medium** — expected for freeform, confusing to users |
| **Mode confusion** | Selecting `pixel` produces absolute; users think all modes should be flex | **Medium** (UX) |
| **Quota / cache** | Force refresh needed for new assets; Tier-1 limits; stale Desktop copies | **Medium** (ops) |
| **Promoted components vs fidelity** | EventCard promote helps structure but can diverge if DS invents styles | **Medium** |
| **100+ file SLA** | Still no guarantee freeform pages look production-ready | **Strategic** |

### 4.3 What improved (honest wins)

- Glass card fill often correct (`rgba(255,255,255,0.1)`) after opacity/token fixes  
- Content order in cards can be flex column (icon → title → body) under `standard`  
- EventCard promote path exists for repeated card pattern  
- Quality scorecard + warnings explain freeform / recovery  
- False `<button>` on full-bleed rectangles reduced  
- Clearer product stance: URL→HTML always; don’t invent Figma chrome  

---

## 5. Approaches we tried (for audit judgment)

| Approach | What it is | Result |
|----------|------------|--------|
| **A. Absolute export** | Faithful X/Y from Figma | Good QA; bad responsive / “absolute approach” complaints |
| **B. Heuristic flex recovery** | `inferFlow`, `inferColumnFlex`, `forceContentFlexStacks` | Helps some stacks; fails/partial on complex freeform; can invent layout |
| **C. Emit modes** | pixel vs standard vs auto | Correct split; users still pick wrong mode |
| **D. Design-system promote** | EventCard BEM template | Good for reuse; risk of inventing styles ≠ Figma |
| **E. Token / semantic IR** | Compiler bindings | Can **regress** paint (opaque token over rgba) if not careful |
| **F. Industry-aligned scale** | AL contract + component map + scorecard | Documented; only partially enforced in code |
| **G. Per-section Desktop fixes** | Edit `Desktop/17-07-26` | Explicitly rejected as scale strategy |

### Core tension (please audit this)

```text
User wants: any Figma URL → flex-like, pretty, production HTML
Figma often gives: freeform Groups + absolute boxes + vector icons without usable local paths
Pipeline: heuristics + promote + tokens
```

**Question for auditor:** Is the right end-state:

1. **Narrow promise** — pixel-perfect preview OR production only when Auto Layout + components, or  
2. **Double down on heuristics** — keep inventing flex/icons for freeform forever, or  
3. **Hybrid** — always HTML; grade quality; promote only known patterns; require AL for “productionReady=true”?

We currently lean **(3)** on paper; implementation still fights freeform Incentives/HackSpace cases with heuristics **(2)**.

---

## 6. Test fixtures & evidence

| Fixture | Path / note |
|---------|-------------|
| Event card (HackSpace) | Freeform group ~610×123; EventCard promote tests in `server/scalability/test/standards-emit.js` |
| Incentives section | User Desktop `17-07-26/index.html` + `styles.css`; Figma node ~`50:192` “Elevate” |
| Figma source of truth | Dark glass cards + colored icons; generated often missing icons / wrong spacing |

**Standards tests:** `node server/scalability/test/standards-emit.js` (emit modes, recovery, EventCard, content flex stack).

---

## 7. Roadmap (suggested next — for auditor challenge)

### Near-term (fidelity classes)

1. **Icons:** Prove PNG/SVG fallback on live Incentives convert with Force refresh; no empty `data-figma-kind=vector`  
2. **Spacing:** Validate per-item `margin-top` against Figma measurements  
3. **Mode UX:** Default + warn hard if user selects `pixel` while asking for flex  
4. **Stale output:** Clear guidance that Desktop copies ≠ live `output/<slug>/`  

### Mid-term (scale)

5. Enforce **quality gates** in UI (still return HTML, but mark productionReady honestly)  
6. Catalog top 10–20 section patterns → promote (IncentiveCard, Hero, …)  
7. Design **Definition of Done**: Auto Layout on section/card frames for productionReady  

### Strategic decision needed

8. Accept that **freeform artboards will never be Locofy-grade production** without Figma contract — or invest heavily in heuristics knowing SLA will slip  

---

## 8. Files / areas to read first (for Claude audit)

```text
docs/LAYOUT_PIPELINE_ROOT_CAUSE.md
docs/STAKEHOLDER_FIGMA_SCALE_MODEL.md
docs/EVENT_CARD_COMPONENT_STANDARD.md
server/figma-build.js          # analyze, inferFlow, forceContentFlexStacks, emit modes
server/figma-generate.js       # paints, reconstructSvg, isBBoxRectPath
server/figma-event-card-emit.js
compiler/artifacts/apply-plan.js  # tokens, demoteFalseButtons
server/scalability/planner.js     # SVG missing → fetch; PNG ids
client/src/App.jsx                # emitMode UX
server/scalability/test/standards-emit.js
```

---

## 9. Audit questions (please answer explicitly)

1. Is **URL → always HTML/CSS** compatible with **100+ freeform Figma files** at acceptable quality, or must production be gated on Auto Layout?  
2. Are **heuristic flex recoveries** a liability (silent wrong layout) more than a help?  
3. Should **promoted components** be the primary production path (detect → DS), with raw emit only for preview?  
4. Did **TokenIR / SemanticIR** create more regressions (paint, false buttons) than value for this product stage?  
5. What would you **delete or freeze** on this branch to reduce thrash?  
6. Given Incentives icons/spacing still fail after v10–v12, is the next bet **asset pipeline** (PNG/SVG), **Figma authoring rules**, or **stop freeform production claims**?  

---

## 10. One-sentence summary for the auditor

**We built a full Figma→HTML pipeline with cache, IR, emit modes, flex heuristics, and EventCard promotion on `feat/offline-snapshot-cache`, but freeform sections (especially Incentives icons/spacing and residual absolute layout) still miss Figma fidelity—and we need an outside judgment on whether to gate production on Auto Layout + components or keep expanding heuristics.**

---

*End of handoff. Please audit architecture, failure modes, and recommended next bets—not only local CSS patches.*
