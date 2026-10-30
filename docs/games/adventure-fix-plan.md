# 大冒险 follow-up implementation plan

## Confirmed flow

1. The host selects a 大冒险 cell, then chooses an assigned team for attempt 1. The rules page appears before the timer starts. No buzzer opens for attempt 1.
2. The host starts the saved timer once. For charades, the server draws one unused word at a time. For Yes or No, the server holds one challenge prompt. For photo recreation, the saved private bank points to a reference image.
3. A successful attempt presents an explicit **给本次挑战队伍计分** control. Only the team that played that attempt may receive the cell value, credited to each teammate through the existing trivia ledger. A failed first attempt presents **开启抢答** or **跳过本题 · 不计分**; the host starts the existing buzzer only if another team wants to challenge, excluding the first team. The first eligible second-team buzz opens a new rules page and a fresh full timer. A failed second attempt ends the cell without an award. There is no third attempt and no requirement that every team play a cell.
4. Yes or No challenge text is hidden from the TV by default. The authenticated host can explicitly show or hide it during rules or active play. The representative's phone never receives the prompt. A consent-based replacement consumes the old prompt and returns to rules with a fresh timer.
5. Photo recreation shows the reference to the TV after the timer starts. The host takes the team photo and uses the saved scoring prompt outside the app, then enters an integer AI score and short reason after the pose timer. A score of at least 80 wins. The second team uses the same reference.
6. The host may end the current challenge early at any stage. This atomically records no award, completes the cell and returns to the normal trivia board. The ordinary trivia host panel, including scoring history and the stage-level end control, stays visible.

## Technical changes and boundaries

- `trivia_adventures` persists the attempt, selected team, phase, deadline, counts, current item, TV visibility and score. `trivia_adventure_pools` persists shuffled item order and cursor for the room. They are added by schema migration 15. Core host authorization, transactions and request deduplication remain unchanged.
- `adventure-choose-team` validates membership and only works in the first waiting state. `arm` is limited to the second-attempt steal state. A buzz locks via the existing first-server-accepted update and enters rules for the winning team.
- `adventure-display-prompt` accepts a boolean and an expected attempt. Host snapshots retain the prompt; TV snapshots omit it while hidden; player snapshots always omit it. The visibility flag resets to hidden for attempt 2.
- The photo sample is a replaceable local reference asset. The actual question, rules, reference path and scoring prompt remain in ignored `config/trivia-event.json`. Team photos are handled outside the app and are not stored.
- The UI uses the existing Party notebook controls. The host receives team selection, timer, result, TV visibility and scoring controls; TV receives rules, active reference and result; phones receive team and buzzer status without private prompts.
- The countdown uses the same server clock offset as the other game timers. The photo score control becomes available only after the saved pose deadline; server validation remains authoritative.

## Verification checklist

- First attempt rejects buzzer and accepts one assigned team; stale or repeated team selection fails.
- Yes/No hide/show survives snapshots and never releases the prompt to phones; consent replacement consumes the prior prompt.
- Photo reference is absent from TV before start, appears after start, and score entry is rejected before the deadline or outside 0–100. A score of 80 awards once; a lower score reaches the second-team path.
- Both-team failure, no volunteer, exact deadline, duplicate requests, pool exhaustion, restart, undo, and role-filtered HTTP/socket snapshots remain covered by focused and full tests.
