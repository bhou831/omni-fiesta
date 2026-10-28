import React, { useEffect, useRef, useState } from 'react';
import { GAME_MOTION, useReducedMotion } from './game-motion.js';
import { useCelebrateOnArrival } from './celebrate.js';
import type { CommandSender } from '../shared/contracts.js';
import type { SlotsDisplayState, SlotsHostState, SlotsPlayerState } from '../server/games/slots.js';

export interface SlotsPlayerProps {
  state: SlotsPlayerState;
  spendable: number;
  revealBalance?: boolean;
  open: boolean;
  disabled: boolean;
  command: CommandSender;
}

type Mark = 'seven' | 'diamond' | 'dot' | 'star';
const MARKS: Mark[] = ['seven', 'diamond', 'dot', 'star'];

function Glyph({ symbol }: { symbol: Mark }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      {symbol === 'seven' ? (
        <text x="32" y="50" textAnchor="middle" fontSize="54" fontWeight="800">
          7
        </text>
      ) : symbol === 'diamond' ? (
        <path d="M32 6 56 32 32 58 8 32Z" />
      ) : symbol === 'dot' ? (
        <circle cx="32" cy="32" r="22" />
      ) : (
        <path d="M32 6l7.5 17 18.5 1.6-14 12.2 4.3 18.2L32 45.5 15.7 55l4.3-18.2L6 24.6 24.5 23Z" />
      )}
    </svg>
  );
}

// Symbols are illustrative only: the saved gross and net, not a visual tier, define the result.
const symbolsFor = (gross: number): Mark[] =>
  gross >= 500
    ? ['seven', 'seven', 'seven']
    : gross >= 300
      ? ['diamond', 'diamond', 'diamond']
      : gross > 0
        ? ['dot', 'dot', 'star']
        : ['dot', 'diamond', 'star'];
const netLabel = (net: number) => (net > 0 ? `+${net}` : net < 0 ? `−${Math.abs(net)}` : '0');

interface Ticket {
  attempt: number;
  gross: number | null;
  net: number | null;
  /** Cells that have stamped; the rest keep rolling. */
  stamped: number;
  printing: boolean;
}

function TicketView({ ticket, cost, compact }: { ticket: Ticket; cost: number; compact: boolean }) {
  const symbols = symbolsFor(ticket.gross ?? 0);
  const settled = ticket.stamped >= 3 && ticket.net !== null;
  return (
    <li
      className={`slot-ticket ${ticket.printing ? 'is-printing' : ''} ${compact ? 'is-compact' : ''} ${settled && (ticket.gross ?? 0) > 0 ? 'is-return' : ''}`}
      aria-label={
        settled
          ? `Spin ${ticket.attempt}: ${ticket.gross} returned, net ${netLabel(ticket.net!)} tokens`
          : `Spin ${ticket.attempt}: printing`
      }
    >
      <div className="ticket-head" aria-hidden="true">
        <span>Spin {ticket.attempt}</span>
        <span>{cost} tokens</span>
      </div>
      <div className="ticket-cells" aria-hidden="true">
        {[0, 1, 2].map((i) =>
          i < ticket.stamped ? (
            <span className={`ticket-cell ${ticket.printing ? 'is-stamped' : ''}`} key={i}>
              <Glyph symbol={symbols[i]!} />
            </span>
          ) : (
            <span className="ticket-cell is-rolling" key={i}>
              <span className="ticket-window">
                <span className="ticket-roll">
                  {MARKS.map((symbol) => (
                    <Glyph key={symbol} symbol={symbol} />
                  ))}
                </span>
              </span>
            </span>
          ),
        )}
      </div>
      <div className="ticket-foot" aria-hidden="true">
        <span>Net</span>
        <strong>{settled ? netLabel(ticket.net!) : '…'}</strong>
      </div>
    </li>
  );
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
  const rack = useRef<HTMLOListElement>(null);
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
  const revealing = latest?.id !== presented?.id;
  // Newest first. The ticket for a spin keeps the same key from request to result, so it never reprints.
  const tickets: Ticket[] = state.spins.map((saved) => {
    const live = revealing && saved.id === latest?.id;
    return {
      attempt: saved.attempt,
      gross: saved.gross,
      net: saved.net,
      stamped: live ? (landed.id === saved.id ? landed.count : 0) : 3,
      printing: live,
    };
  });
  if (requesting && !revealing)
    tickets.push({
      attempt: state.spins.length + 1,
      gross: null,
      net: null,
      stamped: 0,
      printing: true,
    });
  tickets.reverse();
  useCelebrateOnArrival(!spinning && (presented?.net ?? 0) > 0, rack);
  return (
    <section aria-label="Slots" className="game-panel">
      <p>{state.cost} tokens a spin.</p>
      <p className="spin-count">
        <span className="spin-pips" aria-hidden="true">
          {Array.from({ length: state.limit }, (_, i) => (
            <i key={i} className={i < remaining ? '' : 'is-used'} />
          ))}
        </span>
        {remaining} {remaining === 1 ? 'spin' : 'spins'} remaining
        {revealBalance ? ` · ${spendable} tokens available` : ''}
      </p>
      <div className={`slot-printer ${spinning ? 'is-busy' : ''}`} aria-busy={spinning}>
        <span className="printer-slot" aria-hidden="true" />
        <ol className="ticket-rack" ref={rack} aria-label="Spin tickets">
          {tickets.length === 0 && (
            <li className="slot-ticket is-placeholder">
              <p>Your tickets print here.</p>
            </li>
          )}
          {tickets.map((ticket, i) => (
            <TicketView key={ticket.attempt} ticket={ticket} cost={state.cost} compact={i > 0} />
          ))}
        </ol>
      </div>
      <button
        className="button primary spin-button"
        disabled={!canSpin}
        onClick={() => void spin()}
      >
        {spinning ? 'Spinning…' : `Spin · ${state.cost} tokens`}
      </button>
      <div className="slot-status" role="status" aria-live="polite" aria-atomic="true">
        {spinning ? (
          <span className="sr-only">Spinning…</span>
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
          'Joining is optional.'
        )}
      </div>
      {!open ? (
        <p>Time’s up. Waiting for the host.</p>
      ) : remaining > 0 && spendable < state.cost ? (
        <p>Not enough available tokens for another spin.</p>
      ) : null}
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

/** Public activity only: counts and anonymous dots, never names or results. */
export function SlotsDisplay({
  state,
  roomPlayers,
}: {
  state: SlotsDisplayState;
  roomPlayers: number;
}) {
  const total = Math.max(roomPlayers, state.players);
  return (
    <section className="slots-display" aria-label="Slots activity">
      <div className="spin-progress">
        <p className="spin-progress-line">
          <strong>{state.players}</strong> of {total} {total === 1 ? 'player has' : 'players have'}{' '}
          spun
        </p>
        <div className="player-dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < state.players ? 'is-filled' : ''} />
          ))}
        </div>
        <p className="spin-progress-note">
          {state.spins} {state.spins === 1 ? 'spin' : 'spins'} played
        </p>
      </div>
      <div className="slot-printer tv-printer" aria-hidden="true">
        <span className="printer-slot" />
        <ol className="ticket-rack">
          <TicketView
            key={state.spins}
            ticket={{
              attempt: state.spins + 1,
              gross: null,
              net: null,
              stamped: 0,
              printing: true,
            }}
            cost={state.cost}
            compact={false}
          />
        </ol>
      </div>
    </section>
  );
}
