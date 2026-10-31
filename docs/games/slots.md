# Slots

The host starts the timer after advancing to this stage; submissions are unavailable until it starts.

Optional paid independent spins, up to the configured count during the configured slots window. No fixed winner quotas, predetermined winning players, or bag of guaranteed prizes remains in this design.

For current settings, atomically charge 200 and draw gross payouts of 1000/500/200/0 with probabilities 5/20/35/40 percent. Use integer weights derived exactly from validated configuration, unbiased cryptographic sampling, and deterministic injected samples in tests. Do not use client-generated outcomes.

Save accepted attempt count, charge, outcome, payout, request ID, and final balance in one transaction. Return the result immediately after commit; the phone animates that saved outcome. Block a fourth spin, unaffordable spin, or expired request. A result accepted before expiry still plays its animation after expiry. A retried spin returns the same saved result without charging or consuming another attempt.

Show gross returned tokens and net change. A 200 payout after a 200 charge breaks even; do not label it a profit. Expected gross payout is 220 per spin, expected net is +20, and chance of positive net is 25%. These calculations are acceptance examples of current configuration, not fixed code constants. Existing rooms retain their saved slot settings.

Public display: shows the number of spins played and players who have spun (counts only; never names, results or balances).

Presentation: the Spin button (keyboard-accessible) requests one spin. A ticket prints with three rolling cells that stamp in one by one over approximately 2.4 seconds around the saved outcome, and repeat spins are prevented while pending/animating. Earlier spins remain as compact tickets. A short firework finale fires only when the spin's saved net is positive and the player watched it arrive. Keep the same accepted result when the session expires during animation. Reload/late join displays saved history without replay or a new charge. Reduced-motion users see the result directly. Reel symbols are cosmetic; the saved gross/net token amounts are authoritative.

Skipping or letting time expire consumes nothing. Multiple wins by the same player and no wins at all are both valid. No app-controlled fake guarantee should override the configured distribution.

Acceptance: verify all four draw boundaries deterministically; at most three accepted spins; simultaneous spin requests cannot overspend or bypass count; repeated requests preserve the saved animation/result; no click means no cost; reconnect restores recent results without rerolling.
