# Omni Fiesta product specification

Status: foundation and all game modules/views implemented and registered for local play. See `docs/plan.md` for verification and remaining device/recovery/deployment work.
Updated: 2026-10-28. Confirmed user decisions override earlier conversation proposals.

## Purpose and scope

A host-led party web application for about 15 people in one room, designed for 1–100 players. Players use iPhone browsers in portrait orientation. A private host console controls the party; a separate landscape display is projected on a TV. Tokens have game value only. Hosting target: AWS Lightsail at `game.bowen-hou.com`.

The event celebrates **Tracy's 10,000th day**. The user-approved **Party notebook** direction governs all interfaces: minimal white pages, black text, personal/task-focused copy, and restrained celebration details. See [design guidance](docs/design/party-notebook.md); the static refresh is implemented across all four routes, with quiet floating balloons behind the TV and player pages and event-driven fireworks on wins.

Only the host can advance stages. Deadlines close submissions; they never advance the party. Support joining, reconnecting, and restoring persisted state without granting initial tokens twice.

For local UI development, `just preview [game]` opens an isolated, in-memory gallery linking directly to player/host/TV screens with sample players and fixture data, including result variants. It is unavailable in production and cannot modify saved parties. For normal host room management, Archive/Restore hides unused rooms reversibly while preserving all scores/history; archiving is blocked while any player is connected. Archived rooms cannot be joined or played until restored, and restoration never resets elapsed deadlines.

## Sources of truth

- This file owns the product scope, confirmed decisions, investment-card content, and source references.
- [Configuration](config/game.yaml) owns adjustable amounts, durations, probabilities, provider IDs, and research links. Prose examples explain those values rather than defining additional defaults.
- [System design](docs/system.md) owns shared contracts, authorization, accounting, persistence, and timer behavior.
- [Design direction](docs/design/party-notebook.md) owns the approved identity, visual language, wording, cross-view consistency, and future decorative-motion constraints.
- [Game specifications](docs/games/) own each game's behavior and acceptance criteria.
- [Implementation plan](docs/plan.md) owns delivery order, progress, and verification requirements.

## Experiences

| View    | Route     | Behavior                                                                                                                                                      |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Player  | `/play`   | Portrait; profile emoji/name; current stage; confirmed submissions; personal balance hidden initially, tap to toggle.                                         |
| Host    | `/host`   | Authenticated private console; joined/ready/disconnected roster; every player's balance and transactions; game controls and configurable scoring.             |
| Display | `/screen` | Landscape; join QR/room code, instructions, applicable countdown, public results, and host-triggered reveals. Receives no phone numbers or private host data. |

The lobby lists actual joined players only. There is no expected guest list or missing-guest comparison. Profiles require name, phone, and an emoji from a provided set of 24 (decided 2026-10-28: custom emoji were considered and dropped for simplicity). Email is optional and unused by gameplay; omitted or blank email is accepted, and a supplied address is validated. Email/SMS verification is not required for this version. Persistent player sessions support rejoining. Use an authenticated host session; knowing `/host` is not authorization.

The private host view and TV display are separate so balances and the selected phone number stay private until intentional reveals. A host browser uses an extended screen or a separate control device. New rooms present Chinese trivia on a saved host-controlled 5×5 board; the TV shows questions and phones focus on buzzing. The Jeopardy introduction shows concise Chinese rules and an animated board/buzzer, with shared balloons/fireworks behind the TV. Host scoring defaults to the buzzing team, with explicit manual correction. Existing numbered trivia rooms retain their legacy flow.
A Mac can open `/screen`, sign in and select the same room while a phone/iPad remains signed in at `/host`; logins coexist independently and the TV receives only public state. Guests scan the TV lobby QR. Capability-based TV links remain supported; directly opening a signed-in TV never replaces these links.

The 24 preset avatars include Moai 🗿, otter 🦦, dogs 🐶 🐕 🐩 🦮, Mount Fuji 🗻, Paris café choices 🥐 🥖 🧀, and playful meme faces. Saved profiles retain their existing emoji when the picker changes.

## Stage sequence

