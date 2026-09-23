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

## Design system

- Treat `/css/app.css` as the single shared stylesheet and visual source of
  truth. Do not add another site-wide stylesheet for a new tool.
- Use the shared `.wrap`, `.site-nav`, `.site-nav-brand`, `.site-nav-links`,
  and `.site-footer` classes for page structure and navigation.
- Use the theme variables in `:root` for colors, surfaces, borders, focus
  rings, and radii instead of introducing duplicate raw values.
- Reuse shared `.panel`, `.lede`, and `.intro-guide` treatments when content
  has the same role across pages.
- Keep tool-specific selectors scoped under that tool's page class, such as
  `.optimizer-page`; do not broaden calculator rules to generic elements.
- Keep header navigation quiet and consistent: the brand links to `SFC Tools`,
  navigation points to the tool directory/current tool, and external repository
  links do not belong in the header unless explicitly requested.
- Reuse the existing responsive breakpoints in `app.css` (`930px`, `760px`,
  and `650px`) before adding a new breakpoint.
- When changing shared CSS, bump the stylesheet query-string version in every
  page that loads it so GitHub Pages and browser caches receive the update.

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
