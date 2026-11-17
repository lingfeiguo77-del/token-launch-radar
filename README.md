# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lingfeiguo77-del/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lingfeiguo77-del/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar (`radar-v2`) for make.fun's `token-radar-01` bounty, built with Node 22 standard library only and an offline dark-terminal web dashboard.

- **Full watchlist coverage**: Scores all 40 watchlist protocols (`TVL >= $50M`, no token on record, non-wrapped/staked/bridge) plus 160 early pre-token-record protocols below the floor (`200` ranked rows in total), while keeping live-token protocols (`24` top market-cap protocols) strictly separated in a dedicated **Live Token** view.
- **Implied Value Model v2 (`computeImpliedValue`)**: Derived solely from the snapshot's 10 fields with zero hardcoded protocol names, combining base TVL multiple (`0.25`), **asymmetric 7-day growth** (`+0.5x` upside vs `1.0x` downside penalty, clamped `[-60%, +120%]`), **age maturity** (`0.60..1.00`, 1095-day cap, `365d` fallback when unlisted), and **multi-chain distribution reach** (`1.00..1.15`, capped at 6 chains).
- **Actionable Farm Plans (`generateFarmPlan`)**: Category- and chain-aware 5-step plans using real chain names, tier-calibrated gas/fee estimates in USD, time budgets, and explicit non-guarantee / no-token-on-record disclosures.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
