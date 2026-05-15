---
description: Generate a paired Xactimate-style test set (Contractor PDF + Adjuster PDF + Cheat Sheet) from a target line-item count
---

## Usage

```
/pdfgenxactimate <N>
```

Where `N` is the target total line-item count for the **contractor** estimate.

Examples:
- `/pdfgenxactimate 40` → small residential (4–5 zones, ~40 contractor items)
- `/pdfgenxactimate 100` → medium residential (6–7 zones, ~100 contractor items)
- `/pdfgenxactimate 180` → large residential (9–10 zones, ~180 contractor items)

---

## What this produces

All output is written by the existing `gen-batch.js` pipeline. You are generating the **scenario JS data file** that feeds it.

```
PDFS/Generated Sets/<SetId>/
  Contractor_<SetId>.pdf
  Adjuster_<SetId>.pdf
  <SetId>_Cheatsheet.md
```

---

## Step 1 — Determine the next available Set ID

List the files in `PDFS/Generator/lib/scenarios/` and identify the highest existing `setN.js` number. The new ID is `Set<N+1>`. For example, if `set11.js` is the highest, create `set12.js` and use `Set12`.

---

## Step 2 — Determine zone count and item distribution

Use the user-supplied `N` to determine how many zones to create (including General Conditions):

| N (contractor items) | Zone count Z | Notes |
|---|---|---|
| < 35 | 3–4 | Small single-story |
| 35–65 | 4–6 | Small-medium single-family |
| 65–110 | 6–8 | Medium single-family |
| 110–160 | 8–10 | Large single-family |
| > 160 | 10–12 | Very large / multi-story |

**Bell-curve distribution rule:**
- General Conditions always gets 10–14 items (fixed)
- Assign remaining `N - general_count` items across `Z-1` rooms using these relative weights:
  - **Primary rooms** (kitchen, master bedroom, main living area): weight ×1.4
  - **Secondary rooms** (secondary bedrooms, family room, dining room): weight ×1.0
  - **Tertiary rooms** (bathrooms, hallways, laundry, garage, basement): weight ×0.6
- Round each zone's item count to a whole number; adjust the largest zone ±1 to hit the exact target

---

## Step 3 — Select damage scenario and format pair

### Damage scenario
Derive from: `(SetId number) % 6`

| Result | Scenario | Typical zones affected |
|---|---|---|
| 0 | Water damage — burst supply line | Kitchen, bathrooms, hallway, living area, affected bedrooms |
| 1 | Fire damage — kitchen/electrical fire | Kitchen, living area, adjacent rooms + smoke in all zones |
| 2 | Wind & hail storm damage | Roof/exterior, attic, ceilings throughout, garage |
| 3 | Mold damage — chronic moisture intrusion | Crawl space / basement, bathrooms, closets, affected walls |
| 4 | Fire damage — wildfire smoke & ember entry | Exterior, attic, HVAC-spread smoke throughout all zones |
| 5 | Water damage — roof leak with ceiling collapse | Attic, master bedroom ceiling, secondary bedrooms, hallways |

Use a realistic US residential property for the scenario (choose a city/state that matches the damage type — e.g., wind/hail → Texas, Oklahoma, Colorado; wildfire → Arizona, California, Nevada; water → Florida, Louisiana, Pacific Northwest).

### Format pair
Derive from: `(SetId number) % 10`

| Result | contractorFormat | adjusterFormat |
|---|---|---|
| 0 | B | C |
| 1 | B | D |
| 2 | C | E |
| 3 | D | F |
| 4 | E | B |
| 5 | F | C |
| 6 | B | E |
| 7 | C | F |
| 8 | D | B |
| 9 | E | D |

**contractorFormat MUST differ from adjusterFormat — always.**

---

## Step 4 — Generate the scenario JS file

Create: `PDFS/Generator/lib/scenarios/set<N>.js`

Follow every rule in this section exactly. Deviate from the schema and `gen-batch.js` will crash.

---

### 4a — File skeleton

