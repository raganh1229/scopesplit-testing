/**
 * lib/build-confirm.js
 *
 * Converts the GET /api/comparisons/[id]/match-review response into the
 * { e1Slots, e2Slots } body expected by POST .../match-review/confirm.
 *
 * This exactly replicates the initSlots() logic from MatchReview.tsx:
 *   - For each pair: push joinNames(e1Zones) and joinNames(e2Zones)
 *   - For each unmatchedE1: push (name, null)
 *   - For each unmatchedE2: push (null, name)
 */

'use strict';

function joinNames(names) {
  return names.join(' + ');
}

/**
 * @param {{ pairs: Array, unmatchedE1: string[], unmatchedE2: string[] }} matchData
 * @returns {{ e1Slots: (string|null)[], e2Slots: (string|null)[] }}
 */
function buildConfirmBody(matchData) {
  const e1Slots = [];
  const e2Slots = [];

  for (const pair of matchData.pairs) {
    e1Slots.push(joinNames(pair.e1Zones));
    e2Slots.push(joinNames(pair.e2Zones));
  }
  for (const name of matchData.unmatchedE1) {
    e1Slots.push(name);
    e2Slots.push(null);
  }
  for (const name of matchData.unmatchedE2) {
    e1Slots.push(null);
    e2Slots.push(name);
  }

  return { e1Slots, e2Slots };
}

module.exports = { buildConfirmBody };
