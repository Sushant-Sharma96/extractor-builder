'use strict';

const { PluginError, PluginErrorKind } = require('./errors');
const { createPluginContext } = require('./context');

const Lifecycle = Object.freeze({
  LOAD: 'load',
  VALIDATE: 'validate',
  REGISTER: 'register',
  EXECUTE: 'execute',
  COMMIT: 'commit',
  DISPOSE: 'dispose',
});

function delayReject(ms, signal) {
  return new Promise((_, reject) => {
    const t = setTimeout(() => {
      reject(new PluginError(PluginErrorKind.TIMEOUT, `plugin timeout after ${ms}ms`));
    }, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new PluginError(PluginErrorKind.TIMEOUT, 'plugin aborted'));
      }, { once: true });
    }
  });
}

/**
 * Execute a registered plugin handler with isolation, timeout, retries, rollback.
 * handler(ctx) may be sync or async.
 *
 * @returns {Promise<{ ok, lifecycle, result?, error?, attempts }>}
 */
async function executePlugin({
  declaration,
  handler,
  workspace,
  policy,
  knowledge = null,
  onFailure = 'continue', // 'continue' | 'abort'
} = {}) {
  if (typeof handler !== 'function') {
    throw new PluginError(PluginErrorKind.INVALID_DECLARATION, 'handler function required');
  }

  const maxAttempts = (declaration.retries || 0) + 1;
  let lastError = null;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;
    const ac = new AbortController();
    const ctx = createPluginContext({
      workspace,
      declaration,
      policy,
      abortSignal: ac.signal,
      knowledge,
    });

    const lifecycle = {
      [Lifecycle.LOAD]: true,
      [Lifecycle.VALIDATE]: true,
      [Lifecycle.REGISTER]: true,
      [Lifecycle.EXECUTE]: false,
      [Lifecycle.COMMIT]: false,
      [Lifecycle.DISPOSE]: false,
    };

    try {
      lifecycle[Lifecycle.EXECUTE] = true;
      const work = Promise.resolve().then(() => handler(ctx));
      const result = await Promise.race([
        work,
        delayReject(declaration.timeout, ac.signal),
      ]);

      if (ctx.aborted) {
        throw new PluginError(PluginErrorKind.TIMEOUT, 'plugin aborted during execute');
      }

      // Commit = Workspace persistence of staged writes
      if (declaration.rollbackSupport === 'workspace_tx' || declaration.rollbackSupport === 'none'
          || declaration.rollbackSupport === 'invalidate_only') {
        ctx.commit();
        lifecycle[Lifecycle.COMMIT] = true;
      }

      ctx.dispose();
      lifecycle[Lifecycle.DISPOSE] = true;

      return {
        ok: true,
        lifecycle,
        result,
        attempts,
        pluginId: declaration.id,
      };
    } catch (err) {
      lastError = err instanceof PluginError
        ? err
        : new PluginError(PluginErrorKind.CRASH, err.message || String(err), { cause: err });

      // Rollback staged writes — Workspace commits never happened if commit not called
      try {
        if (declaration.rollbackSupport === 'workspace_tx' || declaration.rollbackSupport === 'none') {
          ctx.rollback();
        }
      } catch (_) { /* ignore */ }

      try {
        ctx.dispose();
        lifecycle[Lifecycle.DISPOSE] = true;
      } catch (_) { /* ignore */ }

      if (attempts < maxAttempts) {
        continue; // retry
      }
    }
  }

  const failure = {
    ok: false,
    lifecycle: { [Lifecycle.EXECUTE]: true, [Lifecycle.COMMIT]: false, [Lifecycle.DISPOSE]: true },
    error: lastError,
    attempts,
    pluginId: declaration.id,
    action: onFailure === 'abort' ? 'abort' : 'continue',
  };

  if (onFailure === 'abort') {
    const e = lastError || new PluginError(PluginErrorKind.CRASH, 'plugin failed');
    e.jobAction = 'abort';
    throw e;
  }

  return failure;
}

module.exports = { executePlugin, Lifecycle };