```js
/**
 * <SetId> — Formats <cFmt> / <aFmt>
 * <scenarioName>
 * ~<contractorItemCount> contractor / ~<adjusterItemCount> adjuster line items
 */

const SCENARIO = {
  id: '<SetId>',
  format:           '<cFmt>',   // required by gen-batch.js validation guard
  contractorFormat: '<cFmt>',
  adjusterFormat:   '<aFmt>',
  scenarioName: '<Brief description> — <City, State>',
  client:     '<First> & <Last>',
  property:   '<Street Address>',
  cityState:  '<City, State ZIP>',
  damage:     '<Damage Type>',
  dol:        '<MM/DD/YYYY>',

  contractor: {
    company:    '<Contractor Company Name>',
    tagline:    '<Short scope tagline>',
    cityState:  '<City, State>',
    addr:       '<Street Addr>, <City, State ZIP>',
    phone:      '(<NNN>) <NNN>-<NNNN>',
    web:        '<domain.com>',
    license:    '<STATE> <LicType> #<Num>',
    operator:   '<INITIALS>',
    estimator:  '<F>. <Last>',
    priceList:  '<STABBR><CITY2><VER>_<MON><YY>',
    estimateId: '<3LET>-<YYYY>-<4DIG>',
    date:       '<MM/DD/YYYY>',
  },

  adjuster: {
    company:     '<Insurance Company Name>',
    division:    '<Division or Unit Name>',
    addr1:       '<PO Box or Street>',
    addr2:       '<City, State ZIP>',
    phone:       '1-800-<NNN>-<NNNN>',
    license:     'NAIC #<5digits>',
    insured:     '<Client Full Name>',
    claimRep:    '<Insurance Co> Direct',
    estimator:   '<F>. <Last>',
    examiner:    '<F>. <Last>, AIC',
    claimNumber: '<3LET>-<ST2>-<YY>-<CAT>-<5DIG>',
    fileNum:     '<same as claimNumber>',
    estimateId:  '<3LET>-<5DIG>-FNL',
    date:        '<MM/DD/YYYY>',
  },

  // Sub-category label aliases used on the ADJUSTER side.
  // Provide a realistic variant for every sub-category you use in this scenario.
  subAlias: {
    'DEBRIS REMOVAL':     '<variant — e.g. SITE PREP & HAULING>',
    'TEMP':               '<variant — e.g. TEMPORARY SERVICES>',
    'PROJECT MANAGEMENT': '<variant — e.g. SUPERVISION & MANAGEMENT>',
    'PERMITS':            '<variant — e.g. PERMITTING>',
    'CLEANING':           '<variant — e.g. DECONTAMINATION>',
    'FINAL CLEANING':     '<variant — e.g. POST-CONSTRUCTION CLEAN>',
    'GENERAL':            '<variant — e.g. PROJECT GENERAL CONDITIONS>',
    'ROOFING':            '<variant — e.g. ROOFING SYSTEMS>',
    'GUTTERS':            '<variant — e.g. RAINWATER COLLECTION>',
    'INSULATION':         '<variant — e.g. THERMAL ENVELOPE>',
    'CEILINGS':           '<variant — e.g. OVERHEAD ASSEMBLIES>',
    'WALLS':              '<variant — e.g. VERTICAL SURFACES>',
    'TRIMWORK':           '<variant — e.g. MILLWORK>',
    'FLOORING':           '<variant — e.g. FLOOR FINISHES>',
    'CABINETS':           '<variant — e.g. CASEWORK>',
    'APPLIANCES':         '<variant — e.g. EQUIPMENT>',
    'PLUMBING':           '<variant — e.g. MECHANICAL FIXTURES>',
    'LIGHTING':           '<variant — e.g. ELECTRICAL FIXTURES>',
    'WINDOWS':            '<variant — e.g. GLAZING>',
    'DOORS':              '<variant — e.g. OPENINGS>',
    'SOFT COSTS':         '<variant — e.g. PROFESSIONAL SERVICES>',
  },

  zones: [
    // Zone objects — see schema below
  ],
};

module.exports = SCENARIO;
```

---

### 4b — Zone object schema

```js
{
  cName: '<Exact contractor zone label — printed verbatim in PDF>',
  aName: '<Exact adjuster zone label — MUST differ from cName>',

  // Room dimensions (use 0/0/0/0/'—' for General Conditions)
  floorSF:    <number>,
  wallSF:     <number>,    // approx = perimLF × ceilHeight
  ceilSF:     <number>,    // usually same as floorSF
  perimLF:    <number>,
  ceilHeight: '<N>',       // string e.g. '9' or "9'" — use '—' for non-rooms

  // Optional — default both true
  inContractor: true,  // set false for adjuster-only zones
  inAdjuster:   true,  // set false for contractor-only zones

  // Sub-category order as printed in contractor PDF (can repeat sub-cat)
  cSubOrder: ['SUBCAT1', 'SUBCAT2', ...],

  // Optional photos in contractor PDF (0–2 per room is realistic)
  photosC: [
    { at: 'before-dims', cap: 'P-NN: <Photo caption>' },
  ],

  items: [ /* see item schema below */ ],
}
```

