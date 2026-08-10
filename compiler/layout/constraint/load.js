'use strict';

/**
 * Load LayoutIR₀ / LayoutIR₁ from Workspace.
 * Phase 11b.1: prefer explicit LayoutIR pin over last-created slice.
 */

const { LayoutError, LayoutErrorKind } = require('../errors');
const { STAGE_ID } = require('../constants');

function isSolvedPayload(payload) {
  return !!(payload && payload.constraintSolve);
}

function resolvePin(workspace, graphId) {
  if (!workspace || typeof workspace.getLayoutIrPin !== 'function') return null;
  if (graphId) return workspace.getLayoutIrPin(graphId);
  if (typeof workspace.listLayoutIrPins === 'function') {
    const pins = workspace.listLayoutIrPins();
    return pins.length === 1 ? pins[0] : null;
  }
  return null;
}

/**
 * @param {object} workspace
 * @param {{
 *   sliceId?: string,
 *   prefer?: 'baseline'|'solved'|'active',
 *   graphId?: string,
 * }} [opts]
 */
function loadLayoutIrFromWorkspace(workspace, opts = {}) {
  if (!workspace) {
    throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'workspace required');
  }
  if (opts.sliceId) {
    const slice = workspace.getIrSlice(opts.sliceId);
    if (!slice || slice.stageId !== STAGE_ID) {
      throw new LayoutError(LayoutErrorKind.INVALID_INPUT, `LayoutIR slice not found: ${opts.sliceId}`);
    }
    return slice;
  }

  const prefer = opts.prefer || 'baseline';
  const pin = resolvePin(workspace, opts.graphId);

  if (pin) {
    if (prefer === 'baseline' && pin.baselineLayoutIrSliceId) {
      const slice = workspace.getIrSlice(pin.baselineLayoutIrSliceId);
      if (slice && slice.stageId === STAGE_ID) return slice;
      throw new LayoutError(
        LayoutErrorKind.INVALID_INPUT,
        `pinned baseline LayoutIR missing: ${pin.baselineLayoutIrSliceId}`
      );
    }
    if (prefer === 'solved') {
      const sid = pin.activeLayoutIrSliceId;
      if (sid && sid !== pin.baselineLayoutIrSliceId) {
        const slice = workspace.getIrSlice(sid);
        if (slice && slice.stageId === STAGE_ID && isSolvedPayload(slice.payload)) return slice;
      }
      // else fall through to scan
    }
    if (prefer === 'active' && pin.activeLayoutIrSliceId) {
      const slice = workspace.getIrSlice(pin.activeLayoutIrSliceId);
      if (slice && slice.stageId === STAGE_ID) return slice;
      throw new LayoutError(
        LayoutErrorKind.INVALID_INPUT,
        `pinned active LayoutIR missing: ${pin.activeLayoutIrSliceId}`
      );
    }
  }

  // Legacy fallback — deterministic sort by slice id (avoid when pin exists for baseline/active)
  const ids = workspace.listIds('IrSlice').slice().sort();
  let baseline = null;
  let solved = null;
  for (const id of ids) {
    const slice = workspace.getIrSlice(id);
    if (!slice || slice.stageId !== STAGE_ID) continue;
    if (opts.graphId && slice.graphId && slice.graphId !== opts.graphId) continue;
    if (isSolvedPayload(slice.payload)) solved = slice;
    else baseline = slice;
  }

  if (prefer === 'solved') {
    if (solved) return solved;
    if (baseline) return baseline;
  } else if (prefer === 'active') {
    if (solved) return solved;
    if (baseline) return baseline;
  } else {
    if (baseline) return baseline;
    if (solved) return solved;
  }

  throw new LayoutError(LayoutErrorKind.INVALID_INPUT, 'LayoutIR₀ required — project LayoutIR first');
}

module.exports = { loadLayoutIrFromWorkspace, isSolvedPayload };
