# SFC Zeus Frontier

A dependency-free browser optimizer for **Zeus-only attacks on Starfleet Commander NPCs**. It is designed for very large fleets, where an expected-value / large-fleet treatment is more useful than simulating individual ships.

The goal is not “how many Zeus fully wipe the NPC?” The app estimates the trade-off among:

- Zeus committed
- Zeus survival / expected loss fraction
- defender **ship DSP** destroyed
- defender **Zeus-damaging threat** removed
- marginal DSP gained from adding more Zeus

It then surfaces an efficiency-knee candidate and calculates configurable DSP-destruction × survival breakpoints. The UI also includes a battle-report importer so an NPC fleet can be loaded directly from copied combat-report text.

## What the UI provides

### Survival frontier

Plots Zeus survival against defender ship DSP destroyed. The chosen survival threshold is highlighted and the heuristic efficiency knee is marked.

### Commitment curve

Plots Zeus committed (log scale) against DSP destroyed. This makes diminishing returns visible directly.

### Configurable breakpoints

The defaults are:

- DSP destroyed: `25, 50, 75, 90, 95, 99%`
- Zeus survival: `99, 99.9, 99.99, 99.999%`

Both lists can be edited in the UI. The frontier matrix reports the approximate minimum Zeus count for every combination.

### Threat removed

DSP and danger are not always the same thing. The app therefore also tracks an auxiliary **threat** metric: defender weapon output from units whose individual shots pass the Zeus 1% shield-effectiveness threshold. It is a diagnostic metric, not an in-game score.

### Efficiency knee

Among sweep points satisfying the selected survival constraint, the app normalizes:

- `x = log(Zeus committed)`
- `y = ship DSP destroyed`

and marks the point with the largest bend above the endpoint chord. It also estimates the local DSP-percentage-point gain from adding 10% more Zeus. This is intentionally a heuristic candidate rather than a claim that one fleet size is uniquely optimal.

### CSV export

The complete sampled frontier can be downloaded as CSV for further analysis.

### Battle report import

Click **Paste battle report**, paste the copied combat report, and choose either the detected attacker or defender as the incoming NPC fleet. The importer:

- reads the first attacker and defender snapshots rather than adding later-round repeats;
- accepts row-style copies such as `Athena Class Battleship 50,000`;
- accepts copied-table layouts where class names and counts land on separate rows/lines;
- recognizes the same large-number suffixes as the manual roster;
- imports Weapons / Shield / Armor tech levels when they are present in the pasted text;
- shows a parsed preview before changing the optimizer roster.

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
- `js/combat.js` owns the deterministic six-round combat simulation and threat metric.
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

## Input format

One NPC unit per line. Examples:

```text
Athena: 50M
2.5e12 Hades
Prometheus = 10Qi
Gauss Cannon: 200M
Large Decoy: 1
```

Common class-name variants are accepted, including lines such as:

```text
Athena Class Battleship 50M
10M Hades
```

Supported suffixes include `K`, `M`, `B`, `T`, `Qa`/`Q` (quadrillion), `Qi` (quintillion), `Sx`, and `Sp`. Scientific notation is also supported.

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

The RF sensitivity selector provides a simple deterministic stress case by reducing attacker RF shot totals by 2% per selected sigma.

## Current scope

The unit table currently focuses on Original-style ships and defenses. The code is structured so additional units and mechanics can be added later.

Important limitations:

- It is not yet validated against a large corpus of real battle reports.
- Special Nova / Hired Guns mechanics such as mines, piercing, kamikaze, and unusual multifire need dedicated modeling before relying on results for those units.
- The threat metric is diagnostic only.
- The knee detector is heuristic and depends on the modeled sweep range.

## Tests

The model has a zero-dependency Node test suite:

```bash
node tests/parser.test.js
node tests/combat.test.js
```

The tests cover count parsing, manual roster parsing, row-style and copied-table
battle-report parsing, first-snapshot handling, pre-refactor combat output,
six-round capping, the 1% shield cutoff, defense-only DSP behavior, very large
fleet counts, bounded and monotone sweep outputs, breakpoint feasibility, and
knee feasibility.

## Good next validation step

The most useful next step is to collect several real NPC battle reports containing:

- attacker Zeus count and AWS
- complete NPC fleet / defense composition and AWS
- Zeus losses
- surviving defender composition after each available report

Those can be turned into regression fixtures so the approximation can be calibrated against the live combat engine instead of relying only on documentation-derived mechanics.
