/**
 * runner.js
 *
 * Main entry point for the Estimatch Accuracy Runner.
 *
 * Usage:
 *   node runner.js                        — run all discovered sets
 *   node runner.js --set Set1             — run a single set
 *   node runner.js --set Set1,Set2,Set3   — run specific sets
 *   node runner.js --url http://localhost:3001  — custom app URL
 *
 * Prerequisites:
 *   1. npm install
 *   2. npx playwright install chromium
 *   3. node setup-auth.js   (one-time login)
 *   4. App running at localhost:3000 (or --url)
 *   5. Inngest dev server running (required for async pipeline steps)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { runSet } = require('./lib/run-set');
const { parseCheatsheet } = require('./lib/parse-cheatsheet');
const { compare } = require('./lib/compare');
const { generateReport } = require('./lib/report');
const {
  flatCompare,
  printFlatSummary,
  printFlatAggregateSummary,
  writeFlatReport,
} = require('./lib/flat-compare');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = (() => {
  const idx = process.argv.indexOf('--url');
  return idx !== -1 ? process.argv[idx + 1] : 'http://localhost:3000';
})();

const SET_FILTER = (() => {
  const idx = process.argv.indexOf('--set');
  if (idx === -1) return null;
  return process.argv[idx + 1].split(',').map(s => s.trim());
})();

// --mode full (default) runs the full Playwright + app pipeline.
// --mode flat runs pure cheatsheet text+amount comparison (no app, no browser).
const MODE = (() => {
  const idx = process.argv.indexOf('--mode');
  return idx !== -1 ? process.argv[idx + 1] : 'full';
})();

const AUTH_FILE = path.join(__dirname, 'auth.json');
const PDFS_DIR = path.join(
  __dirname,
  '..',
  'PDFS',
  'Generated Sets',
);
const RESULTS_DIR = path.join(__dirname, 'results');

// ── Set discovery ─────────────────────────────────────────────────────────────

/**
 * Walk the Generated Sets folder and find all sets that have:
 *   - A Contractor_*.pdf
 *   - An Adjuster_*.pdf
 *   - A *_Cheatsheet.md
 *
 * Handles both flat (Set1/) and nested (ExampleSets/SetB/) layouts.
 */