**Zone naming rules:**
- Zone names must be **realistically different** between contractor and adjuster — not just a word swap.
  Good: `'Master Bedroom'` ↔ `'Primary Bedroom Suite'`
  Good: `'Family Room'` ↔ `'Living Area'`
  Good: `'Hall Bath'` ↔ `'Secondary Bathroom'`
  Bad: `'Kitchen'` ↔ `'Kitchen Area'` (too obvious — use rarely)
- The N3 pipeline must work to figure out they're the same space.

---

### 4c — Item object schema

```js
{
  x:  '<SUBCAT>',           // sub-category — must be in valid list below
  c:  '<contractor desc>',  // contractor description string — NULL for added-adj
  a:  '<adjuster desc>',    // adjuster description string  — NULL for missing-adj
  u:  '<unit>',             // SF | EA | LF | HR | DA | LD | SQ | CY | MO

  // Contractor side (omit qC/rC/tC/oC entirely for added-adj items)
  qC: <number>,   // contractor quantity
  rC: <number>,   // contractor unit rate
  tC: <number>,   // tax (0 for labor; small $ for materials)
  oC: <number>,   // O&P ≈ qC × rC × 0.20

  // Adjuster side (omit qA/rA/tA/oA/dA entirely for missing-adj items)
  qA: <number>,   // adjuster quantity
  rA: <number>,   // adjuster unit rate
  tA: <number>,   // tax
  oA: <number>,   // O&P ≈ qA × rA × 0.20
  dA: <number>,   // depreciation (0 for RCV-only line; positive for ACV items)

  s:  '<status>',  // match | mod-qty | mod-price | missing-adj | added-adj

  // !! DO NOT add cN or aN note fields. They cause N3's Phase 8 extractor
  // to concatenate note text into rawDescription and corrupt description matching.
}
```

---

### 4d — Status rules (STRICTLY ENFORCE)

| Status | Rule | qC vs qA | rC vs rA | % of contractor items |
|---|---|---|---|---|
| `match` | Same work, same cost. Descriptions MUST differ in wording. | equal | equal | ~70% |
| `mod-qty` | Same rate, different quantity. Contractor usually higher. | differ | equal | ~10% |
| `mod-price` | Same qty, different rate. Contractor usually higher grade/rate. | equal | differ | ~10% |
| `missing-adj` | Contractor billed; adjuster denied. Set `a: null`. Do NOT include rA/tA/oA/dA fields. | — | — | ~3% of contractor total |
| `added-adj` | Adjuster added; contractor didn't bill. Set `c: null`. Do NOT include qC/rC/tC/oC fields. | — | — | ~2% of adjuster total |

**97% match-rate target**: of all contractor items, 97% must have a corresponding adjuster item (status ∈ match / mod-qty / mod-price). Only ~3% are missing-adj.

**O&P formula**: `oC = +(qC * rC * 0.20).toFixed(2)`, same for `oA`. For specialty items (permits, dumpsters, appliances) O&P may be 0. For materials-only items tax may be non-zero.

---

### 4e — Description naming variation (CRITICAL — applies to every matched item)

Every item with status `match`, `mod-qty`, or `mod-price` MUST have different wording on contractor vs adjuster side. The N3 pipeline must work to recognize them as the same work despite name differences.

**Target divergence: ~75% apparent similarity.** A human should immediately recognize the pair as the same item, but a naive string matcher should NOT trivially match them. Aim for adjuster descriptions to share at most **2–3 key words** with the contractor description — never copy a phrase verbatim.

**Divergence rules (enforce all):**
- Contractor uses abbreviations (`R&R`, `w/`, `5/8"`, `LF`, `SF`); adjuster spells everything out (`remove and replace`, `with`, `5/8 inch`, `linear feet`, `square feet`)
- Contractor leads with the action (`R&R Hardwood flooring`); adjuster leads with the material or spec (`Solid hardwood floor replacement`)
- Contractor uses trade framing (`Hang, tape & finish drywall - walls`); adjuster uses scope framing (`Gypsum board installation with tape and finish coat`)
- Contractor uses fractions (`3-1/4" colonial baseboard`); adjuster uses decimals (`3.25 inch colonial base trim`)
- Contractor uses product nicknames (`comp. shingles`, `LVP`); adjuster uses full spec names (`composition asphalt shingles`, `luxury vinyl plank flooring`)
- Contractor often includes grade/brand qualifiers first (`High-grade carpet pad - 8 lb`); adjuster puts spec last (`Carpet cushion replacement - 8 lb density`)
- **Never share more than 2 consecutive words** between `c` and `a` descriptions

**Examples of correct divergence at ~75% similarity:**