| Order | Stage                | Behavior                                                                                                                                                               | Session countdown                                    |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 0     | Lobby                | Join, choose profile, mark ready; host starts.                                                                                                                         | None                                                 |
| 1     | Investment selection | One or more assets per player, with the cap applying to the total; starting grant, investment cap, locked stake, amplified return.                                     | Configuration: `timers.investment_selection_seconds` |
| 2     | Costume contest      | One vote per player; host locks the standings (re-vote on a tie for first). Winners and tokens come later, in stage 8.                                                 | Configuration: `timers.costume_voting_seconds`       |
| 3     | Trivia               | Host selects a board cell, arms buzzer, judges without wrong-answer penalties, and awards the cell value to each teammate.                                                                                    | None                                                 |
| 4     | Slots                | Optional paid spins with immediate independent results, up to configured limit.                                                                                        | Configuration: `timers.slots_seconds`                |
| 5     | Powerball            | Red/blue proportional pool betting; host locks, draws, and reveals.                                                                                                    | Configuration: `timers.powerball_betting_seconds`    |
| 6     | Investment review    | Fetch one closing snapshot and settle all locked investments once. If closing prices are unavailable, the host refunds every stake.                                    | None                                                 |
| 7     | Somebody's Calling   | Free entry; one private random player selection; host calls manually, then reveals and awards.                                                                         | None                                                 |
| 8     | Costume winners      | Host announces 3rd, 2nd, last place, then 1st, one click each, with an animation; tokens move per place; a last click shows the full list. Under 3 players: one click. |
| 9     | Finish               | Host announces 3rd, 2nd, 1st, then the full ranking (podium fixed, rest rotating on the TV). Under 3 players: one click.                                               | None                                                 |

Only those four action sessions have countdowns. Advancing to a timed stage places it in a waiting state; the host starts its timer explicitly, and player actions open at that moment. Display the same server-based countdown on phones, the TV, and optionally the host. Unsubmitted actions expire with no automatic choice, charge, vote, bet, or spin. Previously accepted actions remain valid and still settle. After expiry, show a waiting state until the host proceeds.

## Economy and confirmed settings

Current configuration grants each player 1,000 tokens once, allows an investment of at most 1,000, and locks the invested amount. The configured return multiplier is currently 100. These adjustable defaults come from `config/game.yaml`; existing rooms retain their saved settings. Investment payout cannot fall below zero; maximum loss is the amount actually invested. Gains are uncapped.

Each slot spin costs 200. Independent gross payouts are 500 with 10% probability, 300 with 20%, 100 with 30%, and zero with 40%. There are no winner quotas. At most three accepted spins per player; a player must afford each spin at the time of purchase.

Costume prizes are 1,000, 800, and 500 **per player** in the top three **distinct vote totals**. Every player tied in a prize group receives that place's full award; prizes are never divided by group size. For example, five players tied for first each receive 1,000, and a single player in the next distinct vote group receives 800. The lowest group still splits a 500-token penalty using `floor(500 / group_size)` only if that group receives no top-three prize. Cap each person's deduction at their spendable balance; locked investments are untouched. Penalty division remainder and uncollectible penalties are not redistributed.

For trivia, a host award of 100 to a team credits 100 to every team member. Somebody's Calling has free entry and awards 500 to one player.

These are examples of values owned by `config/game.yaml`; game modules read the room's saved configuration rather than hard-coding numbers.

## Investment lineup and research cards

Use SOL, BTC, DOGE, SPYx, and PEPE, all quoted in USD through CoinGecko's market-data API. PEPE is the selected speculative meme-themed fifth asset. This is a game-design selection, not a claim that PEPE will outperform or be the most volatile asset during the party.

Show the S&P 500 choice as **S&P 500 proxy — SPYx**. It is a tokenized ETF proxy, not the live cash S&P 500 index. Its weekend token price can differ from the underlying ETF's last regular-session price. Never relabel a frozen traditional SPY/index quote as live weekend data.

The provider change from the earlier Twelve Data candidate is an implementation choice to cover all five instruments through one documented API. Documentation and provider pages establish the intended coverage; authenticated endpoint access, account entitlements, freshness, and Saturday behavior still require integration verification. Do not silently replace an instrument or change providers between opening and settlement.

