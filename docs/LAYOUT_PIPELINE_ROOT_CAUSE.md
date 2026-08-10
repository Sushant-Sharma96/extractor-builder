# Root Cause Analysis — Layout / Alignment / Responsive Failures at Scale

| Field | Value |
|-------|--------|
| **Date** | 2026-07-23 |
| **Scope** | Research + recommendation; **implemented 2026-07-23** (`emitMode`, gated recovery, divider→border, UI warnings) |
| **Evidence** | HackSpace card: Figma Group (no Auto Layout) → converter → desktop/mobile screenshots |
| **Constraint** | 100+ Figma files — cannot hand-tune section-by-section |

---

## 1. What the screens show (facts)

### Screen 1 — Desktop HTML
- Card roughly matches Figma structure (thumb | content | CTA).
- **Alignment drift:** Offline / Register not vertically centered like Figma; spacing uneven.
- **Border/line:** Decorative `Line 15` / `Line 16` still present as absolute overlays (`left: 158px`, `left: 447px`) — they do not track flex reflow → look “wrong” or partial.

### Screen 2 — Mobile
- Stack happens, but layout still feels “pasted”: uneven alignment (title left, Offline/button centered).
- Fixed artboard habits remain (fixed image size, fixed text widths in CSS, canvas tied to 610px design).
- Not a production responsive component — a **desktop collage reflowed**.

### Screen 3 — Figma source of truth
- Component is **`Group 1171276007`**, **610×123**, **no Auto Layout**.
- Children placed with **absolute X/Y** on the canvas.
- Separators are **LINE layers**, not CSS `border` on a column.
- This is freeform illustration of a card, not a layout system.

---

## 2. Root cause (one sentence)

**We are asking a pixel-geometry exporter to invent semantic, responsive CSS layout that the Figma file never encoded — then patching failures with heuristics that cannot be correct for 100+ freeform files.**

---

## 3. What is wrong with the current approach

### 3.1 Two conflicting goals in one pipeline

| Goal A — Pixel preview | Goal B — Production HTML |
|------------------------|---------------------------|
| Match Figma X/Y/W/H | Flex/grid + gap + responsive |
| Absolute / fixed sizes OK | Fluid widths, reflow on mobile |
| LINE layers as SVG overlays | Real borders / dividers |
| Layer names as classes | Design-system components |

Today the product tries to do **A and B in one emit**. That is the structural mistake.

Industry tools split these:

- **Anima / Locofy / Quest / Figma Dev Mode** → best when designers use **Auto Layout**.
- **Absolute export** → preview / design QA.
- **Component libraries** → production scale.

### 3.2 Figma input has no layout contract

Without Auto Layout, the API gives:

- `absoluteBoundingBox` per node  
- No `layoutMode`, no `itemSpacing`, no primary/counter axis align  

So the converter **guesses**:

```text
nodeDecls → position:absolute; left; top
     ↓
inferFlow (1D stack only)
     ↓
inferColumnFlex (cluster by X overlap → fake columns)
     ↓
overlays keep absolute LINE positions
```

Guessing ≠ a solid pipeline. It will always miss edge cases (your border line + alignment).

### 3.3 Why *this* card keeps breaking (mapped to code)

| Symptom | Root mechanism |
|---------|----------------|
| Border line in wrong place / leftover line | LINE layers exported as **absolute overlays** with fixed `left/top` from desktop geometry — not converted to `border-right` on middle column |
| Offline / button misaligned | Nested freeform group recovered to flex, but **align/gap/order** inferred from boxes, not from design intent |
| Mobile “not really responsive” | CSS still carries **desktop pixel widths** (`width: 104px` on title, `610px` artboard mindset); mobile only flips `flex-direction` |
| Image / URL flakiness | Signed Figma S3 URLs vs local `assets/` — packaging + copy discipline, separate from layout |
| HTML/CSS mismatch when editing Desktop | Manual edits + reconvert overwrite one file but not the other |

### 3.4 Why “fix each section” cannot scale to 100+ files

Heuristics like `inferColumnFlex` are **pattern detectors**, not a layout language.

- Pattern A (3-column card) ≠ Pattern B (hero) ≠ Pattern C (timeline) ≠ Pattern D (overlapping art).
- Every new Figma habit creates a new miss.
- You will chase screenshots forever.

**Solid pipelines at scale do not recover layout from freeform Groups.** They require a **layout contract in Figma** (or a **component map** after convert).

---

## 4. Research takeaway (how mature systems work)

| Approach | Works when | Fails when |
|----------|------------|------------|
| **Auto Layout → Flex** | Designers use AL on every component | Freeform Groups (your case) |
| **Absolute export** | Pixel QA at one breakpoint | Responsive / production |
| **Design tokens + DS components** | Repeated UI patterns | Unique one-off illustrations |
| **AI “make it responsive”** | Soft visual polish | Deterministic 100-file SLA |
| **Constraints / LayoutIR** | Explicit constraints exist | No constraints in source |

Your architecture already has **LayoutIR / Constraint** stages, but **emit still follows figma-build geometry**, not a solved responsive layout model. That gap is why IR work does not yet fix screenshots.

---

## 5. Recommended solid pipeline (for 100+ files)

### Principle

```text
Figma (contract) → Converter (deterministic) → Preview
                              ↓
                    Promote to Design System (owned)
                              ↓
                    App pages compose components
```

