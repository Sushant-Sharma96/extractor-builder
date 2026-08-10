'use strict';
/**
 * Public API v1 contract tests.
 * Validates published OpenAPI presence, schema fixtures, live probes, and legacy aliases.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { assertValid } = require('./schema-validate');
const schemas = require('./schemas');
const { errorEnvelope, successEnvelope, budgetErrorCode } = require('./envelope');

const ROOT = path.join(__dirname, '..', '..', '..');
const OPENAPI = path.join(ROOT, 'openapi.yaml');
const REPORT = path.join(ROOT, 'docs', 'CONTRACT_TEST_REPORT.md');

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail: detail || '' });
  console.log(`PASS  ${name}`);
}

function fail(name, err) {
  results.push({ name, ok: false, detail: String(err && err.message ? err.message : err) });
  console.error(`FAIL  ${name}\n  ${err && err.message ? err.message : err}`);
}

function test(name, fn) {
  try {
    fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (e) {
    fail(name, e);
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

// ── OpenAPI file contract ───────────────────────────────────────────────────
test('openapi.yaml exists', () => {
  if (!fs.existsSync(OPENAPI)) throw new Error('missing openapi.yaml');
});

test('openapi.yaml declares v1 paths', () => {
  const y = fs.readFileSync(OPENAPI, 'utf8');
  for (const p of ['/api/v1/convert:', '/api/v1/health:', '/api/v1/ready:', 'openapi: 3.1']) {
    if (!y.includes(p.replace('openapi: 3.1', 'openapi: 3.1.0')) && !y.includes(p)) {
      // allow openapi: 3.1.0
      if (p.startsWith('openapi') && y.includes('openapi: 3.1.0')) continue;
      throw new Error(`missing ${p}`);
    }
  }
  for (const p of ['/api/figma/convert:', '/health:', '/ready:']) {
    if (!y.includes(p)) throw new Error(`missing legacy path ${p}`);
  }
});

test('openapi.yaml includes error examples 400/429/503', () => {
  const y = fs.readFileSync(OPENAPI, 'utf8');
  if (!y.includes('"400":') && !y.includes('400:')) throw new Error('missing 400 response');
  if (!y.includes('"429":') && !y.includes('429:')) throw new Error('missing 429 response');
  if (!y.includes('"503":') && !y.includes('503:')) throw new Error('missing 503 response');
  if (!y.includes('INVALID_URL') || !y.includes('BUDGET_DENY') || !y.includes('BUDGET_QUEUE')) {
    throw new Error('missing errorCode examples');
  }
});

// ── Envelope helpers ────────────────────────────────────────────────────────
test('errorEnvelope shape', () => {
  const e = errorEnvelope({
    errorCode: 'INVALID_URL',
    message: 'bad',
    requestId: 'abc',
  });
  assertValid(schemas.ErrorEnvelope, e, 'errorEnvelope');
  if (e.error !== e.message) throw new Error('error alias mismatch');
});

test('successEnvelope shape', () => {
  const s = successEnvelope({
    requestId: 'abc',
    html: '<div/>',
    css: '',
    scripts: { 'script.js': '' },
    source: 'figma-compiler',
    cache: { status: 'HIT', reason: 'exact', restCalls: 0, compileMs: 1 },
    budget: { outcome: 'Allow', reason: 'ok' },
  });
  assertValid(schemas.ConvertSuccess, s, 'successEnvelope');
});

test('budgetErrorCode mapping', () => {
  if (budgetErrorCode('Deny') !== 'BUDGET_DENY') throw new Error('Deny');
  if (budgetErrorCode('Queue') !== 'BUDGET_QUEUE') throw new Error('Queue');
});

// ── Fixture schemas from OpenAPI examples ───────────────────────────────────
test('fixture ConvertSuccess', () => {
  assertValid(schemas.ConvertSuccess, {
    ok: true,
    requestId: 'a1b2c3d4e5f60718',
    html: '<!DOCTYPE html>',
    css: 'body{}',
    scripts: { 'script.js': '' },
    sectionsSummary: 'Hero',
    sections: [],
    source: 'figma-compiler',
    cache: { status: 'HIT', reason: 'exact', restCalls: 0, compileMs: 120 },
    compiler: { graphId: 'g:x', steps: [] },
    output: { dir: '/tmp', slug: 'x', assets: 0 },
    previewUrl: '/preview/x/',
    budget: {
      outcome: 'Allow',
      reason: 'within_budget',
      predictedTier1: 0,
      predictedTier2: 0,
      warnings: [],
      retryAfter: null,
      retryAfterUntil: null,
      estimatedRemaining: null,
      degrade: null,
      predictionReason: 'cache_hit',
    },
  }, 'ConvertSuccess fixture');
});

test('fixture Error 400', () => {
  assertValid(schemas.ErrorEnvelope, {
    ok: false,
    errorCode: 'INVALID_URL',
    message: 'Please provide a valid Figma design URL.',
    error: 'Please provide a valid Figma design URL.',
    requestId: 'a1b2c3d4e5f60718',
  }, '400');
});

test('fixture Error 429 BUDGET_DENY', () => {
  assertValid(schemas.ConvertBudgetError, {
    ok: false,
    errorCode: 'BUDGET_DENY',
    message: 'Budget Deny: rate_limit_lock_active',
    error: 'Budget Deny: rate_limit_lock_active',
    requestId: 'a1b2c3d4e5f60718',
    stage: 'MISS',
    fileKey: 'AbCdEfGhIjKlMnOpQrStUv',
    nodeId: '1:2',
    cache: { status: 'MISS', reason: 'no_snapshot', restCalls: 0, compileMs: 5 },
    budget: {
      outcome: 'Deny',
      reason: 'rate_limit_lock_active',
      predictedTier1: 2,
      predictedTier2: 1,
      warnings: ['Rate-limit lock active'],
      retryAfter: 60,
      retryAfterUntil: 1720000060000,
      estimatedRemaining: null,
      degrade: { preferCache: true },
      predictionReason: 'lock',
    },
  }, '429');
});

test('fixture Error 503 BUDGET_QUEUE', () => {
  assertValid(schemas.ConvertBudgetError, {
    ok: false,
    errorCode: 'BUDGET_QUEUE',
    message: 'Budget Queue: soft_cap',
    error: 'Budget Queue: soft_cap',
    requestId: 'a1b2c3d4e5f60718',
    stage: 'MISS',
    fileKey: 'AbCdEfGhIjKlMnOpQrStUv',
    nodeId: '1:2',
    cache: { status: 'MISS', reason: 'no_snapshot', restCalls: 0, compileMs: 4 },
    budget: {
      outcome: 'Queue',
      reason: 'soft_cap',
      predictedTier1: 3,
      predictedTier2: 1,
      warnings: ['Queued'],
      retryAfter: 30,
      retryAfterUntil: 1720000030000,
      estimatedRemaining: null,
      degrade: null,
      predictionReason: 'soft_cap',
    },
  }, '503');
});

test('fixture Health + Ready', () => {
  assertValid(schemas.HealthResponse, {
    status: 'ok', uptime: 10, cache: 'ok', budget: 'ok', compiler: 'ok',
  }, 'health');
  assertValid(schemas.ReadyOk, { ready: true }, 'ready ok');
  assertValid(schemas.ReadyNotOk, {
    ready: false,
    configuration: 'ok',
    filesystem: 'error',
    budgetStore: 'error',
    cache: 'error',
  }, 'ready not ok');
});

// ── Live HTTP (spawn server) ────────────────────────────────────────────────
async function runLive() {
  const port = 3011 + Math.floor(Math.random() * 80);
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
    REQUIRE_API_KEY: '0',
    LOG_LEVEL: 'ERROR',
    FIGMA_TOKEN: '',
    CONVERT_API_KEY: '',
  };
  delete env.FIGMA_CLIENT_SECRET;

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let boot = '';
  child.stdout.on('data', (d) => { boot += d; });
  child.stderr.on('data', (d) => { boot += d; });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await wait(150);
    try {
      const r = await fetch(`${base}/api/v1/ready`);
      if (r.ok) { ready = true; break; }
    } catch { /* retry */ }
  }
  if (!ready) {
    child.kill('SIGTERM');
    throw new Error(`server did not become ready\n${boot.slice(-600)}`);
  }

  await testAsync('live GET /api/v1/health', async () => {
    const { status, headers, body } = await fetchJson(`${base}/api/v1/health`);
    if (status !== 200) throw new Error(`status ${status}`);
    if (headers.get('x-api-version') !== '1') throw new Error('missing X-API-Version');
    assertValid(schemas.HealthResponse, body, 'live health v1');
  });

  await testAsync('live GET /health legacy match', async () => {
    const a = await fetchJson(`${base}/api/v1/health`);
    const b = await fetchJson(`${base}/health`);
    if (a.status !== 200 || b.status !== 200) throw new Error('status');
    for (const k of ['status', 'cache', 'budget', 'compiler']) {
      if (a.body[k] !== b.body[k]) throw new Error(`mismatch ${k}`);
    }
    assertValid(schemas.HealthResponse, b.body, 'legacy health');
  });

  await testAsync('live GET /api/v1/ready', async () => {
    const { status, headers, body } = await fetchJson(`${base}/api/v1/ready`);
    if (status !== 200) throw new Error(`status ${status}`);
    if (headers.get('x-api-version') !== '1') throw new Error('missing X-API-Version');
    assertValid(schemas.ReadyOk, body, 'live ready');
  });

  await testAsync('live GET /ready legacy', async () => {
    const { status, body } = await fetchJson(`${base}/ready`);
    if (status !== 200) throw new Error(`status ${status}`);
    assertValid(schemas.ReadyOk, body, 'legacy ready');
  });

  await testAsync('live GET /api/health compat', async () => {
    const { status, body } = await fetchJson(`${base}/api/health`);
    if (status !== 200 || body.ok !== true) throw new Error('compat health');
  });

  await testAsync('live POST /api/v1/convert 400', async () => {
    const { status, headers, body } = await fetchJson(`${base}/api/v1/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-figma-url' }),
    });
    if (status !== 400) throw new Error(`expected 400 got ${status}`);
    if (headers.get('x-api-version') !== '1') throw new Error('missing X-API-Version');
    assertValid(schemas.ErrorEnvelope, body, 'convert 400');
    if (body.errorCode !== 'INVALID_URL') throw new Error(`code ${body.errorCode}`);
  });

  await testAsync('live POST /api/figma/convert 400 alias', async () => {
    const { status, body } = await fetchJson(`${base}/api/figma/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (status !== 400) throw new Error(`expected 400 got ${status}`);
    assertValid(schemas.ErrorEnvelope, body, 'legacy convert 400');
  });

  await testAsync('live POST /api/v1/convert 401 without token', async () => {
    const { status, body } = await fetchJson(`${base}/api/v1/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/File?node-id=1-2',
      }),
    });
    if (status !== 401) throw new Error(`expected 401 got ${status} body=${JSON.stringify(body)}`);
    assertValid(schemas.ErrorEnvelope, body, 'convert 401');
    if (body.errorCode !== 'FIGMA_AUTH_REQUIRED') throw new Error(body.errorCode);
  });

  child.kill('SIGTERM');
  await wait(300);
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

(async () => {
  try {
    await runLive();
  } catch (e) {
    fail('live server suite', e);
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);

  const report = `# Contract Test Report — Public API v1

| Field | Value |
|-------|--------|
| **Date** | ${new Date().toISOString().slice(0, 10)} |
| **OpenAPI** | \`openapi.yaml\` (3.1) |
| **Result** | ${failed.length ? 'FAILED' : 'PASSED'} |
| **Passed** | ${passed.length} |
| **Failed** | ${failed.length} |

## Results

| Test | Status | Detail |
|------|--------|--------|
${results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${String(r.detail || '').replace(/\|/g, '/').slice(0, 120)} |`).join('\n')}

## Coverage

- OpenAPI document presence and required paths
- Envelope helpers (\`ok\` / \`errorCode\` / \`message\` / \`error\` / \`requestId\`)
- Fixtures: Convert success, 400, 429, 503, Health, Ready
- Live: \`/api/v1/health\`, \`/api/v1/ready\`, legacy aliases, convert 400/401
- Header: \`X-API-Version: 1\` on \`/api/v1/*\`

## Non-goals verified

- No planner / budget / resolver / executor / compiler logic changes in this suite
- Convert success path not exercised live (requires Figma) — schema covered by fixtures
`;

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, report);

  console.log(`\n${passed.length} passed, ${failed.length} failed`);
  console.log(`Report: ${REPORT}`);
  process.exit(failed.length ? 1 : 0);
})();
