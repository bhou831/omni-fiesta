# 听歌识曲 implementation plan

## Scope and assumptions

Implement a host-led audio clue in the existing Trivia board, using approved iTunes preview URLs as the preferred source and confined local WAV files as a fallback. The example at bowen-hou.com/music/ uses native HTML audio with an iTunes preview URL; no player package is needed. No event track, recording, clip interval, answer, license, or final selection is inferred from the nine private candidates. Use synthetic, clearly labeled demo media for tests and preview. Playback starts with a host or TV user gesture; browser autoplay is not reliable.

## Acceptance path

| Before                      | Host action                          | Saved result and accounting                                             | Host / TV / phone                                                                                                                |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Prepared, unused music cell | Select cell                          | Existing selected-cell record; no award                                 | Host sees private answer and playback controls; TV sees clue and player; phone sees only team/buzzer status                      |
| Selected music cell         | Host starts or ends preview          | Server stores current playing state and clip position; no ledger change | TV follows host start/stop and resumes from the authoritative position; only host has playback controls; phone gets no media URL |
| Playing or paused           | Arm, buzz, judge, reveal             | Reuse existing buzzer, award, undo, finish receipts                     | Host judges spoken title; TV answer appears only on reveal; phone never gets answer or track metadata                            |
| Finished cell               | Reload, retry stale command, advance | Cell stays used; duplicate award cannot credit again                    | All three roles reconstruct authoritative board and score                                                                        |

A prepared music cell requires a validated local media reference or Apple preview URL, declared clip bounds and host answer. Apple preview entries additionally require exact catalog metadata and the full 30-second preview. An incomplete event cell remains unavailable. Host and display requests for an audio asset must be scoped to the current room and selected clue; no raw filesystem path or private candidate list enters public snapshots or bundles. Do not expose event files through `public/` or a general static directory. Host commands use the existing request-ID and phase-instance guards. Only the host can start/stop; the server persists playback state and position. The TV follows the saved state after a user enables audio once, to accommodate autoplay restrictions. Phones never get board/audio metadata. The visible iTunes attribution and Apple Music link appear on host/TV; answer metadata is host-only until the public reveal. Preserve ordinary trivia scoring and later stages.

## Verification

Add synthetic media fixture, schema validation and normal-module tests for available/unavailable cells, host/TV audio authorization, stale selected cells, byte-range requests, answer and media privacy, buzzer/award/undo/finish, and legacy board behavior. Run format, typecheck, focused and full tests, build and disposable host/TV/phone preview. Use the party simulator if the feature changes sequence behavior. Record exact evidence and limits in `docs/plan.md`.

## Event music and source constraints (2026-10-30)

The user selected exact recordings for the five event music cells. IDs, answers, store URLs, and preview URLs are kept only in the ignored local event bank; this tracked plan does not reproduce them. These selections are technically playable from the Apple catalog, using the entire 30-second preview.

Apple's developer terms limit preview assets to promotion of the underlying content and say they must not be used for independent entertainment value. A song-identification game provides entertainment value; attribution and a nearby store link do not grant that use. These selections therefore remain technically implemented but **not rights-cleared or approved for party use**. Resolve the rights/use question or select a licensed source before treating them as ready. See [Apple iTunes Search API terms](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) and [Apple Developer Program License Agreement, section F](https://developer.apple.com/support/terms/).
