# Trivia

The 2026-10-31 retry update supersedes older two-attempt descriptions below: the host chooses the first team before selecting any board cell. New rooms permit up to four distinct teams per clue, except the first three geography tiers, random challenges, and both Yes/No adventures, which permit two. Assigned teams cap the limit. After a failed attempt the host opens a retry buzzer; the accepted adventure buzz starts its full timer immediately. Photo attempts cycle the two saved references, and the saved scoring text is available only to the host for copying or manual selection. Saved configurations without the new limit settings retain their prior two-team limit. Legacy untimed ordinary clues remain untimed.

The five 大冒险 cells use the saved local event bank when its challenges are prepared. For each cell, the host selects the first team and starts its timer after the rules page. Only a failed first attempt can open the existing buzzer for a second team. During charades, the current word appears on host and TV, but never on phones. Yes or No text starts hidden from TV and the host can show or hide it; phones never receive it. The photo cell uses two tracked reference images, one per attempt. Once each pose timer has started, the host may judge success or failure at any time, including after it expires, from any offline assessment without entering a score or reason. A failed first attempt can open the buzzer for a second team and image. Accepted buzzer winners appear on the host, TV and winning phone. See `adventure-rehearsal-fixes-plan.md` for the state transitions and checks.

The TV is the shared stage: begin with three short Chinese rules (choose a clue, buzz and answer aloud, earn the clue value per teammate) and a decorative animated question board/buzzer, with assigned teams below. Once play begins, show one large question, then prioritize the answer after reveal, with category and value kept quiet. Put buzzer state and team scores along the bottom. The TV uses the shared background balloons/fireworks; phones remain free of ambient effects. All decorative motion respects reduced motion and pauses in hidden tabs. Phones show the player's team, one short state message and a large buzzer; they never show questions or collect answers. The host alone judges spoken answers.

New rooms use a host-controlled 5×5 board, in this order: 童年DNA、听歌识曲名、大冒险、自然地理、随机挑战. Teams announce a choice aloud; only the authenticated host selects the cell. The TV shows the full question; phones show team identity, buzzer status and a large 抢答 button. For ordinary board clues, the host selects the first answering team before opening the clue; opening starts its configured answer timer. On an early wrong answer or expiry, that team is excluded for this clue without a token penalty. The host may open the second-team buzzer; its first eligible buzz starts a fresh timer. At most two teams may attempt. The host may award a correct answer while the timer runs, or reveal and finish without scoring. Phones never collect typed or multiple-choice answers. Adventure keeps its separate challenge timers. Its copy is Chinese; other stages retain their existing language.

`config/game.yaml` owns the five increasing positive `trivia.board_values`. The local review uses **draft 100 / 200 / 300 / 400 / 500 tiers, awaiting user confirmation**. On first opening trivia, snapshot the server-only question set and version into `trivia_boards`. Code/content edits cannot change an active room's frozen clues. Saved pre-board configuration without `board_values`, and existing numbered trivia state, retain the legacy numbered-question/free-form-award flow.

## Content readiness

The tracked server-side `config/trivia-event.json` is the source of event questions; it is not copied into the public client bundle. The two geography cells contain curated non-U.S. Street View scenes. The display shows the panorama. The winning team answers aloud; the host privately judges it against the saved host answer. No typed answer, geocoding or automatic pass/fail is used. The browser Maps key is still needed for Street View. Selected music previews are technically playable but Apple terms limit them to promotional use and do not clear them for an entertainment game. The event bank readiness check covers the remaining adventure content.

Text clues may include a checked-in `questionVideo` asset under `/trivia/`. The host controls playback of the selected clip; the public display follows its saved position. Phones do not receive the question board. Use browser-compatible MP4/H.264 media and keep the answer and judging notes in server-side bank fields.

Image clues may set `questionImage` to a checked-in asset under `/trivia/`. The host and public display receive the image with the selected prompt; phones do not receive the question board. Keep any accepted answer and judging guidance in the server-side bank fields.

## State and actions

