# Red/blue Powerball

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

During the configured betting window, a player chooses red or blue and a positive whole-token stake affordable from spendable balance. Reserve the stake. One side per player; allow revision or cancellation before closing and adjust the reservation atomically. Expiry closes betting without placing bets for inactive players. Only the host initiates the draw/reveal and advances.

After bets close, persist a server-side 50/50 red/blue outcome under current configuration. Hide the outcome until host reveal. Freeze bets before drawing. Retried/restarted draws reuse the same result.

Public display: shows how many players back red and blue (counts only; no names or stakes) and highlights the winning side after the reveal. Phones never receive the tally. Accepted by the user on 2026-10-28; it lets the room see the split before the draw.

Presentation: host reveal starts a five-second gumball-machine animation on connected player and display views: the dome mixes, a capsule drops from the door, rolls out and cracks open to show a red or blue ball. A firework finale fires for a player whose saved payout is a net gain and on the public display when the draw completes; reload/late join stays quiet. The color and personal payout text appear together after presentation; the public reveal still settles immediately on the server. This delay is visual and does not keep a publicly revealed payload secret. Reload/late join displays the saved result immediately; reduced motion skips the wait. Timings belong to client presentation settings, not the betting timer or draw probabilities. Views begin on receipt of the same reveal update; this is not frame-perfect synchronization across devices.

If winning stakes total W > 0 and losing stakes total L, each winning player receives their stake back plus `stake/W * L`. Losing stakes are consumed. Allocate the losing pool in whole tokens using floors plus the largest fractional remainders; use stable player ID to resolve equal remainders. This conserves the pooled tokens exactly. Do not apply the costume penalty's floor-and-discard rule here.

If the selected side has no bettors, refund all stakes. If no bets exist, there are no token effects. No house subsidy or fee. Settlement and release of all reservations occur once, transactionally.

Acceptance: 100 of 500 winning stake against 300 losing stake returns 160; all payouts sum to all stakes when W > 0; no winning bettors causes full refunds; duplicate settlement has no effects; stale or unaffordable edits fail; no submission has no debit.
