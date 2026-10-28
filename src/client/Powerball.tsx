import React, { useState } from 'react';
import type { PowerballColor, PowerballProjection } from '../server/games/powerball.js';
import type { PublicPlayer } from '../shared/contracts.js';
import { GAME_MOTION, useDrawPresentation } from './game-motion.js';

function BallMachine({
  state,
  animating,
  complete,
}: {
  state: PowerballProjection;
  animating: boolean;
  complete: boolean;
}) {
  const color = complete ? state.winningColor : null;
  return (
    <div
      className={`ball-machine ${animating ? 'is-drawing' : ''} ${complete ? 'is-revealed' : ''}`}
      aria-busy={animating}
    >
      <div className="ball-box" aria-hidden="true">
        <span className="box-label">Red or blue?</span>
        <div className="mixing-balls">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={`mixing-ball ${i % 2 ? 'blue' : 'red'}`} />
          ))}
        </div>
        <span className="ball-door" />
      </div>
      <div className="ball-ramp" aria-hidden="true">
        {color && <span className={`drawn-ball ${color}`}>{color === 'red' ? 'R' : 'B'}</span>}
      </div>
      <p className="draw-status" role="status" aria-live="polite">
        {animating
          ? 'Mixing the balls…'
          : color
            ? `${color === 'red' ? 'Red' : 'Blue'}!`
            : state.drawn
              ? 'Ready for the host’s reveal.'
              : 'Pick a color. Take a chance.'}
      </p>
    </div>
  );
}

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
  const presentation = useDrawPresentation(props.state.revealed);
  const [color, setColor] = useState<PowerballColor>(props.state.ownBet?.color ?? 'red');
  const [amount, setAmount] = useState(String(props.state.ownBet?.amount ?? ''));
  const bet = props.state.ownBet;
  return (
    <section className="game-panel" aria-label="Red or blue">
      <BallMachine state={props.state} {...presentation} />
      {presentation.complete ? (
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
      ) : props.state.revealed ? (
        <p>The result is on its way…</p>
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
          <div className="color-choices" role="group" aria-label="Choose a color">
            {(['red', 'blue'] as const).map((side) => (
              <button
                key={side}
                className={`color-choice ${side}`}
                aria-pressed={color === side}
                disabled={props.disabled || !props.open}
                onClick={() => setColor(side)}
              >
                <span aria-hidden="true">●</span>
                {side === 'red' ? 'Red' : 'Blue'}
                {color === side ? ' ✓' : ''}
              </button>
            ))}
          </div>
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
  const presentation = useDrawPresentation(props.state.revealed);
  return (
    <section className="powerball-host">
      <h3>Powerball</h3>
      <BallMachine state={props.state} {...presentation} />
      <p>{props.state.hostBets?.length ?? 0} bets reserved.</p>
      <details>
        <summary>View reserved bets</summary>
        {props.state.hostBets?.map((bet) => (
          <p key={bet.playerId}>
            {props.players.find((p) => p.id === bet.playerId)?.name}: {bet.amount} on {bet.color}
            {bet.payout === null || !presentation.complete ? '' : ` · returned ${bet.payout}`}
          </p>
        ))}
      </details>
      {props.state.revealed ? (
        <p>
          {presentation.complete
            ? `Draw: ${props.state.winningColor}`
            : 'Revealing on phones and the display…'}
        </p>
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
          Reveal ball · {GAME_MOTION.powerballMs / 1000} seconds
        </button>
      )}
    </section>
  );
}
export function PowerballDisplay({ state }: Pick<PowerballViewProps, 'state'>) {
  const presentation = useDrawPresentation(state.revealed);
  return (
    <section className="powerball-display" aria-label="Powerball draw">
      <BallMachine state={state} {...presentation} />
      <p>
        {presentation.complete
          ? `The draw is ${state.winningColor}.`
          : presentation.animating
            ? 'Here comes the draw…'
            : state.drawn
              ? 'Betting is closed. Here comes the reveal.'
              : 'Choose your side on your phone.'}
      </p>
    </section>
  );
}
