---
description: Run the N3 comparison pipeline end-to-end against a generated test set, monitor every stage, and produce a full accuracy + discrepancy analysis report
---

> **N3 run method:** Direct Supabase upload → Prisma row creation → `comparison/process-v3.requested` Inngest event → Prisma poll until COMPLETED. No browser upload. No zone-review or match-review gates.

## Usage

```
/n3pdfrun V<N>
```

Where `V<N>` maps to a generated set: `V12` → `Set12`, `V7` → `Set7`.

---

## What this does

1. Verifies the 3 set files exist in `PDFS/Generated Sets/Set<N>/`
2. Checks prerequisites (app, Inngest, auth.json, `.env.local` credentials)
3. Runs `runner-n3.js --set Set<N>` which:
   - Uploads PDFs directly to Supabase using `run-n3-set.ts`
   - Fires `comparison/process-v3.requested` to the Inngest dev server
   - Polls Prisma until the comparison reaches COMPLETED
   - Fetches results from `/api/comparisons/{id}` and `/api/n3/dashboard/{id}` via Playwright auth
   - Runs compare.js + report.js against the cheat sheet
4. Reads the generated report and prints the accuracy table inline
5. Analyzes every discrepancy and explains root causes with actionable fixes

---

## Step 1 — Resolve the set ID

Strip the `V` prefix: `V12` → `Set12`. The rest of this workflow uses `<SetId>`.

Verify all three files exist:
- `PDFS/Generated Sets/<SetId>/Contractor_<SetId>.pdf`
- `PDFS/Generated Sets/<SetId>/Adjuster_<SetId>.pdf`
- `PDFS/Generated Sets/<SetId>/<SetId>_Cheatsheet.md`

If any file is missing, stop and report it. Generate the set with `/pdfgenxactimate`.

---

## Step 2 — Prerequisite check

Check all four. Report any that are missing and wait for the user to fix them before continuing.

**2a — auth.json**
`Accuracy Runner/auth.json` must exist and be non-empty.
If missing or stale, user runs: `node setup-auth.js` from `Accuracy Runner/`.

**2b — App dev server**
App must be running at `http://localhost:3000`.
If not: `npm run dev` from `Primary Repository/estimatch-app/`.

**2c — Inngest dev server**
Inngest must be running at `http://localhost:8288`.
If not: `npx inngest-cli@latest dev -u http://127.0.0.1:3000/api/inngest` from `Primary Repository/estimatch-app/`.

