// index.js — Express server
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const { captureSite } = require('./capture');
const { build } = require('./build');
const { packageSite } = require('./package-site');
const { parseFigmaUrl, fetchNode, exportImages, fetchSvgMarkup, fetchImageFills } = require('./figma-fetch');
const figmaBuild = require('./figma-build');
const { reconstructSvgMarkup } = require('./figma-generate');

const app = express();
const PORT = process.env.PORT || 3001;
const OUTPUT_ROOT = process.env.OUTPUT_DIR || path.join(__dirname, '..', 'output');

// In-memory OAuth token from the "Connect Figma" flow (single-user local tool).
let figmaOAuthToken = null;
function figmaAuth(bodyToken) {
  if (bodyToken) return { token: bodyToken, oauth: false };            // pasted PAT
  if (figmaOAuthToken) return { token: figmaOAuthToken, oauth: true }; // OAuth session
  if (process.env.FIGMA_TOKEN) return { token: process.env.FIGMA_TOKEN, oauth: false }; // .env PAT
  return null;
}

app.use(express.json({ limit: '60mb' })); // Figma plugin sends base64 images inline

// Return a clean JSON error (not Express's default HTML) when the body isn't
// valid JSON — makes client mistakes obvious instead of a text/html 400.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Request body must be valid JSON, e.g. {"url":"https://...","format":"zip"}' });
  }
  return next(err);
});

// Optional API-key gate for the convert endpoints. If CONVERT_API_KEY is set,
// callers must send it (Authorization: Bearer <key> OR X-Api-Key: <key>). If
// it's unset (local dev), the endpoints stay open.
const API_KEY = process.env.CONVERT_API_KEY || '';
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const key = req.get('x-api-key') || bearer;
  if (key && key === API_KEY) return next();
  return res.status(401).json({ error: 'Invalid or missing API key.' });
}

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

