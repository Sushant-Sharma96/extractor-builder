'use strict';

const { KnowledgeError, KnowledgeErrorKind } = require('./errors');

/**
 * Simple semver satisfaction for ^ and exact and >= ranges used in Phase 7.
 * Supports: "1.0.0", "^1.0.0", ">=1.0.0"
 */
function parseSemver(v) {
  const core = String(v).split('-')[0].split('+')[0];
  const [maj, min, pat] = core.split('.').map((n) => parseInt(n, 10) || 0);
  return { maj, min, pat };
}

function cmpSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.maj !== pb.maj) return pa.maj < pb.maj ? -1 : 1;
  if (pa.min !== pb.min) return pa.min < pb.min ? -1 : 1;
  if (pa.pat !== pb.pat) return pa.pat < pb.pat ? -1 : 1;
  return 0;
}

function satisfies(version, range) {
  if (!range || range === '*' || range === version) return true;
  if (range.startsWith('^')) {
    const base = range.slice(1);
    const pb = parseSemver(base);
    const pv = parseSemver(version);
    if (pv.maj !== pb.maj) return false;
    return cmpSemver(version, base) >= 0;
  }
  if (range.startsWith('>=')) {
    return cmpSemver(version, range.slice(2).trim()) >= 0;
  }
  return version === range;
}

/**
 * Resolve dependencies with cycle detection.
 * @param {object} root - validated bundle
 * @param {(bundleId: string) => Array<{version, bundle}>} catalogById - all known versions
 * @returns {{ order: object[], resolved: Map<string, object> }}
 */
function resolveDependencies(root, catalogById) {
  const resolved = new Map(); // bundleId -> bundle
  const visiting = new Set();
  const order = [];

  function pick(bundleId, versionRange, required) {
    const candidates = catalogById(bundleId) || [];
    const match = candidates
      .filter((c) => satisfies(c.version, versionRange))
      .sort((a, b) => cmpSemver(b.version, a.version))[0];
    if (!match) {
      if (required === false) return null;
      throw new KnowledgeError(
        KnowledgeErrorKind.DEPENDENCY_MISSING,
        `dependency not found: ${bundleId}@${versionRange}`,
        { bundleId, versionRange }
      );
    }
    return match.bundle;
  }

  function visit(bundle) {
    const key = bundle.bundleId;
    if (resolved.has(key)) {
      const existing = resolved.get(key);
      if (existing.version !== bundle.version) {
        throw new KnowledgeError(
          KnowledgeErrorKind.DEPENDENCY_CONFLICT,
          `diamond conflict for ${key}: ${existing.version} vs ${bundle.version}`,
          { bundleId: key, a: existing.version, b: bundle.version }
        );
      }
      return;
    }
    if (visiting.has(key)) {
      throw new KnowledgeError(
        KnowledgeErrorKind.DEPENDENCY_CYCLE,
        `dependency cycle involving ${key}`,
        { bundleId: key }
      );
    }
    visiting.add(key);

    for (const dep of bundle.dependencies || []) {
      const child = pick(dep.bundleId, dep.versionRange, dep.required !== false);
      if (child) visit(child);
    }

    visiting.delete(key);
    resolved.set(key, bundle);
    order.push(bundle);
  }

  visit(root);
  return { order, resolved };
}

module.exports = { resolveDependencies, satisfies, cmpSemver, parseSemver };
