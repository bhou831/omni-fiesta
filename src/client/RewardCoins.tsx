import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from './game-motion.js';
export function RewardCoins({
  cue,
  blocked,
}: {
  cue: { id: number; kind: string } | null;
  blocked: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const consumed = useRef(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!cue) {
      setVisible(false);
      return;
    }
    if (blocked) {
      setVisible(false);
      return;
    }
    if (cue.id <= consumed.current) return;
    if (document.hidden) {
      consumed.current = cue.id;
      return;
    }
    // Let the game report its presentation state before showing the acknowledgment.
    const start = setTimeout(() => {
      consumed.current = cue.id;
      setVisible(true);
    }, 100);
    const end = setTimeout(() => setVisible(false), 1300);
    const hide = () => {
      if (document.hidden) {
        consumed.current = cue.id;
        setVisible(false);
        clearTimeout(start);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [cue, blocked]);
  return (
    <div className="reward-coins" role="status" aria-live="polite" aria-atomic="true">
      {visible && (
        <>
          <span className="sr-only">Tokens received</span>
          {reduced ? (
            <span className="reward-received">✓ Tokens received</span>
          ) : (
            <span key={cue?.id} aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <i
                  key={i}
                  style={
                    {
                      '--coin-x': `${(i - 1.5) * 12}px`,
                      '--coin-delay': `${i * 90}ms`,
                    } as CSSProperties
                  }
                >
                  💸
                </i>
              ))}
            </span>
          )}
        </>
      )}
    </div>
  );
}
