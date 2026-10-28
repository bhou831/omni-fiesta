import React, { useState, type CSSProperties } from 'react';
import type { PowerballColor, PowerballProjection } from '../server/games/powerball.js';
import type { PublicPlayer } from '../shared/contracts.js';
import { GAME_MOTION, useDrawPresentation } from './game-motion.js';

const BALL_POSITIONS = [
  [4, 0],
  [22, 0],
  [40, 0],
  [58, 0],
  [76, 0],
  [13, 17],
  [31, 17],
  [49, 17],
  [67, 17],
  [22, 34],
  [40, 34],
  [58, 34],
] as const;

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
        <span className="box-label">County fair draw</span>
        <div className="mixing-balls">
          {BALL_POSITIONS.map(([x, y], i) => (
            <span
              key={i}
              className={`mixing-ball ${i % 2 ? 'blue' : 'red'}`}
              style={
                {
                  left: `${x}%`,
                  bottom: `${y}%`,
                  animationDelay: `${-(i % 4) * 0.16}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <span className="ball-door" />
      </div>
      <div className="ball-ramp" aria-hidden="true">
        {color ? (
          <span className={`drawn-ball ${color}`}>{color === 'red' ? 'R' : 'B'}</span>
        ) : state.drawn && !animating ? (
          <span className="drawn-ball mystery-ball">?</span>
        ) : null}
      </div>
      <p className="draw-status" role="status" aria-live="polite">
        {animating
          ? 'Mixing the balls…'
          : color
            ? `Result: ${color === 'red' ? 'Red' : 'Blue'}`
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
  const saved = !!bet && bet.color === color && bet.amount === Number(amount);
  const stakeEnabled = props.open && !props.disabled;
  const maximum = props.spendable + (bet?.amount ?? 0);
  const net = bet?.payout == null ? null : bet.payout - bet.amount;
  return (
    <section className="game-panel" aria-label="Red or blue">
      <BallMachine state={props.state} {...presentation} />
      {presentation.complete ? (
        <>
          {bet && net !== null ? (
            <div className="powerball-ticket powerball-result" role="status">
              <strong>
                {bet.amount} tokens on {bet.color}
              </strong>
              <span>{bet.payout} tokens returned</span>
              <span>
                {net > 0
                  ? `Gain +${net} tokens`
                  : net < 0
                    ? `Loss −${Math.abs(net)} tokens`
                    : 'No change'}
              </span>
            </div>
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
            <div className="powerball-ticket">
              <strong>
                {bet.amount} tokens on {bet.color}
              </strong>
              <span>Reserved</span>
            </div>
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
                <span className="choice-ball" aria-hidden="true">
                  {side === 'red' ? 'R' : 'B'}
                </span>
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
              inputMode="numeric"
              value={amount}
              disabled={props.disabled || !props.open}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <div className="stake-chips" role="group" aria-label="Quick stake amounts">
            {[50, 100, 200].map((value) => (
              <button
                key={value}
                type="button"
                className="button secondary"
                disabled={!stakeEnabled}
                onClick={() => setAmount(String(value))}
              >
                {value}
              </button>
            ))}
            {props.revealBalance && (
              <button
                type="button"
                className="button secondary"
                disabled={!stakeEnabled || maximum < 1}
                onClick={() => setAmount(String(maximum))}
              >
                Max
              </button>
            )}
          </div>
          <button
            className="button primary"
            disabled={props.disabled || !props.open || saved}
            onClick={() => props.onBet(color, Number(amount))}
          >
            {saved ? '✓ Bet saved' : bet ? 'Update bet' : 'Save bet'}
          </button>
          <p
            className={`save-feedback ${saved ? 'is-saved' : ''}`}
            role="status"
            aria-live="polite"
          >
            {saved
              ? `✓ ${bet!.amount} tokens on ${bet!.color}. Your ticket is in.`
              : bet
                ? 'Unsaved changes. Your previous ticket is still in the draw.'
                : 'Choose your stake, then save your ticket.'}
          </p>
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
            ? `✓ ${props.state.winningColor === 'red' ? 'Red' : 'Blue'} · bets settled.`
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
    </section>
  );
}
