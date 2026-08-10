// index.js — Express server
require('dotenv').config();
const path = require('path');
const express = require('express');
const { runStartupValidation, probeReadiness } = require('./startup');
const { sendError } = require('./security/errors');
const {
  isValidHttpUrl,
  validateFigmaConvertBody,
  safeSlug,
} = require('./security/validate');
const { captureSite } = require('./capture');
const { build } = require('./build');
const { packageSite } = require('./package-site');
const { parseFigmaUrl } = require('./figma-fetch');
const figmaBuild = require('./figma-build');
const { reconstructSvgMarkup } = require('./figma-generate');
const { compile } = require('../compiler/compile');
const { saveSnapshotAtomic, logCacheEvent } = require('./figma-snapshot');
const { prepareFigmaSources } = require('./scalability');
const budget = require('./scalability/budget');
const { newRequestId, logConvert, logError, logInfo } = require('./scalability/request-log');
const { successEnvelope, errorEnvelope, budgetErrorCode, API_VERSION } = require('./api/v1/envelope');

const { config: bootConfig } = runStartupValidation();
const app = express();
const PORT = bootConfig.port;
const OUTPUT_ROOT = bootConfig.outputDir;
const startedAt = Date.now();

/** Versioned public API — additive header; bodies match legacy semantics. */
app.use('/api/v1', (_req, res, next) => {
  res.setHeader('X-API-Version', API_VERSION);
  next();
});

// In-memory OAuth token from the "Connect Figma" flow (single-user local tool).
let figmaOAuthToken = null;
function figmaAuth(bodyToken) {
  if (bodyToken) return { token: bodyToken, oauth: false };            // pasted PAT
  if (figmaOAuthToken) return { token: figmaOAuthToken, oauth: true }; // OAuth session
  if (process.env.FIGMA_TOKEN) return { token: process.env.FIGMA_TOKEN, oauth: false }; // .env PAT
  return null;
}

app.use(express.json({ limit: bootConfig.jsonBodyLimit })); // Figma plugin sends base64 images inline

// Return a clean JSON error (not Express's default HTML) when the body isn't
// valid JSON — makes client mistakes obvious instead of a text/html 400.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return sendError(res, {
      status: 400,
      errorCode: 'INVALID_JSON',
      message: 'Request body must be valid JSON, e.g. {"url":"https://...","format":"zip"}',
      requestId: newRequestId(),
    });
  }
  return next(err);
});

// Optional API-key gate. Active when CONVERT_API_KEY is set, or REQUIRE_API_KEY=1.
const API_KEY = bootConfig.convertApiKey || '';
function requireApiKey(req, res, next) {
  if (!API_KEY && !bootConfig.requireApiKey) return next();
  if (!API_KEY) {
    return sendError(res, {
      status: 401,
      errorCode: 'API_KEY_REQUIRED',
      message: 'API key required but not configured.',
      requestId: newRequestId(),
    });
  }
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const key = req.get('x-api-key') || bearer;
  if (key && key === API_KEY) return next();
  return sendError(res, {
    status: 401,
    errorCode: 'INVALID_API_KEY',
    message: 'Invalid or missing API key.',
    requestId: newRequestId(),
  });
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

  const requestId = newRequestId();
  if (!url || typeof url !== 'string' || !isValidHttpUrl(url)) {
    return sendError(res, {
      status: 400,
      errorCode: 'INVALID_URL',
      message: 'Please provide a valid http(s) URL.',
      requestId,
    });
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
    if (bootConfig.isDev) console.error('[convert] error\n', err);
    else logError('convert_error', { requestId, message: err && err.message });
    const msg = /headless|puppeteer|Chromium/i.test(String(err && err.message))
      ? err.message
      : `Could not fetch or parse that page. ${err.message}`;
    return sendError(res, {
      status: 502,
      errorCode: 'CONVERT_FAILED',
      message: msg,
      requestId,
    });
  }
});

// ── Figma → HTML/CSS ────────────────────────────────────────────────────────
// Phase 0: fetch/cache orchestration lives in server/scalability/ (thin seams).
// compile() boundary is unchanged.
// Public contract: POST /api/v1/convert (canonical) ≡ POST /api/figma/convert (legacy).

