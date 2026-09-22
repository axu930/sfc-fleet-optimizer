# SFC Zeus Frontier

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

## Existing features

- deterministic Zeus sweep
- survival/DSP Pareto frontier
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