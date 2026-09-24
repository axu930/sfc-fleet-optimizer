# Starfleet Commander Tools

This repository hosts a dependency-free browser toolkit for Starfleet
Commander planning. The root landing page links to individual tools under
`/tools/`; currently available tools are the **Zeus Fleet Optimizer**, the
**Fleet Allocation Optimizer**, and the **Ship Build Time Calculator**.

## Zeus Fleet Optimizer

The Zeus optimizer evaluates **Zeus-only attacks on Starfleet Commander NPCs**.
It is designed for very large fleets, where an expected-value / large-fleet
treatment is more useful than simulating individual ships.

The goal is not “how many Zeus fully wipe the NPC?” The app estimates the trade-off among:

- Zeus committed
- Zeus survival / expected loss fraction
- defender **ship DSP** destroyed
- defender **Zeus-damaging threat** removed
- total debris generated and Dionysus recycler needs

The UI compares expected and conservative rapid-fire scenarios over the same
Zeus commitment range. A report importer can fill the canonical unit table
directly from copied combat or espionage text.

## Fleet Allocation Optimizer

The fleet allocator is available at `tools/fleet-allocation/`. Add one target
card per unique `[Galaxy:System:Planet]` location and paste that planet's
espionage report. The tool parses supported ship/defense counts, technology,
and resource values, then distributes the available Zeus fleet across targets
without revisiting any target.

Choose one objective at a time: ship DSP destroyed, Hydrogen raided, or
resources raided plus gross debris. A single expected-loss limit applies to
the full allocation and defaults to 0.1% of available Zeus if left blank.
DSP can accrue from partial destruction; resource objectives require an
attacker win and weight each conditional raid by the model's deterministic
full-win probability estimate. This estimate treats expected remaining
non-Hephaestus defenders as Poisson counts (`exp(-expected remaining)`) and
multiplies by the estimated chance at least one Zeus survives; it is not an
exact in-game battle-winner calculation.

When a target report shows no defenses and the initial attack wins, the tool
uses the supplied deterministic 7/8 plunder total across three waves (1/2,
1/4, and 1/8). Otherwise it models one half-resource wave. Carmanor needs are
reported per successful wave at 125,000 cargo each and are not part of the
solver constraints. Gross debris includes destroyed Zeus. Expected Zeus losses
are shown as both an absolute count and a percentage; losses above 0.1% are
flagged for review.

The allocation search samples deterministic Zeus commitment candidates per
target and combines them with a bounded Pareto dynamic program. If the browser
performance bound is reached, results explicitly say the search was bounded;
treat them as a practical best allocation found, not a proof of global
optimality.

## What the UI provides

### Scenario charts

The results show separate Expected RF and Conservative RF charts. Each chart
plots Zeus survival and NPC ship DSP destroyed against the same logarithmic
Zeus-commitment x-axis. Hoverable, keyboard-focusable points show survival,
absolute and percentage DSP destruction, debris, and recycler details.

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
RF and crystal-harvesting toggles, with one-click copy buttons for Zeus and
Dionysus counts. The crystal-harvesting toggle changes only the Dionysus
count; the debris column continues to show the full ore/crystal debris pair.
Fleet Recommendations also includes a DSP-target table without survival
filtering and a separate Zeus-survival table for 99%, 99.9%, and 99.999%
thresholds; the latter reports expected DSP as both percent of maximum and
absolute DSP.

### CSV export

The complete sampled frontier can be downloaded as CSV for further analysis.

### Battle report import

Paste a copied combat or espionage report into the always-visible report box
under the unit table, then press **Parse report**. Parsing immediately computes
the curves while leaving the populated inputs in view so the detected counts
and tech values can be verified before use. The importer fills the unit table,
preferring the defender block, then the attacker block, then a single detected
fleet. It:

- reads the first attacker and defender snapshots rather than adding later-round repeats;
- accepts row-style copies such as `Athena Class Battleship 50,000`;
- accepts copied-table layouts where class names and counts land on separate rows/lines;
- recognizes the same large-number suffixes as the manual roster;
- imports Weapons / Shield / Armor tech levels when they are present in the pasted text;
- supports `... SHIPS:` plus `TECHS:` espionage-report sections;
- preserves raw report count text when filling very large table values;
- shows a parsed preview after filling the unit table.