async function handleFigmaConvert(req, res) {
  const requestId = newRequestId();
  const validated = validateFigmaConvertBody(req.body);
  if (!validated.ok) {
    return sendError(res, {
      status: 400,
      errorCode: validated.errorCode,
      message: validated.message,
      requestId,
    });
  }
  const { url, token, refresh } = req.body || {};
  const emitModeRaw = req.body && req.body.emitMode;
  // Default auto: URL → HTML/CSS always; pipeline picks standard vs pixel
  const emitMode = (emitModeRaw == null || emitModeRaw === '')
    ? 'auto'
    : String(emitModeRaw).toLowerCase().trim();
  // Phase 5 opt-in renderer toggle (docs/COMPILER_MIGRATION_BLUEPRINT.md) — UI/API
  // integration only, does not change renderer behavior. Default stays 'legacy'.
  const rendererRaw = req.body && req.body.renderer;
  const renderer = String(rendererRaw || '').toLowerCase().trim() === 'ir-experimental'
    ? 'ir-experimental'
    : 'legacy';
  const auth = figmaAuth(token);
  if (!auth) {
    return sendError(res, {
      status: 401,
      errorCode: 'FIGMA_AUTH_REQUIRED',
      message: 'A Figma token is required. Paste a Personal Access Token, set FIGMA_TOKEN in .env, or click "Connect Figma".',
      requestId,
    });
  }
  const t0 = Date.now();
  const restCounter = { n: 0 };
  let cacheStatus = 'MISS';
  let cacheReason = 'no_snapshot';
  let localByUrl = null;
  let snapSaveMs = null;
  try {
    const { fileKey, nodeId } = parseFigmaUrl(url);
    logConvert('convert_start', { requestId, fileKey, nodeId });
    const wantRefresh = refresh === true || refresh === '1' || refresh === 1;
    const force = req.body && (req.body.force === true || req.body.force === '1');

    const prepared = await prepareFigmaSources({
      fileKey,
      nodeId,
      auth,
      refresh: wantRefresh,
      restCounter,
      t0,
      userKey: 'local',
      force,
      requestId,
    });

    const budgetView = budget.toApiBudget(prepared.authz);

    if (prepared.denied || prepared.budgetBlocked) {
      const status = prepared.authz && prepared.authz.outcome === 'Queue' ? 503 : 429;
      const msg = (prepared.authz && prepared.authz.warnings && prepared.authz.warnings[0])
        || `Budget ${prepared.authz && prepared.authz.outcome}: ${prepared.authz && prepared.authz.reason}`;
      logCacheEvent({
        status: prepared.cacheStatus,
        reason: (prepared.cacheReason || 'budget') + '_' + (prepared.authz && prepared.authz.outcome),
        restCalls: 0,
        ms: Date.now() - t0,
        fileKey,
        nodeId,
      });
      logConvert('convert_blocked', {
        requestId,
        fileKey,
        nodeId,
        budgetDecision: prepared.authz && prepared.authz.outcome,
        cacheStatus: prepared.cacheStatus,
        restCalls: 0,
        compileTime: Date.now() - t0,
        executorSteps: prepared.executorSteps,
        errors: [(prepared.authz && prepared.authz.reason) || 'budget_blocked'],
      });
      return res.status(status).json(errorEnvelope({
        errorCode: budgetErrorCode(prepared.authz && prepared.authz.outcome),
        message: msg,
        requestId,
        stage: prepared.cacheStatus,
        fileKey,
        nodeId,
        cache: {
          status: prepared.cacheStatus,
          reason: prepared.cacheReason,
          restCalls: 0,
          compileMs: Date.now() - t0,
        },
        budget: budgetView,
      }));
    }

    const {
      document,
      name,
      imageFillUrls,
      imageUrls,
      svgFallback,
      analyzed,
      fetchedMeta,
    } = prepared;
    localByUrl = prepared.localByUrl;
    cacheStatus = prepared.cacheStatus;
    cacheReason = prepared.cacheReason;
    // keep authz for success response
    const authz = prepared.authz;
    const successBudget = budget.toApiBudget(authz);

    // Architecture compiler path: Raw → NDG…→EmitPlan → product emitter adapter → disk.
    // Fetch/snapshot still supply document + asset maps; HTML comes from compile().
    const a = analyzed || figmaBuild.analyze(document, { emitMode });
    const svgMarkup = reconstructSvgMarkup(a.svgNodes);
    for (const id of Object.keys(svgFallback || {})) {
      if (!svgMarkup[id] && svgFallback[id]) svgMarkup[id] = svgFallback[id];
    }

    const slug = safeSlug(name || fileKey || 'figma-design');
    const outDir = path.join(OUTPUT_ROOT, slug);

    logConvert('compile_start', { requestId, fileKey, nodeId, cacheStatus, emitMode });
    const compiled = await compile({
      document,
      graphId: `g:figma:${fileKey}:${nodeId || 'root'}`,
      policyProfileId: 'pixel-faithful',
      title: name || 'Figma design',
      slug,
      url: `https://figma.local/${fileKey}`,
      outDir,
      imageUrls,
      imageFillUrls,
      svgMarkup,
      fonts: a.fonts,
      localByUrl,
      downloadImages: true,
      useCache: !wantRefresh,
      emitMode,
      renderer,
    });
    logConvert('compile_done', {
      requestId,
      fileKey,
      nodeId,
      steps: compiled.steps.map((s) => s.stage),
      ms: Date.now() - t0,
    });

    // Persist covering snapshot AFTER compile (page/frame-first). Compile used
    // the requested node only; disk stores the covering container for Subtree reuse.
    if (cacheStatus === 'MISS' && fetchedMeta) {
      const coverId = fetchedMeta.coveringNodeId != null ? fetchedMeta.coveringNodeId : nodeId;
      const coverDoc = fetchedMeta.coveringDocument || document;
      const snapPayload = {
        fileKey,
        nodeId: coverId,
        url,
        kind: fetchedMeta.kind || 'exact',
        coverageType: fetchedMeta.coverageType || null,
        documentPayload: {
          document: coverDoc,
          name: fetchedMeta.coveringName || fetchedMeta.name,
          fileName: fetchedMeta.fileName,
          version: fetchedMeta.version,
        },
        imageFillsRemote: imageFillUrls,
        pngRemote: imageUrls,
        svgFallback,
        // Coverage must use the COVERING tree (what we persist), not the compile subtree.
        // Otherwise sibling icons outside the request node can falsely mark complete.
        ...(() => {
          const coverDoc = fetchedMeta.coveringDocument || document;
          const coverA = coverDoc === document ? a : figmaBuild.analyze(coverDoc, { emitMode });
          const coverReconstructed = reconstructSvgMarkup(coverA.svgNodes || {});
          return {
            requiredVectorIds: [
              ...((coverA && coverA.svgNodeIds) || []),
              ...((coverA && coverA.imageNodeIds) || []),
            ],
            reconstructedVectorIds: Object.keys(coverReconstructed),
          };
        })(),
      };
      setImmediate(() => {
        const snapT0 = Date.now();
        saveSnapshotAtomic(snapPayload)
          .then((snapDir) => {
            const snapshotTime = Date.now() - snapT0;
            logConvert('snapshot_saved', {
              requestId,
              fileKey,
              nodeId: coverId,
              snapshotTime,
              coverageType: fetchedMeta.coverageType,
              snapDir: path.basename(String(snapDir || '')),
            });
          })
          .catch((e) => {
            logError('snapshot_error', {
              requestId,
              fileKey,
              nodeId: coverId,
              errors: [e.message],
            });
          });
      });
    }

    const result = {
      html: compiled.artifacts.html,
      css: compiled.artifacts.css,
      js: compiled.artifacts.js,
      sections: compiled.artifacts.sections,
      sectionsSummary: compiled.artifacts.sectionsSummary,
    };
    const pkg = {
      dir: compiled.artifacts.dir,
      slug,
      assets: (compiled.artifacts.package && compiled.artifacts.package.assets) || 0,
    };

    const compileMs = Date.now() - t0;
    logCacheEvent({
      status: cacheStatus,
      reason: cacheReason,
      restCalls: restCounter.n,
      ms: compileMs,
      fileKey,
      nodeId,
    });

    logConvert('convert_done', {
      requestId,
      fileKey,
      nodeId,
      cacheStrategy: prepared.plan && prepared.plan.cacheStrategy,
      cacheStatus,
      plannerDecision: prepared.plan && prepared.plan.reason,
      budgetDecision: authz && authz.outcome,
      executorSteps: prepared.executorSteps,
      compileTime: compileMs,
      restCalls: restCounter.n,
      snapshotTime: snapSaveMs,
    });

    return res.json(successEnvelope({
      html: result.html,
      css: result.css,
      scripts: { 'script.js': result.js },
      sectionsSummary: result.sectionsSummary,
      sections: result.sections,
      source: 'figma-compiler',
      requestId,
      emitMode: (compiled.artifacts && compiled.artifacts.emitMode)
        || (a.layoutReport && a.layoutReport.emitMode)
        || a.emitMode
        || emitMode,
      renderer,
      rendererSwitchedFrom: compiled.artifacts.rendererSwitchedFrom || null,
      layoutReport: compiled.artifacts.layoutReport || a.layoutReport || null,
      cache: { status: cacheStatus, reason: cacheReason, restCalls: restCounter.n, compileMs },
      compiler: {
        graphId: compiled.graphId,
        steps: compiled.steps.map((s) => s.stage),
        artifactFingerprint: compiled.artifacts.artifactFingerprint,
        timings: compiled.timings,
        fingerprint: {
          ndgChecksum: compiled.fingerprint && compiled.fingerprint.ndgChecksum,
          emitPlanChecksum: compiled.fingerprint && compiled.fingerprint.emitPlanChecksum,
          resolvedIrChecksum: compiled.fingerprint && compiled.fingerprint.resolvedIrChecksum,
        },
      },
      output: pkg ? { dir: pkg.dir, slug: pkg.slug, assets: pkg.assets } : null,
      previewUrl: pkg && pkg.slug ? `/preview/${pkg.slug}/` : null,
      budget: successBudget,
    }));
  } catch (err) {
    if (bootConfig.isDev) console.error('[figma] error\n', err);
    let fileKey = '?';
    let nodeId = null;
    try {
      const parsed = parseFigmaUrl(url);
      fileKey = parsed.fileKey || '?';
      nodeId = parsed.nodeId;
    } catch (_) { /* ignore */ }

    let budgetView = null;
    if (err && err.status === 429) {
      try {
        const lock = budget.recordRateLimit({
          retryAfterSec: err.retryAfter,
          planTier: err.planTier,
          upgradeLink: err.upgradeLink,
          userKey: 'local',
          fileKey: fileKey !== '?' ? fileKey : null,
        });
        budgetView = budget.toApiBudget({
          outcome: 'Deny',
          reason: 'figma_429',
          predictedTier1: null,
          predictedTier2: null,
          warnings: [err.message],
          retryAfterUntil: lock.retryAfterUntil,
          remainingEstimate: null,
          degrade: { preferCache: true, skipPng: true, skipSvg: true, queueRequest: true },
          predictionReason: 'figma_429',
          planTier: err.planTier,
        });
      } catch (_) { /* ignore */ }
    }

    logError('convert_error', {
      requestId,
      fileKey,
      nodeId,
      cacheStatus,
      restCalls: restCounter.n,
      compileTime: Date.now() - t0,
      errors: [(err && err.message) || 'unknown'],
      status: err && err.status,
    });

    try {
      logCacheEvent({
        status: cacheStatus,
        reason: cacheReason + '_error',
        restCalls: restCounter.n,
        ms: Date.now() - t0,
        fileKey,
        nodeId,
      });
    } catch (_) { /* never fail error response */ }
    const status = err && (err.status === 403 || err.status === 401) ? 401
      : (err && err.status >= 400 && err.status < 600 ? err.status : 500);
    const errorCode = status === 429 ? 'FIGMA_RATE_LIMIT'
      : status === 401 ? 'FIGMA_AUTH'
      : status === 404 ? 'FIGMA_NOT_FOUND'
      : 'CONVERT_FAILED';
    if (!res.headersSent) {
      return res.status(status).json(errorEnvelope({
        errorCode,
        message: (err && err.message) || 'Figma conversion failed',
        requestId,
        stage: cacheStatus,
        fileKey,
        nodeId,
        ...(budgetView ? { budget: budgetView } : {}),
      }));
    }
    return undefined;
  }
}

