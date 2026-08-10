'use strict';

const { KnowledgeError, KnowledgeErrorKind } = require('./errors');
const { clone, computeChecksum, deepFreeze } = require('./checksum');
const { validateBundle } = require('./validate');

/**
 * Merge layers low → high. Higher layer replaces entries by entryId.
 * Deterministic: layers processed in order; entry iteration sorted by entryId when building output.
 */
function composeLayers(baseBundle, layerBundles = []) {
  const merged = clone(baseBundle);
  merged.entries = [...(merged.entries || [])];
  merged.relations = [...(merged.relations || [])];
  merged.packs = [...(merged.packs || [])];
  merged.priors = [...(merged.priors || [])];
  const composedFrom = [
    { bundleId: baseBundle.bundleId, version: baseBundle.version, checksum: baseBundle.checksum || null },
  ];

  for (const layer of layerBundles) {
    const byId = new Map(merged.entries.map((e) => [e.entryId, e]));
    for (const e of layer.entries || []) {
      byId.set(e.entryId, clone(e)); // override
    }
    merged.entries = [...byId.values()].sort((a, b) => (a.entryId < b.entryId ? -1 : 1));

    // Relations: union (dedupe by from|to|type)
    const relKey = (r) => `${r.from}|${r.to}|${r.type}`;
    const relMap = new Map((merged.relations || []).map((r) => [relKey(r), r]));
    for (const r of layer.relations || []) {
      relMap.set(relKey(r), clone(r));
    }
    merged.relations = [...relMap.values()].sort((a, b) => relKey(a).localeCompare(relKey(b)));

    // Packs union
    const packs = new Set([...(merged.packs || []), ...(layer.packs || [])]);
    merged.packs = [...packs].sort();

    // Priors: replace by entryId / priorId
    const priorKey = (p) => p.entryId || p.priorId || JSON.stringify(p);
    const priorMap = new Map((merged.priors || []).map((p) => [priorKey(p), p]));
    for (const p of layer.priors || []) {
      priorMap.set(priorKey(p), clone(p));
    }
    merged.priors = [...priorMap.values()];

    composedFrom.push({
      bundleId: layer.bundleId,
      version: layer.version,
      checksum: layer.checksum || null,
    });
  }

  merged.layers = composedFrom.map((c) => ({
    bundleId: c.bundleId,
    version: c.version,
  }));
  merged.composedFrom = composedFrom;
  delete merged.checksum;
  merged.checksum = computeChecksum(merged);
  return deepFreeze(merged);
}

/**
 * Compose using bundle.layers refs resolved via lookup(bundleId, version) → bundle.
 * layers: [{ bundleId, version }] after base.
 */
function composeFromManifest(rootBundle, lookup) {
  const layerBundles = [];
  for (const ref of rootBundle.layers || []) {
    if (!ref.bundleId || !ref.version) {
      throw new KnowledgeError(KnowledgeErrorKind.INVALID_BUNDLE, 'layer ref needs bundleId+version');
    }
    // Skip self-reference to root
    if (ref.bundleId === rootBundle.bundleId && ref.version === rootBundle.version) {
      continue;
    }
    const layer = lookup(ref.bundleId, ref.version);
    if (!layer) {
      throw new KnowledgeError(
        KnowledgeErrorKind.DEPENDENCY_MISSING,
        `layer missing: ${ref.bundleId}@${ref.version}`,
        { ...ref }
      );
    }
    layerBundles.push(layer);
  }
  if (!layerBundles.length) {
    const frozen = deepFreeze(clone(rootBundle));
    if (!frozen.checksum) {
      const withSum = clone(frozen);
      withSum.checksum = computeChecksum(withSum);
      return deepFreeze(withSum);
    }
    return frozen;
  }
  // Root is base; layers applied in order
  return composeLayers(rootBundle, layerBundles);
}

module.exports = { composeLayers, composeFromManifest };
