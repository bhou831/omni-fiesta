import { randomInt } from 'node:crypto';
import { requireRule } from '../core/errors.js';
import type { PhaseContext, PhaseModule } from '../core/phases.js';

/** Register in the integration owner's ordered schema migration. */
export const somebodyCallingSchema = `
CREATE TABLE IF NOT EXISTS phone_draws (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  drawn_at INTEGER NOT NULL,
  revealed_at INTEGER
);`;
export type PhoneDrawRandom = (exclusive: number) => number;
export interface CallingWinner {
  name: string;
  emoji: string;
  award: number;
}
export interface CallingPublicState {
  revealed: boolean;
  winner: CallingWinner | null;
}
export interface CallingHostState {
  drawn: boolean;
  revealed: boolean;
  selected: { id: string; name: string; emoji: string; phone: string } | null;
  award: number;
}
type Draw = { player_id: string; drawn_at: number; revealed_at: number | null };
function drawRow(context: PhaseContext): Draw | undefined {
  return context.store.db
    .prepare('SELECT player_id,drawn_at,revealed_at FROM phone_draws WHERE room_id=?')
    .get(context.room.id) as unknown as Draw | undefined;
}
/** Project independently by role; waiting public projections do not disclose whether selection occurred. */
export function callingPublicState(context: PhaseContext): CallingPublicState {
  const draw = drawRow(context);
  if (!draw || draw.revealed_at === null) return { revealed: false, winner: null };
  const player = context.store.player(draw.player_id);
  return {
    revealed: true,
    winner: {
      name: player.name,
      emoji: player.emoji,
      award: context.config.somebody_calling.winner_award_tokens,
    },
  };
}
export function callingHostState(context: PhaseContext): CallingHostState {
  const draw = drawRow(context);
  const player = draw ? context.store.player(draw.player_id) : null;
  return {
    drawn: !!draw,
    revealed: draw?.revealed_at != null,
    selected: player
      ? { id: player.id, name: player.name, emoji: player.emoji, phone: player.phone }
      : null,
    award: context.config.somebody_calling.winner_award_tokens,
  };
}
/** Called only by authenticated host command routing inside Engine's idempotent transaction. */
export function callingHostAction(
  context: PhaseContext,
  action: string,
  random: PhoneDrawRandom = (max) => randomInt(max),
): Record<string, unknown> {
  requireRule(
    context.room.phase === 'somebody-calling',
    'INVALID_PHASE',
    'The phone draw is not active.',
  );
  requireRule(
    action === 'draw' || action === 'reveal',
    'UNKNOWN_ACTION',
    'That phone draw action is unavailable.',
  );
  const previous = drawRow(context);
  if (action === 'draw') {
    if (previous) return { drawn: true };
    const players = context.store.players(context.room.id);
    requireRule(players.length > 0, 'NO_PLAYERS', 'At least one player must join.');
    const index = random(players.length);
    requireRule(
      Number.isSafeInteger(index) && index >= 0 && index < players.length,
      'INVALID_RANDOM',
      'The phone draw failed.',
    );
    context.store.db
      .prepare('INSERT INTO phone_draws(room_id,player_id,drawn_at,revealed_at) VALUES(?,?,?,NULL)')
      .run(context.room.id, players[index].id, context.now);
    return { drawn: true };
  }
  requireRule(previous, 'DRAW_REQUIRED', 'Draw a player before revealing.');
  if (previous.revealed_at === null) {
    context.store.adjust(
      context.room.id,
      previous.player_id,
      'somebody-calling:award',
      'Somebody’s Calling award',
      { spendable: context.config.somebody_calling.winner_award_tokens, locked: 0, reserved: 0 },
      context.now,
    );
    context.store.db
      .prepare('UPDATE phone_draws SET revealed_at=? WHERE room_id=?')
      .run(context.now, context.room.id);
  }
  return { revealed: true };
}
export const somebodyCalling: PhaseModule = {
  id: 'somebody-calling',
  durationSeconds: () => null,
  action() {
    requireRule(false, 'UNKNOWN_ACTION', 'This round is controlled by the host.');
  },
  assertCanAdvance(context) {
    requireRule(
      drawRow(context)?.revealed_at != null,
      'REVEAL_REQUIRED',
      'Reveal the phone draw before continuing.',
    );
  },
};
