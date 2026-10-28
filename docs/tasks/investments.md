# Next task: investment selection and review

Implement the investment selection/review milestone in this repository, building on the existing runnable foundation.

Read `AGENTS.md`, `spec.md`, `config/game.yaml`, `docs/system.md`, `docs/games/investments.md`, `docs/design/party-notebook.md`, `docs/agent-workflow.md`, and `docs/plan.md`, then inspect the existing code/tests. Treat the latest repository specifications as authoritative; do not infer old rules from conversation history. Complete the approved static UI refresh first; investment screens inherit that shared light theme and direct wording.

## Deliverable

Add a complete investment slice: host prepares/opens selection; all phones show the five research cards and shared countdown; players select/revise/cancel one affordable capped investment; the server locks principal; closing snapshot preparation and idempotent investment review return principal with amplified gain/loss, bounded below by zero. Provide host controls and appropriate public/private state without revealing private portfolios or balances prematurely.

The live lineup is SOL, BTC, DOGE, SPYx, and PEPE using the configured CoinGecko IDs. Clearly label SPYx as a tokenized S&P 500 proxy. Display only timestamped provider facts, mark missing optional metrics unavailable, and preserve configured research links. Mock fixtures must be visibly identified as test data and isolated from live rooms.

## Integration requirements

Use the shared transaction/ledger, request deduplication, sessions, server deadlines, configuration snapshots, and real-time synchronization. Add proper schema migrations without deleting existing rooms. Coordinate the required async preparation, snapshot projections, game UI registration, and settlement/reveal hooks in the shared core. Keep external market requests outside database transactions, revalidate before committing, and start the selection timer only after an opening snapshot is accepted.

Preserve all foundation tests and the rehearsal path. Do not enable incomplete later games or invent skip/advance behavior that discards locks. A full party can remain gated on unimplemented stages while investment behavior is independently verified.

## Verification

Cover cap/affordability, edits/cancellation, duplicate and competing requests, deadline boundaries, exact decimal calculations, zero-floor losses, provider failure/staleness, same-ID/provider consistency, partial preparation/restart recovery, repeated settlement, and role-filtered payloads. Use deterministic market fixtures first. Verify all three interfaces in the browser. Run `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build`.

Use a privately configured API key for live verification when available. If live credentials are unavailable, finish fixture-backed implementation and document live access as unverified; do not claim production market readiness. Update the README and plan with observed evidence. No AWS provisioning, public deployment, unrelated game implementation, or changes to established prize rules are part of this task.
