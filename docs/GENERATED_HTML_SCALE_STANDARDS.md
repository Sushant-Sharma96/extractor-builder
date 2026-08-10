# Managing Generated Figma HTML at Scale — Standards & Guidelines

| Field | Value |
|-------|--------|
| **Document** | Operating model for large pages / large apps |
| **Context** | Figma → HTML/CSS via lovable-extractor converter |
| **Date** | 2026-07-23 |
| **Status** | Guidelines + **partial pipeline implementation** (flex recovery, nested emit, responsive, a11y sanitize) |
| **Related** | Pipeline audit (absolute layout), `BRANCH_feat-offline-snapshot-cache.md` |

---

## 1. Purpose

This document explains **how to use converter output on large pages and in large applications** without violating market web standards (semantic HTML, flex/grid layout, responsiveness, accessibility, maintainability).

**Core rule:**

> Treat converter output as a **preview / bootstrap artifact**, not as the long-term source of truth for production UI.

---

## 2. What “market standard” means here

For production pages, output should align with common industry practice:

| Area | Guideline |
|------|-----------|
| **Semantics** | Meaningful structure (`article`, `header`, `nav`, `main`, `button`, headings) — not every Figma layer as a `<section>` |
| **Layout** | Flexbox / CSS Grid / `gap` for composition; `position: absolute` only for overlays, badges, decorative accents |
| **Responsive** | Fluid containers; real `@media` (or container queries) that change layout — not a fixed `610px` artboard |
| **Accessibility** | Valid roles, real controls, useful `alt` text, keyboard focus — follow WCAG 2.x intent |
| **Tokens** | Semantic design tokens (`--color-text`, `--space-4`) — not only raw `--tok-color-rgb-…` |
| **Naming** | Stable, human class names (BEM / design-system) — not `group-1171276156` |
| **Event cards** | Promote to `design-system/event-card` — see `docs/EVENT_CARD_COMPONENT_STANDARD.md` |
| **Assets** | Owned, cached URLs — not expiring Figma signed S3 links |
| **Maintainability** | Reusable components — not one absolute collage per page |

---

## 3. What the converter is good for today

| Use | OK? | Notes |
|-----|-----|--------|
| Visual QA vs Figma (same desktop size) | Yes | Pixel-faithful preview |
| Internal design review / stakeholder demo | Yes | Label as “export preview” |
| Cold-start scaffolding for a new screen | Careful | Rewrite layout before merge |
| Direct ship to production large pages | **No** | Absolute + flat sections fail standards |
| Scaling 50+ screens as raw exports | **No** | Unmaintainable |

---

## 4. Recommended operating model (large apps)

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Figma file  │ ──► │ Converter        │ ──► │ Preview artifact    │
│ (design)    │     │ (snapshot+compile)│     │ (QA / bootstrap)    │
└─────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                       │ promote
                                                       ▼
                                            ┌─────────────────────┐
                                            │ Design-system       │
                                            │ components (owned)  │
                                            └──────────┬──────────┘
                                                       │ compose
                                                       ▼
                                            ┌─────────────────────┐
                                            │ Large page / app    │
                                            │ routes & features   │
                                            └─────────────────────┘
```

### Stage A — Convert (machine)

- Input: Figma URL / node  
- Output: `index.html` + `styles.css` (+ assets under owned storage)  
- Goal: **Does it look like the design at desktop?**  
- Do **not** merge this straight into the production page tree without Stage B.

### Stage B — Promote (human + standards gate)

Rewrite (or assist-rewrite) into a **standard component**:

- One root card / section with flex or grid  
- Semantic tags and accessible names  
- Responsive rules that actually change layout  
- Design-system tokens and shared primitives (`Button`, `Card`, `Badge`)

### Stage C — Compose (application)

Large pages are built by **composing components**, not by pasting more absolute exports:

```text
Page
  ├─ Hero (DS)
  ├─ HackSpaceCard (DS)     ← promoted from convert
  ├─ MentorSlider (DS)
  └─ Footer (DS)
```

### Stage D — Regenerate safely

When Figma changes:

1. Re-convert → diff **preview** only  
2. Update the **owned component** (layout/tokens/copy)  
3. Never wholesale-replace a production page with a new absolute dump  

---

## 5. Page-level guidelines (large pages)

### 5.1 Structure

**Prefer:**

```html
<article class="hackspace-card">
  <img class="hackspace-card__thumb" …>
  <div class="hackspace-card__body">
    <h3 class="hackspace-card__title">HackSpace</h3>
    …
  </div>
  <div class="hackspace-card__actions">
    <span class="hackspace-card__status">Offline</span>
    <button type="button">Register Now</button>
  </div>