app.post('/api/convert', requireApiKey, async (req, res) => {
  const { url } = req.body || {};
  // Two output modes from ONE compiler pass (build() runs once either way):
  //  • PRODUCTION (default): structured JSON for the event-platform import —
  //    one entry per section (html + its own css) + shared globalCss/globalJs.
  //    In-memory, no disk writes, images keep their remote URLs.
  //  • DEVELOPER (format=dev|full): the assembled single-document bundle
  //    (index.html + styles.css + script.js) written to the output folder with
  //    downloaded assets, so the local UI can visually inspect a conversion.
  const fmt = (req.body && req.body.format) || req.query.format || '';
  const wantDev = fmt === 'dev' || fmt === 'full';

  if (!url || typeof url !== 'string' || !isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'Please provide a valid http(s) URL.' });
  }

  try {
    // 1) capture the rendered page + its own CSS model, 2) build clean output.
    const model = await captureSite(url);

    // ── v2 pipeline (flag-gated) with automatic v1 fallback ─────────────────
    // LOVABLE_PIPELINE_V2=1 runs the new IR-driven compiler; a fast deterministic
    // gate (IR-valid + 100% section partition, no rendering) decides v2-vs-v1 per
    // conversion. Any error or gate failure falls back to the frozen v1 build().
    // Export modes: body.mode='pixel-perfect' → scoped isolation; body.lean → prune dead CSS.
    let result;
    let pipeline = 'v1';
    const v2gate = { };
    // v2 runs if the env flag is set OR the request opts in (body.pipeline='v2' / body.v2=true)
    // — so it can be tested without env setup. Default remains v1.
    const wantV2 = process.env.LOVABLE_PIPELINE_V2 === '1' || !!(req.body && (req.body.pipeline === 'v2' || req.body.v2 === true));
    if (wantV2) {
      try {
        const { runV2 } = require('./pipeline/run-v2');
        const v2 = await runV2(url, model, {
          isolate: !!(req.body && (req.body.isolate === true || req.body.mode === 'pixel-perfect')),
          pruneCss: !!(req.body && (req.body.pruneCss === true || req.body.lean === true)),
          capturedAt: new Date().toISOString(),
        });
        Object.assign(v2gate, v2.gate);
        if (v2.gate.pass) { result = v2.result; pipeline = 'v2'; }
        else { console.warn('[v2] gate failed (coverage=' + v2.gate.coverage + ' overlap=' + v2.gate.overlap + ' irValid=' + v2.gate.irValid + ') — falling back to v1'); result = build(model); }
      } catch (e) { console.error('[v2] pipeline error — falling back to v1:', e.message); result = build(model); }
    } else {
      result = build(model);
    }

    // ── Enhancer: var-completion (v1 only; flag-gated, additive, build.js untouched) ──
    // Restores referenced-but-missing CSS custom-property definitions from the
    // site's own values. v2 already emits :root verbatim so it needs none.
    if (pipeline === 'v1' && process.env.LOVABLE_VAR_COMPLETION === '1') {
      try {
        const { completeVars } = require('./enhance/var-completion');
        const enh = completeVars({ globalCss: result.globalCss, sections: result.sectionsDetailed, rootCss: model.rootCss });
        result.globalCss = enh.globalCss;
        if (result.css) result.css = completeVars({ globalCss: result.css, sections: [], rootCss: model.rootCss }).globalCss; // dev bundle too
        result.enhancements = Object.assign({}, result.enhancements, { varCompletion: { restored: enh.restored, warnings: enh.warnings, danglingBefore: enh.danglingCount } });
      } catch (e) { console.error('[var-completion] failed (skipping):', e.message); }
    }

    // DEVELOPER mode: assemble + write the bundle (index.html/styles.css/
    // script.js + assets/) so it can be previewed at /preview/<slug>/.
    if (wantDev) {
      let pkg = null;
      try {
        pkg = await packageSite(model, result, { outRoot: OUTPUT_ROOT, downloadImages: true });
      } catch (e) { console.error('[dev] packaging failed (returning in-memory bundle)', e); }
      return res.json({
        mode: 'developer',
        pipeline,
        html: result.html,
        css: result.css,
        scripts: { 'script.js': result.js },
        sectionsSummary: result.sectionsSummary,
        sections: result.sections,
        renderMode: 'headless',
        rootClass: 'et-scope',
        ...(result.report ? { report: result.report } : {}),
        output: pkg ? { dir: pkg.dir, slug: pkg.slug, assets: pkg.assets } : null,
        // live preview URL served from the written bundle (assets + fonts intact)
        previewUrl: pkg ? `/preview/${pkg.slug}/` : null,
      });
    }

    // PRODUCTION mode: structured per-section output for the event-platform import.
    return res.json({
      mode: 'production',
      pipeline,                             // 'v1' (frozen) or 'v2' (IR-driven)
      title: model.title || result.sectionsSummary || 'Converted Page',
      url,
      sections: result.sectionsDetailed,   // [{ key, label, tag, html, css, js, preview, htmlBytes, hasImages }]
      globalCss: result.globalCss,
      globalJs: result.globalJs,
      fontLinks: result.fontLinks,          // external font <link>s (also @import-ed into globalCss)
      // both pipelines scope every section under .et-scope (self-contained per section).
      rootClass: 'et-scope',
      sectionsSummary: result.sectionsSummary,
      ...(result.enhancements ? { enhancements: result.enhancements } : {}),
      ...(result.report ? { report: result.report } : {}),
      ...(pipeline === 'v2' ? { gate: v2gate } : {}),
    });
  } catch (err) {
    console.error('[convert] error for', url, '\n', err);
    const msg = /headless|puppeteer|Chromium/i.test(err.message)
      ? err.message
      : `Could not fetch or parse that page. ${err.message}`;
    return res.status(502).json({ error: msg });
  }
});

// ── Figma → HTML/CSS ────────────────────────────────────────────────────────
app.post('/api/figma/convert', async (req, res) => {
  const { url, token } = req.body || {};
  if (!url || typeof url !== 'string' || !/figma\.com\//.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid Figma design URL.' });
  }
  const auth = figmaAuth(token);
  if (!auth) {
    return res.status(401).json({ error: 'A Figma token is required. Paste a Personal Access Token, set FIGMA_TOKEN in .env, or click "Connect Figma".' });
  }
  try {
    const { fileKey, nodeId } = parseFigmaUrl(url);
    const { document, name } = await fetchNode(fileKey, nodeId, auth); // 1 REST call (cached forever)
    const a = figmaBuild.analyze(document);
    // Icons are reconstructed LOCALLY from geometry=paths — no /images render calls.
    const svgMarkup = reconstructSvgMarkup(a.svgNodes);
    // Lazy fallback: render via /images ONLY the vectors local reconstruction
    // couldn't produce (e.g. a node fetched before geometry=paths, or an
    // un-pathable node). In the common case this list is empty → zero render calls.
    const missingSvg = a.svgNodeIds.filter((id) => !svgMarkup[id]);
    if (missingSvg.length) Object.assign(svgMarkup, await fetchSvgMarkup(fileKey, missingSvg, auth));
    const imageFillUrls = await fetchImageFills(fileKey, auth);       // photos: 1 cheap call (imageRef→S3 URL)
    // Only render fills that genuinely lack an imageRef (rare); vectors never hit REST now.
    const pngIds = a.imageNodeIds.filter((id) => !(a.svgNodes && a.svgNodes[id]));
    const imageUrls = pngIds.length ? await exportImages(fileKey, pngIds, 'png', auth, 2) : {};
    const result = figmaBuild.emit(a.tree, { imageUrls, imageFillUrls, svgMarkup, title: name, fonts: a.fonts });

    // download only the asset URLs actually referenced in the output
    const assetSet = new Set();
    (result.html + '\n' + result.css).replace(/url\("?([^")]+)"?\)|src="([^"]+)"/g, (m, a1, b1) => {
      const u = a1 || b1; if (/^https?:/.test(u) && /figma|amazonaws|fig-cdn/i.test(u)) assetSet.add(u); return m;
    });
    const model = { url: `https://figma.local/${fileKey}`, slug: name || fileKey, title: name, assets: [...assetSet] };
    const pkg = await packageSite(model, result, { outRoot: OUTPUT_ROOT, downloadImages: true });

    return res.json({
      html: result.html,
      css: result.css,
      scripts: { 'script.js': result.js },
      sectionsSummary: result.sectionsSummary,
      sections: result.sections,
      source: 'figma',
      output: pkg ? { dir: pkg.dir, slug: pkg.slug, assets: pkg.assets } : null,
    });
  } catch (err) {
    console.error('[figma] error for', url, '\n', err);
    const status = err.status === 403 || err.status === 401 ? 401 : 502;
    return res.status(status).json({ error: err.message });
  }
});

