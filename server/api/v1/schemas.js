'use strict';
/**
 * Frozen v1 JSON schemas used by contract tests (mirrors openapi.yaml components).
 */

const ErrorEnvelope = {
  type: 'object',
  required: ['ok', 'errorCode', 'message', 'error', 'requestId'],
  properties: {
    ok: { const: false },
    errorCode: { type: 'string', minLength: 1 },
    message: { type: 'string' },
    error: { type: 'string' },
    requestId: { type: ['string', 'null'] },
    details: { type: 'object' },
  },
};

const CacheInfo = {
  type: 'object',
  required: ['status', 'reason', 'restCalls', 'compileMs'],
  properties: {
    status: { type: 'string', enum: ['HIT', 'SUBTREE', 'MISS'] },
    reason: { type: 'string' },
    restCalls: { type: 'number' },
    compileMs: { type: 'number' },
  },
};

const BudgetInfo = {
  type: 'object',
  required: ['outcome', 'reason'],
  properties: {
    outcome: { type: 'string', enum: ['Allow', 'Warn', 'Queue', 'Degrade', 'Deny'] },
    reason: { type: 'string' },
    predictedTier1: { type: ['number', 'null'] },
    predictedTier2: { type: ['number', 'null'] },
    warnings: { type: 'array', items: { type: 'string' } },
    retryAfter: { type: ['number', 'null'] },
    retryAfterUntil: { type: ['number', 'null'] },
    estimatedRemaining: { type: ['object', 'null'] },
    degrade: { type: ['object', 'null'] },
    predictionReason: { type: ['string', 'null'] },
  },
};

const ConvertSuccess = {
  type: 'object',
  required: ['ok', 'requestId', 'html', 'css', 'scripts', 'source', 'cache', 'budget'],
  properties: {
    ok: { const: true },
    requestId: { type: 'string' },
    html: { type: 'string' },
    css: { type: 'string' },
    scripts: { type: 'object' },
    sectionsSummary: { type: ['string', 'null'] },
    sections: { type: 'array' },
    source: { const: 'figma-compiler' },
    cache: CacheInfo,
    compiler: { type: 'object' },
    output: { type: ['object', 'null'] },
    previewUrl: { type: ['string', 'null'] },
    budget: BudgetInfo,
  },
};

const ConvertBudgetError = {
  type: 'object',
  required: ['ok', 'errorCode', 'message', 'error', 'requestId', 'stage', 'fileKey', 'cache', 'budget'],
  properties: {
    ok: { const: false },
    errorCode: { type: 'string', enum: ['BUDGET_DENY', 'BUDGET_QUEUE', 'BUDGET_BLOCKED'] },
    message: { type: 'string' },
    error: { type: 'string' },
    requestId: { type: ['string', 'null'] },
    stage: { type: 'string' },
    fileKey: { type: 'string' },
    nodeId: { type: ['string', 'null'] },
    cache: CacheInfo,
    budget: BudgetInfo,
  },
};

const HealthResponse = {
  type: 'object',
  required: ['status', 'uptime', 'cache', 'budget', 'compiler'],
  additionalProperties: false,
  properties: {
    status: { const: 'ok' },
    uptime: { type: 'integer', minimum: 0 },
    cache: { type: 'string', enum: ['ok', 'degraded'] },
    budget: { type: 'string', enum: ['ok', 'degraded'] },
    compiler: { type: 'string', enum: ['ok', 'degraded'] },
  },
};

const ReadyOk = {
  type: 'object',
  required: ['ready'],
  additionalProperties: false,
  properties: { ready: { const: true } },
};

const ReadyNotOk = {
  type: 'object',
  required: ['ready', 'configuration', 'filesystem', 'budgetStore', 'cache'],
  additionalProperties: false,
  properties: {
    ready: { const: false },
    configuration: { type: 'string', enum: ['ok', 'error'] },
    filesystem: { type: 'string', enum: ['ok', 'error'] },
    budgetStore: { type: 'string', enum: ['ok', 'error'] },
    cache: { type: 'string', enum: ['ok', 'error'] },
  },
};

const ConvertRequest = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    token: { type: 'string', maxLength: 512 },
  },
};

module.exports = {
  ErrorEnvelope,
  CacheInfo,
  BudgetInfo,
  ConvertSuccess,
  ConvertBudgetError,
  HealthResponse,
  ReadyOk,
  ReadyNotOk,
  ConvertRequest,
};
