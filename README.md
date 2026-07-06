# stripmine (extractor-builder)

Paste a public Lovable.dev URL → get a **self-contained static site**:

- **index.html** — clean semantic HTML, section comments, no Tailwind classes
- **styles.css** — design tokens + shared classes + per-section blocks (from the site's own compiled CSS)
- **script.js** — reconstructed interactivity (accordion, tabs, smooth-scroll, scroll-reveal)
- **assets/** — downloaded images, de-duplicated
- **README.md** — section manifest + fidelity notes

Repo: [github.com/Sushant-Sharma96/extractor-builder](https://github.com/Sushant-Sharma96/extractor-builder)

---

## How it works

1. **Capture** (`server/capture.js`) — headless Chromium renders the SPA, reads `document.styleSheets` (Tailwind v4, `@layer`, `@media`, `:hover`), collects assets.
2. **Build** (`server/build.js`) — unions class rules per element, dedupes to semantic classes (`.btn`, `.card`, …), emits HTML/CSS/JS.
3. **Package** (`server/package-site.js`) — writes `output/<site-name>/` with downloaded assets.

See [SPEC.md](./SPEC.md) for locked requirements.

---

## Install

```bash
git clone https://github.com/Sushant-Sharma96/extractor-builder.git
cd extractor-builder
npm install
```

Puppeteer downloads Chromium on install (~150 MB). If it fails on a restricted network:

```bash
npx puppeteer browsers install chrome
```

---

## Run (development)

```bash
npm run dev
```

- API: `http://localhost:3001`
- UI: `http://localhost:5173` (proxies `/api`)

Paste a URL, click **Generate**. Output is written to `output/<slug>/`.

---

## Production

```bash
npm run build
npm start
```

Open `http://localhost:3001` — serves the built UI and API.

---

## API

`POST /api/convert`

```json
{
  "url": "https://your-project.lovable.app",
  "write": true,
  "downloadImages": true
}
```

Response:

```json
{
  "html": "<!doctype html> ...",
  "css": "/* styles.css */ ...",
  "scripts": { "script.js": "..." },
  "sectionsSummary": "Header, Hero, Pricing, Footer",
  "renderMode": "headless",
  "output": { "dir": "/path/to/output/your-project", "slug": "your-project", "assets": 6 }
}
```

Health check: `GET /api/health`

---

## Deploy (Render)

1. Push this repo to GitHub.
2. On [Render](https://render.com), **New → Blueprint** and connect `Sushant-Sharma96/extractor-builder`.
3. Render uses `render.yaml`: installs Chromium, builds the client, runs `npm start`.

Or manually: **New Web Service** → build `npm install && npx puppeteer browsers install chrome && npm run build`, start `npm start`.

> Puppeteer needs a long-lived Node host (Render, Railway, Fly, VPS). Serverless (Vercel) is not recommended.

---

## Project layout

```
extractor-builder/
├─ server/
│  ├─ index.js          Express + /api/convert
│  ├─ capture.js        headless render + CSS model extraction
│  ├─ build.js          semantic HTML/CSS/JS generation
│  ├─ package-site.js   disk output + asset download
│  ├─ transform.js      (legacy — unused by v2 pipeline)
│  ├─ fetch-page.js     (legacy)
│  └─ tailwind-map.js   (legacy)
├─ client/              React/Vite UI
├─ output/              generated sites (gitignored)
├─ SPEC.md              locked requirements
└─ render.yaml          Render deploy blueprint
```
