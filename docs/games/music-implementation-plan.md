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

## Event music drafts and source constraints (2026-10-30)

The first candidate in each of the five event music cells is recorded locally as a **draft choice** in that cell's private host notes. All nine candidate strings remain available in the ignored event bank. These are not playable selections: each cell remains unavailable until the exact track/version, clip bounds, playable source, and applicable rights are confirmed. The host notes contain only the candidate position and draft/pending status, not duplicate track metadata.

Source review: Apple Music/iTunes preview assets are excluded as game audio. Apple's developer agreement limits preview use to promotion of the underlying content and says previews must not be used for independent entertainment value; an Apple preview URL being technically playable does not satisfy this event's use. See [Apple Developer Program License Agreement, section F](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/). Spotify's Web Playback SDK is also not a fit for this game flow: Spotify requires a Premium account and its developer guidance says Spotify content may not be used for non-interactive broadcasting or synchronized with visual media. See [Spotify Web Playback SDK getting started](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started). A YouTube embed can preserve its official player, but requires the visible compliant player and its playback constraints; it does not itself establish permission for a particular recording or version. See [YouTube embedded player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality). The implementation currently supports only a safe local WAV basename or an allowlisted Apple preview URL, so no current supported source is cleared for these game cells. A licensed/commissioned recording or an exact, rights-verified public-domain recording with explicit permission for this use would require choosing its version and clip, then updating the implementation's source support if it is not a local WAV. No content source or legal conclusion is inferred here.
