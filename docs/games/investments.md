# Investment selection and review

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

Read `../../spec.md` for the asset lineup/cards and `../../config/game.yaml` for settings.

## Selection

Host preparation fetches a USD `/coins/markets` batch for the exact configured IDs. Validate complete coverage, positive finite prices, provider timestamps, maximum age, and cross-asset timestamp spread. Freeze the complete opening snapshot before opening selection. Retry failed preparation without opening the timer. Missing optional research metrics do not invalidate an otherwise fresh price.

One player holds at most one asset position, with a positive whole-token principal <= configured cap and affordable from spendable balance plus their existing position's principal. A player may revise the asset/amount or cancel while open; update reservations atomically. Cancelling restores the locked principal. No submission at expiry means no position. Confirm the selection on the phone. No real orders, wallets, or brokerage accounts are involved.

Cards use the description, facts, and links defined in `spec.md`. Keep selection possible in two minutes on a portrait phone. Show price precision appropriate to the asset. Do not invent market statistics, forecasts, volatility rankings, or present the SPYx token quote as the cash index price.

## Review and settlement

Fetch and accept one complete closing batch from the same provider and exact IDs, subject to freshness checks. No periodic feed is needed. A saved snapshot is immutable across retries. Failure keeps review pending; no partial payouts or substitution of a different feed.

Calculate using decimal arithmetic: `return = close/open - 1`; `gross_payout = floor(max(0, principal * (1 + multiplier * return)))`. Credit the gross payout and release locked principal once. Report principal, both snapshot prices/times, raw market return, multiplier, game P/L, and gross payout. Gains are uncapped; losses never exceed principal.

## Acceptance examples

- With current configuration, a player investing 600 from 1,000 has 400 spendable and 600 locked. A 601 request is rejected.
- Repeated request or settlement IDs cause no repeated debit or credit.
- Revising a 600 position to 400 releases 200 and retains one position.
- For principal 600 and multiplier 20: +1% returns 720, -1% returns 480, -5% returns zero, and -8% also returns zero.
- No submission before the deadline causes no debit. Researching offsite never pauses the timer.
- A stale/missing/zero SPYx quote prevents opening or closing preparation, not a fabricated zero return. The host can retry.
- Refresh, disconnect, or server restart preserves the same position, opening snapshot, deadline, and any settled payout.