// CORS for the Figma plugin (its UI iframe is a cross-origin sandbox).
app.use('/api/figma/plugin', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

// Figma PLUGIN path — no REST API, no rate limits. The plugin reads the design
// locally and POSTs the node tree + base64 icons/photos here; we run the same
// generator and write a self-contained bundle (images inline as data URIs).
app.post('/api/figma/plugin', async (req, res) => {
  try {
    const { tree, images, svgs, name } = req.body || {};
    if (!tree || typeof tree !== 'object') return res.status(400).json({ error: 'No design tree received (select a frame in Figma).' });
    const a = figmaBuild.analyze(tree);
    const result = figmaBuild.emit(a.tree, { imageUrls: images || {}, svgMarkup: svgs || {}, title: name || 'Figma design', fonts: a.fonts });

    const fs = require('fs');
    const slug = (name || 'figma-design').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'figma-design';
    const dir = path.join(OUTPUT_ROOT, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), result.html);
    fs.writeFileSync(path.join(dir, 'styles.css'), result.css);
    fs.writeFileSync(path.join(dir, 'script.js'), result.js);

    return res.json({
      html: result.html, css: result.css, scripts: { 'script.js': result.js },
      sectionsSummary: result.sectionsSummary, sections: result.sections,
      source: 'figma-plugin', output: { dir, slug },
    });
  } catch (err) {
    console.error('[figma-plugin] error\n', err);
    return res.status(500).json({ error: err.message });
  }
});

// OAuth: "Connect Figma" → authorize → exchange code → store token in memory.
app.get('/api/figma/status', (_req, res) => res.json({ connected: !!figmaOAuthToken || !!process.env.FIGMA_TOKEN }));

app.get('/api/figma/login', (_req, res) => {
  if (!process.env.FIGMA_CLIENT_ID) return res.status(500).send('FIGMA_CLIENT_ID not set in .env');
  const params = new URLSearchParams({
    client_id: process.env.FIGMA_CLIENT_ID,
    redirect_uri: process.env.FIGMA_REDIRECT_URI || `http://localhost:${PORT}/api/figma/callback`,
    scope: 'files:read',
    state: 'stripmine',
    response_type: 'code',
  });
  res.redirect(`https://www.figma.com/oauth?${params.toString()}`);
});

app.get('/api/figma/callback', async (req, res) => {
  const { code } = req.query || {};
  if (!code) return res.status(400).send('Missing authorization code.');
  try {
    const body = new URLSearchParams({
      client_id: process.env.FIGMA_CLIENT_ID,
      client_secret: process.env.FIGMA_CLIENT_SECRET,
      redirect_uri: process.env.FIGMA_REDIRECT_URI || `http://localhost:${PORT}/api/figma/callback`,
      code: String(code),
      grant_type: 'authorization_code',
    });
    const r = await fetch('https://api.figma.com/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await r.json();
    if (!r.ok || !data.access_token) throw new Error(data.message || 'Token exchange failed');
    figmaOAuthToken = data.access_token;
    res.redirect('/?figma=connected');
  } catch (e) {
    res.status(502).send('Figma OAuth failed: ' + e.message);
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve the built frontend in production.
// Serve the written developer bundles for the local live-preview iframe
// (/preview/<slug>/ → the actual index.html + styles.css + script.js + assets).
app.use('/preview', express.static(OUTPUT_ROOT));

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(200).send('API running. Build the client with `npm run build` to serve the UI.');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`lovable-extractor API listening on http://0.0.0.0:${PORT}`);
});
