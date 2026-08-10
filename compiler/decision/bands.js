'use strict';

/** RFC-002 §5.3 priority bands — higher index = lower priority. */
const BAND_ORDER = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);

function bandRank(band) {
  const i = BAND_ORDER.indexOf(band || 'P5');
  return i < 0 ? BAND_ORDER.indexOf('P5') : i;
}

/** Lower number = higher priority. */
function compareBands(a, b) {
  return bandRank(a) - bandRank(b);
}

function isHardBand(band) {
  return band === 'P0' || band === 'P1';
}

module.exports = { BAND_ORDER, bandRank, compareBands, isHardBand };
