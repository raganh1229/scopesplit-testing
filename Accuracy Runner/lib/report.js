/**
 * lib/report.js
 *
 * Generates a markdown summary report + raw JSON file from an array of
 * per-set comparison results.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function pct(n) {
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : 'N/A';
}

function bar(n, total, width = 20) {
  if (!total) return '░'.repeat(width);
  const filled = Math.round((n / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmtConfusion(matrix, status) {
  const row = matrix[status];
  if (!row) return '';
  const items = Object.entries(row)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return items || 'none';
}

/**
 * @param {Array} results  — array of output from compare()
 * @param {string} outDir  — directory to write files into
 */
function generateReport(results, outDir) {
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(outDir, `run-${timestamp}.json`);
  const mdPath = path.join(outDir, `run-${timestamp}.md`);

  // Save raw JSON
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  // ── Markdown report ────────────────────────────────────────────────────────
  const lines = [];

  lines.push(`# Estimatch Accuracy Run — ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(`**Sets run:** ${results.length}`);
  lines.push(`**Raw JSON:** \`${path.basename(jsonPath)}\``);
  lines.push('');

  // ── Executive summary table ───────────────────────────────────────────────
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Set | Zone Det. | Zone Pair | Item Acc. | Coverage | Match F1 | Mod F1 | Miss F1 | Added F1 |');
  lines.push('|-----|-----------|-----------|-----------|----------|----------|--------|---------|----------|');

  for (const r of results) {
    const zd = pct(r.zoneDetection?.avgF1);
    const zp = pct(r.zonePairing?.accuracy);
    const ia = pct(r.lineItems?.overallAccuracy);
    const cov = pct(r.lineItems?.coverage);
    const matchF1 = pct(r.lineItems?.perStatus?.match?.f1);
    const modF1 = pct(r.lineItems?.perStatus?.modified?.f1);
    const missF1 = pct(r.lineItems?.perStatus?.missing?.f1);
    const addF1 = pct(r.lineItems?.perStatus?.added?.f1);
    lines.push(`| ${r.setId} | ${zd} | ${zp} | ${ia} | ${cov} | ${matchF1} | ${modF1} | ${missF1} | ${addF1} |`);
  }

  // Aggregate averages
  const avg = key => {
    const vals = results.map(r => r.lineItems?.perStatus?.[key]?.f1).filter(Number.isFinite);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };
  const avgZd = results.map(r => r.zoneDetection?.avgF1).filter(Number.isFinite);
  const avgZp = results.map(r => r.zonePairing?.accuracy).filter(Number.isFinite);
  const avgIa = results.map(r => r.lineItems?.overallAccuracy).filter(Number.isFinite);
  const avgCov = results.map(r => r.lineItems?.coverage).filter(Number.isFinite);

  lines.push(
    `| **AVG** | **${pct(avgZd.reduce((s, v) => s + v, 0) / (avgZd.length || 1))}** ` +
    `| **${pct(avgZp.reduce((s, v) => s + v, 0) / (avgZp.length || 1))}** ` +
    `| **${pct(avgIa.reduce((s, v) => s + v, 0) / (avgIa.length || 1))}** ` +
    `| **${pct(avgCov.reduce((s, v) => s + v, 0) / (avgCov.length || 1))}** ` +
    `| **${pct(avg('match'))}** | **${pct(avg('modified'))}** | **${pct(avg('missing'))}** | **${pct(avg('added'))}** |`
  );
  lines.push('');

  // ── Per-set details ───────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Per-Set Details');
  lines.push('');

  for (const r of results) {
    lines.push(`### ${r.setId}`);
    lines.push('');

    if (r.error) {
      lines.push(`> **ERROR:** ${r.error}`);
      lines.push('');
      continue;
    }

    // Expected vs App counts
    const exp = r.summary ?? {};
    const got = r.appCounts ?? {};
    lines.push('**Item counts — Expected vs App:**');
    lines.push('');
    lines.push('| Status | Expected | App |');
    lines.push('|--------|----------|-----|');
    lines.push(`| MATCH | ${exp.expectedMatch ?? '?'} | ${got.match ?? '?'} |`);
    lines.push(`| MODIFIED | ${exp.expectedModified ?? '?'} | ${got.modified ?? '?'} |`);
    lines.push(`| MISSING | ${exp.expectedMissing ?? '?'} | ${got.missing ?? '?'} |`);
    lines.push(`| ADDED | ${exp.expectedAdded ?? '?'} | ${got.added ?? '?'} |`);
    lines.push('');

    // Zone detection
    const zd = r.zoneDetection;
    lines.push('**Zone Detection:**');
    for (const side of [zd?.contractorSide, zd?.adjusterSide].filter(Boolean)) {
      lines.push(`- ${side.label}: ${side.correct.length}/${side.expected.length} found (recall ${pct(side.recall)}, precision ${pct(side.precision)})`);
      if (side.missed.length) lines.push(`  - Missed: ${side.missed.map(z => `\`${z}\``).join(', ')}`);
      if (side.extra.length) lines.push(`  - Extra (unexpected): ${side.extra.map(z => `\`${z}\``).join(', ')}`);
    }
    lines.push('');

    // Zone pairing
    const zp = r.zonePairing;
    lines.push(`**Zone Pairing:** ${zp?.correct.length ?? 0}/${zp?.totalExpectedPairs ?? 0} pairs correct (${pct(zp?.accuracy)})`);
    if (zp?.wrong.length) {
      for (const w of zp.wrong) lines.push(`  - ❌ ${w.reason}`);
    }
    lines.push('');

    // Line items confusion matrix
    const li = r.lineItems;
    lines.push(`**Item Classification:** ${li?.totalCorrect ?? 0}/${li?.totalPaired ?? 0} correct (${pct(li?.overallAccuracy)}) — coverage ${pct(li?.coverage)}`);
    lines.push('');
    lines.push('*Confusion matrix (rows = expected, cols = what app returned):*');
    lines.push('');
    lines.push('| Expected \\ Got | match | modified | missing | added | not_found |');
    lines.push('|----------------|-------|----------|---------|-------|-----------|');
    for (const status of ['match', 'modified', 'missing', 'added']) {
      const row = li?.confusionMatrix?.[status] ?? {};
      lines.push(
        `| **${status}** | ${row.match ?? 0} | ${row.modified ?? 0} | ${row.missing ?? 0} | ${row.added ?? 0} | ${row.not_found ?? 0} |`
      );
    }
    lines.push('');

    // Per-status F1
    lines.push('*Per-status F1:*');
    for (const status of ['match', 'modified', 'missing', 'added']) {
      const ps = li?.perStatus?.[status];
      if (!ps) continue;
      lines.push(`- **${status.toUpperCase()}**: P=${pct(ps.precision)} R=${pct(ps.recall)} F1=${pct(ps.f1)} (TP=${ps.tp} FP=${ps.fp} FN=${ps.fn})`);
    }
    lines.push('');

    // Top zone-level issues
    const badZones = (li?.zoneResults ?? [])
      .filter(z => z.zoneAccuracy != null && z.zoneAccuracy < 0.8)
      .sort((a, b) => a.zoneAccuracy - b.zoneAccuracy)
      .slice(0, 5);
    if (badZones.length) {
      lines.push('*Worst-performing zones:*');
      for (const z of badZones) {
        lines.push(`- \`${z.appZone}\`: ${pct(z.zoneAccuracy)} (${z.paired.filter(p => p.statusCorrect).length}/${z.paired.length} correct)`);
        const errors = z.paired.filter(p => !p.statusCorrect).slice(0, 3);
        for (const e of errors) {
          const desc = e.appItem.your?.description || e.appItem.adjuster?.description || '?';
          lines.push(`  - Expected **${e.expectedStatus}**, got **${e.appStatus}** — "${desc.slice(0, 60)}"`);
        }
      }
      lines.push('');
    }
  }

  // ── All Insights ──────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Diagnostic Insights & Recommended Fixes');
  lines.push('');

  const allInsights = results.flatMap(r => r.insights ?? []);
  const errors = allInsights.filter(i => i.severity === 'error');
  const warnings = allInsights.filter(i => i.severity === 'warning');

  if (errors.length === 0 && warnings.length === 0) {
    lines.push('> No issues detected across all sets.');
  }

  if (errors.length) {
    lines.push('### Errors (must fix)');
    lines.push('');
    for (const ins of errors) {
      lines.push(`**[${ins.stage}]** ${ins.message}`);
      lines.push(`> *Fix:* ${ins.suggestion}`);
      lines.push('');
    }
  }

  if (warnings.length) {
    lines.push('### Warnings (should investigate)');
    lines.push('');
    for (const ins of warnings) {
      lines.push(`**[${ins.stage}]** ${ins.message}`);
      lines.push(`> *Investigate:* ${ins.suggestion}`);
      lines.push('');
    }
  }

  // ── Aggregate pattern analysis ────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## Pattern Analysis Across All Sets');
  lines.push('');

  // Aggregate confusion matrix
  const aggMatrix = { match: {}, modified: {}, missing: {}, added: {} };
  for (const r of results) {
    for (const status of ['match', 'modified', 'missing', 'added']) {
      const row = r.lineItems?.confusionMatrix?.[status] ?? {};
      for (const [k, v] of Object.entries(row)) {
        aggMatrix[status][k] = (aggMatrix[status][k] ?? 0) + v;
      }
    }
  }

  lines.push('**Aggregate confusion matrix (all sets combined):**');
  lines.push('');
  lines.push('| Expected \\ Got | match | modified | missing | added | not_found |');
  lines.push('|----------------|-------|----------|---------|-------|-----------|');
  for (const status of ['match', 'modified', 'missing', 'added']) {
    const row = aggMatrix[status];
    lines.push(
      `| **${status}** | ${row.match ?? 0} | ${row.modified ?? 0} | ${row.missing ?? 0} | ${row.added ?? 0} | ${row.not_found ?? 0} |`
    );
  }
  lines.push('');

  // Most common cross-set insight patterns
  const stageCounts = {};
  for (const ins of allInsights) {
    stageCounts[ins.stage] = (stageCounts[ins.stage] ?? 0) + 1;
  }
  if (Object.keys(stageCounts).length) {
    lines.push('**Issue frequency by pipeline stage:**');
    for (const [stage, count] of Object.entries(stageCounts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${stage}\`: ${count} issue(s) across all sets`);
    }
    lines.push('');
  }

  const report = lines.join('\n');
  fs.writeFileSync(mdPath, report);

  return { jsonPath, mdPath };
}

module.exports = { generateReport };
