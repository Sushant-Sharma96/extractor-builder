'use strict';

const { PluginError, PluginErrorKind } = require('./errors');

/**
 * Check plugin vs job context (suite, policy, allowlist, determinism, incompatibles).
 */
function checkPluginCompatibility(plugin, context = {}) {
  const issues = [];

  if (context.suiteVersion != null && plugin.contractSuiteVersion != null
      && plugin.contractSuiteVersion !== context.suiteVersion) {
    issues.push({ code: 'suite_version', message: 'contract suite mismatch' });
  }

  if (context.compilerVersion != null) {
    if (plugin.minCompilerVersion && compareSemver(context.compilerVersion, plugin.minCompilerVersion) < 0) {
      issues.push({ code: 'compiler_min', message: 'compiler below minCompilerVersion' });
    }
    if (plugin.maxCompilerVersion && compareSemver(context.compilerVersion, plugin.maxCompilerVersion) > 0) {
      issues.push({ code: 'compiler_max', message: 'compiler above maxCompilerVersion' });
    }
  }

  const policies = plugin.allowedPolicies || [];
  if (context.profileId && policies.length && !policies.includes('*') && !policies.includes(context.profileId)) {
    issues.push({ code: 'policy', message: `profile ${context.profileId} not in allowedPolicies` });
  }

  if (Array.isArray(context.allowedEngineIds) && context.allowedEngineIds.length > 0) {
    if (!context.allowedEngineIds.includes(plugin.id)) {
      issues.push({ code: 'allowlist', message: `plugin ${plugin.id} not in allowedEngineIds` });
    }
  }

  if (context.determinismStrict === true && plugin.determinism === 'nondeterministic') {
    issues.push({ code: 'determinism', message: 'nondeterministic plugin disabled under strict policy' });
  }

  if (Array.isArray(context.enabledPluginIds)) {
    for (const other of plugin.incompatiblePlugins || []) {
      if (context.enabledPluginIds.includes(other)) {
        issues.push({ code: 'incompatible', message: `incompatible with enabled ${other}` });
      }
    }
  }

  if (issues.length) {
    throw new PluginError(
      PluginErrorKind.INCOMPATIBLE,
      `plugin incompatible: ${issues.map((i) => i.code).join(', ')}`,
      { issues, pluginId: plugin.id }
    );
  }

  return { ok: true, pluginId: plugin.id };
}

/** Simple semver compare major.minor.patch (pre-release ignored for ordering). */
function compareSemver(a, b) {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

module.exports = { checkPluginCompatibility, compareSemver };
