# Omni Fiesta

A host-led party game for phone browsers and a shared TV display.

The shared foundation and all game modules/role views are implemented. A disposable fixture harness has completed full-party network rehearsals with 15 and 100 players and a one-player host/player/TV browser walkthrough. The default server registers all party games; AWS deployment has not been performed. A separate **Sound check** rehearsal remains available.

## Approved design: Party notebook

The party celebrates **Tracy's 10,000th day**. The approved direction is a minimal white page with black text, a compact text header, a small balloon marker, quiet dividers, and direct personal wording. All player, host, TV, and future game interfaces follow this direction.

See the [design guide](docs/design/party-notebook.md) and [portable visual reference](docs/design/party-notebook-reference.html). The running app now applies this design across `/`, `/play`, `/host`, and `/screen`, including forms, waiting states, errors, countdowns, and rehearsal completion. Shared client tokens and system fonts keep the views coherent. The static balloon marker is an optional client component; no animation library or game configuration changes were added. Optional floating balloons and other celebration effects are reserved for a later iteration; keep their decorative layer separate from core layout and game logic.

Game interactions now include a pull/tap slot handle with rolling reels, a five-second red/blue ball reveal, and five expandable investment research cards. Presentation timings live in `src/client/game-motion.ts`; reduced motion skips the wait and reloads show saved results immediately. These effects do not change game odds, accounting or session timers.

## UI verification (2026-10-27–28)

`just format` and `just check` passed: formatting, all 14 rule/HTTP/WebSocket tests, TypeScript checks, and the production build. The first sandboxed check could not bind loopback ports; repeating with local-port permission passed. The development watch command hit an environment file-watcher limit, so browser verification used `node --import tsx src/server/index.ts` against an isolated temporary database and test credential, without changing `.env` or saved parties.

Chrome verification covered all four routes and a complete host/player/TV Sound check: failed and successful host sign-in, empty room, room creation, QR/player/TV links, registration, emoji selection, readiness, balance reveal and automatic hiding on stage change, matching countdowns, check-in, host closure/advancement, completion, and player reload. Existing automated projection tests passed; the TV showed no contacts or private balances. [Screenshots](docs/verification/party-notebook/) capture all four views.

Actual desktop viewports were 1728×940 and 1728×996, with no page overflow observed. A requested 390×844 override did **not** change the actual viewport; narrow-phone and physical iPhone/TV verification remain outstanding. Registration fields computed to 16px. Static decoration has no motion and can be disabled in the client; reduced-motion CSS disables future animation/transition styling, but an OS reduced-motion toggle was not exercised.

Run the party app or Sound check with `just dev`, then visit `/`, `/play`, `/host`, and the host-generated `/screen` link. Use the disposable fixture harness below for isolated rehearsals. Final balloons/confetti and AWS deployment remain pending.

## Shortcuts

The [justfile](justfile) wraps the npm commands below. Run `just` to list shortcuts:

```sh
just setup          # Install dependencies and create .env if needed
just dev            # Start development
just format         # Format source files
just typecheck      # Check TypeScript
just test           # Run tests
just check          # Check formatting, test, type-check, and build
just build          # Build the application
just start          # Start the built application
just simulate       # Simulate 15 players; development server must be running
just simulate 100   # Simulate 100 players
just market-check   # Read-only live check of all five configured assets
just preview        # Gallery of every game, including result screens
just preview slots  # Focus the gallery on slots; print direct player/host/TV links
just preview stock  # Investment cards (alias for investments)
```

## Run locally

Use Node.js 22.13 or newer. On Node 22, the built-in SQLite module prints an experimental-feature warning.

```sh
npm ci
npm run setup
npm run dev
```

Open `http://localhost:3000`. The setup command creates an ignored `.env` with a generated private host password and preserves an existing `.env`. Open that file locally to find `HOST_PASSWORD`. Sign in at `/host`, create a rehearsal, and use its join code/QR and TV link. Host and player cookies are separate, so both roles can run in different tabs of the same browser. Separate players need separate browser profiles or the simulator.

The TV link contains only a public-display capability in its URL fragment; it grants no host access. Use an extended screen for the TV so private host information is not projected.

State is saved in `data/party.sqlite` by default. Stop/restart the server with the same `.env` and database to resume. Editing `config/game.yaml` affects newly created rooms; saved parties keep their original settings. For phones on the same local network, open the computer's LAN address on port 3000 and create/share links through that address, or use HTTPS in deployment. Physical iPhone rehearsal is still required.

## Preview individual games

