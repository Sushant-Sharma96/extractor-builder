// index.js — Express server
require('dotenv').config();
const path = require('path');
const express = require('express');
const { captureSite } = require('./capture');
const { build } = require('./build');
const { packageSite } = require('./package-site');

const app = express();
const PORT = process.env.PORT || 3001;
const OUTPUT_ROOT = process.env.OUTPUT_DIR || path.join(__dirname, '..', 'output');

app.use(express.json({ limit: '2mb' }));

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/api/convert', async (req, res) => {
  const { url, downloadImages = true, write = true } = req.body || {};

  if (!url || typeof url !== 'string' || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid http(s) URL.' });
  }

  try {
    // 1) capture the rendered page + its own CSS model, 2) build clean output,
    // 3) package into a self-contained per-site folder with downloaded assets.
    const model = await captureSite(url);
    const result = build(model);

    let pkg = null;
    if (write) {
      pkg = await packageSite(model, result, { outRoot: OUTPUT_ROOT, downloadImages });
    }

    // For the copy workflow we return HTML with ORIGINAL absolute image URLs
    // (load from origin anywhere). The written folder uses local assets/.
    return res.json({
      html: result.html,
      css: result.css,
      scripts: { 'script.js': result.js },
      sectionsSummary: result.sectionsSummary,
      sections: result.sections,
      renderMode: 'headless',
      output: pkg ? { dir: pkg.dir, slug: pkg.slug, assets: pkg.assets } : null,
    });
  } catch (err) {
    console.error('[convert] error for', url, '\n', err);
    const msg = /headless|puppeteer|Chromium/i.test(err.message)
      ? err.message
      : `Could not fetch or parse that page. ${err.message}`;
    return res.status(502).json({ error: msg });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve the built frontend in production.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('API running. Build the client with `npm run build` to serve the UI.');
  });
});

app.listen(PORT, () => {
  console.log(`lovable-extractor API listening on http://localhost:${PORT}`);
});
