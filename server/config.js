'use strict';
/**
 * Central configuration — env-driven with defaults.
 * No secrets are logged or exported as plaintext helpers for clients.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return String(raw);
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

function loadConfig() {
  const nodeEnv = strEnv('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';
  const outputDir = path.resolve(strEnv('OUTPUT_DIR', path.join(ROOT, 'output')));
  const cacheDir = path.resolve(strEnv('FIGMA_CACHE_DIR', path.join(outputDir, 'figma-cache')));
  const budgetDir = path.resolve(strEnv('FIGMA_BUDGET_DIR', path.join(cacheDir, '_budget')));
  const tempDir = path.resolve(strEnv('TEMP_DIRECTORY', path.join(outputDir, '.tmp')));

  return {
    nodeEnv,
    isProd,
    isDev: !isProd,
    port: intEnv('PORT', 3001),
    outputDir,
    cacheDir,
    budgetDir,
    tempDir,
    logLevel: strEnv('LOG_LEVEL', isProd ? 'INFO' : 'DEBUG').toUpperCase(),
    requestTimeoutMs: intEnv('REQUEST_TIMEOUT', intEnv('FIGMA_REQUEST_TIMEOUT_MS', 30000)),
    maxCacheSizeBytes: intEnv('MAX_CACHE_SIZE', 5 * 1024 * 1024 * 1024), // 5 GiB advisory
    maxLogSizeBytes: intEnv('MAX_LOG_SIZE', 50 * 1024 * 1024), // advisory for ops
    jsonBodyLimit: strEnv('JSON_BODY_LIMIT', '60mb'),
    convertApiKey: strEnv('CONVERT_API_KEY', ''),
    // Opt-in: set REQUIRE_API_KEY=1 (and CONVERT_API_KEY) for production gates.
    requireApiKey: boolEnv('REQUIRE_API_KEY', false),
    figmaTokenConfigured: Boolean(strEnv('FIGMA_TOKEN', '')),
    figmaClientIdConfigured: Boolean(strEnv('FIGMA_CLIENT_ID', '')),
    figmaRedirectUri: strEnv('FIGMA_REDIRECT_URI', ''),
    // Never expose secret values on this object
    _hasFigmaToken: Boolean(process.env.FIGMA_TOKEN),
    _hasFigmaClientSecret: Boolean(process.env.FIGMA_CLIENT_SECRET),
    _hasConvertApiKey: Boolean(process.env.CONVERT_API_KEY),
  };
}

let _config = null;

function getConfig() {
  if (!_config) _config = loadConfig();
  return _config;
}

/** Re-load (tests). */
function resetConfig() {
  _config = null;
  return getConfig();
}

/**
 * Validate config. Returns { ok, errors[], warnings[] }.
 * In production, missing API key when REQUIRE_API_KEY is a hard error.
 */
function validateConfig(cfg = getConfig()) {
  const errors = [];
  const warnings = [];

  if (!cfg.port || cfg.port < 1 || cfg.port > 65535) {
    errors.push('PORT must be a valid TCP port');
  }
  if (!['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(cfg.logLevel)) {
    errors.push('LOG_LEVEL must be DEBUG|INFO|WARN|ERROR');
  }
  if (cfg.requestTimeoutMs < 1000 || cfg.requestTimeoutMs > 600000) {
    errors.push('REQUEST_TIMEOUT must be between 1000 and 600000 ms');
  }
  if (cfg.requireApiKey && !cfg._hasConvertApiKey) {
    errors.push('REQUIRE_API_KEY is set but CONVERT_API_KEY is missing');
  }
  if (cfg.isProd && !cfg._hasFigmaToken && !cfg._hasFigmaClientSecret) {
    warnings.push('No FIGMA_TOKEN or OAuth client secret configured — converts need a pasted token or OAuth');
  }
  if (cfg.figmaRedirectUri && !/^https?:\/\//i.test(cfg.figmaRedirectUri)) {
    errors.push('FIGMA_REDIRECT_URI must be an http(s) URL');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Ensure dirs exist and are writable. */
function ensureWritableDirs(cfg = getConfig()) {
  const errors = [];
  for (const dir of [cfg.outputDir, cfg.cacheDir, cfg.budgetDir, cfg.tempDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (e) {
      errors.push(`Directory not writable: ${dir} (${e.message})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Safe public summary (no secrets). */
function publicConfigSummary(cfg = getConfig()) {
  return {
    nodeEnv: cfg.nodeEnv,
    port: cfg.port,
    logLevel: cfg.logLevel,
    cacheDirConfigured: true,
    budgetDirConfigured: true,
    requestTimeoutMs: cfg.requestTimeoutMs,
    maxCacheSizeBytes: cfg.maxCacheSizeBytes,
    requireApiKey: cfg.requireApiKey,
    figmaTokenConfigured: cfg._hasFigmaToken,
    figmaOAuthConfigured: cfg._hasFigmaClientSecret && cfg.figmaClientIdConfigured,
  };
}

module.exports = {
  loadConfig,
  getConfig,
  resetConfig,
  validateConfig,
  ensureWritableDirs,
  publicConfigSummary,
  ROOT,
};