| Asset / provider ID                   | Short player-facing description                                                                                                                   | Research links                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Solana (SOL) / `solana`               | SOL powers the Solana network, which supports payments and applications. Compare its recent price movement and trading activity before choosing.  | [Market and chart](https://www.coingecko.com/en/coins/solana), [Project](https://solana.com/)      |
| Bitcoin (BTC) / `bitcoin`             | Bitcoin is a peer-to-peer digital currency. Use its recent movement as a reference when comparing the other crypto choices.                       | [Market and chart](https://www.coingecko.com/en/coins/bitcoin), [Project](https://bitcoin.org/en/) |
| Dogecoin (DOGE) / `dogecoin`          | Dogecoin is a dog-themed peer-to-peer cryptocurrency. Compare its price range and trading activity with the other choices.                        | [Market and chart](https://www.coingecko.com/en/coins/dogecoin), [Project](https://dogecoin.com/)  |
| S&P 500 proxy (SPYx) / `sp500-xstock` | SPYx is a tokenized proxy for an ETF tracking large US companies. This game uses the token's USD quote, including weekend token-market movements. | [Market and chart](https://www.coingecko.com/en/coins/sp500-xstock)                                |
| Pepe (PEPE) / `pepe`                  | PEPE is a frog-themed meme token. It adds a speculative choice; use the price range and volume to judge its recent activity.                      | [Market and chart](https://www.coingecko.com/en/coins/pepe)                                        |

Each compact portrait card must contain:

Present the five assets as cards with a checkbox to invest and a separate control to expand details. The cover shows a symbol/mark, name, opening price and 24h change. Opening a card reveals the description, facts, source/time and research links below. Ticking a card adds a blank amount field to the draft; the player types each stake directly, and Save investments commits the whole set. Do not auto-fill amounts or offer an add-remaining-balance button. Researching a card alone never moves tokens.

- Name, symbol, category, and the short description above.
- Opening USD price, 24-hour percentage change, 24-hour high/low, and reported 24-hour USD trading volume, when supplied by the provider.
- A labeled recent-range indicator `(high_24h - low_24h) / opening_price`, if those inputs exist. Label it **24h price range**, never statistical volatility or predicted return.
- Source and provider timestamp, with missing optional metrics shown as unavailable rather than zero.
- A market/chart research link and optional project link. External links open separately; returning restores the same player and timer. Opening a link does not pause the round.
- Selection and amount controls, available tokens, cap, locked-stake explanation, the saved room's game multiplier, and loss limit.

Use one opening `/coins/markets` response, requested for the five exact IDs, to provide both entry prices and research facts. Freeze that snapshot for all players. Use one further market snapshot at investment review for closing prices. Transport retries are allowed; the complete validated opening snapshot may be refreshed only while investment selection is pending and before any position exists. Starting selection requires a fresh snapshot; after opening, persist and reuse it. The accepted closing snapshot remains immutable. Do not embed polling third-party charts or periodically fetch extra prices inside the app. External research pages may show their own newer data; settlement always uses the saved game snapshots.

## Game presentation

Slots is a ticket printer: the Spin button requests one spin, a ticket prints and its three symbols stamp in one by one over about 2.4 seconds, and earlier tickets stack below as history. Block repeat spins during presentation and show gross returned tokens and net change. Reloading shows saved results immediately. On the TV, Slots shows spin and player counts and Powerball shows live bet counts per color (counts only, accepted 2026-10-28). Powerball is a gumball machine; host reveal starts a five-second presentation on connected player/display views (the host view shows the controls only): the dome mixes, a capsule drops from the door, rolls out, rocks and cracks open to show the winning color, and payouts are shown. A short firework finale fires when a player's saved result is a net gain and on the public display when the draw completes; reloads and late joins stay quiet. Reveal still settles once immediately on the server; the animation is presentation, not another betting window or a guarantee of secrecy after public reveal. Late join/reload shows the saved result immediately. Timings live in client presentation settings (`src/client/game-motion.ts`), separate from authoritative session timers and room economy. Reduced motion skips the wait; hidden pages finish presentation rather than running background loops.

## Rankings and privacy

The host can inspect all players in a complete ordered balance list. Public results are host-revealed. The final screen lists every participant, first through last, with final tokens. Equal balances share rank; use a stable secondary order for display without claiming a tied player earned a lower place. Costume winners are announced place by place near the end of the party: public screens show only places announced so far, the host always sees the standings, and tokens move as each place is announced. The final ranking is announced the same way, then shows every participant.

Personal phone numbers/emails are not public. Balances are sent only to their owner and the authenticated host until an intentional leaderboard reveal. Hide the player's balance again on stage change. Reveal phone-draw selection and its reward publicly only when the host chooses.

## Implementation choices and remaining verification

- Proposed single-instance stack: TypeScript, React, Node.js/Socket.IO, SQLite on durable disk, and Caddy HTTPS on Lightsail. This is a design, not an already deployed environment.
- Session durations currently default to 120/60/90/60 seconds; all four are editable in configuration before starting a party.
- Red/blue draw uses 50/50 server randomness, stakes on one side, proportional payouts, and a refund if the selected side has no bettors.
- A tie for first place is settled by re-vote: the host starts a re-vote among only the tied players with a fresh timer, repeating until one player leads; results cannot be revealed while a tie for first stands (if nobody votes in a re-vote, the tie stands). Re-votes only order players who were tied; ties for second or lower still share the full prize. No accepted costume ballots means no awards or penalties. With one player, no self-voting is possible; host can close or skip the empty contest.
- Confirmed submissions may be revised before expiry; the server adjusts reservations atomically. Spins are final when accepted.
- Exact profile identifiers, guest recovery procedure, API access, and deployment commands will be established during implementation and rehearsal, not reported as complete here.

## Market-data references

Reviewed 2026-10-27; recheck live integration before the party.

- [CoinGecko Demo market-data endpoint](https://docs.coingecko.com/demo/reference/coins-markets): authenticated multi-ID market snapshots and market metrics.
- [CoinGecko simple-price reference](https://docs.coingecko.com/reference/simple-price): exact IDs and provider timestamp support.
- [CoinGecko tokenized-asset guide](https://www.coingecko.com/learn/track-tokenized-stocks-rwa-data): includes the `sp500-xstock` API ID.
- Asset and project pages are linked in the research-card table above. No current market numbers have been copied into configuration or treated as party opening quotes.

## Round presentation refinement (2026-10-28)

Keep one game title and one large rules block on the TV, followed by live teams, a machine or results. Avoid repeating the title in an eyebrow and nested game headings. Use the guest-facing names: **2 minute quantitative researcher**, **Best dressed**, **Tracy 的趣味问答**, **Tonight I am Venetian**, **Powerball red or blue**, **The closing bell**, **Somebody’s calling**. These are presentation names; internal stage IDs stay stable.

Use subtle hedge-fund green/serif investment accents, Venetian brass/warm casino accents, a county-fair lottery drum, and a classified-file phone-draw treatment within the white Party notebook canvas. Save investment/bet feedback must follow the authoritative snapshot, remain visible next to the action, and distinguish unsaved edits from the previous saved selection. Never infer successful saving from a click.

The public closing bell shows all configured assets with opening/closing quotes, directional market returns and game returns per 100 tokens invested. The player sees a large personal token gain/loss, stake, returned amount and settlement state, with prices/timestamps/math in a disclosure. Pending estimates must say they are not yet credited. Public cards never expose individual positions or private balances.

Show the invite QR in the lobby only. New registrations remain closed once the party starts. Disconnection never removes a player, tokens, a team or an accepted action; reconnect with the existing session or use the host-assisted recovery link. Keep TV access and connection help available to the host during play.

## Action clarity and trivia corrections (2026-10-28)

Show the configured investment cap prominently and make Ready green after saving. Player trivia has a large centered buzzer; TV rules use concise Chinese text within the shared visual system. Host success feedback requires a committed acknowledgment, never only a click. While trivia is open, provide host-only Undo for individual team awards, using an atomic append-only reversal and persistent history; the host can then re-award correctly. Repeated undo/retries never repeat debits; corrections never spend locked/reserved funds. Close/advance ends this correction window. Disable accidental repeats in the host UI. Board mode permits one active award per cell; legacy numbered rooms retain intentional distinct awards.

The optional Connection check is a short connectivity rehearsal. Full test party uses sample prices across all games for manual practice; both sit under host Test tools and are distinct from automated test/simulator coverage.

## Chinese trivia board (2026-10-29)

The standard flow uses five categories in fixed order: 童年DNA、听歌识曲名、大冒险、自然地理、随机挑战. Host selection drives one reusable full-question TV view. Cancel before any accepted buzz/award/reveal preserves the unused cell; explicit finish marks it used. Saved content, selected cell, reveal, exclusions and completion survive restart. One active award per cell credits its value to each teammate, with no incorrect-answer deductions. Undo/correct remains available after finishing a cell while trivia is open. Public team scores count clue values once, independent of personal balances.

The local review uses configurable tiers 100–500. Thirteen supplied text questions are playable. The user selected exact recordings for all five music tiers; Apple catalog metadata, full 30-second preview URLs, and answers are stored only in the ignored local event bank. Apple preview terms restrict use to promotion of the underlying content and do not establish permission for an entertainment game, so this technical setup is not cleared for party use. Two geography cells await scenes/answers. The five 大冒险 cells are playable only when the selected local event bank supplies their challenges, rules, and reference image. Phones receive no clue content or answers. See [trivia rules](docs/games/trivia.md).

### Private event bank and demo rehearsals (2026-10-29)

Default trivia uses 25 distinct demo questions so the eventual participants can rehearse without seeing event clues. All three roles identify the demo bank. The event bank remains in an ignored local JSON file; it is selected explicitly via the host toggle before play. Preview starts with demo content. A board freezes its bank when trivia opens; switching files never changes an already-opened board. Choose event questions before the first selection; after play begins, use a new party to switch banks. Demo music/reasoning questions are plain oral Q&A and do not implement the event song, geography scene or adventure interactions. Event 大冒险 cells use host-assigned first teams, a timed challenge, and an optional second-team buzzer after failure. Charades words appear only to the host; Yes or No prompts appear on TV only when the host explicitly shows them. Phones receive neither prompt.

### Host demo-mode toggle (2026-10-29)

The host can switch between demo and the local event bank before the first trivia cell is selected. Demo category labels are always generic 类别 1–5. Preview starts in demo mode; switching off is an explicit host action and uses a trusted server-configured local file. After any selection or award, switching is blocked to preserve saved progress and accounting. Mode changes persist across reload/restart. Real questions remain in ignored local files and never enter Git or client builds.

## Trivia scoreboard and reward feedback (2026-10-29)

Insert an untimed, host-controlled **Trivia score board / 团队积分榜** between trivia and slots. Show all teams simultaneously on TV and phones, sorted descending by active trivia award score, with shared competition ranks for ties. This is team clue score, not total teammate balances; no extra payout occurs.

Every positive game reward triggers a small private amount-free four-bill 💸 acknowledgment on the receiving phone, including a positive slot return smaller than its spin cost. Initial grants, refunds, principal returns and reversals do not. Investment settlement needs a positive profit. Saved event IDs prevent replay on reload/reconnect; slot and Powerball acknowledgment waits for result presentation. Balances stay hidden and reduced motion is supported.
## Trivia host flow (2026-10-30)

Each selected board cell presents three host areas in order: 题目, 抢答与公布答案, and 记分与修正. Music, geography, text, and adventure share final host judgement and scoring controls; adventure retains its own challenge rules, timers, prompt visibility, and host pass/fail decisions inside 题目. Charades words appear on host and TV only; photo recreation uses a different tracked reference for each attempt, with offline host judgement and no entered score or reason. Ordinary board clues allow at most two teams to try. The host may choose a different awarded team deliberately, and the selection is initially blank until a winner or explicit choice exists. Legacy numbered trivia retains its free-form amount.
