# Implementation plan

Status: shared foundation implemented and verified locally; actual party games and AWS deployment not started.

Next: investment selection/review, then bounded parallel game work and full-party integration. The [complete local implementation handoff](tasks/complete-party.md) defines dependencies, ownership, and completion checks. This handoff adds no game behavior; current implementation status below is unchanged.

Developer shortcuts are available in the root `justfile` and documented in the README. Recipe parsing, formatting, listing, and dry-run command mappings were verified; adding shortcuts did not rerun or change application behavior.

## Party notebook refresh — implemented (2026-10-27–28)

The approved static presentation is applied across `/`, `/play`, `/host`, and `/screen`. Shared light tokens, system typography, quiet dividers, accessible controls, task-focused copy, and Tracy's 10,000-day identity replace the neon styling, circular logo, poster, and promotional slogans. Forms, errors, waiting/open/closed/finished rehearsal states share the same theme. A small optional, aria-hidden, noninteractive static balloon component reserves the decorative extension point. Final balloon/confetti artwork and motion remain deferred; no game module, server contract, privacy projection, economy configuration, or dependency changed.

Observed verification:

- `just format` passed. `just check` passed formatting, all 14 automated tests, type checking, and the production build. The initial sandboxed run passed 11 core tests but lacked loopback permission for three network tests; the permitted repeat passed all 14. This was an environment restriction, not an application failure.
- Chrome exercised all four routes with host/player/public display together against a temporary database and test-only credential, preserving existing `.env` and saved parties. Verified rejected/successful host login, empty host room, creation, join code/QR and TV links, required registration, emoji choice, readiness, hidden/revealed balance, automatic balance hiding on phase change, matching 02:00 countdowns, accepted check-in, host closure, waiting at 00:00, host advancement, disabled completed control, completed player/TV, and player reload/session restoration. Host roster and token activity remain available. Automated tests retain deadline, authorization, duplicate-command, accounting, restart, and privacy coverage.
- Browser screenshots inspected the white/black composition and functional player/host/TV layouts. Captures: [welcome](verification/party-notebook/welcome.jpg), [player](verification/party-notebook/player.jpg), [host](verification/party-notebook/host.jpg), [display](verification/party-notebook/display.jpg). TV content exposed no contact fields or private balances.
- Actual desktop dimensions were 1728×940 and 1728×996, with no observed page overflow. Requested 390×844 viewport override was ineffective (actual 1728×940); narrow-phone/physical iPhone and real-TV readability remain unverified. Editable registration fields computed to 16px. Decoration is static and removable independently; reduced-motion CSS is present, but OS motion preference was not toggled in the browser.
- `npm run dev` encountered the environment's file-watcher limit (`EMFILE`); the same source server ran without Node watch for browser verification. No deployment was performed.

This static design implementation and desktop rehearsal precede investment work. Resolve phone/device verification during the device rehearsal; optional animation is a separate later design pass. Real party games remain unimplemented.

## Observed foundation evidence (2026-10-27)

- Configuration validation, persistent SQLite schema, one-time grants, transactional accounting, idempotent commands, server deadlines, and authorized role projections are implemented.
- Player, host, and TV views are runnable; the Sound check rehearsal is explicit and does not masquerade as an implemented investment game. Unimplemented party stages cannot be started.
- All 14 automated rule/HTTP/WebSocket tests pass after broadcast batching and module action-data integration. Type checking, formatting checks, and the production build pass. The build explicitly selects production mode so a development `.env` cannot select the React development bundle.
- The 15-player network simulation passed. An initial simultaneous 100-player attempt timed out; coalescing room updates and reading common snapshot data once per broadcast resolved it. The repeated 100-player simulation passed, including isolated sessions, connections, readiness, actions, and one grant each.
- Desktop-browser sign-in, room creation, joining, readiness, balance hiding/reveal, host-driven stage change, synchronized countdown, TV state, and check-in were exercised. A requested viewport override did not change the browser's actual 1280×720 viewport; narrow-phone/physical iPhone verification is not claimed.
- Following development-server restarts, the browser restored the existing player/check-in and host room; expiry left the round waiting until the host advanced it, and the TV showed rehearsal completion. The compiled production server was smoke-tested on a local port for HTML/API serving and Secure session cookies.
- Remaining foundation hardening includes host-assisted guest recovery links, production backup/restore procedures, and physical-device rehearsal. Live game modules, async market preparation, and settlement/reveal integration are next.