- Host assigns balanced random teams (`1 <= N <= joined players`, sizes differ by at most one). Team identity uses both color and text; teams freeze after questions or awards begin.
- `select-cell` requires assigned teams, a prepared unused cell, and no unresolved selection. For ordinary timed clues it also requires a first team, assigns it without inventing a player buzz, and starts the saved answer duration atomically. It increments the existing question counter. Opening does not consume the cell. A valid cancellation is available only before play begins. The counter remains monotonic.
- `arm` opens a new persisted buzzer window; in the timed ordinary flow it is available after the first attempt fails. The first eligible second-team buzz starts the next answer timer. First server-accepted buzz atomically locks the window; there is no runner-up queue or client-time comparison. Late/stale windows cannot win. A wrong team is excluded for this question in the timed ordinary flow; **incorrect answers never deduct tokens**. The host may reopen for eligible teams. If all are excluded, show a clear reveal/finish path.
- `award` requires a positive amount equal to the cell's frozen value and an assigned team. It credits that amount to **every frozen teammate**, using the existing transaction, request ID and append-only accounting. One cell can have at most one active award. TV/host trivia scores count the cell value once per team, never sum personal balances.
- `reveal-answer` intentionally publishes the answer to the TV and closes any armed window. Phones never receive it. Answer reveal prevents further buzzing; the host can still judge/award.
- `finish-cell` requires the buzzer closed or locked. It marks the cell completed and returns to the board, with or without an award. Completed cells cannot be replayed. Close/advance requires the selection to be finished or safely cancelled first. Slots and the later party sequence are unchanged.
- Location cells reuse selection, buzzer, wrong-answer exclusion, one opposing-team retry, host award and finish. The winning team answers aloud. The host alone judges and chooses the shared “答错” or award action. No display submission or checking endpoint exists. The host can finish without scoring.
- Board commands carry the selected cell ID and reject stale selection actions. Persisted state reconstructs after reload/restart. Core authorization and idempotent request replay remain authoritative.

## Corrections and privacy

Successful host actions show feedback only after acknowledgment; an in-flight guard blocks rapid clicks. **计分与撤销记录 → 撤销计分** atomically reverses the exact original award for every frozen recipient. Append reversal entries, retain the original receipt, and never touch locked/reserved accounts. Repeated undo cannot debit twice; insufficient spendable funds roll back all debits. After undo, **重新计分此题** permits a corrected team award for that same cell, including after completion, while trivia is open. The amount remains the cell value. Legacy rooms retain their free-form amount correction. Closing trivia ends the correction window.

Schema v14 adds board snapshots, selection/completion state and nullable-by-absence award/cell associations. Geography uses the existing Trivia schema and requires no new migration. Previously opened local schema-v17 databases remain readable, but their old automatic grading table is unused. Host projections contain private answers, judging notes, music candidates, correction history. TV snapshots contain board availability/completion, the current prompt, public scene controls and team scores; true coordinates and answer remain host-only. Player snapshots omit the board, prompts, answers, scene, media metadata, score table and award history. Only host commands can judge, score, reveal or finish a geography clue. HTTP and Socket.IO use role-filtered projections. Contact details and other players' balances remain private.

The host's scoring selector defaults to the current buzzer winner; the award button names the recipient team. A manual team choice lasts only for that question/window/correction, so it cannot silently carry over to a new buzz. Finishing a clue sits below scoring, labeled **不计分 · 完成本题** until an active award exists. Phones show **本轮结束** when the host closes trivia.

## Game-day host sequence

Phone status always follows the authoritative team result, including when another teammate wins while this phone's request is still pending or rejected. There is no persistent local "未抢到" result to carry into the next question. Expected closed/stale/excluded buzzer rejections resync without a contradictory error banner; genuine network and other command errors remain visible.

Before play, verify the selected bank is the intended event bank (the demo switch is locked after the board starts), then assign teams. Show the board; a team announces a category/value and the host opens that cell. Choose the first answering team, open the clue, and judge its spoken answer while the timer runs. On a wrong answer click **答错 · 不扣分**, then **开启抢答** again for eligible teams. On a correct answer verify the named team and save its award. Optionally **公布答案**, then **完成本题 · 返回题板** to select the next clue. Skipping a clue uses the explicitly labeled no-score finish. No external slides or manual phone navigation are required. Questions are frozen for the room; edit the bank before starting a fresh party rather than expecting file edits to change an active board.

## Verification

Focused tests cover content validation, authorization, stale/duplicate commands, first buzz and exclusions, no-award completion, per-teammate accounting, duplicate-award prevention, undo/correction after finish, restart, v12 migration, legacy behavior and HTTP/socket privacy. Geography tests additionally cover host/TV/player privacy, no typed input, two-team retry, manual host award, reveal and finish. See `docs/plan.md` for verification evidence and remaining physical-device work.

