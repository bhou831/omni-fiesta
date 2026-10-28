import React, { useState } from 'react';
import type { PowerballColor, PowerballProjection } from '../server/games/powerball.js';
import type { PublicPlayer } from '../shared/contracts.js';

export interface PowerballViewProps {
  state: PowerballProjection;
  players: PublicPlayer[];
  spendable: number;
  revealBalance?: boolean;
  open: boolean;
  disabled: boolean;
  onBet: (color: PowerballColor, amount: number) => void;
  onCancel: () => void;
  onDraw: () => void;
  onReveal: () => void;
}
export function PowerballPlayer(props: PowerballViewProps) {
  const [color, setColor] = useState<PowerballColor>(props.state.ownBet?.color ?? 'red');
  const [amount, setAmount] = useState(String(props.state.ownBet?.amount ?? ''));
  const bet = props.state.ownBet;
  return (
    <section>
      <h2>Red or blue</h2>
      {props.state.revealed ? (
        <>
          <p>The draw is {props.state.winningColor}.</p>
          {bet ? (
            <p>
              Your {bet.amount}-token {bet.color} bet returned {bet.payout} tokens.
            </p>
          ) : (
            <p>You did not place a bet.</p>
          )}
        </>
      ) : (
        <>
          <p>
            {props.open
              ? 'Choose a side and a whole-token stake. Your stake is reserved until the draw.'
              : 'Betting is closed. Wait for the host to reveal the draw.'}
          </p>
          {bet && (
            <p>
              Saved: {bet.amount} tokens on {bet.color}.
            </p>
          )}
          <p>
            {props.revealBalance
              ? `Available: ${props.spendable} tokens${bet ? ` plus ${bet.amount} currently reserved` : ''}.`
              : 'Available balance hidden. Tap Tokens to reveal it.'}
          </p>
          <label>
            Side{' '}
            <select
              value={color}
              disabled={props.disabled || !props.open}
              onChange={(e) => setColor(e.target.value as PowerballColor)}
            >
              <option value="red">Red</option>
              <option value="blue">Blue</option>
            </select>
          </label>
          <label>
            Stake{' '}
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              disabled={props.disabled || !props.open}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={props.disabled || !props.open}
            onClick={() => props.onBet(color, Number(amount))}
          >
            Save bet
          </button>
          {bet && (
            <button
              className="button secondary"
              disabled={props.disabled || !props.open}
              onClick={props.onCancel}
            >
              Cancel bet
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function PowerballHost(props: PowerballViewProps) {
  return (
    <section>
      <h3>Powerball</h3>
      <p>{props.state.hostBets?.length ?? 0} bets reserved.</p>
      {props.state.hostBets?.map((bet) => (
        <p key={bet.playerId}>
          {props.players.find((p) => p.id === bet.playerId)?.name}: {bet.amount} on {bet.color}
          {bet.payout === null ? '' : ` · returned ${bet.payout}`}
        </p>
      ))}
      {props.state.revealed ? (
        <p>Draw: {props.state.winningColor}</p>
      ) : !props.state.drawn ? (
        <button
          className="button secondary"
          disabled={props.disabled || props.open}
          onClick={props.onDraw}
        >
          Draw privately
        </button>
      ) : (
        <button
          className="button secondary"
          disabled={props.disabled || props.open}
          onClick={props.onReveal}
        >
          Reveal and settle
        </button>
      )}
    </section>
  );
}
export function PowerballDisplay({ state }: Pick<PowerballViewProps, 'state'>) {
  return (
    <section>
      <h2>Red or blue</h2>
      <p>
        {state.revealed
          ? `The draw is ${state.winningColor}.`
          : state.drawn
            ? 'The draw is saved. Waiting for the host to reveal it.'
            : 'Choose your side on your phone.'}
      </p>
    </section>
  );
}
