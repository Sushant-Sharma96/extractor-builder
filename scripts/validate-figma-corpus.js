#!/usr/bin/env node
'use strict';
/**
 * Offline Figma layout corpus gate (Articles + IBM).
 * Does NOT touch Lovable server/pipeline corpus.
 *
 * Usage: node scripts/validate-figma-corpus.js
 * Writes: server/constraint-transcriber/figma-corpus-report.json
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'constraint-transcriber', 'figma-corpus-report.json');

const FIXTURES = [
  {
    name: 'articles',
    script: 'scripts/recompile-articles-offline.js',
    qaPath: path.join(ROOT, 'output', 'articles', '_emit-qa.json'),
    // Blocking: must promote measured regions; Path B alone is not enough if measured=0
    gate(qa) {
      const promoted = (qa.constraint && qa.constraint.promoted) || 0;
      const measured = qa.etMeasured || 0;
      const cards = qa.etCard || 0;
      const fail = [];
      if (promoted < 1 && measured < 1) fail.push('no_constraint_promotion');
      if (!qa.etCardGrid && cards < 2) fail.push('missing_card_row');
      if (qa.etPathB && measured < 1 && cards < 1) fail.push('path_b_without_recovery');
      return {
        pass: fail.length === 0,
        fail,
        promoted,
        measured,
        cards,
        etCardGrid: !!qa.etCardGrid,
        etPathB: !!qa.etPathB,
      };
    },
  },
  {
    name: 'ibm',
    script: 'scripts/recompile-ibm-offline.js',
    qaPath: path.join(ROOT, 'output', 'ibm', '_emit-qa.json'),
    gate(qa) {
      const fail = [];
      if (!qa.etCardGrid && !(qa.etCard > 0)) fail.push('missing_card_grid');
      if (!qa.etBanner) fail.push('missing_banner');
      if (qa.etPathB && !(qa.etCard > 0)) fail.push('path_b_without_cards');
      return {
        pass: fail.length === 0,
        fail,
        etCard: qa.etCard || 0,
        etBanner: !!qa.etBanner,
        etCardGrid: !!qa.etCardGrid,
        etPathB: !!qa.etPathB,
      };
    },
  },
];

function runFixture(fx) {
  const r = spawnSync(process.execPath, [path.join(ROOT, fx.script), 'auto'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const qa = fs.existsSync(fx.qaPath)
    ? JSON.parse(fs.readFileSync(fx.qaPath, 'utf8'))
    : null;
  const gate = qa ? fx.gate(qa) : { pass: false, fail: ['no_qa_json'] };
  return {
    name: fx.name,
    ok: gate.pass,
    exitCode: r.status,
    stderrTail: (r.stderr || '').slice(-800),
    gate,
    qa,
  };
}

function main() {
  const rows = FIXTURES.map(runFixture);
  const report = {
    generatedAt: new Date().toISOString(),
    engine: 'constraint-transcriber-v2-general',
    note: 'Figma layout corpus only — Lovable CORPUS-VALIDATION.md is separate and frozen.',
    pass: rows.every((r) => r.ok),
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    pass: report.pass,
    results: rows.map((r) => ({ name: r.name, ok: r.ok, gate: r.gate })),
    out: OUT,
  }, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
