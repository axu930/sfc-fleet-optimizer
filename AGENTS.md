# Starfleet Commander Tools

## Site structure

This repository is a zero-build, GitHub Pages-compatible static tool hub.

- `/index.html` is the public landing page.
- `/tools/zeus-optimizer/index.html` is the Zeus fleet optimizer.
- `/css/app.css` is the canonical theme and contains shared shell styles plus
  Zeus optimizer-specific styles.
- `/js/` contains shared model and parser modules loaded by the optimizer.
- `/tests/` contains the zero-dependency Node regression tests.

GitHub Pages deploys from the repository root. New tools should live in their
own `/tools/<tool-name>/` directory with an `index.html` entry point and
relative paths back to shared assets.

## Purpose

Optimize Zeus Class fleet commitment for Starfleet Commander NPC attacks.

We are NOT optimizing for complete defender destruction.

Primary objective:
maximize NPC ship DSP destroyed while constraining Zeus losses.

The important output is the Pareto frontier between:

- Zeus committed
- Zeus survival %
- NPC ship DSP destroyed %
- dangerous defender firepower removed %

Fleet sizes can reach extremely large values. The game is therefore
modeled using deterministic/expected-value large-fleet mechanics rather
than per-ship Monte Carlo.

## Core assumptions

- Combat is simultaneous within each round.
- Maximum 6 combat rounds.
- Shields reset each round.
- Hull damage persists.
- Rapid fire uses expected large-fleet behavior.
- 1% shield ineffectiveness rule applies.
- DSP comes from destroyed ships, not defenses.
- Do not assume destroying 100% of the defender is desirable.

## Important survival breakpoints

- 99%
- 99.9%
- 99.99%
- 99.999%

## Important DSP breakpoints

- 25%
- 50%
- 75%
- 90%
- 95%
- 99%

## Zeus optimizer features

- deterministic Zeus sweep
- scenario-specific survival/DSP charts for expected and conservative RF
- breakpoint matrix
- efficiency knee detector
- threat-removed metric
- battle-report paste/import
- attacker/defender detection
- AWS extraction
- CSV export

## Priorities

1. Accuracy of combat mechanics
2. Correct handling of huge ship counts
3. Fast browser-only computation
4. Simple interface
5. GitHub Pages compatibility

Do not introduce a server/backend unless necessary.

## Adding a tool

1. Create `/tools/<tool-name>/index.html`.
2. Reuse the shared navigation, shell, and theme from `css/app.css`.
3. Keep tool-specific CSS and JavaScript scoped to that directory or clearly
   named shared modules.
4. Add a card and link on the root landing page.
5. Use relative asset paths so direct GitHub Pages sub-page URLs work.
6. Add regression tests for model or parser behavior before pushing.