app.post('/api/figma/convert', handleFigmaConvert);
app.post('/api/v1/convert', handleFigmaConvert);

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
  const requestId = newRequestId();
  try {
    const { tree, images, svgs, name, emitMode: pluginEmitMode } = req.body || {};
    if (!tree || typeof tree !== 'object') {
      return sendError(res, {
        status: 400,
        errorCode: 'INVALID_TREE',
        message: 'No design tree received (select a frame in Figma).',
        requestId,
      });
    }

    const emitMode = String(pluginEmitMode || 'standard').toLowerCase() === 'pixel' ? 'pixel' : 'standard';
    const slug = safeSlug(name || 'figma-design');
    const dir = path.join(OUTPUT_ROOT, slug);
    const a = figmaBuild.analyze(tree, { emitMode });

    const compiled = await compile({
      document: tree,
      graphId: `g:plugin:${slug}`,
      policyProfileId: 'pixel-faithful',
      title: name || 'Figma design',
      slug,
      outDir: dir,
      imageUrls: images || {},
      svgMarkup: svgs || {},
      fonts: a.fonts,
      downloadImages: false,
      emitMode,
    });

    return res.json({
      ok: true,
      html: compiled.artifacts.html,
      css: compiled.artifacts.css,
      scripts: { 'script.js': compiled.artifacts.js },
      sectionsSummary: compiled.artifacts.sectionsSummary,
      sections: compiled.artifacts.sections,
      source: 'figma-plugin-compiler',
      requestId,
      compiler: {
        graphId: compiled.graphId,
        steps: compiled.steps.map((s) => s.stage),
        artifactFingerprint: compiled.artifacts.artifactFingerprint,
      },
      output: { dir: compiled.artifacts.dir || dir, slug },
      previewUrl: `/preview/${slug}/`,
    });
  } catch (err) {
    if (bootConfig.isDev) console.error('[figma-plugin] error\n', err);
    else logError('plugin_error', { requestId, message: err && err.message });
    return sendError(res, {
      status: 500,
      errorCode: 'PLUGIN_CONVERT_FAILED',
      message: (err && err.message) || 'Plugin conversion failed',
      requestId,
    });
  }
});

