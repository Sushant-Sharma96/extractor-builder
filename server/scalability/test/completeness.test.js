'use strict';
/**
 * Snapshot completeness gate — A/B/C regression tests.
 * @see docs/COMPILER_MIGRATION_BLUEPRINT.md (snapshot-completeness slice, requested
 * alongside the Phase 1 geometry work) and server/figma-snapshot.js's
 * saveSnapshotAtomic/validateSnapshot completeness contract:
 *   complete === true  only if every requiredVectorId is covered (reconstructed
 *   inline, in svgFallback, or downloaded as png) AND zero asset downloads failed.
 * A cache HIT must never occur on an incomplete snapshot (constraint #2, locked
 * earlier in this project) — a HIT with missing icons is worse than a MISS.
 */
const path = require('path');
const { assert, test, summary, resetCounts, tmpRoot, rmrf } = require('./_helpers');

async function run() {
  resetCounts();
  process.env.FIGMA_CACHE_DIR = tmpRoot('completeness');
  // Fresh require so getCacheDir() picks up FIGMA_CACHE_DIR set just above.
  delete require.cache[require.resolve('../../figma-snapshot')];
  const snap = require('../../figma-snapshot');

  const baseDoc = {
    document: { id: '1:1', type: 'FRAME', name: 'T', children: [] },
    name: 'T',
    fileName: 'test',
    version: '1',
  };

  // ── A: fully covered by local reconstruction alone → complete, real HIT ──
  await test('A: all required vectors reconstructed inline → complete + HIT', async () => {
    const dir = await snap.saveSnapshotAtomic({
      fileKey: 'fkA',
      nodeId: '1:1',
      url: 'https://figma.local/fkA',
      documentPayload: baseDoc,
      requiredVectorIds: ['v1', 'v2'],
      reconstructedVectorIds: ['v1', 'v2'],
    });
    const v = snap.validateSnapshot(dir);
    assert(v.ok === true, `expected HIT, got ${v.reason}`);
    assert(v.meta.complete === true, 'meta.complete');
    assert((v.meta.deferred || []).length === 0, 'no deferred');
  });

  // ── B: one required vector uncovered → persisted as partial, never a HIT ──
  await test('B: uncovered required vector → persisted partial, never a HIT', async () => {
    const dir = await snap.saveSnapshotAtomic({
      fileKey: 'fkB',
      nodeId: '1:1',
      url: 'https://figma.local/fkB',
      documentPayload: baseDoc,
      requiredVectorIds: ['v1', 'v2', 'v3-orphan'],
      reconstructedVectorIds: ['v1', 'v2'],
    });
    assert(dir, 'saveSnapshotAtomic must not throw/delete on a merely-incomplete write');
    const v = snap.validateSnapshot(dir);
    assert(v.ok === false, 'must not validate as HIT');
    assert(v.reason === 'incomplete_flag', `expected incomplete_flag, got ${v.reason}`);
    const meta = JSON.parse(require('fs').readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    assert(meta.complete === false, 'meta.complete false');
    assert(meta.deferred.includes('v3-orphan'), 'v3-orphan recorded as deferred');
    // Enabler for future top-up: the partial write is readable back.
    const partial = snap.loadPartialSnapshot('fkB', '1:1');
    assert(partial, 'loadPartialSnapshot must find the persisted partial');
    assert(partial.deferred.includes('v3-orphan'), 'partial exposes deferred ids');
    assert(snap.loadSnapshot('fkB', '1:1') === null, 'loadSnapshot must refuse an incomplete dir');
  });

  // ── C: download failure → persisted partial despite nominal id coverage ──
  await test('C: asset download failure → persisted partial despite id coverage', async () => {
    const dir = await snap.saveSnapshotAtomic({
      fileKey: 'fkC',
      nodeId: '1:1',
      url: 'https://figma.local/fkC',
      documentPayload: baseDoc,
      requiredVectorIds: ['v1'],
      reconstructedVectorIds: [],
      // Unroutable local port — fails fast (ECONNREFUSED), no real network hit.
      imageFillsRemote: { v1: 'http://127.0.0.1:9/asset.png' },
    });
    assert(dir, 'saveSnapshotAtomic must not throw/delete on a download-failure write');
    const v = snap.validateSnapshot(dir);
    assert(v.ok === false, 'must not validate as HIT');
    assert(v.reason === 'incomplete_flag', `expected incomplete_flag, got ${v.reason}`);
    const meta = JSON.parse(require('fs').readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    assert(meta.downloadFailures >= 1, 'download failure recorded');
    assert(meta.complete === false, 'meta.complete false');
  });

  const ok = summary();
  rmrf(process.env.FIGMA_CACHE_DIR);
  return ok;
}

if (require.main === module) {
  run().then((ok) => process.exit(ok ? 0 : 1));
}

module.exports = { run };
