import React, { type ReactNode } from 'react';
import type { RoomSnapshot } from '../shared/contracts.js';

function Rules({ children }: { children: ReactNode }) {
  return <ul className="round-rules rule-list">{children}</ul>;
}
function Rule({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return (
    <li className={quiet ? 'rule-note' : ''}>
      <span>{children}</span>
    </li>
  );
}

/** Short, separately scannable rules; each game view owns its results. */
export function RoundDescription({ state }: { state: RoomSnapshot }) {
  switch (state.room.phase) {
    case 'investments':
      return (
        <Rules>
          <Rule>Research the five assets.</Rule>
          <Rule>
            Pick any · up to <strong>{state.investments?.cap} tokens</strong> in total.
          </Rule>
          <Rule>{state.investments?.multiplier}× returns · lose no more than your stake.</Rule>
          <Rule>Locked until the closing bell.</Rule>
          <Rule>Investing is optional.</Rule>
        </Rules>
      );
    case 'costume':
      if (state.costume?.locked)
        return (
          <Rules>
            <Rule>Votes are in.</Rule>
            <Rule>Winners are announced later tonight.</Rule>
          </Rules>
        );
      if (state.costume && state.costume.round > 1)
        return (
          <Rules>
            <Rule>Tied for first.</Rule>
            <Rule>Vote again between these players.</Rule>
          </Rules>
        );
      return (
        <Rules>
          <Rule>Pick your favorite costume.</Rule>
          <Rule>One vote{state.costume?.allowSelfVote ? '.' : ' · no voting for yourself.'}</Rule>
          <Rule>
            {state.costume?.prizes
              .map(
                (p) =>
                  `${p.place === 1 ? '1st' : p.place === 2 ? '2nd' : '3rd'} ${p.tokens.toLocaleString()}`,
              )
              .join(' · ')}{' '}
            tokens each.
          </Rule>
          <Rule>Tied players each receive the full prize.</Rule>
          {!!state.costume?.lastPlacePenaltyPool && (
            <Rule quiet>
              Last place shares a {state.costume.lastPlacePenaltyPool}-token penalty. Prize winners
              exempt; limited to available tokens.
            </Rule>
          )}
        </Rules>
      );
    case 'costume-reveal':
      return (
        <Rules>
          <Rule>Tonight’s best dressed.</Rule>
          <Rule>Winners are announced one place at a time.</Rule>
        </Rules>
      );
    case 'trivia':
      return (
        <Rules>
          <Rule>Play with your team.</Rule>
          <Rule>Buzz first on your phone.</Rule>
          <Rule>Answer questions about Tracy!</Rule>
        </Rules>
      );
    case 'slots': {
      const slots = state.slots?.role === 'display' ? state.slots.data : null;
      return (
        <Rules>
          <Rule>{slots?.cost} tokens a spin.</Rule>
          <Rule>Max {slots?.limit} spins.</Rule>
          <Rule>Joining is optional.</Rule>
        </Rules>
      );
    }
    case 'powerball':
      return state.powerball?.revealed ? (
        <Rules>
          <Rule>Bets are in.</Rule>
        </Rules>
      ) : (
        <Rules>
          <Rule>Pick red or blue.</Rule>
          <Rule>Set your stake and save your bet.</Rule>
          <Rule>Winners split the losing pot in proportion to their stakes.</Rule>
        </Rules>
      );
    case 'investment-review':
      return (
        <Rules>
          <Rule>
            {state.investments?.refunded
              ? 'Market prices were unavailable · every stake returned in full.'
              : `Investment results · ${state.investments?.multiplier}× market returns.`}
          </Rule>
        </Rules>
      );
    case 'somebody-calling':
      return (
        <Rules>
          <Rule>Keep your ringer on.</Rule>
          <Rule>Everyone is entered for free.</Rule>
        </Rules>
      );
    case 'lobby':
      return <p>Join on your phone. We’ll start when everyone’s here.</p>;
    case 'connection-check':
      return <p>Tap “Check in” on your phone.</p>;
    case 'finish':
      return <p>Thanks for celebrating with Tracy.</p>;
  }
}
