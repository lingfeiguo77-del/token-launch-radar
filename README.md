[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lingfeiguo77-del/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lingfeiguo77-del/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

A pre-token protocol radar for make.fun's token-radar-01 bounty. It reads a
sealed DefiLlama snapshot (758 protocols, 2026-11-14), ranks the protocols
that record no token by an implied value, and shows a reader how to farm each
one — in an offline dashboard with three screenshots.

## Value model v2

One function scores every protocol; nothing is hardcoded by name:

```
implied = max(1, round(tvl_usd * 0.25 * growthMult * maturityMult * chainMult))
```

- **Asymmetric 7d growth:** `g = clamp(change_7d, -60, 120)`. A rise adds
  half its size (`1 + (g/100) * 0.5`); a fall subtracts its full size
  (`1 + (g/100) * 1.0`). Clamped to [0.40, 1.60]. Capital flight weighs 2x.
- **Age maturity:** `0.60 + min(age_days, 1095) / 1095 * 0.40`, where age is the
  days from `listed_at` to the snapshot date (365 when unlisted).
- **Multi-chain reach:** `1.00 + 0.03 * min(chains - 1, 5)`, capped at 1.15x.

The board holds 200 rows: all 40 watchlist protocols (TVL >= $50M, no token
on record) plus the 160 highest-TVL protocols outside the watchlist that
record no token. Protocols that record a token never enter the board; the top
24 by market cap are shown separately as Live Tokens.

## Farm plans

Every board row carries a 5-step plan: a concrete action on a real chain
from the snapshot, with a cost in USD and a time for each step, varying by
the protocol's category and chains. Each plan states that the protocol
records no token in this snapshot, so the reader farms a token that may be
issued in future — no airdrop is promised or guaranteed.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot and writes
`out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json` (via the kit's `vendor/makefun-board.ts` buildDossier).
Two runs write byte-identical output. The dashboard renders with zero
network requests.

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — value model v2 and the farm-plan generator
- `vendor/makefun-board.ts` — the kit's dossier builder, unchanged
- `dashboard/` — the offline page (index.html, styles.css, radar.js)
- `screenshots/` — three renders of the page (board, detail, filtered)

Entered on [make.fun](https://make.fun/?ref=7yd20ms9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