</article>
```

**Avoid as production pattern:**

- One `<section>` per Figma rectangle/line/text  
- Empty `<button>` used as the card background  
- Invalid `role="interactive"`  
- Absolute coordinates for every child  

### 5.2 Layout

| Pattern | When to use |
|---------|-------------|
| **Flex row + gap** | Horizontal cards (thumb \| content \| CTA) |
| **Flex column + gap** | Stacked mobile layout |
| **CSS Grid** | Multi-column page shells, card grids |
| **Absolute** | Badge corner, decorative line overlay only |

### 5.3 Responsive (required for product pages)

Minimum expectation:

| Breakpoint | Behavior (example card) |
|------------|-------------------------|
| Desktop | Horizontal: thumb + body + actions |
| Tablet | Same or slightly tighter gaps |
| Mobile | Column stack; full-width CTA |

Converter `@media` blocks must contain **real rules**, or responsiveness is considered **not implemented**.

Fixed artboard width (e.g. `width: 610px`) is allowed only for **preview mode**, not production CSS.

### 5.4 Accessibility

- Real `<button>` / `<a>` for CTAs  
- Headings for titles (`h2`/`h3` in page outline)  
- Meaningful `alt` (or empty alt if decorative)  
- No fake roles; no arbitrary `tabindex` on static text  
- Visible focus styles on controls  

### 5.5 Assets & performance

- Persist images into **app/CDN/storage** at convert time  
- Ban shipping long-lived pages with Figma signed URLs (they expire)  
- Prefer CSS for simple dividers when possible; SVG lines are OK if owned  

---

## 6. Application-scale guidelines

### 6.1 Single source of truth

| Concern | Source of truth |
|---------|-----------------|
| Visual design exploration | Figma |
| Offline Figma data for convert | Snapshot cache (product) |
| Production UI structure | Design-system + app code |
| Copy / CMS content | CMS or content layer (optional) |

Do not let “latest Figma export HTML” become the production SSOT.

### 6.2 Component inventory

Maintain a registry:

| Figma pattern | DS component | Status |
|---------------|--------------|--------|
| HackSpace event card | `HackSpaceCard` | Promoted |
| Mentor photo strip | `MentorSlider` | Promoted |
| Roadmap timeline | `JourneyTimeline` | In progress |
| One-off marketing blob | — | Preview only |

Large apps scale on **inventory + reuse**, not on file count of exports.

### 6.3 Quality gates before merge

Checklist for any screen that started from converter output:

- [ ] Semantic structure reviewed  
- [ ] No page-wide absolute layout  
- [ ] Flex/grid used for primary composition  
- [ ] Responsive behavior verified (mobile + desktop)  
- [ ] a11y pass (keyboard + labels + contrast)  
- [ ] Assets on owned URLs  
- [ ] Classes named for humans / DS  
- [ ] Preview export kept out of production bundle (or clearly isolated)

### 6.4 Folder / ownership suggestion

```text
apps/web/
  pages/…                 # compose DS components
packages/ui/              # design system (owned)
  Card/
  Button/
  HackSpaceCard/
artifacts/figma-preview/  # converter dumps (gitignored or separate)
  2026-07-23-hackspace/
```

Preview artifacts can be stored for QA; production imports **only** from `packages/ui`.

### 6.5 When Auto Layout exists in Figma

Prefer designers use **Auto Layout** for cards and page sections.  
That maps cleanly to flex/`gap` in the converter and reduces promotion cost.

Freeform Groups → absolute exports → **must** go through Stage B before production.

---

## 7. How this fits the current converter pipeline

| Stage | Status (2026-07-23) | Behavior |
|-------|---------------------|----------|
| **`emitMode`** | **Implemented** | `standard` (default) \| `pixel` — see `docs/LAYOUT_PIPELINE_ROOT_CAUSE.md` |
| **`layoutReport` warnings** | **Implemented** | `FREEFORM_GROUP`, `FREEFORM_RECOVERY`, `PIXEL_PREVIEW`, `RECOVERY_BELOW_THRESHOLD` surfaced in API + UI |
| `nodeDecls` | Unchanged | Absolute still used for true freeform when recovery cannot run |
| `inferFlow` | Kept | Single-axis abs → flex when aligned + uniform gap (both modes) |
| **`inferColumnFlex`** | **Gated** | Runs only in `standard` when recovery score ≥ 0.75; vertical LINEs → `border-right` (not absolute overlays) |
| **`emit` nested unit** | **Implemented** | Card-like roots emit **one `<article class="et-component">`** instead of one `<section>` per leaf |
| **Responsive CSS** | **Implemented** | `.canvas` uses `max-width: 100%` + `--canvas-width`; `.et-flow-row` stacks to column under **720px**; leftover `.et-overlay` hidden on mobile |
| **a11y emit** | **Implemented** | No `role="interactive"`; CTA frames can promote to real `<button>`; focus `tabindex` limited to controls |
| **CANVAS/DOCUMENT walk** | **Implemented** | Page roots recurse into children (fixes empty Page shells) |
| LayoutIR → CSS | Still open | Solved LayoutIR not yet the primary layout writer |

**Process (Stages A–D above) still applies** for large apps: promote important patterns into a design system. Pipeline improvements above shrink the gap between preview and standards-ready HTML.

### Tests

```bash
node server/scalability/test/standards-emit.js
```

**API:** `POST /api/figma/convert` accepts `{ emitMode: "standard" | "pixel" }` and returns `layoutReport`.


---

## 8. Decision guide (quick)

| Question | Answer |
|----------|--------|
| Can we paste converter HTML into a large production page? | **No** (unless preview iframe / QA only) |
| Must production pages be responsive? | **Yes** |
| How do we scale to many screens? | Convert → promote to DS → compose pages |
| What is the SSOT for production UI? | Design-system + app code |
| What is Figma for? | Design + convert input |
| What is snapshot cache for? | Offline / quota-safe re-convert |

---

## 9. One-paragraph summary

For large pages and large applications, **do not scale on absolute Figma exports**. Use the converter for **visual preview and bootstrap**, then **promote** each pattern into **semantic, flex/grid, responsive, accessible design-system components**, and build pages by **composition**. That matches market standards and stays maintainable as the product grows; pipeline work (LayoutIR → CSS, stronger inferFlow, better emit structure) should gradually shrink the promotion gap—not replace the component model.
