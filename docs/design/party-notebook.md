# Approved UI direction: Party notebook

Status: approved by the user on 2026-10-27. The static design is implemented across the running application; see `../plan.md` for observed checks and device-verification limitations. Optional animation remains deferred.

## Identity and tone

This is Tracy's **10,000-day celebration**, with games for friends on a Saturday night. The chosen direction is **Party notebook** from the reviewed concepts. The user wants a simple, personal, playful white page with black text, inspired by the clarity of a Notion page.

Use `Tracy / 10,000 days` in the compact page header and `Tracy’s 10,000th day.` as the opening headline. Omni Fiesta remains the repository/engine name; it is not the main guest-facing identity for this event. The milestone is 10,000 days, not 1,000. Do not invent a birthday date, venue, exact start time, or biographical facts.

The selected [portable reference](party-notebook-reference.html) captures the approved welcome layout, spacing, and tone. It is a design reference, not the real app or its authentication flow. It is saved in the repository so a fresh CLI session does not depend on the conversation's temporary preview files.

## Visual language

- White canvas, near-black text, generous whitespace, subtle neutral dividers, and restrained corners.
- A compact text identity; a small balloon emoji/page marker is welcome. Remove the circular `of` logo, large tilted poster, starburst, neon green branding, and slogan badges from the existing implementation.
- One primary black button with white text per action group. Secondary actions are plain text or quiet outlines.
- Shared semantic colors and spacing should be defined centrally in the client and used by every view. Avoid a large theme framework or per-game copies of basic controls.
- Use a system sans-serif stack. Avoid dependence on remote fonts for the core experience. Typography should feel like a readable page, with sentence-case labels rather than pervasive uppercase letterspacing.
- Reserve colored areas for meaningful game identity or feedback: team colors, red/blue bets, gains/losses, selected state, and small celebratory accents. Color always has a corresponding label or other cue.
- Use rows, whitespace, and headings before adding containers. Do not turn every section into a filled card. Borders are thin; avoid decorative shadows, gradients, glass effects, or large hero artwork.

Suggested tokens matching the approved reference:

| Token | Starting value / purpose |
| --- | --- |
| Canvas | `#ffffff` |
| Main text / primary button | `#202020` |
| Secondary text | `#666666`; keep sufficient contrast |
| Divider | `#e8e8e5` |
| Quiet secondary surface | `#f7f7f5`, only where useful |
| Decorative accent | `#f0bfb0`, used sparingly; never essential text on white |
| Button / field radius | Approximately 6px |
| Spacing | A small consistent 8/16/24/32/40px scale |
| Body / editable fields | Readable body text; at least 16px editable fields on phones |
| Page heading | Roughly 28–40px on phones/normal pages; scale functional TV content for distance |

Keep the requested white/black appearance consistent even when the device prefers dark mode. Preserve text scaling, keyboard focus, readable contrast, and reduced-motion preferences.

## Copy

Use short labels that explain the current task. Warmth can come from Tracy's name, emojis, player names, and the game itself. Avoid promotional slogans and elaborate metaphors.

| Location | Preferred wording |
| --- | --- |
| Welcome header | `Tracy / 10,000 days` |
| Welcome headline | `Tracy’s 10,000th day.` |
| Welcome description | `A Saturday night to celebrate Tracy.` |
| Join instruction | `Join on your phone. We’ll start when everyone’s here.` |
| Primary welcome action | `Join the games` |
| Host access | `Host controls` |
| Player registration | `Join the games` / `Your name` / `Pick an emoji` |
| Waiting state | `You’re in. Waiting for the host.` |
| Host room | `Waiting room` / `Players` / `Start sound check` for the existing rehearsal |
| Investment action | `Choose an investment` |
| Costume action | `Vote for a costume` |
| Finished action | `Waiting for the host` or a direct confirmation |

Remove existing guest-facing phrases such as `Good company. Friendly rivalry.`, `Your next great night in`, `A party. A plot twist. Your move.`, `Let the good times roll.`, `Enter the group chat.`, and `Good evening, game master.` Do not replace these with a different layer of marketing copy. Keep genuine state labels and helpful instructions.

## Carry the theme across all views

### Welcome `/`

Use the approved left-aligned notebook composition: compact text header, small balloon marker, direct headline, one short description, primary join action, and a quiet one-line description of tonight's games. Host access is a secondary text link. The page is welcoming with little visual clutter.

### Player `/play`

Portrait first. Show the profile emoji/name, hidden balance control, one current task, any applicable countdown, confirmation, and connection state. Registration requires name, phone and emoji; email is optional. Keep the server-backed hidden/revealed balance behavior and hide it on stage changes.

Trivia can use the specified team color prominently while preserving label/button contrast. Other games use the shared light page. Decoration must not compete with a buzzer, amount input, vote, countdown, or a result.

### Private host `/host`

Use clear headings, restrained tables, concise controls, and a readable roster. Keep private controls separate from the TV. The full activity/accounting information remains available; simplifying the appearance must not remove functionality or weaken authorization. Keep rehearsal status explicit until real games are implemented.

### Public display `/screen`

