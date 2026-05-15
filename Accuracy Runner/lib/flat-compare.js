/**
 * lib/flat-compare.js
 *
 * N3 Flat Comparison Mode — phase 3 of the N3 build.
 *
 * Grades cheatsheet item pairing WITHOUT the live app or Playwright.
 * Uses a JS port of lib/n3/normalization.ts primitives to simulate what
 * N3's Phase 12/13 candidate scoring would find using only the two
 * features available from cheatsheet data: description Jaccard similarity
 * and total amount similarity.
 *
 * Purpose: establish a deterministic baseline before any N3 pipeline code
 * is wired. The recall number this produces is the floor N3 must beat at
 * Phase 18. Precision and recall are computed against cheatsheet ground truth.
 *
 * Algorithm:
 *   1. Flatten all cheatsheet line items into a yours pool + adjuster pool.
 *   2. Compute all pairwise flat scores: 0.65 * jaccardSim + 0.35 * amtSim.
 *   3. Greedy assignment: sort by score, assign highest-scoring unmatched pairs
 *      above FLAT_SCORE_THRESHOLD = 0.15.
 *   4. Ground truth = items where both contractorDesc AND adjusterDesc exist
 *      (normalizedStatus 'match' or 'modified').
 *   5. Compare proposed pairs to ground truth → precision, recall, F1.
 *
 * Usage (from runner.js):
 *   const { flatCompare, printFlatSummary, writeFlatReport } = require('./lib/flat-compare');
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Constants (JS port of lib/n3/constants.ts) ────────────────────────────────

const ABBREV_EXPANSION = {
  'r&r':    'remove and replace',
  'd&r':    'detach and reset',
  'det':    'detach',
  'demo':   'demolition',
  'inst':   'install',
  'repl':   'replace',
  'rmv':    'remove',
  'reinst': 'reinstall',
};

const DESCRIPTION_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for',
  'with', 'on', 'at', 'by', 'is', 'it', 'as', 'be', 'that', 'this',
  'from', 'per', 'up', 'do', 'if', 'not',
]);

// Greedy pairing threshold. Lower than N3's 0.60 REJECT because we're only
// using 2 of 11 features — the normalized weights pull max score down to 1.0
// but a purely description-match pair needs ~0.25 Jaccard to clear 0.15.
const FLAT_SCORE_THRESHOLD = 0.15;

// Weight split for the 2 features we have from cheatsheet data.
// Derived by normalizing N3's descriptionFuzzySimilarity (0.20) and
// totalSimilarity (0.10) to sum to 1.0.
const W_DESC = 0.667;
const W_AMT  = 0.333;

// ── N3 normalization primitives (JS port) ─────────────────────────────────────

/**
 * Normalize a description string: lowercase, expand abbreviations,
 * strip non-alphanumeric, collapse whitespace.
 * Port of lib/n3/normalization.ts normalizeDescription().
 */
function normalizeDescription(description) {
  if (!description) return '';
  let s = String(description).toLowerCase().trim();

  for (const [abbrev, expansion] of Object.entries(ABBREV_EXPANSION)) {
    const escaped = abbrev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'gi');
    s = s.replace(re, expansion);
  }

  s = s.replace(/[^a-z0-9 ]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Tokenize a normalized description for Jaccard similarity.
 * Port of lib/n3/normalization.ts tokenizeDescription().
 */
function tokenize(normalizedDesc) {
  if (!normalizedDesc) return [];
  return normalizedDesc
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !DESCRIPTION_STOPWORDS.has(t));
}

/**
 * Jaccard similarity on token sets. Port of jaccardSimilarity().
 */
function jaccardSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

/**
 * Step-function amount similarity. Port of amountSimilarity().
 */
function amountSimilarity(a, b) {
  if (a == null || b == null) return 0;
  if (a === 0 && b === 0) return 1.0;
  if (a === 0 || b === 0) return 0;
  const ratio = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  if (ratio < 0.02) return 1.0;
  if (ratio < 0.05) return 0.9;
  if (ratio < 0.10) return 0.75;
  if (ratio < 0.20) return 0.5;
  if (ratio < 0.35) return 0.25;
  return 0.0;
}

/**
 * Compute flat score combining description Jaccard and amount similarity.
 * Uses normalized N3 weights (desc 0.667, amount 0.333).
 */
