# Omni Fiesta

A host-led party game for phone browsers and a shared TV display.

The shared foundation is runnable: player registration/readiness, private host controls, a public TV display, persistent token accounting, configuration snapshots, server-controlled countdowns, real-time updates, and reconnect/restart recovery. A clearly labeled **Sound check** rehearsal exercises these pieces without spending tokens. Actual party games and AWS deployment are still pending.

## Approved design: Party notebook

The party celebrates **Tracy's 10,000th day**. The approved direction is a minimal white page with black text, a compact text header, a small balloon marker, quiet dividers, and direct personal wording. All player, host, TV, and future game interfaces follow this direction.

See the [design guide](docs/design/party-notebook.md) and [portable visual reference](docs/design/party-notebook-reference.html). The running app now applies this design across `/`, `/play`, `/host`, and `/screen`, including forms, waiting states, errors, countdowns, and rehearsal completion. Shared client tokens and system fonts keep the views coherent. The static balloon marker is an optional client component; no animation library or game configuration changes were added. Optional floating balloons and other celebration effects are reserved for a later iteration; keep their decorative layer separate from core layout and game logic.

## UI verification (2026-10-27–28)

`just format` and `just check` passed: formatting, all 14 rule/HTTP/WebSocket tests, TypeScript checks, and the production build. The first sandboxed check could not bind loopback ports; repeating with local-port permission passed. The development watch command hit an environment file-watcher limit, so browser verification used `node --import tsx src/server/index.ts` against an isolated temporary database and test credential, without changing `.env` or saved parties.

Chrome verification covered all four routes and a complete host/player/TV Sound check: failed and successful host sign-in, empty room, room creation, QR/player/TV links, registration, emoji selection, readiness, balance reveal and automatic hiding on stage change, matching countdowns, check-in, host closure/advancement, completion, and player reload. Existing automated projection tests passed; the TV showed no contacts or private balances. [Screenshots](docs/verification/party-notebook/) capture all four views.

Actual desktop viewports were 1728×940 and 1728×996, with no page overflow observed. A requested 390×844 override did **not** change the actual viewport; narrow-phone and physical iPhone/TV verification remain outstanding. Registration fields computed to 16px. Static decoration has no motion and can be disabled in the client; reduced-motion CSS disables future animation/transition styling, but an OS reduced-motion toggle was not exercised.

Preview with `just dev`, then visit `/`, `/play`, `/host`, and the host-generated `/screen` link. Only the foundation and Sound check rehearsal work; real game modules, final balloons/confetti, and AWS deployment remain pending.

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

`npm run build` writes `dist/client` and compiled server/shared files. `npm start` uses the environment in `.env`; for production, configure `NODE_ENV=production`, an HTTPS `PUBLIC_ORIGIN`, a private host password, persistent database storage, and `ENABLE_REHEARSAL=false`. Lightsail provisioning, HTTPS proxy, backups/restore procedures, and real game implementations remain deployment prerequisites.

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

Investment implementation has started with an isolated, tested exact-decimal payout calculation; it is not yet connected to a playable stage. See the latest entry in [the implementation plan](docs/plan.md) for the current verification and remaining work.