Do **not** promise: “any freeform Group → perfect responsive HTML.”

### Layer 0 — Design contract (mandatory for scale)

For every reusable UI in those 100+ files:

1. Wrap in a **FRAME with Auto Layout** (row/column + gap + padding + alignment).  
2. Separators = **stroke / divider frame**, not free LINE layers when possible.  
3. Name components consistently (`Card/Event`, `Button/Primary`).  
4. Optional: Variants for Desktop / Mobile **in Figma** (or a second Auto Layout wrap).

**This is the highest-leverage fix.** Without it, no emitter is “solid for all cases.”

### Layer 1 — Converter modes (split goals)

| Mode | Output | Use |
|------|--------|-----|
| **`pixel-preview`** | Absolute / artboard faithful | QA vs Figma at 610px |
| **`layout-standard`** | Flex/grid **only if** Auto Layout (or validated recovery score) | Bootstrap toward production |
| **Refuse / warn** | If freeform Group detected for production mode | Forces contract, prevents silent bad HTML |

Ship **warnings in the UI**:  
`FREEFORM_GROUP: responsive not guaranteed — convert as preview only.`

### Layer 2 — Deterministic lowering (when Auto Layout exists)

```text
layoutMode HORIZONTAL/VERTICAL
  → display:flex + direction + gap + padding + align
FILL/HUG/FIXED
  → flex-grow / width / max-width
NO absolute children inside AL frames
```

This path is what can be **solid for all AL files**.

### Layer 3 — Limited recovery (optional, scored)

Keep `inferColumnFlex` only as **best-effort**, with a confidence score:

- High score → allow `layout-standard`  
- Low score → force `pixel-preview` + warning  

Never treat recovery as SLA for 100+ files.

### Layer 4 — Design system promotion (required at app scale)

Repeated cards (HackSpace-like) become **one owned component**:

- HTML structure fixed  
- Responsive rules fixed  
- Borders = CSS, not LINE overlays  
- Assets owned  

Converter output is **reference**, not the production source of truth.

### Layer 5 — Quality gates (CI for converts)

Before accepting a convert for production:

- [ ] No page-wide absolute for primary layout  
- [ ] No `figma.com` signed image URLs  
- [ ] `max-width: 100%` on root; mobile stack verified  
- [ ] No absolute LINE overlays for structural dividers (or converted to border)  
- [ ] HTML/CSS/assets shipped as one package  

---

## 6. What is wrong *here* specifically (HackSpace)

| Figma | Pipeline did | Correct production intent |
|-------|--------------|---------------------------|
| Freeform Group | Guessed 3 flex columns | Auto Layout FRAME with 3 items + gap |
| LINE 15 / 16 | Absolute SVG overlays | `border-right` on content column / CSS divider |
| Absolute Offline+CTA | Partial flex nest | Auto Layout column, `align: center`, `gap` |
| 610×123 fixed | Pixel sizes in CSS | `width: 100%; max-width: 610px` + mobile stack designed in Figma or DS |

So the mistakes you see are **not random bugs** — they are **expected outputs of freeform→heuristic conversion**.

---

## 7. How to fix properly (decision)

### If goal = accurate for 100+ files in production

1. **Enforce Auto Layout** on components (design ops).  
2. Split converter into **preview vs standard** modes.  
3. Emit flex **from Auto Layout only** for standard mode.  
4. Promote repeated patterns to a **design system**.  
5. Use LayoutIR later to *validate*, not to invent layout from freeform.

### If goal = keep freeform Figma as-is

Accept:

- Desktop pixel preview only  
- Manual or DS promotion for production  
- Heuristics will keep failing on lines/alignment/mobile  

There is no honest “solid pipeline” that makes every freeform Group perfect.

---

## 8. Suggested next implementation order (when you approve code)

1. **Product warning:** detect freeform root → show “Preview only / not production-responsive”. ✅
2. **Mode flag:** `emitMode: 'pixel' | 'standard'`. ✅
3. **Standard mode:** require Auto Layout for `productionReady`; freeform recovery only if score ≥ 0.75. ✅
4. **Divider policy:** convert thin LINEs between columns to CSS borders when confidence high; else hide on responsive. ✅
5. **DS template:** `EventCard` component matching HackSpace — stop reconverting this pattern from freeform. (open)
6. **Corpus test:** 20 Figma samples (AL + freeform) with pass/fail gates — measure before claiming “works for all.” (open)

### Implemented wiring

| Surface | Behavior |
|---------|----------|
| `analyze(root, { emitMode })` | Returns `layoutReport` |
| `POST /api/figma/convert` body | `{ emitMode: "standard" \| "pixel" }` |
| Response | `emitMode`, `layoutReport.warnings[]` |
| UI | Emit mode select + warning banner |
| Cache | `EMIT_ADAPTER_VERSION=emit-modes-v1` + mode in fingerprint |
---

## 9. Bottom line

| Question | Answer |
|----------|--------|
| Why alignment / border issues? | Freeform Group + LINE overlays + heuristic flex recovery |
| What’s wrong with current approach? | One pipeline tries pixel fidelity **and** production responsive HTML |
| How to scale to 100+ files? | Auto Layout contract + dual emit modes + DS promotion + CI gates |
| Can heuristics alone fix all cases? | **No** |

**Do not fix screenshot-by-screenshot.** Fix the **contract and pipeline modes**, then regenerate.