function flatScore(yourDesc, adjDesc, yourAmt, adjAmt) {
  const normY = normalizeDescription(yourDesc);
  const normA = normalizeDescription(adjDesc);
  const tokY  = tokenize(normY);
  const tokA  = tokenize(normA);

  const jSim  = jaccardSimilarity(tokY, tokA);
  const aSim  = amountSimilarity(yourAmt, adjAmt);

  return W_DESC * jSim + W_AMT * aSim;
}

// ── Key normalization for dedup ────────────────────────────────────────────────

function descKey(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Main flat compare ──────────────────────────────────────────────────────────

/**
 * Run flat N3 comparison against a single parsed cheatsheet.
 *
 * @param {object} cheatsheet  Output of parseCheatsheet()
 * @returns {FlatCompareResult}
 */
function flatCompare(cheatsheet) {
  // Flatten all line items across all zones
  const allItems = (cheatsheet.lineItems || []).flatMap(z => z.items || []);

  // Ground truth: rows with both contractor AND adjuster descriptions (MATCH + MODIFIED).
  // These are the pairs N3 must find purely from text + amount.
  const groundTruthItems = allItems.filter(
    item => item.contractorDesc && item.adjusterDesc &&
      (item.normalizedStatus === 'match' || item.normalizedStatus === 'modified'),
  );

  // Yours pool: items with a contractor description
  const yoursPool = allItems.filter(item => item.contractorDesc);

  // Adjuster pool: items with an adjuster description
  const adjPool = allItems.filter(item => item.adjusterDesc);

  // Score all pairs
  const scored = [];
  for (const y of yoursPool) {
    for (const a of adjPool) {
      const score = flatScore(
        y.contractorDesc, a.adjusterDesc,
        y.contractorDollars, a.adjusterRcvDollars,
      );
      scored.push({ yours: y, adjuster: a, score });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Greedy assignment — no double-assignment
  const usedYours    = new Set();
  const usedAdjuster = new Set();
  const proposed     = [];

  for (const pair of scored) {
    if (pair.score < FLAT_SCORE_THRESHOLD) break;
    const yk = descKey(pair.yours.contractorDesc);
    const ak = descKey(pair.adjuster.adjusterDesc);
    if (usedYours.has(yk) || usedAdjuster.has(ak)) continue;
    usedYours.add(yk);
    usedAdjuster.add(ak);
    proposed.push(pair);
  }

  // Build ground truth lookup: (normalised contractor) + '|||' + (normalised adjuster)
  const gtSet = new Set(
    groundTruthItems.map(
      item => `${descKey(item.contractorDesc)}|||${descKey(item.adjusterDesc)}`,
    ),
  );

  // Evaluate
  let truePositives = 0;
  const falsePositives = [];
  const falseNegatives = [];

  for (const pair of proposed) {
    const key = `${descKey(pair.yours.contractorDesc)}|||${descKey(pair.adjuster.adjusterDesc)}`;
    if (gtSet.has(key)) {
      truePositives++;
    } else {
      falsePositives.push(pair);
    }
  }

  const foundKeys = new Set(
    proposed.map(
      p => `${descKey(p.yours.contractorDesc)}|||${descKey(p.adjuster.adjusterDesc)}`,
    ),
  );
  for (const item of groundTruthItems) {
    const key = `${descKey(item.contractorDesc)}|||${descKey(item.adjusterDesc)}`;
    if (!foundKeys.has(key)) {
      falseNegatives.push(item);
    }
  }

  const precision = proposed.length === 0
    ? 0
    : truePositives / proposed.length;
  const recall = groundTruthItems.length === 0
    ? 1
    : truePositives / groundTruthItems.length;
  const f1 = precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);

  return {
    setId:              cheatsheet.setId,
    groundTruthCount:   groundTruthItems.length,
    yoursPoolSize:      yoursPool.length,
    adjPoolSize:        adjPool.length,
    proposedCount:      proposed.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    proposed,
    groundTruthItems,
    summary: cheatsheet.summary,
  };
}

// ── Console output ────────────────────────────────────────────────────────────

function pct(n) {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : 'N/A';
}

/**
 * Print a per-set flat compare summary to stdout.
 */
function printFlatSummary(result) {
  const ok = result.f1 >= 0.70;
  const icon = ok ? '✓' : '⚠';

  console.log(`\n  ${icon} ${result.setId} [FLAT MODE]`);
  console.log(`     Ground-truth pairs : ${result.groundTruthCount} (MATCH + MODIFIED)`);
  console.log(`     Proposed pairs     : ${result.proposedCount}`);
  console.log(`     True positives     : ${result.truePositives}`);
  console.log(`     Precision          : ${pct(result.precision)}`);
  console.log(`     Recall             : ${pct(result.recall)}`);
  console.log(`     F1                 : ${pct(result.f1)}`);

  if (result.falseNegatives.length > 0) {
    console.log(`\n     MISSED pairs (${result.falseNegatives.length}):`);
    for (const fn of result.falseNegatives.slice(0, 5)) {
      console.log(`       ✗ "${fn.contractorDesc}"  ↔  "${fn.adjusterDesc}"`);
    }
    if (result.falseNegatives.length > 5) {
      console.log(`       … and ${result.falseNegatives.length - 5} more`);
    }
  }

  if (result.falsePositives.length > 0) {
    console.log(`\n     FALSE pairs (${result.falsePositives.length}):`);
    for (const fp of result.falsePositives.slice(0, 3)) {
      console.log(
        `       ? "${fp.yours.contractorDesc}"  ↔  "${fp.adjuster.adjusterDesc}"` +
        `  (score=${fp.score.toFixed(3)})`,
      );
    }
    if (result.falsePositives.length > 3) {
      console.log(`       … and ${result.falsePositives.length - 3} more`);
    }
  }
}

/**
 * Print aggregate flat compare summary across all sets.
 */
function printFlatAggregateSummary(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length === 0) return;

  const avg = vals => vals.filter(Number.isFinite).reduce((s, v) => s + v, 0) /
    (vals.filter(Number.isFinite).length || 1);

  const avgPrec   = avg(valid.map(r => r.precision));
  const avgRecall = avg(valid.map(r => r.recall));
  const avgF1     = avg(valid.map(r => r.f1));

  const totalGT       = valid.reduce((s, r) => s + r.groundTruthCount, 0);
  const totalTP       = valid.reduce((s, r) => s + r.truePositives, 0);
  const totalFN       = valid.reduce((s, r) => s + r.falseNegatives.length, 0);
  const totalFP       = valid.reduce((s, r) => s + r.falsePositives.length, 0);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  N3 Flat Mode — Aggregate Pairing Accuracy               ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Avg Precision  : ${pct(avgPrec).padEnd(38)} ║`);
  console.log(`║  Avg Recall     : ${pct(avgRecall).padEnd(38)} ║`);
  console.log(`║  Avg F1         : ${pct(avgF1).padEnd(38)} ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Total GT pairs : ${String(totalGT).padEnd(38)} ║`);
  console.log(`║  True positives : ${String(totalTP).padEnd(38)} ║`);
  console.log(`║  False negatives: ${String(totalFN).padEnd(38)} ║`);
  console.log(`║  False positives: ${String(totalFP).padEnd(38)} ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n  This is the N3 text+amount baseline (2 of 11 features).');
  console.log('  N3 Phase 18 target: recall ≥ 95%, precision ≥ 90%.\n');
}

/**
 * Write a flat compare JSON report to the results directory.
 *
 * @param {Array} results    Array of flatCompare() outputs
 * @param {string} resultsDir
 * @returns {{ jsonPath: string }}
 */
function writeFlatReport(results, resultsDir) {
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(resultsDir, `flat-${ts}.json`);

  // Prune verbose per-item arrays from the JSON to keep it readable
  const slim = results.map(r => ({
    setId:            r.setId || r.error,
    error:            r.error || null,
    groundTruthCount: r.groundTruthCount ?? null,
    yoursPoolSize:    r.yoursPoolSize ?? null,
    adjPoolSize:      r.adjPoolSize ?? null,
    proposedCount:    r.proposedCount ?? null,
    truePositives:    r.truePositives ?? null,
    falsePositiveCount: r.falsePositives?.length ?? null,
    falseNegativeCount: r.falseNegatives?.length ?? null,
    precision:        r.precision ?? null,
    recall:           r.recall ?? null,
    f1:               r.f1 ?? null,
    falseNegatives: (r.falseNegatives || []).map(fn => ({
      contractorDesc: fn.contractorDesc,
      adjusterDesc:   fn.adjusterDesc,
      status:         fn.normalizedStatus,
    })),
    falsePositives: (r.falsePositives || []).map(fp => ({
      yourDesc:    fp.yours?.contractorDesc,
      adjDesc:     fp.adjuster?.adjusterDesc,
      score:       fp.score,
    })),
  }));

  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), results: slim }, null, 2));
  return { jsonPath };
}

module.exports = {
  flatCompare,
  printFlatSummary,
  printFlatAggregateSummary,
  writeFlatReport,
};
