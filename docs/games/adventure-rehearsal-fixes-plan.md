# Adventure and buzzer rehearsal fixes

Status: implemented and verified in the feature checkout, 2026-10-30. The two supplied photo references are tracked at `public/adventure/photo-recreation-attempt-1.png` and `public/adventure/photo-recreation-attempt-2.png`. See `docs/plan.md` for verified implementation status.

## Accepted decisions and boundaries

- 你比我猜 shows the current word on both the private host and public TV while an attempt is active. The representative's phone still receives no word. A skipped or completed word disappears from the TV when the server draws the next one. The host remains the only actor who advances words.
- A first accepted buzz appears on the TV with the winning team and player, including the second-team adventure buzzer. Keep that result until the host judges or deliberately advances; refresh and reconnect show the same winner. No second-place queue is introduced.
- AI 图片人体还原 uses offline judgement. The host chooses success or failure after the posing time and may then use the common award or second-team buzzer flow. The app collects neither an AI score nor a reason and enforces no numeric threshold. The first attempt displays image 1; a host-opened second attempt displays image 2. The second team receives a fresh full timer. The first team cannot buzz again. At most two attempts occur.
- The two images are public challenge material, served from the app's tracked `public/adventure/` directory. The event bank remains ignored and private. No player photos, AI output, or scoring notes are stored in the app. Existing team balances, cell values, award receipts, undo, and later stages remain unchanged.

## Current behavior and causes

| Issue | Current path | Change |
| --- | --- | --- |
| Charades word absent on TV | `projectAdventure` in `src/server/games/trivia-adventure.ts` explicitly nulls `item` for every non-host charades projection. | Include `item` for the display during active charades only; keep it null for players and before a word is drawn. `AdventureStage` already renders non-photo `item`. |
| Buzz winner absent on adventure TV | `TriviaDisplay` in `src/client/Trivia.tsx` chooses the adventure status branch before its normal `answering` branch. | Prioritize a locked accepted winner in the shared status strip, then show challenge status. Ensure `AdventureStage` can still show the selected team and rules. |
| Photo score/reason requirement | `AdventureHost` renders inputs; `adventure-score` validates 0–100 and `photo_success_score` in `trivia.ts`; projection renders the score/reason. | Replace with host success/failure actions after the saved pose deadline. Remove score/reason from new UI and active rules; retain read compatibility for old saved state fields, if any. |
| Same photo for second attempt | `createAdventure` copies one `referenceImage` to `AdventureState.item`; `adventure-steal` retains it. | Freeze two validated reference paths with the room bank; set attempt 1 to image 1 and switch to image 2 when the host opens attempt 2. |

## Implementation sequence

1. **Freeze the contract and event content.** Extend the photo clue schema in `trivia-content.ts` with an ordered two-image field (or equivalent explicit first/second paths). Validate exactly two app-local `/adventure/` PNG paths for a ready event photo cell, with no remote URLs or traversal. Keep a compatibility reader for frozen one-image rooms: their existing image continues to work, while newly created rooms require both. Update the ignored local event bank to point at the two tracked assets when implementing; do not copy private bank contents into Git. Remove `photo_success_score` from configuration validation and prose only after no active server path reads it. A saved room's bank is frozen, so use a new preview/party to test the updated content.
2. **Fix charades projection.** In `projectAdventure`, return the current word to the TV only during an active charades attempt and clear it on result, skip, replacement, or closure according to the saved state. Keep phone projection null. Verify the projected JSON as well as rendered TV, because CSS alone cannot enforce privacy.
3. **Show the buzzer winner on TV.** Reorder `TriviaDisplay` status selection so `status === 'locked'` and `winner` wins over adventure-specific waiting/rules text. Show team name plus player name; preserve a text cue and team color. Ensure the winner remains visible through TV reload and Socket.IO reconnect until the host judges or changes the attempt. Keep stale-window and excluded-team server checks unchanged.
4. **Simplify photo judgement.** Replace the photo score form with two explicit host decisions after the pose timer: `挑战成功` and `挑战失败`. The server checks selected cell, expected attempt, selected team, active phase, and deadline, then moves to `result` (success) or the existing first-failure/second-failure path. Shared award remains enabled only for the successful challenge team; it uses the frozen cell value and one receipt. Host can choose `开启抢答` after first failure, or finish without points. No automatic success based on AI output. Decide whether a host needs an early override before the timer; default to requiring the saved deadline, with the existing clearly labeled early-finish action for aborting the cell.
5. **Rotate the second image.** When `adventure-steal` is accepted after first failure, atomically set the saved `item` to image 2, clear first-attempt result, reset timer/target fields, and exclude the first team. Display image 2 when the second attempt becomes active. Refresh/restart must keep the correct image and attempt. Do not let retries or stale first-attempt commands advance to a third image or third attempt.
6. **Update copy and documentation.** Replace AI threshold/score/reason instructions in `docs/games/trivia.md`, `docs/system.md`, `spec.md`, local event-bank guidance, and `docs/plan.md`. Document that the host may consult an offline score but records only pass/fail. Keep host, TV, and phone instructions consistent.

## Acceptance matrix

| Initial state → action | Server/ledger result | Host / TV / phone |
| --- | --- | --- |
| Charades rules → start | Draw one unused word; deadline set once | Host and TV show same word; phone has no word |
| Active charades → correct/skip | Advance pool cursor once; no balance change | Host and TV replace the old word together; phone stays private |
| Armed second attempt → first eligible buzz | One winner and locked window | Host, TV, and winning phone identify team; TV also names player |
| Photo attempt 1 → timer expires → host success → shared award | One full cell-value credit per teammate; `won` and receipt saved atomically | Host confirms team; TV shows result and score; phone has team status only |
| Photo attempt 1 → host failure → steal → second team buzz | First team excluded; new full timer; no debit | TV moves from image 1 to image 2 at attempt 2; no third attempt |
| Photo attempt 2 → failure / no volunteer | Cell closes with no award | All views show completion; board cell becomes used |
| Duplicate, stale cell/window/attempt, wrong team, premature judgement | Rejected with no ledger or image change | Host sees error; saved state survives reload |
| Award → undo → re-award | Compensating entries once, then one active cell award | Host history is private; TV score updates once each time |

## Verification and handoff

- Focused fake-clock tests for the exact photo deadline, two-image transition, no numeric score path, undo/re-award, and 1-, 2-, and 4-team attempts. Test legacy one-image frozen room read behavior and restart in temporary SQLite. Add default-module and HTTP/Socket.IO checks for TV winner and role-filtered charades words.
- In separate disposable fresh **event-bank** rooms, walk host, TV and phone through both charades variants and photo first failure → second-team buzzer → second image → judgement → award/reveal/finish. Check narrow phone, host desktop, and 1920×1080 and smaller TV; refresh during each active attempt. Verify TV word readability, image sizing and keyboard focus. Use the configured Maps-approved origin when geography is included.
- Run `npm run trivia:check`, `npm run format:check`, `npm run typecheck`, focused tests, full `npm test`, `npm run build`, 15/100-player party simulations, and `git diff --check`. Verify the production build serves both PNGs and contains no private bank or host-only word in player snapshots. Leave a fresh preview running for review, and record exact outcomes and any physical-device limits in `docs/plan.md`.

Implementation and verification evidence are recorded in `docs/plan.md`.
