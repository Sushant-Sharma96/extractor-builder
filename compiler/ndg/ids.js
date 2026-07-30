'use strict';

const crypto = require('crypto');

/** Deterministic JSON — sorted keys recursively. */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function stableCompileId(sourceNodeId) {
  const raw = String(sourceNodeId || '').trim();
  if (!raw) {
    throw new Error('sourceNodeId required for stableCompileId');
  }
  // Preserve readability; normalize separators
  const cleaned = raw.replace(/\s+/g, '');
  return cleaned.startsWith('src:') ? cleaned : `src:${cleaned}`;
}

function edgeKey(kind, from, to, index) {
  const idx = index == null ? '' : String(index);
  return `${kind}:${from}:${to}:${idx}`;
}

function graphChecksum(graph) {
  const payload = {
    graphId: graph.graphId,
    rawDocumentId: graph.rawDocumentId || null,
    nodes: [...(graph.nodes || [])]
      .map((n) => ({
        id: n.id,
        sourceNodeId: n.sourceNodeId ?? null,
        visible: n.visible !== false,
        name: n.name ?? null,
        type: n.type ?? null,
        box: n.box || null,
        renderBox: n.renderBox || null,
        paints: n.paints || [],
        geometry: n.geometry || {},
        attributes: n.attributes || {},
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...(graph.edges || [])]
      .map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind,
        index: e.index == null ? null : e.index,
      }))
      .sort((a, b) => edgeKey(a.kind, a.from, a.to, a.index)
        .localeCompare(edgeKey(b.kind, b.from, b.to, b.index))),
  };
  return sha256(canonicalStringify(payload));
}

module.exports = {
  canonicalStringify,
  sha256,
  stableCompileId,
  edgeKey,
  graphChecksum,
};
