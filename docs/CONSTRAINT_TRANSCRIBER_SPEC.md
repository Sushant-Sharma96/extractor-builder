# Constraint Transcriber + Verifier Contract

| Field | Value |
|-------|--------|
| **Status** | General walk implemented — A0–A5 on every freeform container + card/banner/media-overlay specializations |
| **Date** | 2026-07-25 |
| **Replaces** | Heuristic Standards Promotion guessing (lossy absolute→flex) |
| **Preserves** | Absolute oracle as fidelity ground truth; Path B as fallback only |
| **Proof fixtures** | Articles + IBM via `node scripts/validate-figma-corpus.js` |

**One line:** Re-express measured absolute boxes as flex/grid; prove with box-diff; demote smallest failing container — never silently lossy.

Related: [`STAKEHOLDER_FIGMA_SCALE_MODEL.md`](./STAKEHOLDER_FIGMA_SCALE_MODEL.md) (QA bar).

---

## 0. Contract (what every node carries)

| Field | Meaning |
|-------|---------|
| `box` | `{x,y,w,h}` parent-relative from the absolute oracle — **the spec** |
| `kind` | ∈ `{frame, text, image, vector, group}` |
| `chrome` | fill / stroke / radius / shadow / padding — **verbatim** |
| `figmaAL` | if node already has Figma Auto Layout → transcribe AL directly, **never infer** |

The transcriber runs **only** on containers **without** Figma AL.

---

## A. Transcriber — per container, derive layout from measured child boxes

### A0 — filter + sort

- Drop invisible / zero-area.
- Keep layout-bearing children.
- Sort by `(y, then x)`.

### A1 — overlap test (absolute vs flow)

