# Next UI task: apply Party notebook

Implement the user-approved Party notebook design across the existing application.

## Read first

Read `AGENTS.md`, `README.md`, `spec.md`, `docs/design/party-notebook.md`, the portable reference `docs/design/party-notebook-reference.html`, `docs/system.md`, `docs/agent-workflow.md`, and `docs/plan.md`. Inspect the existing client and shared contracts before editing. The design guide is authoritative; the reference is a visual anchor, not a replacement application or functional specification.

## Deliverable

Replace the current dark/neon/promotional treatment with the approved white-background, black-text, minimal celebration theme for Tracy's **10,000th day**. Apply it to `/`, `/play`, `/host`, and `/screen`, including registration, host login, empty states, waiting states, errors, countdowns, and completed rehearsal states.

Use the approved copy and layout principles. Remove the existing tilted poster, starburst, circular logo, and marketing slogans. Retain functional controls and information. Keep all screens coherent through a small set of shared client tokens/components. Extract page/components from the current entry point only where that makes this refresh maintainable; avoid unrelated rewrites.

Add only a small client-side decorative extension point for future optional balloons/confetti. A static balloon marker is sufficient now. Do not invent or ship the final flying-balloon animation, add an animation library, change the game YAML for cosmetic settings, or block completion on future effects. Follow the accessibility and motion requirements in the design guide.

## Ownership and boundaries

This task owns the client presentation, common styles, page metadata/title, necessary UI components, and documentation updates. Preserve route URLs and all server-facing commands. Backend accounting, sessions/authentication, permissions, hidden balance behavior, countdown rules, saved configuration, privacy projections, and game scoring must stay intact.

Only the foundation and Sound check rehearsal are currently functional. Keep that distinction explicit. Do not implement investment/trivia/other games, change prize rules, provision AWS, or deploy as part of this refresh. Do not overwrite existing work, private `.env`, databases, or saved parties. Do not assign concurrent agents to the same shared client entry point/styles.

## Acceptance criteria

- All four routes follow the approved theme and show the correct 10,000-day milestone.
- The welcome screen matches the notebook direction's composition and has no large right-hand poster or promotional slogans.
- Guest registration, emoji selection, host sign-in, room creation, QR/TV links, readiness, hidden/revealed balances, shared countdowns, check-ins, and host-only advancement still work.
- No contact details or private host information appear on the TV. Connection/error/disabled states remain clear and accessible.
- Small phone layouts have readable text, at least 16px editable fields, and comfortable touch targets without unintended horizontal scrolling. TV content is readable at landscape dimensions.
- The static design works with celebration effects absent and when reduced motion is requested.

## Verification and handoff

Run `just format` and `just check` (or the equivalent npm commands). Verify all four routes in the browser, including a complete rehearsal with host/player/display together. Check actual narrow and wide viewport dimensions when the available tooling supports them; do not equate a requested viewport override with successful responsive verification. Include screenshots if the tooling supports exporting them. Preserve existing network/rule tests; add focused verification only where behavior changed.

Update `README.md` and `docs/plan.md` to distinguish implemented styling from deferred animation and remaining game work. Finish with the changed files, observed checks, preview instructions, and any genuine limitations. Complete this UI task before starting the investment implementation.
