'use strict';
/**
 * Public API v1 response envelope helpers.
 * Additive only — preserves existing field semantics (ok, error, payload fields).
 */

const API_VERSION = '1';

/**
 * Success envelope fields always present on convert success.
 * Additional domain fields are passed through unchanged.
 */
function successEnvelope(fields = {}) {
  return {
    ok: true,
    ...fields,
  };
}

/**
 * Error envelope — frozen v1 shape.
 * Always includes: ok, errorCode, message, error (legacy alias), requestId.
 * Optional: details, and any domain extras (cache, budget, stage, …).
 */
function errorEnvelope({
  errorCode = 'INTERNAL_ERROR',
  message = 'Request failed',
  requestId = null,
  details = null,
  ...extras
} = {}) {
  const msg = String(message || 'Request failed');
  const body = {
    ok: false,
    errorCode: String(errorCode || 'INTERNAL_ERROR'),
    message: msg,
    error: msg,
    requestId: requestId || null,
    ...extras,
  };
  if (details && typeof details === 'object' && Object.keys(details).length) {
    body.details = details;
  }
  return body;
}

/** Map HTTP status for budget outcomes. */
function budgetErrorCode(outcome) {
  if (outcome === 'Queue') return 'BUDGET_QUEUE';
  if (outcome === 'Deny') return 'BUDGET_DENY';
  return 'BUDGET_BLOCKED';
}

module.exports = {
  API_VERSION,
  successEnvelope,
  errorEnvelope,
  budgetErrorCode,
};