Pairwise overlap. If any two **content** children overlap > `OVERLAP_TOL` (10% of the smaller's area), excluding a single full-bleed background child → container stays **ABSOLUTE** (Path B for this region). Honest fallback, first check.

### A2 — axis detection

For non-overlapping children:

| Pattern | Emit |
|---------|------|
| One horizontal band, tops aligned within `ALIGN_TOL`, L→R | **ROW** |
| One vertical band, left edges aligned within `ALIGN_TOL` | **COLUMN** |
| R≥2 rows × K≥2 cols; every row has K children; column x’s repeat within `ALIGN_TOL`; cells uniform within `SIZE_TOL` | **GRID** |
| Wraps but not a clean matrix | **ROW** + `flex-wrap` (verifier decides) |
| None clean | **ABSOLUTE** |

### A3 — derive measured properties (never average unless proven uniform)

- **padding** = frame content inset:
  - `top = min(child.y)`
  - `left = min(child.x)`
  - `right = C.w − max(child.x + child.w)`
  - `bottom = C.h − max(child.y + child.h)`  
  ← this alone restores card image insets.
- **gap** (main axis): `g_i = next.start − prev.end`
  - If `max(g_i) − min(g_i) ≤ GAP_TOL` → single `gap = median(g_i)`
  - Else → per-item leading margin = exact `g_i` (pinned, not averaged)
  - Prefer single gap when uniform.
- **cross-axis align** from geometry:
  - lefts equal → `flex-start` + padding-left
  - centers equal → `center`
  - right edges equal → `flex-end`
- **sizing**
  - **GRID:** cell widths equal within `SIZE_TOL` → `repeat(K, 1fr)`; else measured column widths. Row/col gap measured.
  - **ROW/COLUMN basis:** siblings equal on main axis within `SIZE_TOL` → equal basis; else each `flex-basis = measured`. Child spanning remainder (banner quote) → `flex: 1 1 <measured>` + `max-width: <measured>`.
  - **cross-axis:** pin to measured unless child is text/hug **and** pinning-vs-hug is verified pixel-neutral. Default = pin.

### A4 — frame preservation (chrome/content fix)

**Never unwrap a frame.** The frame stays as the flex/grid item with chrome verbatim + A3 padding; only its **interior** children are transcribed. Makes chrome uniform across siblings; kills “card-2 has a border, others don’t.”

### A5 — recurse

Depth-first into each child container.

---

## B. Verifier — box-diff tolerance contract

Render the transcribed candidate headless; compare each node’s computed parent-relative box to its oracle box.

**Per-node pass** =

`|Δx| ≤ POS_TOL ∧ |Δy| ≤ POS_TOL ∧ |Δw| ≤ SIZE_TOL ∧ |Δh| ≤ SIZE_TOL`

- **Text nodes:** height may use `TEXT_H_TOL` (web font metrics); **x/y start must still pass**.
- **Region acceptance:** every descendant passes → ship flex. Any failure → demote the **smallest failing container** to ABSOLUTE, not the page.
  - Example: 3 cards pass, 1 fails → demote that card’s interior, keep the grid; grid itself fails → demote the grid.
- Record `demoteReason = {containerId, failingNodeId, Δx, Δy, Δw, Δh}` in the IR.

### Two-phase (Phase-0 temper)

| Phase | What | Role |
|-------|------|------|
| **0a** | Structural box-diff only (above) | **Ship this** — deterministic, no screenshots |
| **0b** | SSIM ≥ 0.95 per region raster | Secondary confirmation once harness stable; box-diff stays primary |

---

## C. Thresholds (named, corpus-calibrated — one config, no inline literals)

| Const | Start | Role |
|-------|-------|------|
| `OVERLAP_TOL` | 10% area | above → absolute |
| `ALIGN_TOL` | 2px | edges “aligned” |
| `GAP_TOL` | 2px | gaps “uniform” → single gap |
| `SIZE_TOL` | 2px / 1.5% | sizes “equal” → 1fr / equal basis + verifier size pass |
| `POS_TOL` | 2px | verifier position pass |
| `TEXT_H_TOL` | 8px (≈1 line) | relaxed text height only |

---

## D. Pipeline order

```text
oracle boxes (Pass 1)
 → transcriber A0–A5 per container, depth-first
 → verifier B per container, bottom-up
 → accept flex OR demote smallest failing container to absolute
 → emit: frames verbatim (chrome) · interiors as measured flex/grid · demoted regions absolute
 → scorecard reads route + demoteReason from IR
```

---

## E. What this deletes (stop the treadmill)

Subsumed by A2–A3 (geometry-derived) + B (verified) — retire after transcriber proves out:

- `stampFeatureCards`
- `inferCardGrids`
- `polishBannerContent`
- `polishSectionEyebrows`
- per-item-margin averaging / full-bleed-image patches
- ad-hoc `inferFlow` / `forceContentFlexStacks` guessing

They were each hand-discovering a number this **measures**.

---

## F. IBM applied (illustration, not a per-file fix)

- **4 card frames:** equal w/top/gap → `grid repeat(4, 1fr)` + measured gap; each frame verbatim → uniform chrome; insets via A3 padding; images pinned to measured box.
- **Card interior:** measured column (eyebrow, icon, title, body, image); gaps = Y-deltas.
- **Banner** `[icon | quote | robot]`: row, `align-items: center`; icon/robot measured basis; quote `flex: 1` + measured max-width; measured gaps — **no** `space-between`.
- Verify each vs oracle within `POS_TOL` / `SIZE_TOL`; pass → ship flex; fail → that region absolute + `demoteReason`.

---

## G. Success (exact)

IBM cards + banner emit as **grid + column + row**, every node within `POS_TOL` / `SIZE_TOL` of the absolute oracle, **zero page-level absolute**, chrome uniform; anything that can’t hit tolerance is absolute with a recorded reason — **never silently lossy**.

---

## First implementable slice (when told **go**)

**A2–A3 + B‑0a** on the **IBM card grid + banner only**, gated by corpus box-diff — smallest change that proves the transcriber beats the promoters on the hardest fixture.

Do **not** delete promoter heuristics until IBM box-diff passes.
