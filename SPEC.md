# stripmine — Requirements & Approach (locked)

## 1. Purpose
One job: paste **any** Lovable URL → get an **accurate, clean, self-contained** static copy
(HTML + CSS + JS) that looks and behaves like the original. Must scale from simple
landing pages to complex/custom ("extraordinary") designs — and stay **responsive**,
keep **hover states**, and match the source visually.

## 2. Core approach (the important decision)
**Read each site's OWN compiled CSS as the source of truth** — do NOT maintain a hand-built
Tailwind dictionary.

Why: every Lovable project defines its own custom theme (colors, spacing, fonts, gradients,
animations, shadcn `--` tokens). A stored dictionary only knows Tailwind defaults and cannot
know a specific project's values — that is what caused the original "colorless" output. The
site's shipped stylesheet already contains every class it uses → real resolved declarations,
including custom theme values, arbitrary values (`w-[347px]`), `@keyframes`, `@media`
breakpoints, and `:hover` rules. It is same-origin, so the headless browser can read it directly.

### Pipeline
1. Headless-render the URL (React SPA → real DOM).
2. From the rendered page, collect:
   - the DOM (Tailwind classes intact),
   - the site's own CSS rules (`document.styleSheets` → base / `@media` / `:hover` / `::pseudo`),
   - the `:root` design tokens (resolved to hex), `@keyframes`, `@font-face` / font `<link>`s,
   - the list of image/asset URLs.
3. For each element, union the real declarations of its classes across contexts
   (base + breakpoints + states). **Keep Tailwind's internal `--tw-*` custom properties** so
   gradients / transforms / shadows / ring resolve exactly.
4. De-dupe identical declaration sets into **semantic reusable classes** (`.btn`, `.card`,
   `.hero-title`).
5. Reconstruct common interactivity as vanilla JS.
6. Download assets into a per-site folder and rewrite references.

## 3. Output (per site, self-contained)
```
output/<site-name>/
├─ index.html   clean semantic HTML, no Tailwind classes, <!-- Section: Hero --> markers,
│               web-font <link>s in <head>
├─ styles.css   :root tokens → Common/shared block (.btn, .card, reset)
│               → each section's classes under /* ===== Section: Hero ===== */
├─ script.js    interactions grouped per section (accordion, tabs, mobile menu,
│               smooth-scroll, carousel) with proper aria-*
├─ assets/      downloaded images (+ fonts), de-duplicated
└─ README.md    section manifest + fidelity notes ("carousel reconstructed", etc.)
```

## 4. Locked decisions
| Topic | Decision |
|---|---|
| CSS values | Read the site's own compiled CSS (source of truth) |
| Class names | Semantic (`.btn`, `.card`, `.hero-title`) |
| HTML/CSS/JS layout | One file each; section-commented; shared/common block in CSS |
| Interactivity | Reconstruct common patterns in vanilla JS (accordion, tabs, mobile menu, smooth-scroll, carousel) |
| Images/assets | Download into per-site `assets/`, de-duplicated |
| Multiple URLs | One at a time (each into its own folder) |
| Responsive | Preserved exactly (real `@media` from the site CSS) |
| Hover/focus | Preserved exactly (real state rules from the site CSS) |
| Fonts | Preserved (real web fonts) |
| Dark mode | If the site ships `.dark` tokens, include them as an optional theme block |

## 5. What is intentionally dropped
Lovable's bundled React runtime, the "Edit with Lovable" badge, analytics/tracking scripts,
and behavior that is purely React-internal (we rebuild the *common* interaction patterns,
not a 1:1 React clone).

## 5a. Confirmed site structure (from probing the reference URLs)
Both reference sites are **Tailwind v4**. Verified facts the capture must handle:
- The compiled stylesheet is **same-origin and readable** (`/assets/styles-*.css`), but every
  utility is nested inside **`@layer`** blocks — the extractor MUST recurse into `@layer`
  (and `@media`, `@supports`, `@container`), not just top-level rules.
- Declarations MUST be read via **`rule.style.cssText`** (authored text). Enumerating
  properties returns empty values for v4 `calc()`/`var()` utilities (`py-2`, `rounded-2xl`).
- Colors are CSS-variable tokens in `:root` (`--navy-deep`, `--gold`, …) — carry `:root`
  verbatim and keep `var(--x)` references in class decls (resolves identically at runtime).
- Gradients/shadows/transforms rely on Tailwind's **`@property --tw-*`** rules (72 of them)
  and universal `--tw-*` initializers — capture and emit these verbatim so the plumbing works.
- Responsive = real `@media (min-width: …)`; hover/focus = real `:hover`/`:focus` rules —
  both preserved exactly (no reconstruction).
- **Approximated (noted in README):** `group-hover`/`peer` and radix `data-state` combinator
  rules. Interactive behavior is rebuilt with our own vanilla JS + our own classes instead.

## 6. Known limits (will be noted per-section in README)
- Genuinely custom hand-written CSS or bespoke JS animations (rare on Lovable) are approximated.
- Forms submit nowhere (no backend) — wired for UX only.
- Exact original React state logic is reconstructed as standard patterns, not cloned.
