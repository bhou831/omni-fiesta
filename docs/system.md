# Shared system design

Status: shared foundation implemented; game-specific preparation, settlement/reveal, recovery-link workflows, and deployment remain pending. Product decisions live in `../spec.md`.

## Deployment and application boundaries

Use one Lightsail instance in a suitable nearby AWS region: Caddy for HTTPS/WebSocket proxying; Node.js/Socket.IO for server behavior; React for three role-specific views; SQLite on persistent local disk. TypeScript is the proposed implementation language. Build and test locally before provisioning infrastructure.

The instance has a static public IP; the domain's existing DNS provider maps `game.bowen-hou.com` to it. S3 can hold consistent backups. Configure a process supervisor and restart recovery. This is a single-instance design; a server outage interrupts live play until recovery. No autoscaling or multiple server writers is part of the first version.

## Room state and configuration

A room owns its phase, phase instance/version, status, player memberships, saved configuration version/hash, and immutable resolved configuration. Read and validate YAML when creating a room, then snapshot it in the database. Existing rooms never adopt edited defaults or asset definitions on restart. Share only public configuration with player/display roles.

Normal phase lifecycle: `pending -> open -> closed -> settled -> revealed`, with untimed phases using only applicable states. Settlement and reveal do not implicitly advance stages. Only an authenticated host command advances. Model completion requirements explicitly; reject advancement that would silently discard unhandled reservations or duplicate a settlement.

Validate finite/nonnegative integer amounts, positive four timer durations, unique asset IDs, known enum policies, cap <= starting grant, valid HTTPS research links, unique prize places, positive spin limits, and draw probabilities summing to one. Preserve decimal market prices at full useful precision; never round a tiny token price to zero.

## Commands and events

Client commands include an opaque request ID, room ID, expected phase instance, action type, and payload. Derive player identity and host permissions from the authenticated session, never a payload player ID. Use unique operation keys and database constraints to deduplicate commands and reject reused IDs with differing payloads.

In one short database transaction: authorize; load current state/configuration; check phase/deadline; validate funds/limits; apply game operation and ledger entries; save the result and updated room version. Return acknowledgment and publish filtered state only after commit. Retried commands return the saved result without repeating side effects.

Clients receive versioned state. After reconnect, reload the authoritative snapshot for their role, then apply newer versioned updates. Ignore stale/out-of-order updates and resynchronize after gaps. A transient missed broadcast cannot invalidate a committed action. Local animation is never the source of a reward.

## Timers

Only investment selection, costume voting, slots, and Powerball betting use countdowns. Persist `opened_at` and `deadline_at` in server UTC. Start the countdown only after required preparation succeeds; investment quotes must be saved before the picking window opens.

Use a server-time handshake/offset to render remaining time on both phones and TV. Clients render locally; do not write the database or broadcast once per second. Recompute on focus/reconnect. Accept commands only when server acceptance time is strictly before the persisted deadline; equality is expired. Late queued submissions are rejected, including delayed buzzer commands from earlier rounds. Phone time is not authoritative.

Expiry closes input but creates no submission, bet, spin, or charge for inactive players. Accepted actions remain valid. A deadline check on every command enforces expiry even when the in-memory timer callback is delayed. On restart, reconstruct phase status from the persisted deadline; never extend it automatically. Advancing remains host-controlled.

## Accounting

Track integer spendable balance, locked investment principal, and reserved Powerball stakes separately. Create an append-only ledger for every grant, reservation/release, cost, award, penalty, and settlement. Maintain materialized balances transactionally with those ledger entries. Each operation references its player, room, phase, and unique operation key.

Use conditional debits/transactions so simultaneous requests cannot overspend. Grant starting tokens once per room/player. Investment edits adjust the principal lock; bet edits adjust the reservation. Debit and record a slot result in one operation. Costume penalty deductions are capped by spendable balance and never access investments or betting reservations. Balances cannot become negative under current rules.

Investment payout is `floor(max(0, principal * (1 + multiplier * (close/open - 1))))`, computed with decimal arithmetic, credited after releasing the locked position exactly once. Preserve input prices, timestamps, multiplier, and principal so results can be explained.

## Data model (logical entities)

- Rooms: phase instance/status/deadline, state version, configuration snapshot, host ownership.
- Players/memberships: public name/emoji/readiness; separate private profile/contact fields; session identity and balances.
- Ledger operations/entries: immutable causes, amounts, accounts, and deduplication keys.
- Market snapshots: role opening/closing, provider IDs, normalized full-precision prices, optional facts, provider/fetch times, immutable accepted payload.
- Investments and votes: unique room/player/stage records with revision support while open.
- Teams/memberships, trivia questions/buzzer windows, first accepted buzz, excluded teams, and host awards.
- Slot spins: unique attempt and request, cost, sampled outcome, resulting payout.
- Powerball bets/draw/settlement: frozen stakes, committed secret outcome, per-player allocations.
- Phone draws: persisted selected player, private contact reference, award and reveal state.

## Privacy and identity

Players access only their own economic state and public party state. Host sessions access all balances/contact fields. The TV gets an explicit public projection, not the host payload with fields visually hidden. Public reveal state controls release of rankings/results. Phone numbers and emails never appear in public snapshots, leaderboards, or logs.

Guest sessions survive a tab refresh and reconnect, using secure server-issued credentials. A new device is not automatically the same person because its name matches. Provide a host-assisted recovery/reassignment path with explicit identity checking rather than creating a duplicate funded player. Choose concrete session libraries and cookie policy during scaffolding.

Host authentication uses a private configured credential and secure session; store secrets in environment/secrets configuration. Host/display route differences are not authorization. A display token grants only public room access.

## Determinism, randomness, and recovery

Inject clock, random draw, and market-provider dependencies for tests. Production outcomes use cryptographic server randomness. Resolve a draw once, persist it, and reuse it after retries/restarts. Do not reroll pending reveals. Use a question/window ID so a late buzz cannot win a new question.

Persist enough state to resume every phase, command result, deadline, spin, and partially presented reveal. Capture consistent SQLite backups rather than copying a live database file without its transaction state. Rehearse restore and server restart before the event. Keep development fixtures separate from production rooms and expose no public test controls.