## Demo versus event content (2026-10-29)

The default server bank is `config/trivia-demo.json`, containing 25 ready **demo-only** clues. The five cells in 类别 2 are listening/identify-the-melody clues, backed by distinct locally synthesized WAV fixtures of public-domain melodies: 《小星星》, 《欢乐颂》, 《两只老虎》, 《玛丽有只小羊羔》 and 《铃儿响叮当》. They exercise playback and oral identification; they are not event-song selections or recordings. Demo category headings are generic 类别 1、类别 2、类别 3、类别 4、类别 5, including projections of previously frozen demo boards. Stable cell IDs and scoring remain the same; other demo content remains a rehearsal substitute, not event questions or adventure challenges. Host, TV and phones identify 演示题库. Players answer aloud; no phone answer input is added.

The supplied event bank is tracked at `config/trivia-event.json`. All original questions, missing-content markers and nine music candidates are retained there. The earlier content-readiness section describes this event draft, not the default demo bank. Read `TRIVIA_BANK_FILE` server-side to select an external JSON bank for new trivia instances. `npm run trivia:check` validates it and prints only label/version/readiness/candidate counts. Five JSON value ranks map to the saved room's configured value tiers. The event bank contains the real questions and host answers by user request; keep it out of client bundles, screenshots, tests and logs. Played boards remain frozen; only a pristine board can use the host toggle, otherwise make a new party to change banks. The standalone preview explicitly loads the event bank and `.env` for the browser Maps key; it still uses an in-memory database, fixed preview password and disabled live-market provider. Invalid custom files fail with generic errors without dumping their contents.

## Host demo toggle

Host trivia controls include 演示模式: on loads the demo bank and generic category labels; off loads the event file. The server resolves `TRIVIA_EVENT_BANK_FILE`, then a non-demo `TRIVIA_BANK_FILE`, then `config/trivia-event.json`; clients never supply a path. The bank is tracked for deployment and loaded only by the server. Only host snapshots include switch availability/file-presence metadata. Players cannot switch banks.

`set-demo-mode` uses normal host authorization, transaction/idempotency and expected bank version. It is allowed only while trivia is open, question/award counters are zero, no selected/begun cell exists and no cell result exists. It preserves teams and accounts. Once any cell is selected, even if safely cancelled afterward, switching locks; a new party is required. Invalid/missing/wrong-mode files leave the previous board intact and return a generic error without private input. The chosen bank persists in the existing board snapshot across reload/restart. No new migration or reset of scores/results is needed.

## Trivia scoreboard

After trivia the host advances to a separate untimed **团队积分榜** stage, then closes it and advances to slots. TV, host and phones show all teams at once, descending by score; phones mark the viewer's team. Scores count each active award once per team, including legacy awards, never once per teammate. Undone awards do not count. Zero-score teams remain visible. Equal scores share competition ranks (1, 1, 3), with team number breaking display-order ties. No additional tokens are awarded. Scores and teams come from the completed persisted trivia instance and survive restart. `just preview trivia-scoreboard` opens the five-team disposable fixture.
## 听歌识曲 playback

Prepared music cells must have a host answer and exactly one validated media reference: a local basename under `private/trivia-media/`, or an HTTPS Apple preview URL on `audio-ssl.itunes.apple.com` under `/itunes-assets/AudioPreview`. Apple entries also require exact catalog metadata and use the full 30-second preview. Local event audio never lives in `public/`; the selected-cell route requires a host session or valid TV display capability and checks that the requested cell is still selected. Apple preview URLs are redirected only after selected-cell and exact-host/path checks. Host commands persist playback start/stop and clip position; the TV follows this state, with a one-time sound-enable gesture to satisfy browser autoplay policy. The host alone controls playback. TV receives the Apple Music store link and courtesy attribution while selected, and title/artist after reveal; phones receive no board or media metadata. Demo audio is synthetic and uses the same synchronized host controls. Apple's preview terms do not establish permission for these event selections; they are not cleared or approved for party use.

## Shared host decision flow (2026-10-30)