If only one fleet block is pasted and no Attacker/Defender heading is present, it is offered as a single **Detected fleet**. Only unit classes currently supported by the model are imported.

## Ship Build Time Calculator

The ship build calculator estimates the total queue time for a single ship
type and a large order quantity in a Foundry-based universe. It reuses the
ship Ore and Crystal costs from `js/units.js`; Hydrogen does not contribute to
build time. The displayed estimate rounds to the nearest second and uses a
365-day year when expressing very long durations.

The calculator applies the Shipyard wiki formula:

```text
(Ore + Crystal) × ship count
÷ (2,500 × (Shipyard level + 1) × 2^Foundry level)
```

Each Build Droid assigned to the Shipyard adds 2% build speed. Available
worker slots are calculated as `1 + floor(Shipyard level / 3)`. This page
targets Foundry-based universes; it does not model Hired Guns Construction,
human Builder bonuses, or time already present in another queue entry.

Count input preserves integers through `BigInt`, accepts decimal digits,
comma-grouping, scientific notation, and supported suffixes through
septillion, and rejects fractional ship quantities. The grouped preview is
for checking; the copy button writes the exact plain-decimal digits.

## Run locally

No build system or dependencies are needed:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

Opening `index.html` directly also works in most browsers.

## Architecture

The site stays dependency-free and uses static HTML plus ordered classic
scripts so it works from GitHub Pages and when pages are opened directly:

- `index.html` is the landing page and tool directory.
- `tools/zeus-optimizer/index.html` is the Zeus optimizer entry point.
- `tools/shipyard-calculator/index.html` is the ship build-time calculator.
- `css/app.css` owns the canonical theme, shared shell, and Zeus
- `tools/fleet-allocation/index.html` is the multi-target Zeus allocator.
- `css/app.css` owns the canonical theme, shared shell, and Zeus
  optimizer-specific presentation plus scoped Fleet Allocation and ship
  calculator styles.
- `js/units.js` owns immutable unit statistics, aliases, and shared numeric helpers.
- `js/battle-report-parser.js` owns large-number, roster, and battle-report parsing.
- `js/shipyard-calculator.js` owns exact ship-count parsing, Foundry build-time
  calculations, and large-duration formatting.
- `tools/shipyard-calculator/app.js` owns the calculator form and copy action.
- `js/combat.js` owns the deterministic six-round combat simulation, DSP, debris, and threat metrics.
- `js/optimizer.js` owns range selection, sweeps, breakpoints, the matrix, and knee detection.
- `js/app.js` owns DOM events, rendering, chart generation, importing, and CSV export.
- `js/plunder.js` owns full-win probability approximation, plunder wave shares,
  and Carmanor requirements.
- `js/fleet-allocation.js` owns per-target commitment candidates and the
  bounded cross-target allocation search.
- `js/allocation-app.js` owns target cards, report parsing, input validation,
  allocation rendering, warnings, and copy controls.

The model modules expose browser globals and CommonJS exports. The browser
loads them in dependency order; Node tests import the same production files.

## GitHub Pages

1. In **Settings → Pages**, choose **Deploy from a branch**.
2. Select the branch (usually `main`) and `/ (root)`.
3. Open the landing page at `/`, the optimizer at `/tools/zeus-optimizer/`,
   the allocator at `/tools/fleet-allocation/`, or the calculator at
   `/tools/shipyard-calculator/`.

The included `.nojekyll` file keeps GitHub Pages from applying Jekyll processing.

## Adding a tool

Create a new `/tools/<tool-name>/index.html` page, reuse the shared navigation,
shell, and theme from `css/app.css`, add a card to the root landing page, and
use relative paths back to shared assets. Keep tool-specific logic isolated and
add tests for any new model or parser behavior.

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
`o`, `n`). Displayed decimal quantities are rounded to two significant
figures, while copy-ready Zeus recommendations remain exact plain integers
without commas in every display mode.

The Ship Build Time Calculator uses a separate exact integer path for order
quantities. For example, entering `1 septillion` copies
`1000000000000000000000000` exactly, while showing grouped digits and the
magnitude name for visual verification.

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
node tests/shipyard-calculator.test.js
node tests/plunder.test.js
node tests/fleet-allocation.test.js
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
