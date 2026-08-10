'use strict';
/**
 * Safe HTTP errors — never leak stacks or secrets to clients.
 * Uses the frozen v1 error envelope (ok, errorCode, message, error, requestId).
 */

const { errorEnvelope } = require('../api/v1/envelope');

function sendError(res, {
  status = 500,
  errorCode = 'INTERNAL_ERROR',
  message = 'Request failed',
  requestId = null,
  details = null,
}) {
  const safeDetails = details && typeof details === 'object' ? {} : null;
  if (safeDetails) {
    for (const k of ['fileKey', 'nodeId', 'stage', 'retryAfter', 'upgradeUrl']) {
      if (details[k] !== undefined && details[k] !== null) safeDetails[k] = details[k];
    }
  }
  const body = errorEnvelope({
    errorCode,
    message,
    requestId,
    details: safeDetails && Object.keys(safeDetails).length ? safeDetails : null,
  });
  if (!res.headersSent) {
    return res.status(status).json(body);
  }
  return undefined;
}

module.exports = { sendError };
