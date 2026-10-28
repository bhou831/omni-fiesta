# Trivia / Jeopardy controller

The host presents questions in external PowerPoint slides. This app supplies balanced random team assignment, theme colors plus text labels, buzzers, and configurable host-entered scoring. There is no session countdown.

Host chooses N teams; enforce `1 <= N <= joined player count` and balance sizes within one player. The configured default is a suggestion, clamped to player count. Freeze teams once trivia starts unless the host explicitly begins a new assignment before awards/questions. Every player phone displays its team's name/color and a large buzzer.

For each question/window, the host arms the buzzer. The first valid buzz accepted at the server atomically wins and locks the window. Save player/team and server order. Do not trust client timestamps, wait for all buzzes, or maintain a second-place queue. Later buzzes in that window have no effect. Show acceptance clearly on the winner's phone and host/public display as appropriate.

Host judges the answer. An incorrect team can be excluded and the same question reopened with a new buzzer window. A new question clears exclusions. A stale request/window can never win after reopening. Host enters a team and positive whole-token award; credit that amount to every frozen teammate in one idempotent award operation. Reusing a request ID does not issue another award; a deliberately new award request is distinct.

Acceptance: simultaneous buzzes from multiple teammates/teams produce exactly one winning record; 100 to a four-person team adds 100 to each; duplicate awards do not repeat; excluded teams cannot buzz on reopening; N=1 is valid; phones reconnect to current team/window; no countdown is displayed.


## Host feedback and award correction

Successful host commands show checked green feedback only after a server acknowledgment. The award form disables an already-active award with the same question, team and amount (also after reload). Intentional different awards remain supported; changing the form or starting a new question permits a distinct request. A synchronous in-flight guard blocks rapid duplicate clicks, while network retries retain the original request ID.

During the open trivia stage, the authenticated host may undo a specific saved award from **Awards & corrections**, then submit the correct team/amount. Reverse the full original amount for every original, frozen teammate in one transaction. Append compensating ledger entries and mark the receipt undone; do not delete history, decrement the team-freeze counter or alter locked/reserved accounts. Repeating undo, including with a new request ID or after restart, cannot debit twice. Replaying the original award request after undo cannot re-credit it. If any debit cannot be completed, roll back every debit and leave the award active. A closed/advanced stage cannot be corrected through this command. There is no arbitrary balance editor in this feature.

Additive schema version 10 stores question/time/undo metadata in `trivia_award_receipts` linked to existing awards. Earlier awards remain readable and reversible with an unknown question label; do not fabricate their original question. Award history is host-only; public/player projections retain only teams/buzzer information.
