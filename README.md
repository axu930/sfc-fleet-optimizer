# SFC Zeus Frontier

A dependency-free browser optimizer for **Zeus-only attacks on Starfleet Commander NPCs**. It is designed for very large fleets, where an expected-value / large-fleet treatment is more useful than simulating individual ships.

The goal is not “how many Zeus fully wipe the NPC?” The app estimates the trade-off among:

- Zeus committed
- Zeus survival / expected loss fraction
- defender **ship DSP** destroyed
- defender **Zeus-damaging threat** removed
- total debris generated and Dionysus recycler needs

The UI compares expected and conservative rapid-fire scenarios over the same
Zeus commitment range. A report importer can fill the canonical unit table
directly from copied combat or espionage text.

## What the UI provides

### Zeus survival curve

Plots Zeus committed on a logarithmic x-axis against Zeus survival. Expected
and conservative RF scenarios use the same sampled commitment points.

### Commitment curve

Plots Zeus committed on the identical logarithmic x-axis against NPC ship DSP
destroyed. Hoverable, keyboard-focusable points show survival, absolute and
percentage DSP destruction, debris, and threat removed.

### Unit input table

Every supported ship and defense has its own count input. This table is the
single source of truth for calculations. Inputs accept commas, scientific
notation, and the same large-number suffixes supported by report import.

### Threat removed

DSP and danger are not always the same thing. The app therefore also tracks an auxiliary **threat** metric: defender weapon output from units whose individual shots pass the Zeus 1% shield-effectiveness threshold. It is a diagnostic metric, not an in-game score.

### DSP and debris

The result summary and chart inspection panel show absolute modeled DSP
destroyed alongside the percentage. Total debris includes 30% of destroyed
NPC ships' and committed Zeus ships' Ore and Crystal build costs; Hydrogen
and defenses create no debris. The UI reports Ore and Crystal separately and
uses their combined total for all-debris Dionysus recycler needs, estimated by
dividing it by the 20,000 cargo capacity of one recycler. In crystal-only
mode, each recycler contributes 10,000 crystal while ore remains to be
collected (20,000 when there is no ore). The compact recommendation table has
RF and crystal-only toggles, with one-click copy buttons for Zeus and Dionysus
counts.

### CSV export

The complete sampled frontier can be downloaded as CSV for further analysis.

### Battle report import

Paste a copied combat or espionage report into the always-visible report box
under the unit table, then press **Parse report**. The importer immediately
fills the unit table, preferring the
defender block, then the attacker block, then a single detected fleet. It:

- reads the first attacker and defender snapshots rather than adding later-round repeats;
- accepts row-style copies such as `Athena Class Battleship 50,000`;
- accepts copied-table layouts where class names and counts land on separate rows/lines;
- recognizes the same large-number suffixes as the manual roster;
- imports Weapons / Shield / Armor tech levels when they are present in the pasted text;
- supports `... SHIPS:` plus `TECHS:` espionage-report sections;
- preserves raw report count text when filling very large table values;
- shows a parsed preview after filling the unit table.

If only one fleet block is pasted and no Attacker/Defender heading is present, it is offered as a single **Detected fleet**. Only unit classes currently supported by the model are imported.

## Run locally

No build system or dependencies are needed:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

Opening `index.html` directly also works in most browsers.

## Architecture

The app stays dependency-free and uses ordered classic scripts so it works from
GitHub Pages and when `index.html` is opened directly:

- `js/units.js` owns immutable unit statistics, aliases, and shared numeric helpers.
- `js/battle-report-parser.js` owns large-number, roster, and battle-report parsing.
- `js/combat.js` owns the deterministic six-round combat simulation, DSP, debris, and threat metrics.
- `js/optimizer.js` owns range selection, sweeps, breakpoints, the matrix, and knee detection.
- `js/app.js` owns DOM events, rendering, chart generation, importing, and CSV export.
- `css/app.css` owns all presentation styles.

The four model modules expose browser globals and CommonJS exports. The browser
loads them in dependency order; Node tests import the same production files.

## GitHub Pages

1. Create a GitHub repository.
2. Copy the contents of this folder into the repository root.
3. In **Settings → Pages**, choose **Deploy from a branch**.
4. Select the branch (usually `main`) and `/ (root)`.

The included `.nojekyll` file keeps GitHub Pages from applying Jekyll processing.

## Count format

Each unit-table field and imported report count accepts values such as:

```text
50M
2.5e12
10Qi
9,223,372,036,854,775,807
```

Supported suffixes include `K`, `M`, `B`, `T`, `Qa`/`Q` (quadrillion), `Qi` (quintillion), `Sx`, and `Sp`. Scientific notation is also supported.

The **Number display** selector changes rendered result counts without changing
the underlying model: raw numbers, comma-grouped numbers, scientific notation,
full magnitude words, or abbreviations (`k`, `m`, `b`, `t`, `q`, `Q`, `s`, `S`,
`o`, `n`). Copy-ready Zeus recommendations remain plain integers without
commas in every display mode.

## Model

This is deliberately a **deterministic large-fleet approximation**:

- combat lasts up to six rounds;
- both sides fire using their start-of-round force (simultaneous round resolution);
- shields reset between rounds while hull damage persists;
- ineffective shots at or below the 1% shield threshold are ignored;
- Zeus rapid fire uses the expected geometric-chain length;
- incoming hits are distributed using Poisson/normal approximations and hull buckets;
- units below 70% hull use the explosion rule in expected-value form;
- Zeus and other non-one-hit targets are handled with hull/shield buckets rather than individual ships.

The UI always shows the expected RF curve and a conservative 2σ sensitivity
curve, which reduces expected attacker RF shots by 4%.

## Current scope

The unit table currently focuses on Original-style ships and defenses. The code is structured so additional units and mechanics can be added later.

Important limitations:

- It is not yet validated against a large corpus of real battle reports.
- Special Nova / Hired Guns mechanics such as mines, piercing, kamikaze, and unusual multifire need dedicated modeling before relying on results for those units.
- The threat metric is diagnostic only.
- JavaScript numbers approximate integer counts above `2^53`; the relative
  error is negligible for the expected-value model, while imported raw text is
  preserved in the input table.

## Tests

The model has a zero-dependency Node test suite:

```bash
node tests/parser.test.js
node tests/combat.test.js
node tests/units.test.js
```

The tests cover count parsing, manual roster parsing, row-style and copied-table
battle-report parsing, first-snapshot handling, the supplied espionage-report
layout, AWS extraction without tech/unit false positives, pre-refactor combat
output, debris, six-round capping, the 1% shield cutoff, defense-only DSP
behavior, very large fleet counts, bounded and monotone sweep outputs,
breakpoint feasibility, and knee feasibility.

## Good next validation step

The most useful next step is to collect several real NPC battle reports containing:

- attacker Zeus count and AWS
- complete NPC fleet / defense composition and AWS
- Zeus losses
- surviving defender composition after each available report

Those can be turned into regression fixtures so the approximation can be calibrated against the live combat engine instead of relying only on documentation-derived mechanics.
