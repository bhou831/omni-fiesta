# Red/blue Powerball

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

During the configured betting window, a player chooses red or blue and a positive whole-token stake affordable from spendable balance. Reserve the stake. One side per player; allow revision or cancellation before closing and adjust the reservation atomically. Expiry closes betting without placing bets for inactive players. Only the host initiates the draw/reveal and advances.

After bets close, persist a server-side 50/50 red/blue outcome under current configuration. Hide the outcome until host reveal. Freeze bets before drawing. Retried/restarted draws reuse the same result.

If winning stakes total W > 0 and losing stakes total L, each winning player receives their stake back plus `stake/W * L`. Losing stakes are consumed. Allocate the losing pool in whole tokens using floors plus the largest fractional remainders; use stable player ID to resolve equal remainders. This conserves the pooled tokens exactly. Do not apply the costume penalty's floor-and-discard rule here.

If the selected side has no bettors, refund all stakes. If no bets exist, there are no token effects. No house subsidy or fee. Settlement and release of all reservations occur once, transactionally.

Acceptance: 100 of 500 winning stake against 300 losing stake returns 160; all payouts sum to all stakes when W > 0; no winning bettors causes full refunds; duplicate settlement has no effects; stale or unaffordable edits fail; no submission has no debit.
