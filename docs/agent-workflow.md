# Working on Omni Fiesta with coding agents

## Recommended approach

Continue in the existing session or open a fresh one against this same repository. A fresh conversation does not need the original chat: repository files are the durable context. The foundation, approved Party notebook design, and all games are implemented. Normal startup and the disposable harness share registration in `src/server/games/index.ts`. Read the latest `docs/plan.md` checkpoint first; historical implementation briefs must not cause completed games to be re-disabled. Remaining work is device/full-recovery rehearsal and deployment preparation. The original handoff is [Complete the party](tasks/complete-party.md).

One integration owner maintains `src/server/core`, shared contracts, schema migrations, `src/server/app.ts`, client routing, and common styling. Other game tasks own their module, isolated components, and focused tests. A game task should request shared changes explicitly; do not have multiple agents independently rewrite the ledger, sessions, timers, or app entry point.

## Current implementation seams

- `src/server/core/store.ts`: persistent rooms/configuration, hashed sessions, idempotency, and transactional account/ledger mutations. `adjust` must execute inside the core transaction.
- `src/server/core/engine.ts`: authorization, deadline enforcement, phase transitions, action dispatch, and separate host/player/display snapshots. Batch snapshots share a public base but never private role fields.
- `src/server/core/phases.ts`: transactional `PhaseModule` hooks. Module action data is untrusted and requires game-specific validation. Do not perform asynchronous external API calls inside a SQLite transaction.
- `src/shared/contracts.ts`: shared command and state types for all games. `src/server/games/index.ts` owns normal application registration; explicit test overrides do not verify that default path.
- `src/client/useRoom.ts`: reconnect/sync, clock offset, version handling, and idempotent action retries.
- `src/client/main.tsx`: current foundation views. Extract per-game UI components before several agents work on the same entry point.

External preparation, game-specific public/private projections, host game actions, and settlement/reveal states need coordinated integration during the first real game. Do not mistake the rehearsal's simple open/closed lifecycle for the full completed party engine.

## Task instructions

For every game task, supply the relevant game specification, system contract, approved `docs/design/party-notebook.md`, precise ownership, acceptance criteria, and integration dependency. Keep one game task small enough to verify end to end. A UI animation does not prove the server's accounting is correct.

Before marking a task complete, run format checking, type checking, applicable tests, and the production build. Verify affected player/host/display behavior together. Record results and limitations in `docs/plan.md`. Use injected clocks/randomness/provider fixtures for rule tests; use real network connections for transport/reconnect checks. Keep claims about physical iPhone testing and live API access separate from desktop simulations.

For `listen EPERM`, request the supported permission to bind a local test server; do not stop after the restricted attempt when a permission mechanism is available. If permission is unavailable, preserve the pending verification requirement and continue independent implementation. An unavailable live market connection likewise does not block fixture-backed game development.

## Fresh-session instruction for the next task

Read the latest `docs/plan.md` checkpoint and address actual remaining rehearsal/recovery work. The UI/investment task files and most of `docs/tasks/complete-party.md` are historical implementation briefs. Do not recreate or disable completed modules. AWS provisioning/public deployment remains separate.
