import React from 'react';
import type { Command } from '../shared/contracts.js';
import type { CallingHostState, CallingPublicState } from '../server/games/somebody-calling.js';

type HostProps = {
  state: CallingHostState;
  disabled: boolean;
  command: (type: Command['type'], payload?: Command['payload']) => Promise<void>;
};
export function SomebodyCallingHost({ state, disabled, command }: HostProps) {
  return (
    <section>
      <h3>Somebody’s calling</h3>
      <p>All joined players are included, even if they are disconnected. Entry is free.</p>
      {!state.drawn ? (
        <button
          className="button primary"
          disabled={disabled}
          onClick={() => void command('phase.host', { action: 'draw' })}
        >
          Draw a player
        </button>
      ) : (
        <>
          <p>
            <strong>
              {state.selected?.emoji} {state.selected?.name}
            </strong>{' '}
            · {state.selected?.phone}
          </p>
          <p>Call this player privately, then reveal to everyone.</p>
          <button
            className="button primary"
            disabled={disabled || state.revealed}
            onClick={() => void command('phase.host', { action: 'reveal' })}
          >
            {state.revealed ? 'Revealed' : `Reveal and award ${state.award} tokens`}
          </button>
        </>
      )}
    </section>
  );
}
export function SomebodyCallingPlayer({ state }: { state: CallingPublicState }) {
  return (
    <section className="calling-brief" aria-live="polite">
      {state.revealed && state.winner ? (
        <div className="calling-result">
          <span className="result-label">The call goes to</span>
          <p className="calling-signal">
            {state.winner.emoji} {state.winner.name}
          </p>
          <p className="calling-award">+{state.winner.award.toLocaleString()} tokens</p>
        </div>
      ) : (
        <>
          <svg
            className="phone-mark"
            viewBox="0 0 64 64"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <rect x="18" y="6" width="28" height="52" rx="6" />
            <path d="M27 12h10M29 51h6M9 23v18M55 23v18" strokeLinecap="round" />
          </svg>
          <p className="calling-signal">
            Waiting for the call
            <span className="signal-dots" aria-hidden="true">
              …
            </span>
          </p>
          <p>Keep your phone’s ringer on.</p>
        </>
      )}
    </section>
  );
}
export function SomebodyCallingDisplay({ state }: { state: CallingPublicState }) {
  return <SomebodyCallingPlayer state={state} />;
}
