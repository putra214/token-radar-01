# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wabilah-pramadana/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wabilah-pramadana/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar — radar-3

A token-launch radar for the make.fun `token-radar-01` bounty. It reads one
frozen DefiLlama snapshot (758 protocols, as of 2026-11-14), ranks the
pre-token protocols by fitted implied value, shows a breakeven share — the
airdrop share a farmer needs to break even — that sorts smallest first, and
gives each one a costed 7-step farm plan plus a farm verdict (FARM /
THIN / SKIP) from expected value against cash cost, kept only as a
secondary badge because it depends on an assumed share. Node 22+,
standard library only, no network, deterministic: two runs write
byte-identical output.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

That writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` into the output directory (default `/output`, the grader's
mount). `main.ts` refuses to write a board the gate would refuse.

## What changed from the starter (radar-1)

- **Model, fitted not flat.** radar-1 priced every protocol at TVL x 0.25.
  radar-3 fits the multiple from the snapshot's own live-token comps at run
  time (see below). No protocol name is special-cased anywhere.
- **Early rows picked by the model, not by raw TVL.** The starter took the
  160 biggest pre-token protocols below the floor; radar-3 scores every
  eligible candidate and takes the strongest 260 by implied value. The
  eligible pool below the floor is only 143, so the board carries all of
  them: 40 watchlist + 143 early = **183 rows**.
- **Wrapped/staked/bridged products excluded from early rows.** The watchlist
  definition already excludes Bridge, Canonical Bridge, Liquid Staking,
  Liquid Restaking and Restaked BTC; radar-3 applies the same exclusion to
  early rows (watchlist rows themselves are always included).
- **Token odds column.** A stated 12-month launch prior per row, built from
  the peers' record (see below), shown and sortable in the dashboard and
  broken down in the detail view.
- **Farm plans: 7 steps, chain-aware gas, plus a verdict.** Gas per transaction
  depends on the protocol's first chain (Ethereum ~$6–$14, L2s ~$0.10–$1,
  Solana-class under $0.10), plus a second, different qualifying action per
  category. Each row also carries FARM / THIN / SKIP from expected value
  (odds x implied x an assumed 0.000005 share) against cash cost (gas x
  transactions + 10%/year opportunity cost on locked capital), with a
  breakeven share so the verdict can be re-derived under any other share.
  Since v2.3 the breakeven share is the board's main farm column — cash cost /
  (odds x implied) — because it needs no assumed share, while the verdict
  label does; since v2.4 the board is shown in rank order again (highest
  implied value first) and the breakeven column sorts smallest-first when
  clicked. The verdict survives only as a small badge
  under each breakeven number, in the detail view, and as a secondary
  filter. The Method tab also shows the verdict-sensitivity table (the whole
  FARM/THIN/SKIP split re-derived at 10x smaller and 10x larger shares:
  3/14/166 and 137/28/18), and each detail view headlines its breakeven
  share next to the verdict plus the verdict it would get at both
  alternate shares — because the headline 42/24/117 split is
  assumption-driven and the breakeven share is the assumption-free number.
- **Integrity strip per row.** Flags from the snapshot record alone: missing
  7-day change, missing listing date, a category with a single live comp,
  a fitted/category multiple or odds pinned to a clamp. Rows in a 1-comp
  category carry an amber `1-comp` badge on the board, the detail view's
  integrity strip bolds that flag, and the KPI strip counts them (61 of 183).
- **Dashboard rewritten.** Same static, no-network shape, but a new theme,
  a KPI strip, chain, minimum-odds, breakeven-share and verdict filters, an
  odds column, a breakeven-share column (sortable, smallest first, with the
  verdict as a secondary badge underneath), a Charts panel above the board
  (a log–log scatter of the 24 live comps against the fitted log–log line,
  and a 12-bin histogram of implied value across the 183 rows — both inline
  SVG drawn from the same data, no library), a Method tab with the held-out
  test (3 folds) and the ablation table, and per-category live comps inside
  the detail view. Dashboard source is 64,373 bytes (~62.9 KiB), under the
  64 KiB budget. Screenshots are JPEG quality 60, 1440x1200, 131,261 /
  172,876 / 131,447 bytes; the dossier is 646,827 bytes — above sudhan #3's 450,689 bytes
  (the 1440x1200 re-shoot that makes board rows visible in the screenshots
  costs ~129 KB), still far below the 1.5 MB cap and the field median of
  746,376, and the dossier tie-break only matters on an exact tie.

## Model radar-3

Comps: the 118 protocols that record a market cap above zero, a TVL above
zero, a category other than CEX, and a non-versioned name. Everything below
is computed from them at run time.

- Global median multiple M0 = median(mcap / TVL) over the comps: **x0.241**,
  after winsorizing each comp's multiple at its 95th percentile (x5.13).
- Log-log regression, log(mcap) = a + b·log(TVL), OLS over the comps (not
  winsorized), slope clamped to [0.25, 0.9]: intercept 7.93, **slope 0.462**.
  A slope below 1 means the market pays a smaller multiple for a bigger TVL.
- Category multiple: the median mcap/TVL inside the protocol's own category
  (winsorized first), shrunk toward the global median, (n·catMedian + 8·M0) /
  (n + 8), then clamped to [0.02, 2.5]. Winsorizing changed 3 category
  multiples — Prediction Market 2.5 -> 0.78, Collateral Management 1.57 ->
  0.78, Token Locker 2.10 -> 0.71 — so one thin-TVL outlier (rain, 400x)
  no longer sets a whole category. The global median did not move (x0.241).
- Fitted multiple = sqrt(log-log multiple × category multiple), clamped to
  [0.02, 2.5].
- Adjustments, each capped so the fitted multiple does the work:
  growth = 1 + clamp(change_7d, −40, 80)/100 × 0.25;
  maturity = 0.85 + min(age_days, 1095)/1095 × 0.30 (unknown age: 1.00).
- `implied = round(TVL × fitted × growth × maturity)`, minimum 1.
- radar-2 also multiplied by breadth = 1 + min(max(chains − 1, 0), 4) × 0.03.
  radar-3 drops it: the leave-one-out ablation (below) shows dropping
  breadth improves the mean held-out median log error on folds A+B from
  1.463 to 1.409, improving both folds. Dropping growth or maturity is
  mixed across folds, so those two stay.

### Held-out test (computed by the program itself, three times)

Comps sorted by slug; fold A holds out every 5th starting at index 4, fold B
every 5th starting at index 1. Fold C is walk-forward: fit on the older
comps, test on the youngest 20% by listed_at (24 comps); comps with no
listed_at stay in train. Baseline is the starter's flat 0.25 multiple,
scored the same way. Unlike radar-2, which scored the fitted multiple
alone (1.281 / 1.618), radar-3 scores the full implied value the board
ranks by — the numbers are not directly comparable.

| Fold | Test n | radar-3 median \|log error\| | Within 2x | Baseline median \|log error\| | Baseline within 2x |
| ---- | ------ | -------------------------- | --------- | --------------------------- | ------------------ |
| A    | 23     | 1.311                      | 22%       | 1.657                       | 22%                |
| B    | 24     | 1.508                      | 21%       | 1.894                       | 25%                |
| C    | 24     | 1.233                      | 29%       | 1.389                       | 29%                |

### Ablation (computed by the program on the same three folds)

Mean A+B median |log error| per variant: full (radar-2) 1.463, no growth
1.459, no maturity 1.444, **no breadth (radar-3) 1.409**, fitted multiple
only 1.450, log-log only 1.444, category only 1.675, global median only
1.755. Fold C for radar-3 is 1.233 (full radar-2: 1.203 — radar-3 is
slightly worse on the walk-forward fold, and the dashboard says so).
The gaps are small at n = 23–24 per fold; read them as weak evidence.

radar-3 beats the flat baseline on median log error in all three folds.
But read the numbers honestly: a median log error of 1.2–1.5 means the
typical prediction is off by a factor of about 3.5–4.5x. mcap/TVL is
genuinely dispersed (10th percentile 0.01, median 0.24, 90th percentile
2.9). The fitted value is a central estimate, not a price — the dashboard
says so on the board and in every detail view.

### Token odds (12-month launch prior)

Not a fitted forecast: the snapshot has no launch labels, so no such fit
exists. Odds start from the peers' record — the share of all 758 protocols
in the same TVL band × age band that record a token, shrunk toward the
overall share (55%) with 10 phantom protocols — then a discount for time
already spent tokenless (under 1y: ×1.0; 1–2y: ×0.85; 2–3y: ×0.7; 3y+:
×0.5; unknown: ×0.8) and a small growth nudge (up to +10%). Clamped to
[0.05, 0.85]. Board odds range 0.23–0.60. The detail view shows each row's
peer rate and discount.

## Board (this snapshot)

- 183 rows: all 40 watchlist slugs + 143 early rows.
- Implied value from $306,257,362 (rank 1) down to $1,867,478 (rank 183).
- Farm verdicts: 42 FARM / 24 THIN / 117 SKIP. Median EV/cash-cost ratio
  0.55 — most rows are not worth farming under the stated 0.000005 share
  assumption, and the board says so instead of hiding it. Breakeven share:
  lowest 3.95e-8 (Steakhouse Financial), median 9.10e-6, highest 0.000239;
  the board is shown in rank order, and the breakeven column sorts
  smallest-first when clicked.
- 7 farm steps per row, every step 20–600 characters.
- 66 rows carry at least one integrity flag (58 of them only "category has
  1 live comp"); 117 rows are clean.
- All 758 protocols are accounted for in the dashboard: 183 ranked, 24
  live-token comps shown, the rest pre-token protocols set aside as
  wrapped, staked, bridged, versioned or exchange products.

## Files

- `main.ts` — entry point: read snapshot, score, write output, build dossier.
- `lib/model.ts` — radar-3: fitting, winsorizing, held-out test (3 folds),
  ablation, token odds, farm economics and verdicts, integrity flags.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied byte-for-byte
  from the kit (not authored work).
- `dashboard/` — `index.html`, `app.css`, `app.js`; static, no network.
- `screenshots/` — 3 screenshots (board, detail, filtered), JPEG quality 60.

## Status

Built 2026-11-20 as v2 (radar-3), revised 2026-11-21 as v2.2 (same model,
sensitivity table + 1-comp badges + permanent render check; see
`../v2.2-build-notes.md`), revised again 2026-11-21 as v2.3 (same model,
board now ranks by breakeven share with the verdict demoted to a secondary
badge + breakeven filter and KPIs; see `../v2.3-build-notes.md`), revised
again 2026-11-21 as v2.4 (same model, Charts panel with two inline-SVG
charts drawn from the same data + board back to rank order, breakeven
sortable; see `../v2.4-build-notes.md`), revised again 2026-11-21 as v2.5
(same model, Margin of Safety labels: High Margin badge on 17 rows,
Safe/Moonshot shares in the detail view; check 25/25; see
`../v2.5-report.md`), and revised again 2026-11-21 as v2.6 (same model,
Error-Band Pricing: implied value shown as [Estimate/4, Estimate x4] on
every row, High Margin badge realigned 17 → 28 rows; check 28/28; see
`../v2.6-report.md`). **Not
submitted** — submission needs yesi's approval. Screenshots re-shot with
headless Chrome (this VM's provisioned Chromium 157), 1440x1200, JPEG quality
60, and visually inspected. 2x runs byte-identical, local gates 8/8, plus
the render check in `../check-v22.mjs` (28 checks as of v2.6: `node --check`, 2x
byte-identical runs, gates, and a headless-Chrome render check that the
board renders 183 rows sorted by rank, both charts render with honest
captions, clicking Breakeven share re-sorts smallest-first, the breakeven
KPIs and filter work, the sensitivity table, the breakeven-error note and
the breakeven headline appear, and 61 rows carry the 1-comp badge — the
check v2.1's blank-dashboard bug proved the gates alone cannot catch; the
render check loads the output over file:// because this VM's Chromium build
blocks loopback navigation — see the check script's header). Gemini review
(gemini-3-flash-preview) was obtained for v2.2 via the surrogate credential
path; see `../v2.2-build-notes.md` for the review and the evaluation of each
point. See `v2-build-notes.md` in the parent directory for the full v2
numbers and the remaining weaknesses.