**2d — .env.local credentials**
`Primary Repository/estimatch-app/.env.local` must contain `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
These are used by `run-n3-set.ts` to upload and create the DB row directly.

---

## Step 3 — Run the N3 accuracy runner

// turbo
```
node runner-n3.js --set <SetId>
```

Run from the `Accuracy Runner/` directory.

The runner prints three live stages:
- `[1/3]` Triggers N3 pipeline — uploads PDFs to Supabase, fires Inngest event, polls Prisma until COMPLETED (can take 2–5 min depending on pipeline phases wired)
- `[2/3]` Fetches results — uses Playwright auth session to hit `/api/comparisons/{id}` and `/api/n3/dashboard/{id}`
- `[3/3]` Compares against cheat sheet — runs compare.js + report.js, writes report files

If any stage fails, capture the error exactly and report it. Do NOT retry automatically. Diagnose first.

Common failure modes:
- **`COMPARISON_ID not found`** — pipeline failed or timed out; check Inngest UI at localhost:8288
- **`Pipeline FAILED`** — an N3 phase threw an error; read the error message for the phase name
- **`auth.json stale`** — re-run `node setup-auth.js`
- **`Inngest rejected event`** — Inngest dev server is not running or URL mismatch

---

## Step 4 — Read the report and print accuracy table

After the runner exits, read the newest report file:

// turbo
```
Get-ChildItem "Accuracy Runner\results" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```

Present the results in this exact format:

---

### Accuracy Results — <SetId>

**Accuracy Table:**

| Metric | Score | Threshold | Status |
|---|---|---|---|
| Zone Detection (avg F1) | `<val>` | ≥ 90% | ✅ / ⚠ / ❌ |
| Zone Pairing (accuracy) | `<val>` | ≥ 90% | ✅ / ⚠ / ❌ |
| Item Accuracy (overall) | `<val>` | ≥ 85% | ✅ / ⚠ / ❌ |
| Item Coverage | `<val>` | ≥ 90% | ✅ / ⚠ / ❌ |
| MATCH F1 | `<val>` | ≥ 90% | ✅ / ⚠ / ❌ |
| MODIFIED F1 | `<val>` | ≥ 75% | ✅ / ⚠ / ❌ |
| MISSING F1 | `<val>` | ≥ 70% | ✅ / ⚠ / ❌ |
| ADDED F1 | `<val>` | ≥ 70% | ✅ / ⚠ / ❌ |

Threshold key: ✅ = at or above | ⚠ = within 10 pts below | ❌ = more than 10 pts below

> Note: Zone Detection and Zone Pairing are sourced from `/api/n3/dashboard/{id}` (Phase 4/6 data).
> If the dashboard returns no data (phases not yet wired), these show N/A — that is expected and not a failure.

**Item Counts — Expected vs App:**

| Status | Expected | App Got | Delta |
|---|---|---|---|
| MATCH | `<n>` | `<n>` | +/- N |
| MODIFIED | `<n>` | `<n>` | +/- N |
| MISSING | `<n>` | `<n>` | +/- N |
| ADDED | `<n>` | `<n>` | +/- N |

**Confusion Matrix (rows = expected, cols = app returned):**

| Expected \ Got | match | modified | missing | added | not_found |
|---|---|---|---|---|---|
| match | | | | | |
| modified | | | | | |
| missing | | | | | |
| added | | | | | |

---

## Step 5 — Discrepancy analysis

Read the cheat sheet from `PDFS/Generated Sets/<SetId>/<SetId>_Cheatsheet.md` and the report's
`## Diagnostic Insights & Recommended Fixes` and `## Pattern Analysis Across All Sets` sections.

For each metric below threshold or each non-zero off-diagonal confusion matrix cell, produce:

---

### Issue: `<short title>`
- **Stage**: Zone Detection | Zone Pairing | Item Classification
- **Pattern**: Exactly what went wrong (e.g., "4 MATCH items classified as MODIFIED")
- **Root cause**: Most likely N3 code-level explanation
- **Evidence**: Up to 5 specific cheat-sheet items or zones involved
- **Fix**: Concrete actionable change to the N3 algorithm or constants

---

**Standard root-cause lookup:**

| Confusion pattern | Likely N3 root cause |
|---|---|
| MATCH → MODIFIED (many) | Phase 18 MATCH threshold too tight; totalSimilarity feature weight issue |
| MODIFIED → MATCH (many) | Phase 15 score threshold too loose; MOD-PRICE delta swallowed by tolerance |
| MATCH → not_found (many) | Phase 6 zone correspondence wrong; item scored against mismatched zone items |
| MISSING → MATCH (any) | Phase 12 candidate generation hallucinated edge; check fuzzy_description false positives |
| ADDED → not_found (many) | Phase 4 failed to detect adjuster-only zone; check `KNOWN_ZONE_PREFIXES` |
| Zone Detection recall < 90% | Phase 4 zone header regex/prefix gap for this PDF format |
| Zone Pairing accuracy < 90% | Phase 6 name similarity threshold too strict for this set's zone name variants |

---

## Step 6 — Summary verdict

End with:
- **Overall pass/fail** (pass = all thresholds met)
- **Highest priority fix** — single most impactful N3 code change
- **Next recommended test** — re-run after fix, or specific set to isolate the issue

Report the full path to the markdown report:
```
Accuracy Runner\results\run-<timestamp>.md
```
