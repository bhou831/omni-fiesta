# Costume contest

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

## Voting and placement

Each joined player is a candidate identified by name/emoji. Each player may cast/revise one vote before expiry; self-votes are disabled by current configuration. Zero-vote candidates remain in the results. No vote is automatically cast at expiry.

Group all candidates by vote count descending. Place means **distinct vote total**, so vote groups receive dense ranks 1, 2, 3, etc. Every player in a prize group receives the full configured per-player award for that place. Do not divide awards by group size or combine adjacent places' awards. The next distinct group gets the next place's award even when earlier groups contain multiple people. Total tokens awarded therefore depend on the number of players in each prize group.

The lowest-vote group splits the configured last-place penalty pool using `floor(pool / group_size)`, but only when that group receives no top-three prize. Cap each individual deduction at their current spendable balance. Do not access locked investments or redistribute an uncollectible deduction. Division remainder is not awarded or deducted elsewhere.

If no valid votes were cast, perform no awards or penalties. This follows the inactive-session rule and avoids awarding everyone for an empty contest. With one player, voting can be closed/skipped by the host. With fewer than four distinct groups, the bottom group receives its prize if applicable and has no last-place penalty.

## Lock and reveal

Voting stays where it is in the party. When voting closes the host **locks** the standings (a tie for first must be re-voted first). Locking calculates places but changes no balance, and phones and the TV only say winners come later. The host-only preview is the only place standings are visible until the reveal.

The **Costume winners** stage comes after Somebody's calling and before the finish. The host announces one place per click: 3rd, 2nd, last place, then 1st. Tied players share a step, an empty place is skipped, and last place is its own step only when it is below 3rd. With fewer than 3 players one click shows everyone. After the last place, one more click replaces the cards with the full list (place, name, votes, token change), podium fixed and the rest rotating on the TV, as in the final ranking; a single group already shows everyone, so it has no list step. Each click moves tokens for that step's players only (one `costume:<instance>` ledger entry per player). The last-place penalty is capped by the player's spendable balance when their place is announced. Public screens receive only the places announced so far. The host cannot advance until every place and the list are shown. Repeated clicks after the last place do nothing.

## Acceptance examples

- A tie for first blocks locking. The host starts a re-vote (fresh timer, same voting rules) among only the tied players; every player may vote, but only tied players can be chosen, and earlier-round ballots are kept but not counted as the current vote. This repeats until one player leads. Standing is each round's votes in order, so a re-vote only orders players who were tied. If nobody votes in a re-vote the tie stands and results may be revealed.
- Players in a tie for second or lower still each receive that place's full prize; for example, with nine players and votes `[4,2,2,2,0,0,0,0,0]`, awards are 1,000, then 800 for each of the three tied for second, then 500 for each of the five zero-vote players (a prize exists for their group, so no penalty), with no re-vote.
- With nine players and round-one totals `[3,3,2,1,0,0,0,0,0]`, the two leaders are re-voted. If player 0 then outpolls player 1, awards are `[1000,800,500,0,0,0,0,0,0]` before the zero-vote penalties of 100 each.
- The five zero-vote candidates each owe 100 (500 pool split), capped individually at spendable balance.
- If two of those bottom players have balances 60 and 140, deduct 60 and 100 respectively; do not shift the uncollectible 40 to anyone else.
- With distinct vote groups 4/2/0, every player in the zero-vote group receives the full third-place award and no penalty.
- All zero votes causes no settlement effects.
- Repeated lock/reveal commands never repeat monetary effects, and locking moves no tokens.
- Reveal order is 3rd, 2nd, last place, 1st; tokens move only for the place just announced.
- Public results include all candidates, including every zero-vote candidate; emails and phone numbers remain private.
