# Costume contest

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

## Voting and placement

Each joined player is a candidate identified by name/emoji. Each player may cast/revise one vote before expiry; self-votes are disabled by current configuration. Zero-vote candidates remain in the results. No vote is automatically cast at expiry.

Group all candidates by vote count descending. Place means **distinct vote total**, so vote groups receive dense ranks 1, 2, 3, etc. Every player in a prize group receives the full configured per-player award for that place. Do not divide awards by group size or combine adjacent places' awards. The next distinct group gets the next place's award even when earlier groups contain multiple people. Total tokens awarded therefore depend on the number of players in each prize group.

The lowest-vote group splits the configured last-place penalty pool using `floor(pool / group_size)`, but only when that group receives no top-three prize. Cap each individual deduction at their current spendable balance. Do not access locked investments or redistribute an uncollectible deduction. Division remainder is not awarded or deducted elsewhere.

If no valid votes were cast, perform no awards or penalties. This follows the inactive-session rule and avoids awarding everyone for an empty contest. With one player, voting can be closed/skipped by the host. With fewer than four distinct groups, the bottom group receives its prize if applicable and has no last-place penalty.

## Settlement and reveal

Host closes or waits for deadline, then settles exactly once and reveals the complete vote ranking and award/deduction changes. The TV animation follows committed results. A host-only preview cannot leak standings before reveal. Only the host advances afterward.

## Acceptance examples

- A tie for first blocks the reveal. The host starts a re-vote (fresh timer, same voting rules) among only the tied players; every player may vote, but only tied players can be chosen, and earlier-round ballots are kept but not counted as the current vote. This repeats until one player leads. Standing is each round's votes in order, so a re-vote only orders players who were tied. If nobody votes in a re-vote the tie stands and results may be revealed.
- Players in a tie for second or lower still each receive that place's full prize; for example, with nine players and votes `[4,2,2,2,0,0,0,0,0]`, awards are 1,000, then 800 for each of the three tied for second, then 500 for each of the five zero-vote players (a prize exists for their group, so no penalty), with no re-vote.
- With nine players and round-one totals `[3,3,2,1,0,0,0,0,0]`, the two leaders are re-voted. If player 0 then outpolls player 1, awards are `[1000,800,500,0,0,0,0,0,0]` before the zero-vote penalties of 100 each.
- The five zero-vote candidates each owe 100 (500 pool split), capped individually at spendable balance.
- If two of those bottom players have balances 60 and 140, deduct 60 and 100 respectively; do not shift the uncollectible 40 to anyone else.
- With distinct vote groups 4/2/0, every player in the zero-vote group receives the full third-place award and no penalty.
- All zero votes causes no settlement effects.
- Repeated settlement/reveal commands never repeat monetary effects.
- Public results include all candidates, including every zero-vote candidate; emails and phone numbers remain private.
