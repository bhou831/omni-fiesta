# Trivia / Jeopardy controller

The host presents questions in external PowerPoint slides. This app supplies balanced random team assignment, theme colors plus text labels, buzzers, and configurable host-entered scoring. There is no session countdown.

Host chooses N teams; enforce `1 <= N <= joined player count` and balance sizes within one player. The configured default is a suggestion, clamped to player count. Freeze teams once trivia starts unless the host explicitly begins a new assignment before awards/questions. Every player phone displays its team's name/color and a large buzzer.

For each question/window, the host arms the buzzer. The first valid buzz accepted at the server atomically wins and locks the window. Save player/team and server order. Do not trust client timestamps, wait for all buzzes, or maintain a second-place queue. Later buzzes in that window have no effect. Show acceptance clearly on the winner's phone and host/public display as appropriate.

Host judges the answer. An incorrect team can be excluded and the same question reopened with a new buzzer window. A new question clears exclusions. A stale request/window can never win after reopening. Host enters a team and positive whole-token award; credit that amount to every frozen teammate in one idempotent award operation. Reusing a request ID does not issue another award; a deliberately new award request is distinct.

Acceptance: simultaneous buzzes from multiple teammates/teams produce exactly one winning record; 100 to a four-person team adds 100 to each; duplicate awards do not repeat; excluded teams cannot buzz on reopening; N=1 is valid; phones reconnect to current team/window; no countdown is displayed.