Run `just preview` and open [the preview gallery](http://127.0.0.1:3001/preview). You can keep `just dev` running on port 3000. `just preview slots`, `just preview investments` (or `stock`), and `just preview powerball` highlight a game and print its direct player/host/TV links. `npm run preview -- slots` is equivalent. Other choices include `lobby`, `costume`, `costume-results`, `trivia`, `powerball-results`, `investment-review`, `somebody-calling`, and `finish`.

Each screen uses the actual game views and commands with six sample players and clearly labeled fixture prices/research facts. You do not need to register or play earlier rounds. Host links sign in automatically on this local preview server; use the host controls to trigger draws/reveals and watch animations. Opening a result preview shows an already-settled result. Timed previews allow 15 minutes; stop with Ctrl+C and restart the command to reset all sample rooms. Source/CSS edits refresh through Vite; changes to server code or seeds require restarting the command.

The preview server binds only to loopback, stores everything in memory, uses separate `of_preview_*` cookies, and disables live market requests. It does not use the saved party database or configured host password. These routes are not mounted by normal startup and the preview script refuses production mode. Player tabs share a sample-player session within the preview server, so inspect one room at a time or use separate browser profiles. Use `PREVIEW_PORT=3002 just preview` if port 3001 is occupied. Real-device/LAN rehearsal uses the normal server, not this loopback preview.

## Clean up unused rooms

In `/host`, open **Manage parties**, select the unused room, then **Archive party**. All player tabs must disconnect first; the server also enforces this. Archived rooms disappear from the active selector, stop accepting commands/joins and disconnect their host/TV views. Expand **Archived parties** and choose **Restore** to reopen one.

Archiving is reversible and preserves profiles, scores, saved draws, locked/reserved tokens, sessions and the ledger. It does not permanently erase data or pause/reset deadlines; a restored round whose deadline has passed is closed. No rooms are archived automatically or by the preview command.

## Check and simulate

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

With the development server running:

```sh
npm run simulate -- 15
npm run simulate -- 100
```

Each simulator run creates a separate rehearsal and isolated player sessions, uses real HTTP/WebSocket connections, checks starting grants/readiness/check-ins, and finishes without spending tokens. Rehearsal requires `ENABLE_REHEARSAL=true`; it is disabled unless explicitly enabled. Set `BASE_URL` if testing another local server. Network integration tests need permission to bind loopback ports in restricted environments.

`npm run build` writes `dist/client` and compiled server/shared files. `npm start` uses the environment in `.env`; for production, configure `NODE_ENV=production`, an HTTPS `PUBLIC_ORIGIN`, a private host password, persistent database storage, and `ENABLE_REHEARSAL=false`. Complete readiness review, Lightsail provisioning, HTTPS proxy verification, and backup/restore rehearsal before deployment.

## Specifications and agent tasks

- [Product specification and investment research cards](spec.md)
- [Adjustable game configuration](config/game.yaml)
- [Shared system design](docs/system.md)
- [Implementation plan](docs/plan.md)
- [Approved Party notebook design](docs/design/party-notebook.md)
- [Completed UI implementation task](docs/tasks/party-notebook-ui.md)
- [Agent workflow and ownership](docs/agent-workflow.md)
- [Full local implementation handoff and parallel work plan](docs/tasks/complete-party.md)
- [Fresh-session investment task](docs/tasks/investments.md)
- [Investment selection/review](docs/games/investments.md)
- [Costume contest](docs/games/costume.md)
- [Trivia](docs/games/trivia.md)
- [Slots](docs/games/slots.md)
- [Powerball](docs/games/powerball.md)
- [Somebody's Calling](docs/games/somebody-calling.md)

Target hosting: AWS Lightsail, `game.bowen-hou.com`. Implemented stack: TypeScript, React, Node.js/Socket.IO, SQLite. Caddy is the planned HTTPS proxy.

## Integrated verification (2026-10-28)

The permitted `just check` run passed all 46 tests, including investment HTTP/WebSocket coverage and a balance-visibility regression, plus formatting, type checking, and the production build. Full-party network simulations against the disposable harness completed all stages with 15 and 100 isolated HTTP/WebSocket player sessions. These simulator runs did not test process restart or reconnect during play.

A desktop browser walkthrough exercised one fixture player with private host and public TV through investment selection/reload/settlement, an empty costume contest, a trivia buzz/team award, a slot spin, Powerball bet/draw/reveal, private phone selection/public award, and the final ranking. Fixed game panels exposing available tokens while the header balance was hidden, the TV's stale rehearsal footer, the settled-position label, and duplicate ranking numbers. [Screenshots](docs/verification/party-integration/) record review and completion. Physical iPhone/TV, narrow viewport, richer multiplayer browser cases, and full-party restart/backup restoration remain pending.

The normal-startup registration issue was subsequently fixed: it previously loaded only Sound check, causing “Make your move is not implemented yet” even though the game existed. Normal startup and the fixture harness now share the full game registration. The investment transport test exercises normal defaults without module overrides and checks all stage registrations. All 46 checks/tests and complete 15/100-player network parties passed again using normal registration. Existing rooms/players are preserved. Refresh open pages after the development server reloads (or restart an unwatched server), then have the host prepare opening prices and open investments.

The live `just market-check` request succeeded with HTTP 200 using the privately configured Demo key, and the application's adapter accepted fresh quotes for SOL, BTC, DOGE, SPYx, and PEPE. This is an observed weekday snapshot, not a guarantee of Saturday availability. The command sends the key only to CoinGecko, prints no credentials, and changes no room/database state. Restricted DNS failed with `ENOTFOUND`; the permitted network run succeeded.

For a disposable browser/network rehearsal, `HOST_PASSWORD=fixture-test-password node --import tsx scripts/fixture-server.ts` starts an in-memory, non-production-only harness on port 3001 using the same default modules as the normal app. Select **Fixture party**; its data disappears when the process stops. Run the simulator with `BASE_URL=http://127.0.0.1:3001 HOST_PASSWORD=fixture-test-password npm run simulate -- 15 --party` (or 100). These observed commands require local-port permission. See [the plan](docs/plan.md) for remaining rehearsal work and [deployment preparation](docs/deployment.md) for future Lightsail/backup work. No public deployment was performed.

Timed rounds wait after the host advances. Select **Start timer** in the host view to open player actions and begin the shared countdown; closing a waiting round skips it without starting the timer. Untimed rounds do not require this button.
