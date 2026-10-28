import React, { useRef, useState, type CSSProperties } from 'react';
import type { PowerballColor, PowerballProjection } from '../server/games/powerball.js';
import type { PublicPlayer } from '../shared/contracts.js';
import { CELEBRATION_COLORS, useCelebrateOnArrival } from './celebrate.js';
import { GAME_MOTION, useDrawPresentation } from './game-motion.js';
import { formatTokens } from './format.js';

// Dome contents in em, laid out once so every view (and every render) shows the same machine.
const DOME_BALLS = (() => {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 28 }, (_, i) => {
    let x = 0;
    let y = 0;
    do {
      x = 1.6 + next() * 19.6;
      y = 8 + next() * 14.5;
    } while (Math.hypot(x + 1.4 - 12.2, y + 1.4 - 12.2) > 10.6);
    return {
      color: i % 2 ? 'blue' : 'red',
      style: {
        left: `${x.toFixed(2)}em`,
        top: `${y.toFixed(2)}em`,
        '--dx': `${((next() - 0.5) * 1.2).toFixed(2)}em`,
        '--dy': `${(next() * 1.1 - 0.8).toFixed(2)}em`,
        '--dur': `${(0.9 + next() * 1.3).toFixed(2)}s`,
      } as CSSProperties,
    };
  });
})();

function BallMachine({
  state,
  animating,
  complete,
  celebrate = false,
}: {
  state: PowerballProjection;
  animating: boolean;
  complete: boolean;
  celebrate?: boolean;
}) {
  const color = complete ? state.winningColor : null;
  const scene = useRef<HTMLDivElement>(null);
  const picked = state.revealed ? state.winningColor : null;
  useCelebrateOnArrival(complete && celebrate, scene, [
    ...CELEBRATION_COLORS,
    ...(picked ? [picked === 'red' ? '#b83e3e' : '#3476c5'] : []),
  ]);
  const ready = state.drawn && !animating && !complete;
  return (
    <div
      className={`gumball ${animating ? 'is-drawing' : ''} ${complete ? 'is-revealed' : ''} ${ready ? 'is-ready' : ''}`}
      aria-busy={animating}
    >
      <div className="gumball-scene" ref={scene} aria-hidden="true">
        <div className="gb-dome">
          {DOME_BALLS.map((ball, i) => (
            <i key={i} className={`gb ${ball.color}`} style={ball.style} />
          ))}
        </div>
        <i className={`gb gb-drop ${picked ?? 'red'}`} />
        <span className="gb-neck" />
        <div className="gb-base">
          <span className="gb-knob" />
          <span className="gb-door" />
        </div>
        <div className="gb-capsule">
          <i className={`gb-in ${picked ?? ''}`}>{picked ? (picked === 'red' ? 'R' : 'B') : ''}</i>
          <i className="gb-half gb-bottom" />
          <i className="gb-half gb-top" />
          <b className="gb-q">?</b>
        </div>
      </div>
      <p className="draw-status" role="status" aria-live="polite">
        {animating
          ? 'Mixing the balls…'
          : color
            ? `Result: ${color === 'red' ? 'Red' : 'Blue'}`
            : state.drawn
              ? 'Ready to reveal.'
              : 'Waiting for the draw.'}
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
      <BallMachine state={props.state} {...presentation} celebrate={net !== null && net > 0} />
      {presentation.complete ? (
        <>
          {bet && net !== null ? (
            <div
              className={`powerball-ticket powerball-result ${net > 0 ? 'is-gain' : net < 0 ? 'is-loss' : ''}`}
              role="status"
            >
              <span className="result-kicker">
                {props.state.winningColor === 'red' ? 'Red' : 'Blue'} won
              </span>
              <strong className="result-net">
                {net > 0
                  ? `Gain ${formatTokens(net, { signed: true })} tokens`
                  : net < 0
                    ? `Loss ${formatTokens(net, { signed: true })} tokens`
                    : 'No change'}
              </strong>
              <span>
                {bet.amount} tokens on {bet.color} · {bet.payout} tokens returned
              </span>
            </div>
          ) : (
            <p>You did not place a bet.</p>
          )}
        </>
      ) : props.state.revealed ? (
        <p className="watch-cue" role="status">
          Watch the screen.
        </p>
      ) : (
        <>
          <p>
            {props.open
              ? 'Pick a side and a stake. It’s reserved until the draw.'
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
          {props.revealBalance && (
            <p>
              {`Available: ${props.spendable} tokens${bet ? ` plus ${bet.amount} currently reserved` : ''}.`}
            </p>
          )}
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
              ? `✓ ${bet!.amount} tokens on ${bet!.color}. Your bet is in.`
              : bet
                ? 'Unsaved changes. Your previous bet is still in the draw.'
                : 'Choose your stake, then save your bet.'}
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
  const tally = state.tally ?? { red: 0, blue: 0 };
  const total = tally.red + tally.blue;
  const result = presentation.complete ? state.winningColor : null;
  return (
    <section
      className={`powerball-display ${result ? `is-revealed result-${result}` : ''}`}
      aria-label="Powerball draw"
    >
      <BallMachine state={state} {...presentation} celebrate />
      <div className="tally" role="group" aria-label="Bets so far">
        {(['red', 'blue'] as const).map((side) => (
          <div key={side} className={`tally-side is-${side} ${result === side ? 'is-result' : ''}`}>
            <span className="tally-label">{side === 'red' ? 'Red' : 'Blue'}</span>
            <strong>{tally[side]}</strong>
            <small>{tally[side] === 1 ? 'bet' : 'bets'}</small>
            <span className="tally-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${total ? tally[side] / total : 0})` }} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
