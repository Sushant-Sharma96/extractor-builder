'use strict';

const { RulePackError, RulePackErrorKind } = require('./errors');
const { checkPluginCompatibility, compareSemver } = require('../plugin/compatibility');

function satisfies(version, range) {
  if (!range || range === '*' || range === version) return true;
  if (range.startsWith('^')) {
    const base = range.slice(1);
    const pb = base.split('.').map((n) => parseInt(n, 10) || 0);
    const pv = version.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
    if (pv[0] !== pb[0]) return false;
    return compareSemver(version, base) >= 0;
  }
  if (range.startsWith('>=')) {
    return compareSemver(version, range.slice(2).trim()) >= 0;
  }
  return version === range;
}

/**
 * Policy + suite + allowlist + dependency presence checks.
 */
function checkRulePackCompatibility(pack, context = {}) {
  const issues = [];

  if (context.suiteVersion != null && pack.suiteVersion !== context.suiteVersion) {
    issues.push({ code: 'suite_version', message: 'suite mismatch' });
  }

  const policies = pack.allowedPolicies || [];
  if (context.profileId && policies.length && !policies.includes('*')
      && !policies.includes(context.profileId)) {
    issues.push({ code: 'policy', message: `profile ${context.profileId} not allowed` });
  }

  if (Array.isArray(context.allowedPackIds) && context.allowedPackIds.length > 0) {
    if (!context.allowedPackIds.includes(pack.packId)) {
      issues.push({ code: 'allowlist', message: `pack ${pack.packId} not in allowedPackIds` });
    }
  }

  // Plugin-level compatibility
  try {
    checkPluginCompatibility(pack.plugin, {
      suiteVersion: context.suiteVersion,
      profileId: context.profileId,
      allowedEngineIds: context.allowedEngineIds,
      determinismStrict: context.determinismStrict,
      enabledPluginIds: context.enabledPluginIds,
    });
  } catch (e) {
    issues.push({ code: 'plugin', message: e.message });
  }

  if (Array.isArray(context.registeredPackIds)) {
    for (const dep of pack.dependencies || []) {
      const found = context.registeredPackVersions
        && context.registeredPackVersions[dep.packId];
      if (!found) {
        if (dep.required !== false) {
          issues.push({
            code: 'dependency_missing',
            message: `missing dependency ${dep.packId}`,
          });
        }
      } else if (!satisfies(found, dep.versionRange)) {
        issues.push({
          code: 'dependency_version',
          message: `${dep.packId}@${found} does not satisfy ${dep.versionRange}`,
        });
      }
    }
  }

  if (issues.length) {
    throw new RulePackError(
      RulePackErrorKind.INCOMPATIBLE,
      `rule pack incompatible: ${issues.map((i) => i.code).join(', ')}`,
      { issues, packId: pack.packId }
    );
  }

  return { ok: true, packId: pack.packId };
}

module.exports = { checkRulePackCompatibility, satisfies };
