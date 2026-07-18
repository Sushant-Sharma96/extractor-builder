'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Corpus validation runner — regenerates the acceptance metrics behind
// CORPUS-VALIDATION.md for a given compiler version. Runs every reference site
// through the full v2 pipeline (capture → capture++ → DG → BG → generate → verify)
// and prints: per-site metrics, failures aggregated by category, PASS/FAIL summary.
// Writes machine-readable results to server/pipeline/corpus-report.json.
//
//   node server/pipeline/validate-corpus.js
//
// Update REFERENCE_CORPUS / EXCLUDED when the site set changes; paste the printed
// tables into CORPUS-VALIDATION.md and append a Regression History row.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { captureSite } = require('../capture');
const { capturePlus } = require('./capture-plus');
const { buildDependencyGraph } = require('./dependency-graph');
const { buildBehaviorGraph } = require('./behavior-graph');
const { generate } = require('./generate-v2');
const { verify } = require('./verify');
const { validateIR, SCHEMA_VERSION } = require('./ir');

const REFERENCE_CORPUS = [
  'https://etauto-revive.lovable.app',
  'https://et-storytelling-masterclass.lovable.app',
  'https://gcc-leadership-masterclass.lovable.app',
  'https://et-industry-leader.lovable.app',
  'https://etauto-retail-refined.lovable.app',
  'https://etauto-summit-forge.lovable.app',
  'https://ai-women-revolution.lovable.app',
  'https://elite-landing-alchemy.lovable.app',
  'https://eng-lead-pro.lovable.app',
  'https://flowforge-pixel-premium.lovable.app',
  'https://future-code-women.lovable.app',
  'https://nova-ai-league.lovable.app',
];
// Excluded (not convertible sites): reason kept for the audit trail.
const EXCLUDED = [{ url: 'https://preview--shine-luxe.lovable.app', reason: 'auth-gated login page (title="Login"), renders no site content' }];

const CATS = ['sectionPartition', 'domStructure', 'cssFidelity', 'behavior', 'console', 'visual', 'a11y'];

async function runOne(url) {
  // Per-phase timing + peak process RSS + graph size. capture/capture++ are
  // NETWORK-bound (high variance); graph/generate/verify are the deterministic
  // compute metrics of interest. Peak RSS is process-wide (cumulative across sites).
  const perf = {}; let peakRss = 0; const mark = () => { const r = process.memoryUsage().rss; if (r > peakRss) peakRss = r; };
  const phase = async (key, fn) => { const s = Date.now(); const v = await fn(); perf[key] = Date.now() - s; mark(); return v; };

  const model = await phase('captureMs', () => captureSite(url));
  const cp = await phase('capturePlusMs', () => capturePlus(url));
  let dg, bg;
  await phase('graphMs', async () => { dg = buildDependencyGraph({ model, capturePlus: cp }); bg = buildBehaviorGraph({ capturePlus: cp, dependency: dg.dependency, sections: dg.sections }); });
  const ir = { meta: { url, capturedAt: 'x', pipelineVersion: SCHEMA_VERSION }, document: dg.document, sections: dg.sections, dependency: dg.dependency, behavior: bg.behavior, report: { warnings: [], approximations: [], skipped: [], review: [] } };
  const irOk = validateIR(ir).ok;
  const out = await phase('generateMs', async () => generate(ir));
  const rep = await phase('verifyMs', () => verify({ url, ir, output: out, sourceHtml: model.html }));

  perf.peakRssMb = Math.round(peakRss / 1048576);
  perf.dgNodes = dg.dependency.nodes.length; perf.dgEdges = dg.dependency.edges.length;
  perf.bgNodes = bg.behavior.nodes.length; perf.bgEdges = bg.behavior.edges.length;
  perf.totalMs = perf.captureMs + perf.capturePlusMs + perf.graphMs + perf.generateMs + perf.verifyMs;
  return { name: url.replace('https://', '').replace('.lovable.app', ''), ok: true, gate: rep.gate.pass, failed: rep.gate.failedBlocking, irOk, sections: dg.sections.length, perf,
    scores: CATS.reduce((a, c) => { const v = rep.verdicts[c]; a[c] = v ? { score: v.score, pass: v.pass, advisory: !!v.advisory, f0: v.findings[0] } : null; return a; }, {}) };
}

async function main() {
  const rows = [];
  for (const url of REFERENCE_CORPUS) {
    const name = url.replace('https://', '').replace('.lovable.app', '');
    try { rows.push(await runOne(url)); console.log('done: ' + name + ' → ' + (rows[rows.length - 1].gate ? 'PASS' : 'FAIL')); }
    catch (e) { rows.push({ name, ok: false, error: e.message.slice(0, 120) }); console.log('ERR:  ' + name + ' → ' + e.message.slice(0, 80)); }
  }
  fs.writeFileSync(path.join(__dirname, 'corpus-report.json'), JSON.stringify({ generatedFor: SCHEMA_VERSION, rows, excluded: EXCLUDED }, null, 2));

  const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);
  console.log('\n===== PER-SITE =====');
  console.log(pad('SITE', 24) + CATS.map((c) => pad(c.slice(0, 8), 9)).join('') + 'OVERALL');
  rows.forEach((r) => {
    if (!r.ok) { console.log(pad(r.name, 24) + 'ERROR: ' + r.error); return; }
    console.log(pad(r.name, 24) + CATS.map((c) => pad(r.scores[c] ? r.scores[c].score : '-', 9)).join('') + (r.gate ? 'PASS' : 'FAIL(' + r.failed.join(',') + ')'));
  });

  console.log('\n===== FAILURES BY CATEGORY =====');
  const loaded = rows.filter((r) => r.ok);
  CATS.forEach((c) => {
    const failed = loaded.filter((r) => r.scores[c] && r.scores[c].pass === false).map((r) => r.name);
    const advisory = loaded.length && loaded[0].scores[c] ? loaded[0].scores[c].advisory : false;
    console.log('  ' + pad(c, 18) + (advisory ? '(advisory) ' : '(blocking) ') + failed.length + (failed.length ? ' — ' + failed.join(', ') : ''));
  });
  console.log('\n===== PERFORMANCE (ms; capture/capture++ are network-bound) =====');
  console.log(pad('SITE', 24) + ['capture', 'capt++', 'graph', 'gen', 'verify', 'total', 'rssMB', 'dgN', 'dgE', 'bgN'].map((h) => pad(h, 8)).join(''));
  loaded.forEach((r) => { const p = r.perf || {}; console.log(pad(r.name, 24) + [p.captureMs, p.capturePlusMs, p.graphMs, p.generateMs, p.verifyMs, p.totalMs, p.peakRssMb, p.dgNodes, p.dgEdges, p.bgNodes].map((x) => pad(x == null ? '-' : x, 8)).join('')); });
  const avg = (k) => Math.round(loaded.reduce((s, r) => s + (r.perf ? r.perf[k] : 0), 0) / (loaded.length || 1));
  console.log(pad('AVERAGE', 24) + ['captureMs', 'capturePlusMs', 'graphMs', 'generateMs', 'verifyMs', 'totalMs', 'peakRssMb', 'dgNodes', 'dgEdges', 'bgNodes'].map((k) => pad(avg(k), 8)).join(''));

  const pass = loaded.filter((r) => r.gate).length;
  console.log('\n===== SUMMARY =====  GATE PASS ' + pass + '/' + loaded.length + '  (excluded: ' + EXCLUDED.map((e) => e.url).join(', ') + ')');
}

if (require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
module.exports = { runOne, REFERENCE_CORPUS, EXCLUDED };
