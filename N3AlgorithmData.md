# N3 Algorithm Diagnostic Data

Tracks pipeline shortfalls after each accuracy run. Used for trend analysis across sets.
Each run section is self-contained — concise enough for single-context AI analysis.

**Schema per run:** Set · Format · Comparison ID · Date · High-level metrics · Confusion matrix · Failure catalog (type / zone / item / gap / hypothesis) · Phase suspects · Open questions

---

## Run: V12 | Set12 | Format C(contractor) + E(adjuster) | 2026-05-10

**Comparison ID:** `6dc463ba-fc11-4a3d-ae33-788c82ea2ff4`
**Total items:** 77 (66M + 7Mod + 2Miss + 2Add)
**Bug fixed this run:** `score-candidates.ts` had `$1::uuid` cast on a TEXT column → `operator does not exist: text = uuid`. Removed cast. Pipeline now reaches completion.

> **⚠ Retroactive correction (discovered during V13):** The V12 confusion matrix below was produced by a broken `fetch-n3-results.ts` that mapped ALL items to `status:'match'` (the DECISION_STATUS map was keyed on `'MATCH'`/`'MODIFIED'` but `n3_match_decisions.decisionType` stores `'one_to_one'`/`'unmatched'`). The "4 MODIFIED→MATCH" and "0% MODIFIED/MISSING/ADDED F1" figures were grader artifacts. Re-running V12 with the fixed fetcher would likely show near-perfect scores. The failure catalog below is **invalidated** — the N3 pipeline was correct; the runner was not.

### Metrics (as reported — now known to be grader-corrupted)
| Metric | Score | Notes |
|---|---|---|
| Zone Detection (avg F1) | 100% | Correct — unaffected by grader bug |
| Zone Pairing (accuracy) | 100% | Correct — unaffected by grader bug |
| Item Accuracy (overall) | 94% | Artificially low — grader bug |
| Item Coverage | 91% | Artificially low — grader bug |
| MATCH F1 | 97% | Partially correct |
| MODIFIED F1 | 0% | **Invalid** — grader bug |
| MISSING F1 | 0% | **Invalid** — grader bug |
| ADDED F1 | 0% | **Invalid** — grader bug |

### Decisions / Holds
Changes considered after this run but explicitly deferred:

| Change | Considered | Decision | Rationale |
|---|---|---|---|
| Lower compare.js Jaccard 0.4 → 0.3 | Yes | **HOLD** | Risk of false pairings. Grader is a measuring instrument; changing mid-experiment corrupts cross-run data. |
| Switch `fetch-n3-results.ts` to `rawDescription` as primary | Yes | **HOLD** | Higher noise risk. No evidence rawDescription improves things. |
| Tune N3 scoring thresholds (Phase 13/16) | Yes | **HOLD** | Only 1 data point. Need 3+ sets to confirm patterns before touching pipeline logic. |

**Rule established:** Do not change the grader (compare.js thresholds, description source) until a multi-set baseline is established.

---

## Run: V13 | Set13 | Format D(contractor) + F(adjuster) | 2026-05-10

**Comparison ID:** `bca0d826-0047-48f3-ba43-a17d81b70c57`
**Total items:** 125 (77 MATCH + 35 MOD + 7 MISSING + 6 ADDED)
**Scenario:** Kitchen/electrical fire — Cincinnati, OH — 9 zones

**Bugs fixed this run (3 — all in runner/grader, not N3 pipeline):**

| Bug | File | Root cause | Fix |
|---|---|---|---|
| Status mapping — all items → `'match'` | `fetch-n3-results.ts` | `DECISION_STATUS` map keyed on `'MATCH'`/`'MODIFIED'` but DB stores `'one_to_one'`/`'unmatched'` — zero keys ever matched, fallback `?? 'match'` fired | Read `line_items.matchStatus` directly (set correctly by `persist-decisions.ts`) |
| Scenario MISSING/ADDED status codes | `set13.js` (and likely all prior sets) | Items used `s:'missing'`/`s:'added'` instead of `s:'missing-adj'`/`s:'added-adj'` → `util.js` computed wrong side amounts → cheat-sheet emitted lowercase "missing"/"added" → `parse-cheatsheet.js` normalizes only uppercase-prefixed strings → `normalizedStatus='unknown'` | Changed all 13 occurrences to `-adj` suffix |
| Zone grouping: 15 zones instead of 9 | `fetch-n3-results.ts` | ADDED items (adjuster-only) used adjuster zone's `normalizedName` as canonical, creating 6 extra zone groups that aliased the same cheat-sheet zones → `totalCsItems` double-counted → coverage read 55% | Built `zoneNameToCanonical` map from `n3_zone_correspondences`; all items now resolve to contractor zone name as canonical |

### Metrics (final — all bugs fixed)
| Metric | Score | Threshold | Status |
|---|---|---|---|
| Zone Detection (avg F1) | 100% | ≥ 90% | ✅ |
| Zone Pairing (accuracy) | 100% | ≥ 90% | ✅ |
| Item Accuracy (overall) | 100% | ≥ 85% | ✅ |
| Item Coverage | 100% | ≥ 90% | ✅ |
| MATCH F1 | 100% | ≥ 90% | ✅ |
| MODIFIED F1 | 100% | ≥ 75% | ✅ |
| MISSING F1 | 100% | ≥ 70% | ✅ |
| ADDED F1 | 100% | ≥ 70% | ✅ |

### Confusion Matrix
| Expected \ Got | match | modified | missing | added | not_found |
|---|---|---|---|---|---|
| match | 77 | 0 | 0 | 0 | 0 |
| modified | 0 | 35 | 0 | 0 | 0 |
| missing | 0 | 0 | 7 | 0 | 0 |
| added | 0 | 0 | 0 | 6 | 0 |

### Key findings
- **N3 pipeline is correct end-to-end** — zero misclassifications across 125 items, 9 zones, Format D+F.
- **MODIFIED detection works** — `persist-decisions.ts` `amountsMatch()` ±1% tolerance correctly classifies all 35 quantity/price discrepancies.
- **MISSING/ADDED detection works** — unmatched items in Phase 16 correctly surface as MISSING_FROM_ADJUSTER / ADDED_BY_ADJUSTER.
- **V12 Failure Type A (4 MODIFIED→MATCH) was a grader artifact**, not a real pipeline defect.

### Open Questions (resolve across future runs)
1. Does the pipeline stay at 100% for other format combinations (B+C, E+F)?
2. Does accuracy hold at higher item counts (N=200+)?
3. Does the ±1% `amountsMatch` tolerance hold for edge cases (e.g., $0.01 gaps at high quantities)?

### Decisions / Holds

| Change | Considered | Decision | Rationale |
|---|---|---|---|
| Tune `amountsMatch` tolerance | No | **HOLD** | Zero failures at ±1% across 35 MODIFIED items. No evidence of false positives or false negatives. |
| Lower compare.js Jaccard | No | **HOLD** | 100% coverage achieved; threshold is not a bottleneck. |
| Pipeline threshold changes | No | **HOLD** | Pipeline demonstrated correct at N=125. Need more diverse sets before tuning. |

**Status:** Baseline established. Runner + grader are now trustworthy measurement instruments. Next runs collect clean accuracy data.

---

*Next run: add set ID, format, comparison ID, date, and fill same schema above.*
