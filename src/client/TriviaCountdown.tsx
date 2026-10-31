import React, { useEffect, useState } from 'react';

export function useTriviaRemaining({
  deadlineAt,
  pausedRemainingMs = null,
  clockOffset = 0,
}: {
  deadlineAt: number | null;
  pausedRemainingMs?: number | null;
  clockOffset?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (deadlineAt === null || pausedRemainingMs !== null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadlineAt, pausedRemainingMs]);
  return deadlineAt === null ? null : (pausedRemainingMs ?? deadlineAt - now - clockOffset);
}

/** Render the server clock; pausing never changes a browser-local deadline. */
export function TriviaCountdown(props: {
  deadlineAt: number | null;
  pausedRemainingMs?: number | null;
  clockOffset?: number;
  className?: string;
}) {
  const remaining = useTriviaRemaining(props);
  if (remaining === null) return null;
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  return (
    <p className={props.className} role="timer">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      {props.pausedRemainingMs != null && <span> · 已暂停</span>}
    </p>
  );
}