| Contractor `c` | Adjuster `a` |
|---|---|
| `R&R Hardwood flooring` | `Solid hardwood floor replacement` |
| `1/2" drywall - ceiling` | `Gypsum board ceiling - half inch` |
| `Paint walls - two coats` | `Wall painting - 2 coat application` |
| `R&R Baseboard - 3-1/4" colonial` | `Colonial base molding replacement - 3.25 inch` |
| `Tear off comp. shingles` | `Strip and dispose composition shingles` |
| `R&R Upper cabinets - custom grade` | `Replace upper kitchen cabinets - semi-custom` |
| `Hang, tape & finish drywall - walls` | `Drywall installation - hang, tape, float and finish` |
| `R&R Carpet - medium grade` | `Medium grade carpet replacement` |
| `5/8" moisture-resistant drywall - walls` | `Moisture-resistant gypsum board - 5/8 inch walls` |

**Examples of BAD descriptions (too similar — DO NOT use):**

| BAD Contractor | BAD Adjuster | Why bad |
|---|---|---|
| `Paint ceiling - two coats` | `Paint ceiling - 2 coats` | Shares 3 consecutive words |
| `R&R Window - double hung` | `Remove and replace double hung window` | Every content word identical |
| `Drywall - walls - 1/2"` | `1/2" drywall walls` | Same words, shuffled |

Apply this to **every matched item**. No two items on the same side should read identically.

---

### 4f — Valid sub-categories

Use only these values for the `x` field:

```
DEBRIS REMOVAL  TEMP           PROJECT MANAGEMENT  PERMITS
CLEANING        FINAL CLEANING GENERAL             SOFT COSTS
ROOFING         GUTTERS        INSULATION          CEILINGS
WALLS           TRIMWORK       FLOORING            CABINETS
APPLIANCES      PLUMBING       LIGHTING            WINDOWS
DOORS
```

---

### 4g — Realistic Xactimate-range pricing (use actual values in this range)

| Work type | Unit | Contractor rate range | Notes |
|---|---|---|---|
| Demo wet drywall | SF | $1.65–$2.10 | |
| Drywall hang & tape | SF | $1.80–$2.40 | |
| Drywall texture | SF | $0.85–$1.30 | |
| Paint ceiling 2 coats | SF | $0.85–$1.10 | |
| Paint walls 2 coats | SF | $0.80–$1.20 | |
| Baseboard R&R | LF | $5.50–$8.50 | |
| Crown molding R&R | LF | $6.50–$10.50 | |
| Carpet medium | SY | $28–$42 | |
| Carpet pad 8-lb | SY | $7–$11 | |
| Carpet remove | SY | $2.50–$4.00 | |
| LVP flooring | SF | $4.50–$7.50 | |
| Ceramic tile 12×12 | SF | $8–$14 | |
| Hardwood flooring | SF | $9–$18 | |
| Base cabinet R&R | LF | $185–$320 | |
| Upper cabinet R&R | LF | $145–$260 | |
| Countertop laminate | LF | $38–$65 | |
| Countertop granite/quartz | SF | $75–$140 | |
| Roof shingles 30-yr arch | SQ | $210–$320 | |
| Roof underlayment | SQ | $35–$55 | |
| Gutters 5-in alum | LF | $7–$11 | |
| Downspouts | LF | $5.50–$9 | |
| Interior door pre-hung | EA | $285–$485 | |
| Exterior door R&R | EA | $650–$1,200 | |
| Window R&R standard | EA | $285–$650 | |
| Project supervision | HR | $55–$75 | |
| General labor | HR | $30–$45 | |
| Dumpster 20–30 cy | EA | $485–$685 | |
| Building permit | EA | $350–$750 | |
| Antimicrobial treatment | SF | $0.35–$0.65 | |
| Dehumidifier rental | DA | $55–$90 | |
| Air mover rental | DA | $28–$45 | |

For **MOD-PRICE** items: contractor rate should be 15–40% higher than adjuster rate (real-world grade difference).
For **MOD-QTY** items: contractor qty should be 10–35% higher than adjuster qty (measurement dispute).

---

## Step 5 — Run the generator

After saving the scenario file, run from the `Application Comparrison` root:

```
node "PDFS/Generator/gen-batch.js" <SetId>
```

// turbo

This runs automatically if Step 4 succeeds without errors.

---

## Step 6 — Verify and report

Confirm the three output files were created in `PDFS/Generated Sets/<SetId>/`. Report the line item counts that `gen-batch.js` logs to console:

```
→ SetN [contractor:X / adjuster:Y] — Scenario Name
   wrote Contractor_SetN.pdf
   wrote Adjuster_SetN.pdf
   wrote SetN_Cheatsheet.md
   line items: NNN contractor / NNN adjuster
```

If any error occurs (missing renderer, bad item shape, undefined zone field), report the full error and fix the scenario JS before re-running.
