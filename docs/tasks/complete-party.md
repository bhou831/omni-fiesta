# Task: complete the local party application

Status at handoff (2026-10-28): foundation and Party notebook UI implemented; real party games and AWS deployment pending. Inspect current code and `docs/plan.md` before deciding what remains. This document is an execution brief, not evidence of completion.

## Outcome and scope

Deliver the complete host-led party locally: investments, costume voting, trivia, slots, Powerball, investment review, Somebody's Calling, and the full final ranking. Implement each game's player, private host, and public display views together. Preserve the approved Party notebook design and all existing foundation/rehearsal behavior.

Read `../../AGENTS.md`, `../../README.md`, `../../spec.md`, `../../config/game.yaml`, `../system.md`, `../design/party-notebook.md`, `../agent-workflow.md`, `../plan.md`, and each assigned `../games/*.md` specification. Product rules and saved room configuration remain authoritative. Do not reintroduce superseded prize splits, guaranteed slot winners, client-time buzzer ordering, or unlocked investments.

Complete local implementation and verification, including deployment preparation files/run instructions if useful. Provisioning AWS resources, changing live DNS, and public deployment are separate work. Final celebration animations remain deferred. Missing live market credentials do not block fixture-backed implementation, but production market readiness must remain explicitly unverified until observed.

## Coordination and ownership

Use one coordinating integration agent and at most three implementation subagents at once. This is a project recommendation, not a required CLI setting. If subagents are unavailable, execute the same sequence in one session.

The integration owner exclusively edits shared core lifecycle/accounting, schema migration registration, shared contracts, command routing, game registration, client entry points/common styles, dependencies/lockfile, and shared progress docs. Subagents own disjoint game modules, isolated client components, and focused test files. Define exact owned paths and interfaces before delegating. A subagent proposes required shared edits to the owner instead of independently changing those files. Shared database migrations must be ordered and integrated by the owner; no worker allocates competing migration versions.

Keep interfaces small and typed. Do not build a generic plugin platform or replace the working stack. Shared foundations already exist; extend them only where actual game behavior requires it. No game may invent a separate ledger, timer, authentication system, or reconnect mechanism.

Preserve all existing user files, ignored `.env`, and saved databases. At this handoff the project sources are untracked: a fresh worktree from HEAD may not contain the foundation. Do not start isolated checkouts from an incomplete baseline or discard untracked work. Confirm the full source baseline is present before using worktrees. Shared-checkout work requires strictly disjoint ownership; run repository-wide formatting only when workers have finished writing.

## Implementation sequence

### 1. Establish the first real game

Complete `investments.md` first. The integration owner establishes async preparation outside SQLite transactions, migrations, typed game-specific host/player/display projections, host actions, settlement/reveal lifecycle, and per-game client components/registration. Implement only the interfaces this slice needs. Check the current `PhaseModule`, which only covers rehearsal callbacks; it is not yet the full party lifecycle.

Use deterministic market fixtures for acceptance tests, add the live provider adapter, and keep fixture rooms visibly separate from live rooms. Verify opening/closing snapshot persistence, capped locked principal, edits, cancellation, decimal settlement, retry/restart safety, provider failure, and private portfolio data. Test investment selection and later review without enabling incomplete intervening party stages or exposing production skip controls.

Gate: the investment slice, shared integration interfaces, and existing rehearsal pass applicable checks before parallel game implementation begins. If interfaces change later, the owner updates dependent modules before accepting them.

### 2. Implement the independent games in parallel

| Workstream | Source specification | Main acceptance boundaries |
| --- | --- | --- |
| Costume | `../games/costume.md` | Full award to every member of the top three distinct vote groups; split/capped bottom penalty only outside prize groups; no-vote behavior; settlement and reveal privacy |
| Trivia | `../games/trivia.md` | Balanced frozen teams; first server-accepted buzz; stale-window rejection; excluded-team reopening; idempotent award to every teammate |
| Slots | `../games/slots.md` | Atomic charge and independent immediate saved result; attempt/funds/deadline enforcement; exact configured probability boundaries; gross and net shown correctly |

Each agent implements server behavior, isolated views for all affected roles, and deterministic tests within its ownership. The owner integrates completed modules and validates their interaction with shared balances and stage transitions. Merely adding rule helpers or UI mockups does not complete a game.

### 3. Complete pooled bets and the final reveal

Once the interfaces are stable, Powerball and Somebody's Calling can be delegated to two disjoint workstreams using `../games/powerball.md` and `../games/somebody-calling.md`.

Powerball must reserve/edit/cancel stakes, persist a secret draw, conserve tokens through largest-remainder allocation, refund when the selected side has no bettors, and settle once. Reveals follow committed state.

Somebody's Calling must draw from all joined players including disconnected players, keep the selected identity/phone private to the host, and award only on public reveal. The integration owner adds the complete final ranking, including equal-rank ties and stable display order, after all required economic settlements. No phone/email data may appear in player/display projections.

### 4. Integrate and harden the whole evening

Enable the normal party sequence only as modules become complete. Host-only advancement must enforce settlement/reveal prerequisites and never abandon locked investments or reserved bets. Only the four configured sessions have countdowns; timeout closes input without automatically playing, charging, voting, or advancing.

Finish host-assisted guest recovery so a lost session can recover the existing player without a duplicate starting grant. Preserve authorization boundaries and invalidate/reassign credentials deliberately. Add consistent backup/restore and process-restart run instructions and verify restoration using disposable data. Prepare deployment assets for the documented Lightsail/Caddy stack without claiming a deployed service.

## Verification and completion evidence

- Run each game specification's acceptance examples with injected clocks, randomness, and market fixtures. Include duplicate/competing requests, exact deadlines, insufficient funds, retries, and repeated settlement/reveal. Production randomness remains cryptographic and server-side.
- Retain existing foundation tests. Test additive migrations against an existing foundation database and restart/recovery of game state, not only fresh in-memory databases.
- Extend the simulator to play a complete party with 15 isolated players, and check a burst of up to 100. Exercise reconnect and restart at meaningful preparation, locked/reserved-balance, pending-reveal, and settlement boundaries. A completed Sound check alone is insufficient.
- Inspect role payloads for premature results, other players' private balances/portfolios, and phone/email leaks. Secret phone selection must not change a player's visible balance before reveal.
- Verify host, player, and TV together in the browser, including narrow portrait player screens, errors, waiting/closed/revealed states, countdowns, and the final ranking. Verify actual viewport dimensions; do not infer success from an ineffective viewport override. Record physical iPhone/TV checks separately when the devices are available.
- After integration, run `just format` and `just check`. Repeat checks after fixes that affect them; do not claim passed checks without actual output.
- Update `../plan.md` and `../../README.md` after each milestone with what exists, commands/results, and concrete limitations. Subagents report their owned files, behavior, tests, and requested integration changes to the coordinator. The coordinator reviews and integrates results before marking a milestone complete.

Continue through these local milestones without asking the user to approve routine implementation choices. Ask only for a material unresolved product decision or genuinely required external access; continue independent work in the meantime. Finish with a usable local party, observed verification, and a precise remaining list for live market access, physical-device rehearsal, and deployment. If interrupted, leave a clear next step in `../plan.md` rather than marking incomplete work finished.