function discoverSets(rootDir) {
  const sets = [];

  function walk(dir, depth = 0) {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const files = entries.filter(e => e.isFile()).map(e => e.name);
    const contractorPdf = files.find(f => /^Contractor_/i.test(f) && f.endsWith('.pdf'));
    const adjusterPdf = files.find(f => /^Adjuster_/i.test(f) && f.endsWith('.pdf'));
    const cheatsheet = files.find(f => /_Cheatsheet\.md$/i.test(f));

    if (contractorPdf && adjusterPdf && cheatsheet) {
      const setId = cheatsheet.replace('_Cheatsheet.md', '');
      sets.push({
        setId,
        dir,
        contractorPdf: path.join(dir, contractorPdf),
        adjusterPdf: path.join(dir, adjusterPdf),
        cheatsheetPath: path.join(dir, cheatsheet),
      });
    }

    for (const entry of entries.filter(e => e.isDirectory())) {
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(rootDir);
  return sets.sort((a, b) => a.setId.localeCompare(b.setId));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        Estimatch Accuracy Runner                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`Mode    : ${MODE}`);
  console.log(`App URL : ${BASE_URL}`);
  console.log(`PDFs    : ${PDFS_DIR}`);
  console.log(`Results : ${RESULTS_DIR}\n`);

  // Discover sets (same for both modes)
  let sets = discoverSets(PDFS_DIR);
  if (sets.length === 0) {
    console.error(`ERROR: No sets found in ${PDFS_DIR}`);
    process.exit(1);
  }

  // Apply filter
  if (SET_FILTER) {
    sets = sets.filter(s => SET_FILTER.includes(s.setId));
    if (sets.length === 0) {
      console.error(`ERROR: No sets matched filter: ${SET_FILTER.join(', ')}`);
      console.error(`Available sets: ${discoverSets(PDFS_DIR).map(s => s.setId).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Sets to run (${sets.length}): ${sets.map(s => s.setId).join(', ')}\n`);

  // ── Flat mode: pure cheatsheet text+amount scoring (no app, no browser) ──
  if (MODE === 'flat') {
    const results = [];
    for (const setInfo of sets) {
      let result;
      try {
        const cheatsheet = parseCheatsheet(setInfo.cheatsheetPath);
        result = flatCompare(cheatsheet);
      } catch (err) {
        console.error(`\n  ERROR running ${setInfo.setId}: ${err.message}`);
        result = { setId: setInfo.setId, error: err.message };
      }
      results.push(result);
      if (!result.error) printFlatSummary(result);
      else console.log(`\n  ❌ ${result.setId}: ERROR — ${result.error}`);
    }
    console.log('\n\nGenerating flat report...');
    const { jsonPath } = writeFlatReport(results, RESULTS_DIR);
    console.log(`  JSON : ${jsonPath}`);
    printFlatAggregateSummary(results);
    console.log('Done.\n');
    return;
  }

  // ── Full mode: Playwright + live app (original behaviour) ─────────────────
  // Check auth
  if (!fs.existsSync(AUTH_FILE)) {
    console.error('ERROR: auth.json not found. Run "node setup-auth.js" first.');
    process.exit(1);
  }

  // Launch browser with saved auth state
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    storageState: AUTH_FILE,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Silence noisy console output from the app
  page.on('console', () => {});
  page.on('pageerror', err => console.warn(`  [page-error] ${err.message.slice(0, 120)}`));

  const results = [];

  for (const setInfo of sets) {
    let result;
    try {
      // Parse the cheat sheet up front so parse errors surface immediately
      const cheatsheet = parseCheatsheet(setInfo.cheatsheetPath);

      // Run the set through the app
      const runResult = await runSet(page, {
        setId: setInfo.setId,
        contractorPdf: setInfo.contractorPdf,
        adjusterPdf: setInfo.adjusterPdf,
        baseUrl: BASE_URL,
      });

      // Compare app output against cheat sheet
      result = compare(runResult, cheatsheet);
    } catch (err) {
      console.error(`\n  ERROR running ${setInfo.setId}: ${err.message}`);
      result = {
        setId: setInfo.setId,
        error: err.message,
        zoneDetection: null,
        zonePairing: null,
        lineItems: null,
        insights: [],
        summary: {},
        appCounts: {},
      };
    }
    results.push(result);

    // Brief summary per set
    printSetSummary(result);
  }

  await browser.close();

  // Generate report
  console.log('\n\nGenerating report...');
  const { jsonPath, mdPath } = generateReport(results, RESULTS_DIR);
  console.log(`  JSON : ${jsonPath}`);
  console.log(`  MD   : ${mdPath}`);

  // Print quick aggregate
  printAggregateSummary(results);

  console.log('\nDone.\n');
}

// ── Console helpers ───────────────────────────────────────────────────────────

function pct(n) {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : 'N/A';
}

function printSetSummary(r) {
  if (r.error) {
    console.log(`\n  ❌ ${r.setId}: ERROR — ${r.error}`);
    return;
  }
  const ia = pct(r.lineItems?.overallAccuracy);
  const cov = pct(r.lineItems?.coverage);
  const zd = pct(r.zoneDetection?.avgF1);
  const zp = pct(r.zonePairing?.accuracy);
  const insights = r.insights?.filter(i => i.severity === 'error').length ?? 0;
  console.log(`\n  ${insights === 0 ? '✓' : '⚠'} ${r.setId} — item acc: ${ia} | coverage: ${cov} | zone-det: ${zd} | zone-pair: ${zp} | errors: ${insights}`);
}

function printAggregateSummary(results) {
  const valid = results.filter(r => !r.error);
  if (valid.length === 0) return;

  const avg = vals => vals.filter(Number.isFinite).reduce((s, v) => s + v, 0) / (vals.filter(Number.isFinite).length || 1);

  const avgZD  = avg(valid.map(r => r.zoneDetection?.avgF1));
  const avgZP  = avg(valid.map(r => r.zonePairing?.accuracy));
  const avgIA  = avg(valid.map(r => r.lineItems?.overallAccuracy));
  const avgCov = avg(valid.map(r => r.lineItems?.coverage));

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  Aggregate Accuracy Across All Sets                      ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Zone Detection (avg F1)   : ${pct(avgZD).padEnd(28)}║`);
  console.log(`║  Zone Pairing  (accuracy)  : ${pct(avgZP).padEnd(28)}║`);
  console.log(`║  Item Accuracy             : ${pct(avgIA).padEnd(28)}║`);
  console.log(`║  Item Coverage             : ${pct(avgCov).padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  const totalErrors = results.flatMap(r => r.insights ?? []).filter(i => i.severity === 'error').length;
  if (totalErrors > 0) {
    console.log(`\n  ⚠  ${totalErrors} diagnostic error(s) flagged — see the report for details.\n`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
