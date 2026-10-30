# Investment selection and review

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

Read `../../spec.md` for the asset lineup/cards and `../../config/game.yaml` for settings.

## Selection

Host preparation fetches a USD `/coins/markets` batch for the exact configured IDs. Validate complete coverage, positive finite prices, provider timestamps, maximum age, and cross-asset timestamp spread. Freeze the complete opening snapshot before opening selection. If it becomes stale while the stage is pending, the host can refresh it before starting; once selection opens it cannot change. Retry failed preparation without opening the timer. Missing optional research metrics do not invalidate an otherwise fresh price.

A player may hold a position in several assets at once (at most one per asset). Each principal is a positive whole-token amount; **the configured cap applies to the total across all of a player's positions** (assumption recorded 2026-10-28: 300 in VOO plus 200 in BTC fits a 600 cap). The total must be affordable from spendable balance plus the player's existing positions. Saving replaces the whole portfolio in one atomic command, and the reservation changes by the difference. A player may revise or cancel while open; cancelling restores all locked principal. No submission at expiry means no position. Each card has a checkbox to invest and a separate control that expands the research details; a ticked asset shows its own amount field, and a pinned bar shows the invested total against the cap and the save action. Expanded details lead with a "See live chart ↗" button (the configured market-and-chart link, opening in a new tab; the timer keeps running), keep the payoff examples in their own collapsed section, and sit on an opaque card so the celebration backdrop never crosses the text. Unsaved stakes are kept in the browser's session storage for the round, so a phone that discards the tab does not lose them. Confirm the selection on the phone. No real orders, wallets, or brokerage accounts are involved.

Each newly ticked asset begins with a blank **Enter tokens** field. Players type their own amounts; there is no auto-fill or **Add the rest** button. Keep one Save/Update investments action for the whole portfolio, with server-confirmed saved feedback. Previously saved or session-restored draft amounts remain visible.

Cards use the description, facts, and links defined in `spec.md`. Keep selection possible within the configured timer on a portrait phone. Show price precision appropriate to the asset. Do not invent market statistics, forecasts, volatility rankings, or present the SPYx token quote as the cash index price.

## Review and settlement

Fetch and accept one complete closing batch from the same provider and exact IDs, subject to freshness checks. No periodic feed is needed. A saved snapshot is immutable across retries. Failure keeps review pending; no partial payouts or substitution of a different feed. If closing prices cannot be loaded, the host may instead refund every unsettled position at its principal (no gain or loss), after a confirmation. Refund uses the same per-position settlement key, so a position pays out once either way. It is refused once a closing snapshot is saved, and closing prices cannot be prepared after a refund. Phones and the display say that stakes were returned in full. Review can advance once nothing is unsettled and either closing prices are saved, a refund happened, or nobody invested.

Calculate using decimal arithmetic: `return = close/open - 1`; `gross_payout = floor(max(0, principal * (1 + multiplier * return)))`. Credit the gross payout and release locked principal once. Report principal, both snapshot prices/times, raw market return, multiplier, game P/L, and gross payout. Gains are uncapped; losses never exceed principal.

## Acceptance examples

- With an illustrative 600-token cap, a player investing 600 from 1,000 has 400 spendable and 600 locked. A 601 request is rejected. Production rooms use their own saved configured cap.
- Repeated request or settlement IDs cause no repeated debit or credit.
- Revising a 600 position to 400 releases 200 and retains one position.
- With that same 600 cap, holding 300 in one asset and 200 in another locks 500; a request totalling 601 is rejected, as is a repeated asset or an unknown asset. Each position settles once with its own payout.
- For principal 600 and multiplier 20: +1% returns 720, -1% returns 480, -5% returns zero, and -8% also returns zero.
- No submission before the deadline causes no debit. Researching offsite never pauses the timer.
- A stale/missing/zero SPYx quote prevents opening or closing preparation, not a fabricated zero return. The host can retry. If closing prices remain unavailable, the host can refund every stake in full, and repeated refunds credit nothing further.
- Refresh, disconnect, or server restart preserves the same position, opening snapshot, deadline, and any settled payout.
