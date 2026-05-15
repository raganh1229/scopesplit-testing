# Estimatch Accuracy Runner

Fully automated end-to-end accuracy testing for the Estimatch comparison pipeline.

Uploads real PDFs, walks the full comparison flow without touching zone pairings, captures outputs at every stage, and diffs them against the cheat sheets to produce accuracy statistics and diagnostic insights.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Any modern version |
| Playwright Chromium | `npx playwright install chromium` |
| App running locally | Default: `http://localhost:3000` |
| Inngest dev server | Required — pipeline steps are async via Inngest |
| `auth.json` | Created by `node setup-auth.js` (one-time) |

---

## Quick Start

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. One-time login (opens a browser window — log in, then press Enter)
node setup-auth.js

# 3. Start the app + Inngest in separate terminals
#    (in estimatch-app/)  npm run dev
#    (in estimatch-app/)  npx inngest-cli@latest dev

# 4. Run all sets
node runner.js

# 5. Run a single set
node runner.js --set Set1

# 6. Run multiple specific sets
node runner.js --set Set1,Set2,Set9

# 7. Custom app URL
node runner.js --url http://localhost:3001
```

Results are written to `results/run-<timestamp>.md` and `results/run-<timestamp>.json`.

---

## What It Measures

### Stage 1 — Zone Detection
Did the app correctly identify all zones (rooms/sections) in both PDFs?

- **Precision**: of the zones the app found, what % were expected?
- **Recall**: of the expected zones, what % did the app find?
- **Missed zones**: zone headers not detected (likely a `KNOWN_ZONE_PREFIXES` gap)
- **Extra zones**: zones detected that don't exist (hallucinations or mis-splits)

### Stage 2 — Zone Pairing
Did the app correctly pair contractor zones to adjuster zones?

- **Accuracy**: % of expected pairs that were made correctly
- **Wrong pairs**: zones paired that shouldn't be, or paired to the wrong counterpart
- **Missed pairs**: zones left unmatched that should have been paired

### Stage 3 — Line Item Classification
Did the app assign the correct status to each line item?

- **Overall accuracy**: % of paired items classified correctly
- **Coverage**: % of cheat-sheet items that appeared in the app output at all
- **Confusion matrix**: cross-tab of expected vs actual statuses
- **Per-status F1**: precision/recall/F1 for each status (match/modified/missing/added)

### Diagnostic Insights
The runner analyzes patterns and emits actionable bullets, e.g.:

> `[item-classification]` 4 MATCH items classified as MODIFIED — possible over-sensitivity in cost comparison.
> *Fix:* Items where costs match exactly are being flagged as different. Check float rounding or O&P/tax column interpretation.

---

## Output Files

| File | Contents |
|---|---|
| `results/run-<ts>.md` | Human-readable report with tables, per-set breakdowns, insights |
| `results/run-<ts>.json` | Full machine-readable data for all sets (for further analysis) |
| `auth.json` | Saved Clerk session — do not commit, regenerate if expired |

---

## Re-authenticating

Clerk sessions expire after ~1 week. If you get auth errors, re-run:

```bash
node setup-auth.js
```

---

## File Structure

```
Accuracy Runner/
├── runner.js              ← main entry point
├── setup-auth.js          ← one-time Clerk login helper
├── package.json
├── .gitignore
├── auth.json              ← saved session (gitignored)
├── results/               ← generated reports (gitignored)
└── lib/
    ├── run-set.js         ← drives one set through the full pipeline
    ├── parse-cheatsheet.js← parses *_Cheatsheet.md files
    ├── build-confirm.js   ← builds zone-review confirm body from match data
    ├── compare.js         ← accuracy diffing engine + insight generator
    └── report.js          ← markdown + JSON report generator
```
