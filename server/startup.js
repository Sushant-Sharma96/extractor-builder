'use strict';
/**
 * Startup validation — fail fast before accepting traffic.
 */

const { getConfig, validateConfig, ensureWritableDirs, publicConfigSummary } = require('./config');
const { logInfo, logError, logWarn } = require('./scalability/request-log');

function tryCompilerInit() {
  try {
    const { compile } = require('../compiler/compile');
    if (typeof compile !== 'function') {
      return { ok: false, error: 'compile export missing' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Run all startup checks. process.exit(1) on hard failure.
 * @returns {{ config, ready: true }}
 */
function runStartupValidation() {
  const config = getConfig();
  const cfgCheck = validateConfig(config);
  for (const w of cfgCheck.warnings) logWarn('startup_warning', { message: w });
  if (!cfgCheck.ok) {
    for (const e of cfgCheck.errors) logError('startup_config_error', { message: e });
    console.error('[startup] Configuration validation failed. Exiting.');
    process.exit(1);
  }

  const dirs = ensureWritableDirs(config);
  if (!dirs.ok) {
    for (const e of dirs.errors) logError('startup_fs_error', { message: e });
    console.error('[startup] Filesystem validation failed. Exiting.');
    process.exit(1);
  }

  // Align env for snapshot/budget modules that read process.env
  process.env.FIGMA_CACHE_DIR = config.cacheDir;
  process.env.FIGMA_BUDGET_DIR = config.budgetDir;
  process.env.OUTPUT_DIR = config.outputDir;
  if (!process.env.FIGMA_REQUEST_TIMEOUT_MS) {
    process.env.FIGMA_REQUEST_TIMEOUT_MS = String(config.requestTimeoutMs);
  }

  const compiler = tryCompilerInit();
  if (!compiler.ok) {
    logError('startup_compiler_error', { message: compiler.error });
    console.error('[startup] Compiler failed to load. Exiting.');
    process.exit(1);
  }

  logInfo('startup_ok', {
    ...publicConfigSummary(config),
    cacheWritable: true,
    budgetWritable: true,
    compiler: 'ok',
  });

  return { config, ready: true };
}

/** Lightweight readiness probe for /ready (no exit). */
function probeReadiness() {
  const config = getConfig();
  const cfgCheck = validateConfig(config);
  const dirs = ensureWritableDirs(config);
  const compiler = tryCompilerInit();
  const ready = cfgCheck.ok && dirs.ok && compiler.ok;
  return {
    ready,
    configuration: cfgCheck.ok ? 'ok' : 'error',
    filesystem: dirs.ok ? 'ok' : 'error',
    budgetStore: dirs.ok ? 'ok' : 'error',
    cache: dirs.ok ? 'ok' : 'error',
    compiler: compiler.ok ? 'ok' : 'error',
  };
}

module.exports = { runStartupValidation, probeReadiness, tryCompilerInit };
