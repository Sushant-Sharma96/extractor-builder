'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Production adapter for the v2 pipeline. Runs capture++ → DG → BG → generate,
// applies a FAST deterministic acceptance gate (IR-valid + 100% section partition,
// no per-request rendering), and maps the IR/output into the v1-compatible
// response shape so /api/convert can serve v2 behind a flag with v1 fallback.
//
// The full rendering Verify harness (verify.js) remains the OFFLINE corpus gate
// (validate-corpus.js); the live path uses only the cheap structural checks.
// ─────────────────────────────────────────────────────────────────────────────

const { capturePlus } = require('./capture-plus');
const { buildDependencyGraph } = require('./dependency-graph');
const { buildBehaviorGraph } = require('./behavior-graph');
const { generate } = require('./generate-v2');
const { validateIR, SCHEMA_VERSION } = require('./ir');
const { partitionCheck } = require('./verify');

// Build the v1-shaped production result from the IR + generated output.
function toResult(ir, out) {
  // Prefer the generator's scoped per-section markup (each wrapped in .et-scope with
  // original classes kept) so platform per-section import is self-contained + isolated.
  const src = (out && out.sectionsOut && out.sectionsOut.length) ? out.sectionsOut : (ir.sections || []);
  const sectionsDetailed = src.map((s) => ({
    key: s.key, label: s.label, tag: s.tag,
    html: s.html || '', css: '', js: '', // v2 ships one coherent scoped stylesheet in globalCss
    preview: (s.html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
    htmlBytes: (s.html || '').length,
    hasImages: /<img|<svg|<picture|<video/i.test(s.html || ''),
  }));
  return {
    html: out.html, css: out.css, js: out.js,
    globalCss: out.css, globalJs: out.js,
    sectionsDetailed,
    sections: sectionsDetailed.map((s) => s.key),
    sectionsSummary: (ir.sections || []).length + ' sections',
    fontLinks: (ir.document && ir.document.fontLinks) || [],
    report: out.report,
    trace: out.trace,
    pipeline: 'v2',
  };
}

async function runV2(url, model, options = {}) {
  const capturedAt = options.capturedAt || '';
  const cp = await capturePlus(url);
  const dg = buildDependencyGraph({ model, capturePlus: cp });
  const bg = buildBehaviorGraph({ capturePlus: cp, dependency: dg.dependency, sections: dg.sections });
  const ir = {
    meta: { url, capturedAt, pipelineVersion: SCHEMA_VERSION },
    document: dg.document, sections: dg.sections, dependency: dg.dependency, behavior: bg.behavior,
    report: { warnings: [], approximations: [], skipped: [], review: [] },
    options: { isolate: !!options.isolate, pruneCss: !!options.pruneCss },
  };
  const out = generate(ir);

  // Fast deterministic acceptance gate (no rendering).
  const v = validateIR(ir);
  const part = partitionCheck(model.html, out.html);
  const gate = {
    pass: v.ok && part.missing === 0 && part.extra === 0,
    irValid: v.ok,
    coverage: +part.coverage.toFixed(4),
    overlap: +part.overlap.toFixed(4),
    errors: v.ok ? [] : v.errors.slice(0, 3),
  };
  return { result: toResult(ir, out), ir, out, gate };
}

module.exports = { runV2, toResult };
