# DEMO BLOCKER — Incentives URL (node 50:2)

## Status: HARD BLOCKED on Figma API (not pipeline code)

- URL: https://www.figma.com/design/fYKUEGHAxVkJwn8CwvJCsp/Untitled?node-id=50-2
- Current `FIGMA_TOKEN` plan: **starter**
- Figma returned **429** — file reads locked ~**72 hours**
- Upgrade link from API: https://www.figma.com/files?api_paywall=true

Without a working token, paste-URL cannot produce pixel output tonight.

## Code already shipped for when token works

1. `auto` → **pixel** when freeform dominates (Incentives Group)
2. Covering-scoped vector coverage for snapshot completeness
3. SVG-then-PNG bake for icon export failures
4. Missing assets = visible warning (not silent empty)
5. `compilerVersion` no longer kills snapshot HIT
6. Force refresh can override budget Deny (including old lock)
7. Script: `node scripts/demo-convert-incentives.js "<url>"`

## Existing `output/incentives/` — DO NOT DEMO AS PIXEL

Icons are **placeholder** SVGs (`data-asset-fallback="true"`) from `package-site.js` when real Figma asset URLs were missing/expired. Not trophy/lightning/medal art.

## Unblock checklist (do in order)

1. Create a **new** Figma Personal Access Token on an account that is **not** rate-locked (second account or paid plan).
2. Put it in `.env` as `FIGMA_TOKEN=...` (replace old).
3. Clear locks: delete or empty `output/figma-cache/_budget/state.json` locks (or run convert with force).
4. Run:
   ```bash
   node scripts/demo-convert-incentives.js "https://www.figma.com/design/fYKUEGHAxVkJwn8CwvJCsp/Untitled?node-id=50-2"
   ```
5. Open `output/<slug>/index.html` — confirm 5 real icons + background, `missingAssets=0` in console / `_demo-qa.json`.
6. For UI demo: start `npm run dev`, paste URL, **Force refresh** once, emit leave **auto**.

## If no second token tonight

Demo plan B: show architecture + prior successful converts; say Incentives is queued pending Figma quota — do **not** claim pixel match on placeholder icons.
