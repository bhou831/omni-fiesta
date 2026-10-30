# 听歌识曲 implementation plan

## Scope and assumptions

Implement a host-led audio clue in the existing Trivia board, using approved iTunes preview URLs as the preferred source and confined local WAV files as a fallback. The example at bowen-hou.com/music/ uses native HTML audio with an iTunes preview URL; no player package is needed. No event track, recording, clip interval, answer, license, or final selection is inferred from the nine private candidates. Use synthetic, clearly labeled demo media for tests and preview. Playback starts with a host or TV user gesture; browser autoplay is not reliable.

## Acceptance path

| Before | Host action | Saved result and accounting | Host / TV / phone |
| --- | --- | --- | --- |
| Prepared, unused music cell | Select cell | Existing selected-cell record; no award | Host sees private answer and playback controls; TV sees clue and player; phone sees only team/buzzer status |
| Selected music cell | Host or TV user presses play | No saved playback state or ledger change | Host and TV each get an independent native player; each can pause/restart locally; phone gets no media URL |
| Playing or paused | Arm, buzz, judge, reveal | Reuse existing buzzer, award, undo, finish receipts | Host judges spoken title; TV answer appears only on reveal; phone never gets answer or track metadata |
| Finished cell | Reload, retry stale command, advance | Cell stays used; duplicate award cannot credit again | All three roles reconstruct authoritative board and score |

A prepared music cell requires a validated local media reference, declared clip start/end and host answer. An incomplete event cell remains unavailable. Host and display requests for an audio asset must be scoped to the current room and selected clue; no raw filesystem path or private candidate list enters public snapshots or bundles. Do not expose event files through `public/` or a general static directory. Selecting the cell uses the existing host command, request ID and phase-instance guards; audio GETs are separately authorized and require that cell to remain selected in the current Trivia phase. Playback position and play/pause are local browser presentation state: the server does not synchronize host and TV players or persist playback across reloads. Preserve ordinary trivia scoring and later stages.

## Verification

Add synthetic media fixture, schema validation and normal-module tests for available/unavailable cells, host/TV audio authorization, stale selected cells, byte-range requests, answer and media privacy, buzzer/award/undo/finish, and legacy board behavior. Run format, typecheck, focused and full tests, build and disposable host/TV/phone preview. Use the party simulator if the feature changes sequence behavior. Record exact evidence and limits in `docs/plan.md`.
