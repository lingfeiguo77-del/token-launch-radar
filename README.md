# Token Launch Radar — Model v3 (Sqrt), Clean Build

A pre-token-record protocol radar for make.fun token-radar-01. The board ranks 200 protocols by an implied value derived only from the sealed snapshot figures, with a farm plan on every row and an offline dashboard for exploring the ranking.

## Model

`implied = round( sqrt(tvl_usd) * 5000 * growthMult * maturityMult * chainMult )`

- Growth: seven-day TVL change clamped to [-60, 120]; rises count 0.55x, falls 1.10x; a missing value counts as 0.
- Maturity: 0.55 + min(age_days, 1095) / 1095 * 0.45; a missing listing date counts as 365 days.
- Chains: 1.00 + 0.03 per extra chain, capped at seven chains.

One function scores every protocol. No names are hardcoded. Protocols record no token in this snapshot; no airdrop or token launch is promised or guaranteed.

## Run

`MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>`

Node standard library only. Two runs on the same snapshot produce identical bytes.
