# Repository guidance

## Read before implementation

- Read `spec.md` for product decisions and `docs/system.md` for shared invariants.
- Read `docs/design/party-notebook.md` before any UI work. The approved identity is Tracy's 10,000-day celebration: white background, black text, minimal notebook layout, and personal/task-focused copy. Future balloon/confetti motion is deferred.
- Read `config/game.yaml` and the relevant `docs/games/*.md` for the assigned feature.
- Read and update `docs/plan.md` for implementation status. Documentation is not evidence that code exists or checks passed.
- The foundation, clearly labeled rehearsal, game modules and role views exist. The normal app registers every game through `src/server/games/index.ts`; isolated tests can override modules. Do not restore the old rehearsal-only default. AWS deployment remains pending. See `README.md` and the latest `docs/plan.md` checkpoint for verification evidence.

## Ownership and conventions

- Configuration owns adjustable values. Do not scatter game constants through source or contradict the saved room configuration.
- Centralize authorization, deadlines, idempotency, accounting, persistence, and role-filtered real-time state in the server core.
- Game modules use shared services; they do not write player balances independently.
- Treat accepted user decisions as authoritative. Record material assumptions explicitly rather than silently changing rules.
- Keep game interfaces small and typed. Build the smallest runnable milestone before adding abstractions.
- Keep credentials out of tracked files, logs, public client bundles, and documentation examples.
- Do not create parallel implementations of shared core services. Keep changes scoped to the assigned feature.

## Verification

- Test actual game rules and failure boundaries, including duplicate commands, simultaneous actions, deadline boundaries, insufficient funds, reconnects, and repeated settlement.
- Use fake clocks, fixed market fixtures, and injected random sources for deterministic tests. Production draws use server-side cryptographic randomness.
- Verify the player, private host, and public display together. Confirm private balances and phone numbers are absent from unauthorized payloads.
- Run applicable type checks, tests, build checks, and targeted UI verification once commands exist. Report observed results and remaining limitations accurately.
- Keep `spec.md`, game specifications, configuration, and acceptance tests aligned when behavior changes.
- Run `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build` as appropriate. HTTP/WebSocket tests need local port access. Do not call permission-related test failures application defects.
- Read `docs/agent-workflow.md` before assigning or implementing a separate game task. Keep one integration owner for schema, shared contracts, routing, and core lifecycle changes.
