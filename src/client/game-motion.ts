import { useEffect, useState } from 'react';

// Presentation timing only. Server timers, draws and accounting are independent.
export const GAME_MOTION = { slotMs: 2400, powerballMs: 5000 } as const;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Animate a newly received reveal; a reload/late join shows the saved result immediately. */
export function useDrawPresentation(revealed: boolean) {
  const [complete, setComplete] = useState(revealed);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!revealed) {
      setComplete(false);
      return;
    }
    if (complete) return;
    const finish = () => setComplete(true);
    if (reduced || document.hidden) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, GAME_MOTION.powerballMs);
    const visibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [revealed, complete, reduced]);
  return { animating: revealed && !complete, complete: revealed && complete };
}
