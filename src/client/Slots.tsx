import React, { useEffect, useRef, useState } from 'react';
import { GAME_MOTION, useReducedMotion } from './game-motion.js';
import type { Command } from '../shared/contracts.js';
import type { SlotsHostState, SlotsPlayerState } from '../server/games/slots.js';

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
  const [landed, setLanded] = useState<{ id: string | undefined; count: number }>({
    id: undefined,
    count: 0,
  });
  const requestLock = useRef(false);
  const pullStart = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const reduced = useReducedMotion();
  const spinning = requesting || latest?.id !== presented?.id;
  useEffect(() => {
    if (latest?.id === presented?.id) return;
    const finish = () => {
      setLanded({ id: latest?.id, count: 3 });
      setPresented(latest);
    };
    if (reduced || document.hidden) {
      finish();
      return;
    }
    setLanded({ id: latest?.id, count: 0 });
    const timers = [0, 1, 2].map((index) =>
      window.setTimeout(
        () => setLanded({ id: latest?.id, count: index + 1 }),
        GAME_MOTION.slotMs - (2 - index) * 300,
      ),
    );
    const timer = window.setTimeout(finish, GAME_MOTION.slotMs);
    const visibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      timers.forEach(clearTimeout);
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
  // Symbols are illustrative only: the saved gross and net, not a visual tier, define the result.
  const symbolsFor = (gross: number | undefined) =>
    gross && gross >= 500
      ? ['7', '7', '7']
      : gross && gross >= 300
        ? ['◆', '◆', '◆']
        : gross && gross > 0
          ? ['●', '●', '★']
          : ['●', '◆', '★'];
  const revealing = latest?.id !== presented?.id;
  const netLabel = (net: number) => (net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '0');
  return (
    <section aria-label="Slots" className="game-panel">
      <p>
        Each spin costs {state.cost} tokens. You can spin up to {state.limit} times.
      </p>
      <p>
        {remaining} {remaining === 1 ? 'spin' : 'spins'} remaining
        {revealBalance ? ` · ${spendable} tokens available` : ''}
      </p>
      <div
        className={`slot-machine ${spinning ? 'is-spinning' : ''} ${spinning && landed.count > 0 ? 'is-settling' : ''}`}
        aria-busy={spinning}
      >
        <div className="slot-cabinet">
          <span className="eyebrow">Slots</span>
          <div className="slot-reels" aria-hidden="true">
            {[0, 1, 2].map((i) => {
              const stopped = revealing && landed.id === latest?.id && i < landed.count;
              const rolling = revealing ? !stopped : requesting;
              const symbol = symbolsFor(stopped ? latest?.gross : presented?.gross)[i];
              return (
                <div className="slot-window" key={i}>
                  {rolling ? (
                    <div className="slot-strip">
                      <span>7</span>
                      <span>◆</span>
                      <span>●</span>
                      <span>7</span>
                    </div>
                  ) : (
                    <span className="slot-symbol" key={stopped ? latest?.id : presented?.id}>
                      {symbol}
                    </span>
                  )}
                </div>
              );
            })}
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
          onPointerMove={(e) => {
            if (pullStart.current !== null)
              e.currentTarget.style.setProperty(
                '--pull',
                `${Math.min(56, Math.max(0, e.clientY - pullStart.current))}px`,
              );
          }}
          onPointerUp={(e) => {
            e.currentTarget.style.setProperty('--pull', '0px');
            if (pullStart.current !== null && e.clientY - pullStart.current >= 24) {
              suppressClick.current = true;
              void spin();
            }
            pullStart.current = null;
          }}
          onPointerCancel={(e) => {
            e.currentTarget.style.setProperty('--pull', '0px');
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
        </button>
      </div>
      <button
        className="button secondary spin-button"
        disabled={!canSpin}
        onClick={() => void spin()}
      >
        {spinning ? 'Spinning…' : `Spin · ${state.cost} tokens`}
      </button>
      <div className="slot-status" role="status" aria-live="polite" aria-atomic="true">
        {spinning ? (
          'Spinning…'
        ) : presented ? (
          <div
            key={presented.id}
            className={`slot-payout ${presented.gross > 0 ? 'is-return' : 'is-miss'}`}
          >
            <strong>
              {presented.gross > 0 ? `${presented.gross} tokens returned` : 'No tokens returned'}
            </strong>
            <span>Net {netLabel(presented.net)} tokens</span>
          </div>
        ) : (
          'Playing is optional.'
        )}
      </div>
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
              Spin {spin.attempt}: {spin.gross} returned · net {netLabel(spin.net)}
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
