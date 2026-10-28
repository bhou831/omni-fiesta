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
        <p>
          {state.winner.emoji} {state.winner.name} receives {state.winner.award} tokens!
        </p>
      ) : (
        <>
          <div className="classified-stamp" aria-hidden="true">
            CLASSIFIED
          </div>
          <p className="calling-signal">
            ☎ Incoming call
            <span className="signal-dots" aria-hidden="true">
              …
            </span>
          </p>
          <p>Keep the ringer on. The host has the file.</p>
        </>
      )}
    </section>
  );
}
export function SomebodyCallingDisplay({ state }: { state: CallingPublicState }) {
  return <SomebodyCallingPlayer state={state} />;
}
