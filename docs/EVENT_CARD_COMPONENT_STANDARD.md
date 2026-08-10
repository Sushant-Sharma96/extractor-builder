# EventCard component standard

| Field | Value |
|-------|--------|
| **Status** | Canonical promote target for event/hackathon-style Figma cards |
| **Reference HTML** | `Desktop/17-07-26` (promoted) |
| **React module** | `design-system/event-card/` |
| **Pipeline** | `applyEventCardSemantics()` in `server/figma-build.js` (standard emitMode) |

---

## 1. Why this exists

Converter output uses Figma layer names (`group-1171276007`). Those are **preview-only**.

For large applications, promote into this **owned** component contract once, then reuse across pages.

```text
Figma convert (bootstrap)
        ↓ promote
design-system/EventCard  ← SSOT for production
        ↓ compose
App pages / lists / dashboards
```

---

## 2. HTML contract

```html
<article class="event-card" data-mode="offline">
  <div class="event-card__media">
    <img class="event-card__image" src="…" alt="…">
  </div>
  <div class="event-card__body">
    <div class="event-card__header">
      <h3 class="event-card__title">…</h3>
      <p class="event-card__meta" aria-label="Awards">…</p>
    </div>
    <p class="event-card__date">
      Registration Ends on <time datetime="YYYY-MM-DD">…</time>
    </p>
  </div>
  <div class="event-card__actions">
    <p class="event-card__status" aria-label="Offline event">Offline</p>
    <button class="event-card__button" type="button">Register Now</button>
  </div>
</article>
```

### Rules

| Do | Don’t |
|----|--------|
| `article.event-card` | `group-1171276007` |
| BEM elements above | Absolute collage as final markup |
| Real `<button>` / `<a>` | Plain text CTA |
| `<time datetime>` | Date as untyped spans only |
| `h3` (or contextual heading) | Title as anonymous `<div>`/`<p>` only |
| Fluid `width: 100%` + `max-width` | Hard `610px` canvas as the component |

---

## 3. Tokens (`:root`)

| Token | Role |
|-------|------|
| `--color-surface` | Card background |
| `--color-text-primary` | Title / body |
| `--color-border` / `--color-accent` | Button outline |
| `--color-divider` | Body / actions separator |
| `--font-family-body` | Typography |
| `--font-size-title` / `-date` / `-status` / `-button` | Scale |
| `--radius-card` / `--shadow-card` | Chrome |
| `--event-card-max-width` | Fluid cap (default 610px ref) |

Theme by overriding tokens — do not fork the markup.

---

## 4. Responsive

| Breakpoint | Layout |
|------------|--------|
| ≥ 721px | Row: media \| body \| actions |
| ≤ 720px | Column stack; actions row under body |
| ≤ 420px | Actions column; full-width button |

---

## 5. Accessibility

- Keyboard: button focusable; `:focus-visible` outline required  
- Status: `aria-label="Offline event"` (or Online)  
- Awards/icons: decorative `aria-hidden` + visually hidden text when meaning matters  
- Image: meaningful `alt` (not layer id)  
- Contrast: text/border vs surface ≥ WCAG AA  

---

## 6. React / large-app API

```jsx
<EventCard
  title="HackSpace"
  imageUrl="/assets/hackspace.svg"
  imageAlt="HackSpace — Build. Break. Beyond."
  mode="offline"
  registrationEndLabel="Mon 08 2025"
  registrationEndIso="2025-08-08"
  ctaLabel="Register Now"
  onRegister={() => { /* navigate / API */ }}
  awarded
/>
```

Import: `design-system/event-card`.

---

## 7. Pipeline behavior

When `emitMode=standard` recovers a freeform card into columns, the emitter stamps:

`event-card`, `event-card__media`, `event-card__body`, `event-card__actions`, `event-card__button`, …

That output is still a **bootstrap**. Diff against this standard and promote into `design-system/event-card` before shipping in a large app.

---

## 8. Gate checklist (merge to production)

- [ ] No Figma numeric class names in production bundle  
- [ ] No signed `figma.com` image URLs  
- [ ] Fluid width; stacks on mobile  
- [ ] Real button + focus ring  
- [ ] `<time datetime>` when date known  
- [ ] Tokens used (no one-off hex sprawl for brand colors)  
