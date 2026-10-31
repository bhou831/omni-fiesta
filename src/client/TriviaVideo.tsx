import { useEffect, useRef, useState } from 'react';

export type VideoPlayback = { playing: boolean; position: number; changedAt: number };

/** Playback follows server state; native TV controls cannot diverge from the host. */
export function TriviaVideo({
  src,
  playback,
  host = false,
  clockOffset = 0,
  disabled = false,
  onHost,
}: {
  src: string;
  playback: VideoPlayback;
  host?: boolean;
  clockOffset?: number;
  disabled?: boolean;
  onHost?: (action: string, data?: Record<string, unknown>) => Promise<void>;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [now, setNow] = useState(Date.now());
  const positionAt = (time: number) =>
    Math.max(
      0,
      playback.position +
        (playback.playing ? Math.max(0, time + clockOffset - playback.changedAt) / 1000 : 0),
    );
  const ended = duration > 0 && positionAt(now) >= duration;
  useEffect(() => {
    setNow(Date.now());
    if (!playback.playing) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [playback.playing, playback.position, playback.changedAt]);
  const syncPlayback = () => {
    const video = ref.current;
    if (!video || video.readyState === 0) return;
    const target = Math.min(video.duration || Infinity, positionAt(Date.now()));
    if (Math.abs(video.currentTime - target) > 0.3) video.currentTime = target;
    if (playback.playing && target < video.duration) {
      void video
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    } else video.pause();
  };
  useEffect(syncPlayback, [
    src,
    playback.playing,
    playback.position,
    playback.changedAt,
    clockOffset,
    duration,
    sound,
  ]);
  return (
    <section className="trivia-video-playback" aria-label="视频播放">
      <video
        ref={ref}
        className="trivia-question-video"
        src={src}
        muted={host || !sound}
        playsInline
        preload="metadata"
        aria-label="题目视频"
        onLoadedMetadata={() => {
          setDuration(ref.current?.duration ?? 0);
          syncPlayback();
        }}
        onError={() => setBlocked(true)}
      />
      {host && onHost && (
        <div className="actions">
          <button
            className="button primary"
            disabled={disabled}
            onClick={() =>
              void onHost(playback.playing && !ended ? 'video-stop' : 'video-start', {
                restart: ended,
              })
            }
          >
            {playback.playing && !ended ? '暂停大屏视频' : ended ? '重播大屏视频' : '播放大屏视频'}
          </button>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => void onHost('video-start', { restart: true })}
          >
            从头播放
          </button>
          <span className="fine-print">本机静音预览；声音由大屏幕播放。</span>
        </div>
      )}
      {!host && (!sound || blocked) && (
        <button
          className="button secondary"
          onClick={() => {
            const video = ref.current;
            setSound(true);
            if (video) {
              video.muted = false;
              if (playback.playing && !ended)
                void video
                  .play()
                  .then(() => setBlocked(false))
                  .catch(() => setBlocked(true));
            }
          }}
        >
          启用大屏视频声音
        </button>
      )}
      {blocked && <p role="status">视频未能播放，请检查媒体加载或点击启用大屏声音。</p>}
    </section>
  );
}
