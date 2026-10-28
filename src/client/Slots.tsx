import React, { useEffect, useRef, useState } from 'react';
import { GAME_MOTION, useReducedMotion } from './game-motion.js';
import type { Command } from '../shared/contracts.js';
import type { SlotsDisplayState, SlotsHostState, SlotsPlayerState } from '../server/games/slots.js';

export interface SlotsPlayerProps {
  state: SlotsPlayerState;
  spendable: number;
  revealBalance?: boolean;
  open: boolean;
  disabled: boolean;
  command: (type: Command['type'], payload?: Command['payload']) => Promise<void>;
}
/** Every displayed result is a committed server result, including after a reload. */
export function SlotsPlayer({
  state,
  spendable,
  revealBalance = false,
  open,
  disabled,
  command,
}: SlotsPlayerProps) {
  const latest = state.spins.at(-1);
  const [presented, setPresented] = useState(latest);
  const [requesting, setRequesting] = useState(false);
  const requestLock = useRef(false);
  const pullStart = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const reduced = useReducedMotion();
  const spinning = requesting || latest?.id !== presented?.id;
  useEffect(() => {
    if (latest?.id === presented?.id) return;
    const finish = () => setPresented(latest);
    if (reduced || document.hidden) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, GAME_MOTION.slotMs);
    const visibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [latest?.id, presented?.id, reduced]);
  const remaining = state.limit - state.spins.length;
  const canSpin = open && remaining > 0 && spendable >= state.cost && !disabled && !spinning;
  const spin = async () => {
    if (!canSpin || requestLock.current) return;
    requestLock.current = true;
    setRequesting(true);
    try {
      await command('phase.action', { action: 'spin' });
    } finally {
      requestLock.current = false;
      setRequesting(false);
    }
  };
  const symbols =
    !presented || presented.gross === 0
      ? ['🍒', '🔔', '★']
      : Array(3).fill(presented.gross >= 500 ? '★' : presented.gross >= 300 ? '🔔' : '🍒');
  return (
    <section aria-label="Slots" className="game-panel">
      <h2>Try your luck</h2>
      <p>
        Each spin costs {state.cost} tokens. You can spin up to {state.limit} times.
      </p>
      <p>
        {remaining} {remaining === 1 ? 'spin' : 'spins'} remaining
        {revealBalance ? ` · ${spendable} tokens available` : ''}
      </p>
      <div className={`slot-machine ${spinning ? 'is-spinning' : ''}`} aria-busy={spinning}>
        <div className="slot-cabinet">
          <span className="eyebrow">Tracy’s lucky three</span>
          <div className="slot-reels" aria-hidden="true">
            {symbols.map((symbol, i) => (
              <div className="slot-window" key={i} style={{ animationDelay: `${i * 120}ms` }}>
                {spinning ? (
                  <div className="slot-strip">
                    <span>🍒</span>
                    <span>🔔</span>
                    <span>★</span>
                    <span>🍒</span>
                  </div>
                ) : (
                  <span className="slot-symbol">{symbol}</span>
                )}
              </div>
            ))}
          </div>
          <span className="slot-caption">
            {spinning
              ? 'Spinning…'
              : remaining === 0
                ? 'All spins played'
                : 'Pull down or tap the handle'}
          </span>
        </div>
        <button
          className="slot-handle"
          disabled={!canSpin}
          aria-label={`Pull handle to spin for ${state.cost} tokens`}
          onPointerDown={(e) => {
            suppressClick.current = false;
            pullStart.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            if (pullStart.current !== null && e.clientY - pullStart.current >= 24) {
              suppressClick.current = true;
              void spin();
            }
            pullStart.current = null;
          }}
          onPointerCancel={() => {
            pullStart.current = null;
          }}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            void spin();
          }}
        >
          <span className="handle-track" aria-hidden="true">
            <span className="handle-knob" />
          </span>
          <span className="handle-label">Pull ↓</span>
        </button>
      </div>
      <button
        className="button primary spin-button"
        disabled={!canSpin}
        onClick={() => void spin()}
      >
        {spinning ? 'Spinning…' : `Spin · ${state.cost} tokens`}
      </button>
      <p className="slot-status" role="status" aria-live="polite">
        {spinning
          ? 'Good luck…'
          : presented
            ? `${presented.gross} tokens returned · Net ${presented.net > 0 ? '+' : ''}${presented.net} tokens.`
            : 'Ready when you are. Playing is optional.'}
      </p>
      {!open ? (
        <p>Time’s up. Waiting for the host.</p>
      ) : remaining > 0 && spendable < state.cost ? (
        <p>Not enough available tokens for another spin.</p>
      ) : null}
      {state.spins.length > 0 && !spinning && (
        <details>
          <summary>Your spin history</summary>
          {state.spins.map((spin) => (
            <p key={spin.id}>
              Spin {spin.attempt}: {spin.gross} returned · net {spin.net > 0 ? '+' : ''}
              {spin.net}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
export function SlotsHost({ state }: { state: SlotsHostState }) {
  return (
    <section>
      <h3>Slots</h3>
      <p>
        {state.acceptedSpins} spins accepted · {state.cost} tokens per spin · {state.limit} maximum
        per player.
      </p>
      <p>Each result is saved immediately. Close the round or wait for the timer.</p>
    </section>
  );
}
export function SlotsDisplay({ state }: { state: SlotsDisplayState }) {
  return (
    <section>
      <h2>Feeling lucky?</h2>
      <p>
        Spin on your phone for {state.cost} tokens each, up to {state.limit} times. Playing is
        optional.
      </p>
    </section>
  );
}
