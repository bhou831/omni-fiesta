import React from 'react';
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
  const remaining = state.limit - state.spins.length;
  const canSpin = open && remaining > 0 && spendable >= state.cost && !disabled;
  return (
    <section aria-label="Slots">
      <h2>Try your luck</h2>
      <p>
        Each spin costs {state.cost} tokens. You can spin up to {state.limit} times.
      </p>
      <p>
        {remaining} {remaining === 1 ? 'spin' : 'spins'} remaining
        {revealBalance ? ` · ${spendable} tokens available` : ''}
      </p>
      <button
        className="button primary"
        disabled={!canSpin}
        onClick={() => void command('phase.action', { action: 'spin' })}
      >
        Spin for {state.cost} tokens
      </button>
      {!open ? (
        <p>Time’s up. Waiting for the host.</p>
      ) : remaining > 0 && spendable < state.cost ? (
        <p>Not enough available tokens for another spin.</p>
      ) : null}
      {latest && (
        <div key={latest.id} className="slot-result" role="status" aria-live="polite">
          <strong>{latest.gross} tokens returned</strong>
          <p>
            Net change: {latest.net > 0 ? '+' : ''}
            {latest.net} tokens.
          </p>
        </div>
      )}
      {state.spins.length > 0 && (
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
      <style>{`@keyframes slot-reveal { from { opacity: .35; transform: translateY(4px) } to { opacity: 1; transform: translateY(0) } } .slot-result { animation: slot-reveal .35s ease-out } @media (prefers-reduced-motion: reduce) { .slot-result { animation: none } }`}</style>
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