Use the same white/black theme with names, QR code, countdown, and results large enough to read from across the room. Tracy's milestone provides the celebration identity; the useful content fills the screen. Do not expose private balances, phone numbers, emails, or the private draw selection through styling or display payload changes.

### Future game interfaces

Investments, costumes, trivia, slots, Powerball, phone reveal, and the complete leaderboard inherit these tokens and copy rules. Individual games may have their necessary visual character without introducing unrelated branding or a new design system.

## Room for celebration effects

Game interaction update (2026-10-28): slots may use a compact outlined cabinet, rolling emoji reels and a pull handle; Powerball may use a simple outlined mixing box and a falling red/blue ball. Use lightweight CSS transforms, no new animation dependency, accessible text outcomes and reduced-motion/hidden-page fallbacks. Five investment cards use restrained symbol marks and expandable research details. These requested functional game effects are implemented; the optional welcome-page balloons below remain deferred.

The user may later want balloons drifting upward on the welcome page or short confetti bursts on winner reveals. The exact artwork, motion, density, timing, and controls are **deferred**. Do not ship a speculative animation now or let this future work delay the static refresh.

Leave a small, replaceable client-side celebration/decorative layer separate from page content and game logic. It can initially be a static marker or an empty component slot. Its future contract should allow:

- Optional effects that can be disabled without changing navigation or game components.
- `aria-hidden` decoration with `pointer-events: none`, correctly layered behind interactive content.
- A reduced-motion/static fallback, no flashing, and a bounded number/duration of particles.
- No interference with focus, form submission, scrolling, connection status, or server deadlines.
- Lightweight transform/opacity motion suitable for iPhone Safari; pause or stop effects when a page is hidden.

Keep presentation options in client-side UI configuration rather than adding aesthetic switches to the authoritative game-economy YAML or database. Do not add an animation dependency solely to reserve this extension point.

## Verification and scope

Apply and inspect all four routes, including sign-in/join forms, validation errors, waiting/open/closed/finished rehearsal states, and host roster. Verify narrow phone widths as well as a landscape host/TV layout. Report the actual viewport used and any real-device limits honestly.

Retain all existing game rules, timers, privacy, sessions, accounting, request handling, and configuration behavior. This direction changes presentation; it does not authorize changing scoring or enabling unfinished games. Use `docs/tasks/party-notebook-ui.md` for the bounded implementation task.


2026-10-28 refinement: host and player are portrait-first; TV is landscape-first. Party management and private details use disclosures, with compact round controls. Game machines use restrained rounded surfaces and semantic red/blue accents; the Powerball chamber is circular, slots retain a handle plus a clear Spin button. Desktop TV lays the chamber beside its result. Public lists rotate in small batches to bound screen content.


## Game personality and facilitation (2026-10-28)

The approved refinement adds restrained game-specific character inside the white notebook: hedge-fund green and serif investment headings, warm brass for **Tonight I am Venetian**, county-fair colors/type for **Powerball red or blue**, and a manila/classified-file treatment for **Somebody’s calling**. Functional machines may use subtle depth; keep it local to the machine rather than adding decorative cards everywhere.

TV: one title, one large playful rules block, then useful state/results. No repeated eyebrows, generic “follow along” paragraphs or nested copies of the game title. State changes can replace instructions with a concise result introduction. Show costume prizes from saved room configuration, including full awards for tied prize groups and the existing conditional last-place penalty.

Host: separate trivia team assignment, question/buzzer and awards using labeled groups, 20px field/action gaps and 24–32px group spacing. Use a three-column group layout on wide screens and a stacked portrait layout. Keep the invite QR in the lobby; during play show connection/recovery help in a disclosure and keep the TV link available.

Player: confirm saved investments and bets from the server snapshot with a persistent checked button/status. Editing should make unsaved changes clear. Closing-bell results lead with signed token P/L and settlement state, with calculation details expandable. TV market cards show public price movements only. Motion remains presentation-only: spaced pull handle, staggered reel stops, varied ball orbits and a short drop/bounce; preserve reduced-motion behavior and saved results on reload.


## Scannable rules and confident actions (2026-10-28)

TV rules are a short emoji-led list, one rule per line, rather than a prose paragraph. Slots uses exactly cost per spin, maximum spins and optional participation, with no extra marquee. Costume uses separate choice, vote restriction, prize and tie rows; its existing penalty stays in a quieter line. Trivia uses separate team, buzz and answer rows. Keep all values sourced from the saved room settings.

Make the investment limit a prominent green-tinted numeric panel (currently 600 tokens max). A saved lobby-ready state is a green checked button. Trivia uses a large centered team-color buzzer with deliberate space around status and team lists; compact the player header to keep the action visible. Host commands have pending/checked-green feedback after acknowledgment, and an awarded form stays green/disabled for the same question/team/amount. Award corrections are explicit history entries with Undo, not silent balance edits.

Rehearsal is labeled **Connection check** and lives inside **Manage parties → Test tools** beside **Full test party**. Explain that the former exercises the lobby/timer/check-in only; the latter is manual full-game practice using fixture prices. Neither label claims an automated complete end-to-end test. Test tools remain unavailable when rehearsal/fixture support is disabled.