// OAuth: "Connect Figma" → authorize → exchange code → store token in memory.
app.get('/api/figma/status', (_req, res) => res.json({ connected: !!figmaOAuthToken || !!process.env.FIGMA_TOKEN }));

app.get('/api/figma/login', (_req, res) => {
  if (!process.env.FIGMA_CLIENT_ID) {
    return sendError(res, {
      status: 500,
      errorCode: 'OAUTH_NOT_CONFIGURED',
      message: 'FIGMA_CLIENT_ID not set in .env',
      requestId: newRequestId(),
    });
  }
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
  if (!code || typeof code !== 'string' || code.length > 512) {
    return res.status(400).send('Missing or invalid authorization code.');
  }
  try {
    const body = new URLSearchParams({
      client_id: process.env.FIGMA_CLIENT_ID,
      client_secret: process.env.FIGMA_CLIENT_SECRET,
      redirect_uri: process.env.FIGMA_REDIRECT_URI || `http://localhost:${PORT}/api/figma/callback`,
      code: String(code),
      grant_type: 'authorization_code',
    });
    const r = await fetch('https://api.figma.com/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) throw new Error(data.message || 'Token exchange failed');
    figmaOAuthToken = data.access_token;
    logInfo('oauth_connected', { ok: true });
    res.redirect('/?figma=connected');
  } catch (e) {
    logError('oauth_failed', { message: e && e.message });
    res.status(502).send('Figma OAuth failed.');
  }
});

/** Liveness — process is up. No internals. Canonical: GET /api/v1/health */
function handleHealth(_req, res) {
  const probe = probeReadiness();
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    cache: probe.cache === 'ok' ? 'ok' : 'degraded',
    budget: probe.budgetStore === 'ok' ? 'ok' : 'degraded',
    compiler: probe.compiler === 'ok' ? 'ok' : 'degraded',
  });
}

/** Readiness — safe to receive traffic. Canonical: GET /api/v1/ready */
function handleReady(_req, res) {
  const probe = probeReadiness();
  if (probe.ready) {
    return res.status(200).json({ ready: true });
  }
  return res.status(503).json({
    ready: false,
    configuration: probe.configuration,
    filesystem: probe.filesystem,
    budgetStore: probe.budgetStore,
    cache: probe.cache,
  });
}

app.get('/health', handleHealth);
app.get('/api/v1/health', handleHealth);
app.get('/ready', handleReady);
app.get('/api/v1/ready', handleReady);

/** Compat liveness used by older clients. */
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

process.on('unhandledRejection', (reason) => {
  logError('unhandled_rejection', {
    message: reason && reason.message ? reason.message : String(reason),
  });
});
process.on('uncaughtException', (err) => {
  logError('uncaught_exception', { message: err && err.message });
  if (bootConfig.isDev) console.error(err);
  process.exit(1);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  logInfo('server_listen', { port: PORT, host: '0.0.0.0' });
});

function shutdown(signal) {
  logInfo('server_shutdown', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
