# Slots

Optional paid independent spins, up to the configured count during the configured slots window. No fixed winner quotas, predetermined winning players, or bag of guaranteed prizes remains in this design.

For current settings, atomically charge 200 and draw gross payouts of 500/300/100/0 with probabilities 10/20/30/40 percent. Use integer weights derived exactly from validated configuration, unbiased cryptographic sampling, and deterministic injected samples in tests. Do not use client-generated outcomes.

Save accepted attempt count, charge, outcome, payout, request ID, and final balance in one transaction. Return the result immediately after commit; the phone animates that saved outcome. Block a fourth spin, unaffordable spin, or expired request. A result accepted before expiry still plays its animation after expiry. A retried spin returns the same saved result without charging or consuming another attempt.

Show gross returned tokens and net change. A 100 payout after a 200 charge is a net loss of 100; do not label it a profit. Expected gross payout is 140 per spin, expected net is -60, and chance of positive net is 30%. These calculations are acceptance examples of current configuration, not fixed code constants.

Skipping or letting time expire consumes nothing. Multiple wins by the same player and no wins at all are both valid. No app-controlled fake guarantee should override the configured distribution.

Acceptance: verify all four draw boundaries deterministically; at most three accepted spins; simultaneous spin requests cannot overspend or bypass count; repeated requests preserve the saved animation/result; no click means no cost; reconnect restores recent results without rerolling.