## 1. Runnable foundation

Scaffold TypeScript/React and Node.js/Socket.IO, establish real commands, and add configuration schema/loading plus SQLite migrations. Implement room creation, host/display/guest sessions, join/readiness, one-time starting grant, shared ledger, phase authorization, persisted deadlines, role-filtered snapshots, reconnects, and restart recovery. Create fake clock/random/provider interfaces and simulated-player fixtures.

Done when: one host, one TV view, and multiple isolated players can run together; only host advances; a duplicate join/starting grant cannot mint tokens; a timed action expires by server time; reconnect and process restart restore the party. Verify unauthorized payloads omit private data.

## 2. Investments and review

Implement the research-card UI and locking/edits/settlement using fixed five-asset fixtures, then add the CoinGecko adapter. Establish authenticated access without committing secrets. Verify every configured ID, fresh timestamp behavior, numeric precision, and SPYx weekend readiness. Distinguish confirmed documentation coverage from an observed successful API test.

Done when: game-specific acceptance cases pass; price failure is retryable; saved snapshots and settlements survive restart; all cards work in portrait and external research returns to the same session.

## 3. Costume and trivia

Implement full per-player prizes for the top three distinct vote groups, plus split and capped last-place penalties using the confirmed tie rules. Add balanced teams, buzzer windows/exclusions, and whole-team individual awards.

Done when: tie and zero-vote examples match exactly; simultaneous buzzes lock one winner; repeated awards/settlements are safe; host/phone/TV results agree.

## 4. Slots, Powerball, and phone draw

Implement independent immediate slot outcomes, bet reservations/proportional allocations, private phone selection and public reveal, and a full final leaderboard. Keep all money mutations in the shared accounting service.

Done when: each game-specific acceptance case passes; delayed/repeated requests cannot overspend/reroll/duplicate payouts; private phone draw stays secret through balance state; timers appear only on the four configured sessions.

## 5. Rehearsal and deployment

Rehearse the complete host-driven party locally and with a real iPhone/TV. Simulate 15 players and test a burst of up to 100 clients, including disconnects, deadline races, and server restart. Prepare Lightsail deployment, DNS/HTTPS, private credentials, consistent S3 backups, and restore/run instructions. Provision and deploy when that work is requested; do not claim infrastructure exists from planning files.

Done when: actual checks, deployment status, market-access evidence, and unresolved limitations are recorded; a complete rehearsal restores the same party after interruption; host can demonstrate public reveals without exposing contact data.

## Execution discipline

Implement the shared core first. Later game tasks read system contracts plus their own specification and do not create alternative ledgers/timers/authentication services. Keep validation tied to observable behavior. Track real progress and evidence here; never mark milestones complete based solely on generated code or documentation.

## Investment work started (2026-10-28)

Added a standalone exact-decimal gross-payout calculation and focused tests for the specified gain/loss examples, tiny prices, invalid inputs, and overflow. It is not wired into the engine and does not constitute an investment game. Party stages remain gated; no game workstreams have been delegated because the required investment integration gate has not been met.

Observed: the two focused tests and `npm run typecheck` passed. `just format` passed. `just check` passed formatting and 13 tests, but its three HTTP/WebSocket tests could not bind 127.0.0.1 (`EPERM`); the command stopped before its typecheck/build steps. This is a local sandbox restriction, not evidence of an application defect.

Next: implement and integrate validated asynchronous opening/closing market snapshots, additive migrations, investment locks and settlement, role-filtered projections, host/player/display controls and deterministic lifecycle tests. Complete that gate before assigning disjoint costume, trivia, and slots work. The remaining full-party simulator, recovery, backup/restore, browser/device, live API, and deployment preparation work is still outstanding.
