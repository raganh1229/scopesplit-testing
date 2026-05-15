/**
 * lib/compare.js
 *
 * Diffs the app's pipeline output against a parsed cheat sheet.
 * Returns a structured accuracy report for a single set run.
 *
 * Three stages are evaluated independently:
 *   1. Zone Detection  — did the app find the right zones in each PDF?
 *   2. Zone Pairing    — did the app pair contractor ↔ adjuster zones correctly?
 *   3. Item Status     — did the app classify each line item correctly?
 */

'use strict';

// ── Text normalization ────────────────────────────────────────────────────────

function norm(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/r&r/g, 'rr')
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaccard similarity on word sets (0–1). */
function similarity(a, b) {
  const wa = new Set(norm(a).split(' ').filter(Boolean));
  const wb = new Set(norm(b).split(' ').filter(Boolean));
  if (wa.size === 0 && wb.size === 0) return 1;
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : inter / union;
}

function bestMatch(needle, haystack, threshold = 0.4) {
  let best = null;
  let bestScore = 0;
  const normNeedle = norm(needle);
  for (const item of haystack) {
    const score = similarity(normNeedle, norm(item));
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= threshold ? { item: best, score: bestScore } : null;
}

// ── Stage 1: Zone Detection ───────────────────────────────────────────────────

/**
 * Compare what the zone-review API returned vs what the cheat sheet expects.
 *
 * @param {{ e1Zones: Array, e2Zones: Array }} zoneReviewData
 * @param {string[]} expectedContractor
 * @param {string[]} expectedAdjuster
 */
function compareZoneDetection(zoneReviewData, expectedContractor, expectedAdjuster) {
  function evalSide(detectedArr, expectedArr, label) {
    const detected = detectedArr.map(z => z.name || z);
    const correct = [];
    const missed = [];
    const extra = [];

    for (const exp of expectedArr) {
      const hit = bestMatch(exp, detected, 0.45);
      if (hit) correct.push({ expected: exp, detected: hit.item, score: hit.score });
      else missed.push(exp);
    }
    const matchedDetected = new Set(correct.map(c => c.detected));
    for (const det of detected) {
      if (!matchedDetected.has(det)) extra.push(det);
    }

    const precision = detected.length === 0 ? 0 : correct.length / detected.length;
    const recall = expectedArr.length === 0 ? 1 : correct.length / expectedArr.length;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    return { label, detected, expected: expectedArr, correct, missed, extra, precision, recall, f1 };
  }

  const contractorSide = evalSide(
    zoneReviewData.e1Zones ?? [],
    expectedContractor,
    'Contractor',
  );
  const adjusterSide = evalSide(
    zoneReviewData.e2Zones ?? [],
    expectedAdjuster,
    'Adjuster',
  );

  const avgF1 = (contractorSide.f1 + adjusterSide.f1) / 2;

  return { contractorSide, adjusterSide, avgF1 };
}

// ── Stage 2: Zone Pairing ─────────────────────────────────────────────────────

/**
 * Compare match-review zone pairings vs cheat sheet expected pairings.
 */
function compareZonePairing(matchReviewData, expectedPairings) {
  // Build lookup: norm(contractorZone) → expected pairing object
  const pairingByContractor = new Map();
  const pairingByAdjuster = new Map();
  for (const p of expectedPairings) {
    if (p.contractor) pairingByContractor.set(norm(p.contractor), p);
    if (p.adjuster) pairingByAdjuster.set(norm(p.adjuster), p);
  }

  const correct = [];
  const wrong = [];

  // Evaluate each app pair
  for (const pair of matchReviewData.pairs ?? []) {
    const appE1 = pair.e1Zones.join(' + ');
    const appE2 = pair.e2Zones.join(' + ');

    // Find expected pairing for this e1 zone
    const hit = bestMatch(appE1, [...pairingByContractor.keys()].map(k => k), 0.35);
    const expPairing = hit ? pairingByContractor.get(norm(hit.item)) : null;

    if (!expPairing) {
      wrong.push({
        type: 'unexpected_pair',
        appE1, appE2,
        reason: `No expected pairing found for contractor zone "${appE1}"`,
      });
      continue;
    }

    if (!expPairing.match) {
      wrong.push({
        type: 'should_not_be_paired',
        appE1, appE2,
        expected: 'no match (contractor-only zone)',
        reason: `"${appE1}" should be unmatched but was paired with "${appE2}"`,
      });
      continue;
    }

    const adjHit = expPairing.adjuster ? similarity(appE2, expPairing.adjuster) : 0;
    if (adjHit < 0.35) {
      wrong.push({
        type: 'wrong_adjuster_zone',
        appE1, appE2,
        expectedAdjuster: expPairing.adjuster,
        reason: `"${appE1}" paired with wrong adjuster zone. Got "${appE2}", expected "${expPairing.adjuster}"`,
      });
    } else {
      correct.push({ appE1, appE2, expectedContractor: expPairing.contractor, expectedAdjuster: expPairing.adjuster });
    }
  }

  // Check unmatched e1 zones
  for (const zone of matchReviewData.unmatchedE1 ?? []) {
    const hit = bestMatch(zone, [...pairingByContractor.keys()], 0.35);
    const expPairing = hit ? pairingByContractor.get(norm(hit.item)) : null;
    if (expPairing && expPairing.match) {
      wrong.push({
        type: 'should_be_paired',
        appE1: zone, appE2: null,
        expectedAdjuster: expPairing.adjuster,
        reason: `"${zone}" was left unmatched but should pair with "${expPairing.adjuster}"`,
      });
    }
    // If expPairing.match === false, being unmatched is correct — do nothing
  }

  // Check unmatched e2 zones
  for (const zone of matchReviewData.unmatchedE2 ?? []) {
    const hit = bestMatch(zone, [...pairingByAdjuster.keys()], 0.35);
    const expPairing = hit ? pairingByAdjuster.get(norm(hit.item)) : null;
    if (expPairing && expPairing.match) {
      wrong.push({
        type: 'should_be_paired',
        appE1: null, appE2: zone,
        expectedContractor: expPairing.contractor,
        reason: `Adjuster zone "${zone}" was left unmatched but should pair with "${expPairing.contractor}"`,
      });
    }
  }

  const totalExpectedPairs = expectedPairings.filter(p => p.match).length;
  const accuracy = totalExpectedPairs === 0 ? 1 : correct.length / totalExpectedPairs;

  return { correct, wrong, totalExpectedPairs, accuracy };
}

// ── Stage 3: Line Item Status ─────────────────────────────────────────────────

/**
 * For a given zone's items, try to pair each cheat-sheet item to an app item
 * by normalized description, then compare statuses.
 */
function matchZoneItems(appItems, csItems) {
  // Build lookups by normalized contractor desc and adjuster desc
  const byYourDesc = new Map();
  const byAdjDesc = new Map();
  for (const csi of csItems) {
    if (csi.contractorDesc) byYourDesc.set(norm(csi.contractorDesc), csi);
    if (csi.adjusterDesc) byAdjDesc.set(norm(csi.adjusterDesc), csi);
  }

  const paired = [];
  const appUnpaired = [];

  for (const appItem of appItems) {
    const primaryDesc =
      appItem.status === 'added'
        ? appItem.adjuster?.description
        : appItem.your?.description;
    const fallbackDesc =
      appItem.status === 'added'
        ? appItem.your?.description
        : appItem.adjuster?.description;

    const normPrimary = norm(primaryDesc);
    const normFallback = norm(fallbackDesc);

    // Exact match first
    let csItem =
      byYourDesc.get(normPrimary) ||
      byAdjDesc.get(normPrimary) ||
      byYourDesc.get(normFallback) ||
      byAdjDesc.get(normFallback);

    // Fuzzy match if no exact
    if (!csItem) {
      const candidates = [...byYourDesc.values(), ...byAdjDesc.values()];
      const hit = bestMatch(primaryDesc || fallbackDesc, candidates.map(c => c.contractorDesc || c.adjusterDesc || ''), 0.45);
      if (hit) {
        csItem = candidates.find(c => norm(c.contractorDesc || '') === norm(hit.item) || norm(c.adjusterDesc || '') === norm(hit.item));
      }
    }

    if (!csItem) {
      appUnpaired.push({ appItem, reason: 'No matching cheat-sheet item found' });
      continue;
    }

    const statusCorrect = appItem.status === csItem.normalizedStatus;
    paired.push({
      appItem,
      csItem,
      statusCorrect,
      appStatus: appItem.status,
      expectedStatus: csItem.normalizedStatus,
    });
  }

  // Cheat sheet items with no app counterpart
  const pairedCsItems = new Set(paired.map(p => p.csItem));
  const csUnpaired = csItems.filter(c => !pairedCsItems.has(c));

  return { paired, appUnpaired, csUnpaired };
}

/**
 * Full line-item comparison across all zones.
 *
 * @param {{ zones: Array }} comparisonData  — from GET /api/comparisons/[id]
 * @param {Array} lineItems                  — from parseCheatsheet().lineItems
 * @returns {LineItemComparison}
 */
/**
 * Detect whether an app zone is the synthetic CROSS ZONE MATCHES bucket
 * produced by Pass 5 cross-zone reconciliation. These zones contain items
 * whose true home is some OTHER cheat-sheet zone — they were paired across
 * zone boundaries because contractor and adjuster filed them differently.
 */
function isCrossZoneMatchesZone(appZone) {
  const name = (appZone?.canonicalName || '').toLowerCase();
  return name === 'cross zone matches' || name.includes('cross zone match');
}

/**
 * Find the cheat-sheet zone whose item descriptions best match this app
 * item. Used to redistribute CROSS ZONE MATCHES items back into their
 * semantic home zones for grading. Returns null if no zone has a
 * confidently-matching item (threshold 0.45 on Jaccard).
 */
function findHomeCheatsheetZone(appItem, lineItems) {
  const primaryDesc = appItem.your?.description || appItem.adjuster?.description || '';
  const fallbackDesc = appItem.adjuster?.description || appItem.your?.description || '';

  let bestZone = null;
  let bestScore = 0;

  for (const csZone of lineItems) {
    for (const csi of csZone.items || []) {
      const candidates = [csi.contractorDesc, csi.adjusterDesc].filter(Boolean);
      for (const cand of candidates) {
        const score = Math.max(
          similarity(primaryDesc, cand),
          similarity(fallbackDesc, cand),
        );
        if (score > bestScore) {
          bestScore = score;
          bestZone = csZone;
        }
      }
    }
  }

  return bestScore >= 0.45 ? bestZone : null;
}

/**
 * Pre-process the app's zone list to redistribute Pass 5 cross-zone-matched
 * items into the cheat-sheet zones where they actually belong. Returns a
 * NEW array of app zones — original zones are kept intact (their items are
 * augmented with the redistributed cross-zone items keyed by description
 * lookup against each cheat-sheet zone's expected items).
 *
 * Without this step, every Pass 5 reconciliation costs the runner two
 * not_found tallies (one for the missing app row in the original zone, one
 * for the orphaned row in CROSS ZONE MATCHES).
 */
function redistributeCrossZoneItems(appZones, lineItems) {
  const csByCanonical = new Map();
  for (const csZone of lineItems) {
    const names = [csZone.contractorZone, csZone.adjusterZone].filter(Boolean);
    for (const n of names) csByCanonical.set(norm(n), csZone);
  }

  const regularZones = [];
  const crossZoneItems = [];

  for (const appZone of appZones) {
    if (isCrossZoneMatchesZone(appZone)) {
      crossZoneItems.push(...(appZone.items || []));
    } else {
      // Shallow-clone so we can safely append items without mutating caller state
      regularZones.push({ ...appZone, items: [...(appZone.items || [])] });
    }
  }

  if (crossZoneItems.length === 0) return regularZones;

  // For each cross-zone item, find the cheatsheet zone it semantically belongs
  // to, then locate (or synthesize) the corresponding app-side zone entry and
  // append the item there.
  for (const item of crossZoneItems) {
    const homeCsZone = findHomeCheatsheetZone(item, lineItems);
    if (!homeCsZone) {
      // Couldn't confidently place it — leave it in a synthetic bucket so it
      // still appears in the report (as appUnpaired) rather than vanishing.
      const orphanZone = regularZones.find(z => z.canonicalName === '__cross_zone_unplaced__');
      if (orphanZone) {
        orphanZone.items.push(item);
      } else {
        regularZones.push({
          canonicalName: '__cross_zone_unplaced__',
          yourName: null,
          adjusterName: null,
          items: [item],
        });
      }
      continue;
    }

    // Find the regular app zone that pairs with the cheatsheet zone we
    // identified. Match by either contractor or adjuster name.
    const homeNames = [homeCsZone.contractorZone, homeCsZone.adjusterZone]
      .filter(Boolean)
      .map(norm);
    let target = regularZones.find(z =>
      homeNames.includes(norm(z.canonicalName)) ||
      homeNames.includes(norm(z.yourName)) ||
      homeNames.includes(norm(z.adjusterName)),
    );

    if (!target) {
      // No app zone exists for this cheatsheet zone — synthesize one so the
      // main comparison loop processes it. Use the cheatsheet's contractor
      // name as canonical so csByCanonical finds it.
      target = {
        canonicalName: homeCsZone.contractorZone || homeCsZone.adjusterZone,
        yourName: homeCsZone.contractorZone || null,
        adjusterName: homeCsZone.adjusterZone || null,
        items: [],
      };
      regularZones.push(target);
    }

    target.items.push(item);
  }

  return regularZones;
}

function compareLineItems(comparisonData, lineItems) {
  // Build a lookup from canonical zone name → cheat-sheet zone entry
  const csByCanonical = new Map();
  for (const csZone of lineItems) {
    const names = [csZone.contractorZone, csZone.adjusterZone].filter(Boolean);
    for (const n of names) csByCanonical.set(norm(n), csZone);
  }

  // Pass 5 produces a synthetic CROSS ZONE MATCHES zone containing items
  // that were paired across zone boundaries. Redistribute those items back
  // to their semantic home zones BEFORE the per-zone comparison runs, so
  // cross-zone-matched items are graded against the cheat-sheet entries
  // they actually correspond to.
  const appZones = redistributeCrossZoneItems(
    comparisonData.zones ?? [],
    lineItems,
  );

  const zoneResults = [];
  const globalConfusion = {
    match:    { match: 0, modified: 0, missing: 0, added: 0, not_found: 0 },
    modified: { match: 0, modified: 0, missing: 0, added: 0, not_found: 0 },
    missing:  { match: 0, modified: 0, missing: 0, added: 0, not_found: 0 },
    added:    { match: 0, modified: 0, missing: 0, added: 0, not_found: 0 },
  };

  let totalPaired = 0;
  let totalCorrect = 0;
  let totalCsItems = 0;
  let totalAppUnpaired = 0;
  let totalCsUnpaired = 0;

  for (const appZone of appZones) {
    const canonKey = norm(appZone.canonicalName);
    // Try canonical, then yourName, then adjusterName
    let csZone =
      csByCanonical.get(canonKey) ||
      csByCanonical.get(norm(appZone.yourName)) ||
      csByCanonical.get(norm(appZone.adjusterName));

    if (!csZone) {
      // Fuzzy fallback across all known names
      const allKeys = [...csByCanonical.keys()];
      const hit = bestMatch(appZone.canonicalName, allKeys, 0.4);
      if (hit) csZone = csByCanonical.get(norm(hit.item));
    }

    if (!csZone) {
      zoneResults.push({
        appZone: appZone.canonicalName,
        csZone: null,
        note: 'Could not match this app zone to any cheat-sheet zone — skipped',
        paired: [], appUnpaired: appZone.items, csUnpaired: [],
      });
      continue;
    }

    const { paired, appUnpaired, csUnpaired } = matchZoneItems(appZone.items, csZone.items);

    totalPaired += paired.length;
    totalCorrect += paired.filter(p => p.statusCorrect).length;
    totalCsItems += csZone.items.length;
    totalAppUnpaired += appUnpaired.length;
    totalCsUnpaired += csUnpaired.length;

    // Populate confusion matrix
    for (const p of paired) {
      const exp = p.expectedStatus;
      const got = p.appStatus;
      if (globalConfusion[exp]) {
        globalConfusion[exp][got] = (globalConfusion[exp][got] ?? 0) + 1;
      }
    }
    for (const p of appUnpaired) {
      // App found an item the cheat sheet didn't — treat as noise for now
    }
    for (const p of csUnpaired) {
      // Cheat sheet item app didn't surface at all
      const exp = p.normalizedStatus;
      if (globalConfusion[exp]) globalConfusion[exp].not_found++;
    }

    zoneResults.push({
      appZone: appZone.canonicalName,
      csZone: csZone.contractorZone || csZone.adjusterZone,
      paired,
      appUnpaired,
      csUnpaired,
      zoneAccuracy: paired.length === 0 ? null : paired.filter(p => p.statusCorrect).length / paired.length,
    });
  }

  const overallAccuracy = totalPaired === 0 ? 0 : totalCorrect / totalPaired;
  const coverage = totalCsItems === 0 ? 0 : totalPaired / totalCsItems;

  // Per-status precision/recall
  const perStatus = {};
  for (const status of ['match', 'modified', 'missing', 'added']) {
    const row = globalConfusion[status];
    const tp = row[status] ?? 0;
    const fnTotal = Object.values(row).reduce((s, v) => s + v, 0) - tp;
    const fp = Object.values(globalConfusion).reduce((s, r) => s + (r[status] ?? 0), 0) - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fnTotal === 0 ? 0 : tp / (tp + fnTotal);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perStatus[status] = { tp, fp, fn: fnTotal, precision, recall, f1 };
  }

  return {
    zoneResults,
    confusionMatrix: globalConfusion,
    perStatus,
    overallAccuracy,
    coverage,
    totalPaired,
    totalCorrect,
    totalCsItems,
    totalAppUnpaired,
    totalCsUnpaired,
  };
}

// ── Insight generator ─────────────────────────────────────────────────────────

/**
 * Produces human-readable diagnostic bullets from the comparison results.
 * These pinpoint likely algorithmic failure modes.
 */
function generateInsights(zoneDetection, zonePairing, lineItemComp, setId) {
  const insights = [];

  // Zone detection issues
  for (const side of [zoneDetection.contractorSide, zoneDetection.adjusterSide]) {
    if (side.missed.length > 0) {
      insights.push({
        stage: 'zone-detection',
        severity: 'error',
        message: `[${setId}] ${side.label} PDF: ${side.missed.length} zone(s) not detected: ${side.missed.map(z => `"${z}"`).join(', ')}`,
        suggestion: 'Check if these zone header patterns are recognized by the zone-detection prompt or KNOWN_ZONE_PREFIXES.',
      });
    }
    if (side.extra.length > 0) {
      insights.push({
        stage: 'zone-detection',
        severity: 'warning',
        message: `[${setId}] ${side.label} PDF: ${side.extra.length} zone(s) detected that are not in the cheat sheet: ${side.extra.map(z => `"${z}"`).join(', ')}`,
        suggestion: 'These may be phantom zones hallucinated by the detector, or legitimate zones that are missing from the cheat sheet.',
      });
    }
  }

  // Zone pairing issues
  for (const w of zonePairing.wrong) {
    insights.push({
      stage: 'zone-pairing',
      severity: 'error',
      message: `[${setId}] Zone pairing error (${w.type}): ${w.reason}`,
      suggestion: w.type === 'should_not_be_paired'
        ? 'The zone matcher paired a contractor-only zone. Check confidence thresholds.'
        : w.type === 'should_be_paired'
        ? 'A zone that should be paired was left unmatched. Check similarity scoring for this name variant.'
        : 'Wrong adjuster zone was paired. Name variants may have fooled the matcher.',
    });
  }

  // Line item classification issues — identify confusion patterns
  const matrix = lineItemComp.confusionMatrix;

  // MATCH → MODIFIED confusion (over-sensitive cost detection)
  const matchAsMod = matrix.match?.modified ?? 0;
  if (matchAsMod > 0) {
    insights.push({
      stage: 'item-classification',
      severity: 'warning',
      message: `[${setId}] ${matchAsMod} MATCH item(s) classified as MODIFIED — possible over-sensitivity in cost comparison.`,
      suggestion: 'Items where costs match exactly are being flagged as different. Check float rounding or O&P/tax column interpretation.',
    });
  }

  // MODIFIED → MATCH confusion (under-sensitivity)
  const modAsMatch = matrix.modified?.match ?? 0;
  if (modAsMatch > 0) {
    insights.push({
      stage: 'item-classification',
      severity: 'warning',
      message: `[${setId}] ${modAsMatch} MODIFIED item(s) classified as MATCH — real discrepancies are being missed.`,
      suggestion: 'Cost differences are not being detected. Verify that the AI prompt instructs the model to compare unit prices and quantities, not just descriptions.',
    });
  }

  // MISSING items not surfaced
  const missingNotFound = matrix.missing?.not_found ?? 0;
  if (missingNotFound > 0) {
    insights.push({
      stage: 'item-classification',
      severity: 'error',
      message: `[${setId}] ${missingNotFound} MISSING item(s) from cheat sheet not surfaced by the app at all.`,
      suggestion: 'Contractor-only items are being lost. They may be miscategorized as MATCH/ADDED or dropped during processing.',
    });
  }

  // ADDED items not surfaced
  const addedNotFound = matrix.added?.not_found ?? 0;
  if (addedNotFound > 0) {
    insights.push({
      stage: 'item-classification',
      severity: 'error',
      message: `[${setId}] ${addedNotFound} ADDED item(s) from cheat sheet not surfaced by the app at all.`,
      suggestion: 'Adjuster-only items are being dropped. They may be getting merged with contractor items incorrectly.',
    });
  }

  // Coverage gap
  if (lineItemComp.coverage < 0.8) {
    insights.push({
      stage: 'item-classification',
      severity: 'error',
      message: `[${setId}] Low item coverage: only ${Math.round(lineItemComp.coverage * 100)}% of expected items were matched in the app output.`,
      suggestion: 'Many expected items are missing from the comparison result entirely. This could indicate zone detection/pairing failures upstream.',
    });
  }

  return insights;
}

// ── Top-level entry point ─────────────────────────────────────────────────────

/**
 * @param {object} runResult   — output of lib/run-set.js
 * @param {object} cheatsheet  — output of lib/parse-cheatsheet.js
 * @returns {ComparisonResult}
 */
function compare(runResult, cheatsheet) {
  const zoneDetection = compareZoneDetection(
    runResult.zoneReviewData ?? { e1Zones: [], e2Zones: [] },
    cheatsheet.contractorZones,
    cheatsheet.adjusterZones,
  );

  const zonePairing = compareZonePairing(
    runResult.matchReviewData ?? { pairs: [], unmatchedE1: [], unmatchedE2: [] },
    cheatsheet.expectedPairings,
  );

  const lineItemComp = compareLineItems(
    runResult.comparisonData ?? { zones: [] },
    cheatsheet.lineItems,
  );

  const insights = generateInsights(zoneDetection, zonePairing, lineItemComp, cheatsheet.setId);

  return {
    setId: cheatsheet.setId,
    comparisonId: runResult.comparisonId,
    zoneDetection,
    zonePairing,
    lineItems: lineItemComp,
    insights,
    summary: cheatsheet.summary,
    appCounts: {
      match: runResult.comparisonData?.comparison?.matchCount ?? null,
      modified: runResult.comparisonData?.comparison?.modifiedCount ?? null,
      missing: runResult.comparisonData?.comparison?.missingCount ?? null,
      added: runResult.comparisonData?.comparison?.addedCount ?? null,
    },
  };
}

module.exports = { compare };
