/**
 * runner-n3.js
 *
 * N3-specific accuracy runner.
 *
 * Stage 1: Trigger N3 pipeline via run-n3-set.ts
 *   (Supabase upload → Prisma row → Inngest event → poll until COMPLETED)
 * Stage 2: Fetch results directly from DB via fetch-n3-results.ts
 *   (No Playwright, no auth — reads n3_match_decisions + n3_line_items)
 * Stage 3: Compare against cheat sheet → generate accuracy report
 *
 * Usage:
 *   node runner-n3.js --set Set12
 *
 * Prerequisites:
 *   1. App running at localhost:3000
 *   2. Inngest dev server running:
 *        npx inngest-cli@latest dev -u http://127.0.0.1:3000/api/inngest
 *   3. .env.local in Primary Repository/estimatch-app/ with:
 *        DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseCheatsheet } = require('./lib/parse-cheatsheet');
const { compare }         = require('./lib/compare');
const { generateReport }  = require('./lib/report');

// ── Config ─────────────────────────────────────────────────────────────────────

const SET_ID = (() => {
  const idx = process.argv.indexOf('--set');
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error('Usage: node runner-n3.js --set Set12');
    process.exit(1);
  }
  return process.argv[idx + 1];
})();

const PDFS_DIR    = path.join(__dirname, '..', 'PDFS', 'Generated Sets');
const APP_DIR     = path.join(__dirname, '..', 'Primary Repository', 'estimatch-app');
const RESULTS_DIR = path.join(__dirname, 'results');

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(n) {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : 'N/A';
}

/** Spawn an npx tsx script (Windows-safe via shell:true + relative path). */
function spawnScript(scriptRelPath, extraArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptRelPath, ...extraArgs], {
      cwd:   APP_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    child.stdout.on('data', chunk => { const t = chunk.toString(); process.stdout.write(t); stdout += t; });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', err => reject(new Error(`spawn failed: ${err.message}`)));
    child.on('close', code => {
      if (code !== 0) reject(new Error(`${scriptRelPath} exited with code ${code}`));
      else resolve(stdout);
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║        Estimatch N3 Accuracy Runner                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`Set     : ${SET_ID}`);
  console.log(`Results : ${RESULTS_DIR}`);

  const cheatsheetPath = path.join(PDFS_DIR, SET_ID, `${SET_ID}_Cheatsheet.md`);
  if (!fs.existsSync(cheatsheetPath)) {
    console.error(`\nERROR: Cheatsheet not found: ${cheatsheetPath}`);
    console.error('Generate the set first with /pdfgenxactimate');
    process.exit(1);
  }

  // ── Step 1: Fire N3 pipeline and poll until COMPLETED ──────────────────────
  console.log(`\n[1/3] Triggering N3 pipeline for ${SET_ID}...\n`);
  const triggerOut  = await spawnScript('./scripts/run-n3-set.ts', ['--set', SET_ID]);
  const idMatch     = triggerOut.match(/COMPARISON_ID=([^\s\r\n]+)/);
  if (!idMatch) throw new Error('COMPARISON_ID not found in run-n3-set.ts output');
  const comparisonId = idMatch[1];
  console.log(`\n  Comparison ID: ${comparisonId}`);

  // ── Step 2: Fetch results directly from DB (no auth/Playwright needed) ─────
  // Use a relative path so shell:true doesn't choke on spaces in absolute paths.
  // cwd for the spawned script is APP_DIR, so the file lands in APP_DIR.
  console.log('\n[2/3] Fetching N3 results from database...');
  const tmpRelPath = `n3-tmp-${comparisonId}.json`;
  const tmpAbsPath = path.join(APP_DIR, tmpRelPath);
  await spawnScript('./scripts/fetch-n3-results.ts', ['--id', comparisonId, '--out', tmpRelPath]);

  const n3Data = JSON.parse(fs.readFileSync(tmpAbsPath, 'utf8'));
  fs.unlinkSync(tmpAbsPath);

  const mc = n3Data.comparison;
  console.log(`  ✓ Results loaded — match:${mc.matchCount ?? '?'} mod:${mc.modifiedCount ?? '?'} miss:${mc.missingCount ?? '?'} add:${mc.addedCount ?? '?'}`);

  // ── Step 3: Compare against cheat sheet and generate report ───────────────
  console.log('\n[3/3] Comparing against cheat sheet...');

  const cheatsheet = parseCheatsheet(cheatsheetPath);

  const runResult = {
    setId:           SET_ID,
    comparisonId,
    zoneReviewData:  n3Data.zoneReview,
    matchReviewData: n3Data.matchReview,
    comparisonData:  n3Data,
    error:           null,
  };

  const compResult = compare(runResult, cheatsheet);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const { jsonPath, mdPath } = generateReport([compResult], RESULTS_DIR);

  // ── Print summary ──────────────────────────────────────────────────────────
  const ia  = pct(compResult.lineItems?.overallAccuracy);
  const cov = pct(compResult.lineItems?.coverage);
  const zd  = pct(compResult.zoneDetection?.avgF1);
  const zp  = pct(compResult.zonePairing?.accuracy);
  const mF1 = pct(compResult.lineItems?.perStatus?.match?.f1);
  const dF1 = pct(compResult.lineItems?.perStatus?.modified?.f1);
  const sF1 = pct(compResult.lineItems?.perStatus?.missing?.f1);
  const aF1 = pct(compResult.lineItems?.perStatus?.added?.f1);
  const errs = compResult.insights?.filter(i => i.severity === 'error').length ?? 0;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  ${SET_ID} — N3 Accuracy Results`.padEnd(59) + '║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Zone Detection  (avg F1)  : ${zd.padEnd(28)}║`);
  console.log(`║  Zone Pairing    (accuracy): ${zp.padEnd(28)}║`);
  console.log(`║  Item Accuracy   (overall) : ${ia.padEnd(28)}║`);
  console.log(`║  Item Coverage             : ${cov.padEnd(28)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  MATCH F1   : ${mF1.padEnd(10)}  MODIFIED F1 : ${dF1.padEnd(22)}║`);
  console.log(`║  MISSING F1 : ${sF1.padEnd(10)}  ADDED F1    : ${aF1.padEnd(22)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Diagnostic errors flagged : ${String(errs).padEnd(28)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  MD   : ${mdPath}`);
  console.log(`  JSON : ${jsonPath}\n`);

  if (errs > 0) {
    console.log(`  ⚠  ${errs} error(s) — see the MD report for root-cause analysis.\n`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
