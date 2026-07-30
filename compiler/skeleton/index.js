'use strict';

/**
 * Design Skeleton — see build.js for the full design rationale and
 * docs/FIGMA_DESIGN_MODEL_ARCHITECTURE_RESEARCH.md Part 3 for the proposal.
 */

const constants = require('./constants');
const {
  buildDesignSkeleton,
  classifyBaseRole,
  resolveReadingOrder,
  hasOwnVisualSignal,
  isRealAutoLayout,
} = require('./build');

module.exports = {
  ...constants,
  buildDesignSkeleton,
  classifyBaseRole,
  resolveReadingOrder,
  hasOwnVisualSignal,
  isRealAutoLayout,
};
