/** Positions are relative to the clip start and anchored to server snapshot time. */
export function triviaPlaybackPosition(
  playback: { playing: boolean; position: number; changedAt: number },
  now: number,
  clockOffset: number,
  duration: number,
) {
  const elapsed = playback.playing ? Math.max(0, now + clockOffset - playback.changedAt) / 1000 : 0;
  return Math.max(0, Math.min(duration, playback.position + elapsed));
}
