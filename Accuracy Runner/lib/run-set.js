/**
 * lib/run-set.js
 *
 * Drives a single set through the full Estimatch pipeline via Playwright.
 * Uses page.evaluate() for all API calls so Clerk session cookies are
 * automatically included — no manual cookie forwarding needed.
 *
 * Flow:
 *   1. Navigate to /app/new-comparison and upload PDFs
 *   2. Poll until AWAITING_ZONE_REVIEW
 *   3. Capture zone detection data (GET /zone-review)
 *   4. Confirm zone review — accept defaults
 *   5. Poll until AWAITING_MATCH_REVIEW
 *   6. Capture zone pairing data (GET /match-review)
 *   7. Confirm match review — accept defaults (build slots from match data)
 *   8. Poll until COMPLETED
 *   9. Capture final comparison data (GET /comparisons/[id])
 *  10. Return all captured data
 */

'use strict';

const path = require('path');
const { buildConfirmBody } = require('./build-confirm');

const POLL_INTERVAL_MS = 3_000;
const UPLOAD_TIMEOUT_MS = 90_000;    // waiting for comparison to be created
const ZONE_TIMEOUT_MS  = 180_000;    // zone detection can take 1-2 min
const MATCH_TIMEOUT_MS = 180_000;    // match processing
const DONE_TIMEOUT_MS  = 300_000;    // final extract-and-match pass

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiGet(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GET ${u} → ${r.status}`);
    return r.json();
  }, url);
}

async function apiPost(page, url, body) {
  return page.evaluate(async ({ u, b }) => {
    const r = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }, { u: url, b: body });
}

// ── Status poller ─────────────────────────────────────────────────────────────

async function pollUntil(page, comparisonId, targetStatuses, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  Waiting for ${targetStatuses.join('/')} (${label})`);
  while (Date.now() < deadline) {
    const data = await apiGet(page, `/api/comparisons/${comparisonId}`);
    const status = data.comparison?.status;
    if (!status) throw new Error('Unexpected API response: no comparison.status');
    if (status === 'FAILED') {
      process.stdout.write(' FAILED\n');
      throw new Error(`Comparison FAILED: ${data.comparison?.errorMessage ?? 'unknown'}`);
    }
    if (targetStatuses.includes(status)) {
      process.stdout.write(` ✓ (${status})\n`);
      return data;
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${targetStatuses.join(' or ')}`);
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * @param {import('playwright').Page} page
 * @param {{ setId, contractorPdf, adjusterPdf, baseUrl }} opts
 * @returns {Promise<RunResult>}
 */
async function runSet(page, { setId, contractorPdf, adjusterPdf, baseUrl }) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Running: ${setId}`);
  console.log(`  Contractor: ${path.basename(contractorPdf)}`);
  console.log(`  Adjuster  : ${path.basename(adjusterPdf)}`);
  console.log(`${'─'.repeat(60)}`);

  // ── Step 1: Upload ──────────────────────────────────────────────────────
  console.log('  [1/5] Uploading PDFs...');
  await page.goto(`${baseUrl}/app/new-comparison`, { waitUntil: 'domcontentloaded' });

  // Fill optional name
  const nameInput = page.locator('input#comparison-name');
  await nameInput.waitFor({ timeout: 10000 });
  await nameInput.fill(`[AUTO] ${setId}`);

  // Upload contractor PDF — after this React removes that input and shows the filename
  await page.locator('input[type="file"]').first().setInputFiles(contractorPdf);

  // Wait for React to re-render (contractor input gone, filename shown)
  await page.waitForFunction(
    () => document.querySelectorAll('input[type="file"]').length === 1,
    { timeout: 5000 }
  ).catch(() => {});

  // Upload adjuster PDF — now the only remaining file input
  await page.locator('input[type="file"]').first().setInputFiles(adjusterPdf);

  // Wait for both files to be in state (button becomes enabled)
  await page.waitForFunction(
    () => !document.querySelector('button[class*="compareBtn"]')?.hasAttribute('disabled'),
    { timeout: 5000 }
  ).catch(() => {});

  // Click Compare — capture the comparison ID from the POST response directly
  const [, postResponse] = await Promise.all([
    page.locator('button:has-text("Compare Estimates")').click(),
    page.waitForResponse(
      res => res.url().includes('/api/comparisons') && res.request().method() === 'POST',
      { timeout: UPLOAD_TIMEOUT_MS },
    ),
  ]);

  const postBody = await postResponse.json().catch(() => ({}));
  const comparisonId = postBody?.comparison?.id;
  if (!comparisonId) {
    throw new Error(`Upload failed — no comparison ID in POST response: ${JSON.stringify(postBody)}`);
  }
  console.log(`  Comparison ID: ${comparisonId}`);

  // ── Step 2: Zone Review ─────────────────────────────────────────────────
  console.log('  [2/5] Zone detection...');
  await pollUntil(page, comparisonId, ['AWAITING_ZONE_REVIEW'], ZONE_TIMEOUT_MS, 'zone detection');

  const zoneReviewData = await apiGet(page, `/api/comparisons/${comparisonId}/zone-review`).catch(err => {
    console.warn(`  WARNING: Could not fetch zone-review data: ${err.message}`);
    return { e1Zones: [], e2Zones: [] };
  });

  const e1Count = zoneReviewData.e1Zones?.length ?? 0;
  const e2Count = zoneReviewData.e2Zones?.length ?? 0;
  console.log(`  Detected zones — Contractor: ${e1Count}, Adjuster: ${e2Count}`);

  console.log('  Confirming zone review (accepting defaults)...');
  const zoneConfirmResp = await apiPost(page, `/api/comparisons/${comparisonId}/zone-review/confirm`, {});
  if (zoneConfirmResp.status >= 400) {
    throw new Error(`zone-review/confirm returned ${zoneConfirmResp.status}: ${JSON.stringify(zoneConfirmResp.data)}`);
  }

  // ── Step 3: Match Review ─────────────────────────────────────────────────
  console.log('  [3/5] Zone matching...');
  await pollUntil(page, comparisonId, ['AWAITING_MATCH_REVIEW'], MATCH_TIMEOUT_MS, 'zone matching');

  const matchReviewData = await apiGet(page, `/api/comparisons/${comparisonId}/match-review`).catch(err => {
    console.warn(`  WARNING: Could not fetch match-review data: ${err.message}`);
    return { pairs: [], unmatchedE1: [], unmatchedE2: [] };
  });

  const pairCount = matchReviewData.pairs?.length ?? 0;
  const unmatchedE1 = matchReviewData.unmatchedE1?.length ?? 0;
  const unmatchedE2 = matchReviewData.unmatchedE2?.length ?? 0;
  console.log(`  Zone pairs: ${pairCount} paired, ${unmatchedE1} unmatched contractor, ${unmatchedE2} unmatched adjuster`);

  const confirmBody = buildConfirmBody(matchReviewData);
  console.log('  Confirming match review (accepting defaults)...');
  const matchConfirmResp = await apiPost(page, `/api/comparisons/${comparisonId}/match-review/confirm`, confirmBody);
  if (matchConfirmResp.status >= 400) {
    throw new Error(`match-review/confirm returned ${matchConfirmResp.status}: ${JSON.stringify(matchConfirmResp.data)}`);
  }

  // ── Step 4: Wait for completion ──────────────────────────────────────────
  console.log('  [4/5] Extracting & matching items...');
  await pollUntil(page, comparisonId, ['COMPLETED'], DONE_TIMEOUT_MS, 'extract-and-match');

  // ── Step 5: Fetch results ────────────────────────────────────────────────
  console.log('  [5/5] Fetching results...');
  const comparisonData = await apiGet(page, `/api/comparisons/${comparisonId}`);

  const mc = comparisonData.comparison;
  console.log(`  Results: ${mc.matchCount} match, ${mc.modifiedCount} modified, ${mc.missingCount} missing, ${mc.addedCount} added`);

  return {
    setId,
    comparisonId,
    zoneReviewData,
    matchReviewData,
    comparisonData,
    error: null,
  };
}

module.exports = { runSet };