For every selected board cell, the host sees 题目, 抢答与公布答案, and 记分与修正 in that order. Text, music, and geography use the same oral judgement and at most two attempts. Adventure challenge rules and timers stay in 题目; final award, reveal, finish, and correction use the common controls. The server projects host-only control capabilities; commands still validate the actual state in the transaction.

| State | Available host decision | Result |
| --- | --- | --- |
| Selected, unrevealed, idle | Arm or cancel before play begins | Arm opens a fresh window; cancel returns the unused cell |
| Armed | Close; wait for the first accepted buzz | Close leaves the cell idle; first buzz locks one team |
| Locked, ordinary clue | Mark incorrect or award the chosen team | Wrong excludes the team without a debit; award credits each teammate once |
| Idle after one wrong team | Arm the second attempt | Excluded team cannot buzz |
| Idle after two wrong teams | Reveal or finish without points | No third team may buzz, even in a four-team room |
| Adventure waiting/rules/active | Choose the first team, run challenge controls, or end early | Common scoring stays blocked until success; prompts stay private until allowed |
| Adventure first failure | Open one opposing-team attempt or end | The second team receives the full challenge conditions |
| Adventure success result | Award only the successful team at cell value | Award and challenge phase change to won atomically |
| Awarded | Reveal, finish, or undo | Undo reverses the receipt once and reopens correction |
| Completed awarded cell | Undo, then re-award at the same cell value | The used cell stays used; ledger records both operations |

Reveal closes an armed ordinary buzzer and blocks new buzzes. Adventure reveal is available only after a result or closure. Music playback position is measured from the clip start, and replay starts at zero after the clip ends. The TV needs its own browser sound-enable gesture.


## Ordinary answer timers and saved rooms

New rooms save `trivia.answer_seconds` (90 seconds by default). Each ordinary clue persists its assigned team, attempt number, deadline and status. Expiry is reconciled on the server at the exact deadline, including while idle and after restart; it excludes the team without closing Trivia or awarding tokens. Failed teams cannot buzz again on the same clue. Reveal, finish and successful awards resolve an active timer; playback does not restart it. The timer and answering team are projected to all three roles without inventing a player winner for the host-assigned team.

Saved rooms whose configuration predates `answer_seconds` keep their existing untimed ordinary Trivia flow; their saved configuration is not rewritten. Existing selected clues and legacy numbered rooms retain their previous behavior. To use the timed flow, create a room with the new setting. Adventure behavior is independent.

## Video and reveal controls (2026-10-31)

Video clues use host **播放大屏视频 / 暂停大屏视频 / 从头播放** controls. TV playback follows the persisted server position, including reconnect and restart; the host preview stays muted. The TV can enable sound with its own gesture. Independent native playback controls are not shown. Reveal and finish stop video, and playback leaves both ordinary and adventure timers unchanged. Media validation accepts source `public/` assets and packaged `dist/client/` assets; missing files still reject the bank.

For a timed ordinary clue, revealing before expiry stops the countdown and preserves scoring for that attempt's assigned team. The host may then award or finish without points. Revealing after expiry never restores scoring eligibility. Undo and explicit historical correction retain their existing receipt-ledger behavior.

## Host timer controls (2026-10-31)

All timed ordinary clues and all five adventure variants offer **暂停计时 / 继续计时 / 重新计时** after their timer starts. Pause saves the exact remaining milliseconds; resume starts a deadline from that saved remainder. Restart immediately runs a full countdown using that room's saved ordinary answer duration or the current adventure variant's duration. It changes only the clock: team, attempt, words, photo reference, progress, media playback and scores stay unchanged. Pausing the clock leaves the host's existing judging/finish controls available.

Controls cannot revive an expired attempt, a judged challenge, a revealed answer, an awarded clue or a finished cell. At the exact deadline the timer is expired. The host can still judge photo recreation after expiry, as before. Untimed legacy clues do not acquire a timer. Host, TV and phones show the same clock and **已暂停** label, including after reconnect. Paused clocks survive a server restart. Commands carry the selected cell, attempt and timer revision, so stale controls from another host device cannot change a newer clock; identical request retries never extend time twice.

Music playback follows a separate server timeline. Its projected position is anchored at snapshot time; late sound activation and metadata loading add elapsed time and clock offset once, bounded by the clip end. Enabling sound after a clip has ended does not replay it. Answer timer controls never pause or restart music automatically.
