import React from 'react';
import type { RoomSnapshot } from '../shared/contracts.js';

/** One public instruction per round. Details and outcomes belong to the game view below. */
export function RoundDescription({ state }: { state: RoomSnapshot }) {
  switch (state.room.phase) {
    case 'investments':
      return (
        <p className="round-rules">
          📈 You’re the quant. Research five assets, pick one and invest up to{' '}
          {state.investments?.cap} tokens—or sit this one out. Returns get a{' '}
          {state.investments?.multiplier}× boost; your stake stays locked until the closing bell.
        </p>
      );
    case 'costume':
      if (state.costume?.revealed)
        return (
          <p className="round-rules">
            🎁 The votes are in. Give tonight’s best dressed a round of applause!
          </p>
        );
      return (
        <div className="round-rules">
          <p>
            🎁 Look around. Pick your favorite costume on your phone. One vote
            {state.costume?.allowSelfVote ? '.' : ', no voting for yourself.'}
          </p>
          <p className="prize-line">
            {state.costume?.prizes
              .map(
                (p) =>
                  `${p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : '🥉'} ${p.tokens.toLocaleString()}`,
              )
              .join('   ·   ')}{' '}
            tokens per person. Tied? Everyone in that place gets the full prize.
          </p>
          {!!state.costume?.lastPlacePenaltyPool && (
            <p className="rules-footnote">
              Last place shares a {state.costume.lastPlacePenaltyPool}-token penalty, unless it also
              wins a prize. Only available tokens can be deducted.
            </p>
          )}
        </div>
      );
    case 'trivia':
      return (
        <p className="round-rules">
          🧠 Team up and answer questions about Tracy! Buzz first on your phone to give your team
          the floor.
        </p>
      );
    case 'slots':
      return (
        <p className="round-rules">
          🎰 Casino night, Venetian style. Pull the handle on your phone and see what lands.{' '}
          {state.slots?.role === 'display'
            ? `${state.slots.data.cost} tokens a spin · up to ${state.slots.data.limit} spins. `
            : ''}
          Feeling sensible? Sitting out is allowed.
        </p>
      );
    case 'powerball':
      if (state.powerball?.revealed)
        return <p className="round-rules">🎟️ Tickets in. Let the balls decide.</p>;
      return (
        <p className="round-rules">
          🎟️ A little county-fair luck. Pick red or blue and save your bet on your phone. The
          winning side shares the losing side’s pot in proportion to its stakes.
        </p>
      );
    case 'investment-review':
      return (
        <p className="round-rules">
          🔔 Markets closed. Who made the call? Here’s how the five assets moved, with{' '}
          {state.investments?.multiplier}× returns for tonight’s quants.
        </p>
      );
    case 'somebody-calling':
      return (
        <p className="round-rules">
          ☎️ An unidentified caller. One classified selection. Keep your phone close… everyone is
          entered for free.
        </p>
      );
    case 'lobby':
      return <p>Join on your phone. We’ll start when everyone’s here.</p>;
    case 'connection-check':
      return <p>Tap “Check in” on your phone.</p>;
    case 'finish':
      return <p>🎈 Ten thousand days of Tracy. One excellent night.</p>;
  }
}
