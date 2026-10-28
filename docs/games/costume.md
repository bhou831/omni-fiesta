# Costume contest

## Voting and placement

Each joined player is a candidate identified by name/emoji. Each player may cast/revise one vote before expiry; self-votes are disabled by current configuration. Zero-vote candidates remain in the results. No vote is automatically cast at expiry.

Group all candidates by vote count descending. Place means **distinct vote total**, so vote groups receive dense ranks 1, 2, 3, etc. Every player in a prize group receives the full configured per-player award for that place. Do not divide awards by group size or combine adjacent places' awards. The next distinct group gets the next place's award even when earlier groups contain multiple people. Total tokens awarded therefore depend on the number of players in each prize group.

The lowest-vote group splits the configured last-place penalty pool using `floor(pool / group_size)`, but only when that group receives no top-three prize. Cap each individual deduction at their current spendable balance. Do not access locked investments or redistribute an uncollectible deduction. Division remainder is not awarded or deducted elsewhere.

If no valid votes were cast, perform no awards or penalties. This follows the inactive-session rule and avoids awarding everyone for an empty contest. With one player, voting can be closed/skipped by the host. With fewer than four distinct groups, the bottom group receives its prize if applicable and has no last-place penalty.

## Settlement and reveal

Host closes or waits for deadline, then settles exactly once and reveals the complete vote ranking and award/deduction changes. The TV animation follows committed results. A host-only preview cannot leak standings before reveal. Only the host advances afterward.

## Acceptance examples

- Five players tie for first: each receives 1,000. A single player in the next distinct vote group receives 800. Every player in the third distinct group receives 500.
- With nine players and vote totals `[3,3,2,1,0,0,0,0,0]`, awards are `[1000,1000,800,500,0,0,0,0,0]`. The five zero-vote candidates each owe 100, capped individually at spendable balance.
- If two of those bottom players have balances 60 and 140, deduct 60 and 100 respectively; do not shift the uncollectible 40 to anyone else.
- With distinct vote groups 4/2/0, every player in the zero-vote group receives the full third-place award and no penalty.
- All zero votes causes no settlement effects.
- Repeated settlement/reveal commands never repeat monetary effects.
- Public results include all candidates, including every zero-vote candidate; emails and phone numbers remain private.
