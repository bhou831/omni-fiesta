import { randomBytes } from 'node:crypto';
import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';

export const powerballSchema = `
CREATE TABLE IF NOT EXISTS powerball_bets (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id), color TEXT NOT NULL CHECK(color IN ('red','blue')),
  amount INTEGER NOT NULL CHECK(amount>0), payout INTEGER,
  PRIMARY KEY(room_id,phase_instance,player_id)
);
CREATE TABLE IF NOT EXISTS powerball_draws (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  color TEXT NOT NULL CHECK(color IN ('red','blue')), revealed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(room_id,phase_instance)
);`;
export type PowerballColor = 'red' | 'blue';
export type RandomBelow = (exclusive: bigint) => bigint;
export const cryptoRandomBelow: RandomBelow = (exclusive) => {
  if (exclusive <= 0n) throw new Error('Invalid random range');
  if (exclusive === 1n) return 0n;
  const bits = (exclusive - 1n).toString(2).length;
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const sample = BigInt(`0x${randomBytes(Math.ceil(bits / 8)).toString('hex')}`) & mask;
    if (sample < exclusive) return sample;
  }
};
function weight(value: number): { n: bigint; scale: number } {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error('Invalid draw probability');
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0) - fraction.length;
  const digits = BigInt(match[1] + fraction);
  return exponent >= 0
    ? { n: digits * 10n ** BigInt(exponent), scale: 0 }
    : { n: digits, scale: -exponent };
}
export function drawColor(context: PhaseContext, random: RandomBelow): PowerballColor {
  const colors = context.config.powerball.colors;
  const decimals = colors.map((c) => weight(c.probability));
  const scale = Math.max(...decimals.map((v) => v.scale));
  const weights = decimals.map((v) => v.n * 10n ** BigInt(scale - v.scale));
  const total = weights.reduce((a, b) => a + b, 0n);
  requireRule(total > 0n, 'INVALID_CONFIG', 'Draw probabilities are unavailable.');
  const sample = random(total);
  requireRule(sample >= 0n && sample < total, 'INVALID_RANDOM', 'Draw failed.');
  return sample < weights[0] ? colors[0].color : colors[1].color;
}
type Bet = { player_id: string; color: PowerballColor; amount: number; payout: number | null };
type Draw = { color: PowerballColor; revealed: number };
function bets(context: PhaseContext): Bet[] {
  return context.store.db
    .prepare(
      'SELECT player_id,color,amount,payout FROM powerball_bets WHERE room_id=? AND phase_instance=? ORDER BY player_id',
    )
    .all(context.room.id, context.room.phase_instance) as unknown as Bet[];
}
function draw(context: PhaseContext): Draw | undefined {
  return context.store.db
    .prepare('SELECT color,revealed FROM powerball_draws WHERE room_id=? AND phase_instance=?')
    .get(context.room.id, context.room.phase_instance) as unknown as Draw | undefined;
}
export interface PowerballProjection {
  ownBet: { color: PowerballColor; amount: number; payout: number | null } | null;
  drawn: boolean;
  revealed: boolean;
  winningColor: PowerballColor | null;
  hostBets:
    { playerId: string; color: PowerballColor; amount: number; payout: number | null }[] | null;
  /** Public display only: how many players back each color. No names or stakes. */
  tally?: { red: number; blue: number } | null;
}
export function powerballProjection(
  context: PhaseContext,
  role: 'host' | 'player' | 'display',
  playerId?: string,
): PowerballProjection {
  const rows = bets(context);
  const currentDraw = draw(context);
  const revealed = !!currentDraw?.revealed;
  const own =
    role === 'player' && playerId ? rows.find((row) => row.player_id === playerId) : undefined;
  return {
    ownBet: own
      ? { color: own.color, amount: own.amount, payout: revealed ? own.payout : null }
      : null,
    drawn: !!currentDraw,
    revealed,
    winningColor: revealed ? currentDraw!.color : null,
    hostBets:
      role === 'host'
        ? rows.map((row) => ({
            playerId: row.player_id,
            color: row.color,
            amount: row.amount,
            payout: revealed ? row.payout : null,
          }))
        : null,
    tally:
      role === 'display'
        ? {
            red: rows.filter((row) => row.color === 'red').length,
            blue: rows.filter((row) => row.color === 'blue').length,
          }
        : null,
  };
}

/** Caller executes inside the core's authenticated, deadline-checked, idempotent transaction. */
export function createPowerballModule(): PhaseModule {
  return {
    id: 'powerball',
    durationSeconds: (config) => config.timers.powerball_betting_seconds,
    action(context, playerId, action, data) {
      requireRule(
        action === 'bet' || action === 'cancel',
        'UNKNOWN_ACTION',
        'Choose or cancel a bet.',
      );
      requireRule(context.requestId, 'INVALID_ACTION', 'The bet request is missing its ID.');
      const previous = bets(context).find((bet) => bet.player_id === playerId);
      const amount = action === 'cancel' ? 0 : data.amount;
      const color = action === 'cancel' ? null : data.color;
      requireRule(
        typeof amount === 'number' &&
          Number.isSafeInteger(amount) &&
          (action === 'cancel' || amount > 0),
        'INVALID_AMOUNT',
        'Choose a positive whole-token stake.',
      );
      requireRule(
        action === 'cancel' || color === 'red' || color === 'blue',
        'INVALID_COLOR',
        'Choose red or blue.',
      );
      const change = amount - (previous?.amount ?? 0);
      context.store.adjust(
        context.room.id,
        playerId,
        `powerball-edit:${context.room.phase_instance}:${context.requestId}`,
        'Powerball reservation',
        { spendable: -change, locked: 0, reserved: change },
        context.now,
      );
      if (amount === 0)
        context.store.db
          .prepare(
            'DELETE FROM powerball_bets WHERE room_id=? AND phase_instance=? AND player_id=?',
          )
          .run(context.room.id, context.room.phase_instance, playerId);
      else
        context.store.db
          .prepare(
            'INSERT INTO powerball_bets(room_id,phase_instance,player_id,color,amount) VALUES(?,?,?,?,?) ON CONFLICT(room_id,phase_instance,player_id) DO UPDATE SET color=excluded.color,amount=excluded.amount',
          )
          .run(context.room.id, context.room.phase_instance, playerId, color as string, amount);
      return { color, amount };
    },
    assertCanAdvance(context) {
      requireRule(
        draw(context)?.revealed,
        'REVEAL_REQUIRED',
        'Reveal the Powerball result before advancing.',
      );
    },
  };
}
/** Host authorization and transaction/idempotency belong to the shared command router. */
export function powerballHostAction(
  context: PhaseContext,
  action: string,
  random: RandomBelow = cryptoRandomBelow,
): Record<string, unknown> {
  requireRule(
    context.room.phase === 'powerball' && context.room.status === 'closed',
    'ROUND_OPEN',
    'Close betting before drawing.',
  );
  requireRule(
    action === 'draw' || action === 'reveal',
    'UNKNOWN_ACTION',
    'Choose a Powerball host action.',
  );
  const { store, room } = context;
  const existing = draw(context);
  if (action === 'draw') {
    if (!existing)
      store.db
        .prepare('INSERT INTO powerball_draws(room_id,phase_instance,color) VALUES(?,?,?)')
        .run(room.id, room.phase_instance, drawColor(context, random));
    return { drawn: true };
  }
  requireRule(existing, 'DRAW_REQUIRED', 'Draw before revealing the result.');
  if (existing.revealed) return { revealed: true };
  const rows = bets(context);
  const winning = rows.filter((row) => row.color === existing.color);
  const winningTotal = winning.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const losingTotal = rows
    .filter((row) => row.color !== existing.color)
    .reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const payouts = new Map<string, bigint>();
  if (winningTotal === 0n) rows.forEach((row) => payouts.set(row.player_id, BigInt(row.amount)));
  else {
    const shares = winning.map((row) => ({
      playerId: row.player_id,
      base: (BigInt(row.amount) * losingTotal) / winningTotal,
      remainder: (BigInt(row.amount) * losingTotal) % winningTotal,
    }));
    const allocated = shares.reduce((sum, share) => sum + share.base, 0n);
    shares.sort((a, b) =>
      a.remainder === b.remainder
        ? a.playerId.localeCompare(b.playerId)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
    let leftover = losingTotal - allocated;
    for (const share of shares) {
      if (leftover > 0n) {
        share.base++;
        leftover--;
      }
      const bet = winning.find((row) => row.player_id === share.playerId)!;
      payouts.set(share.playerId, BigInt(bet.amount) + share.base);
    }
  }
  for (const row of rows) {
    const payout = payouts.get(row.player_id) ?? 0n;
    requireRule(
      payout <= BigInt(Number.MAX_SAFE_INTEGER),
      'INVALID_AMOUNT',
      'Powerball payout exceeds token limits.',
    );
    store.adjust(
      room.id,
      row.player_id,
      `powerball-settlement:${room.phase_instance}`,
      'Powerball settlement',
      { spendable: Number(payout), locked: 0, reserved: -row.amount },
      context.now,
    );
    store.db
      .prepare(
        'UPDATE powerball_bets SET payout=? WHERE room_id=? AND phase_instance=? AND player_id=?',
      )
      .run(Number(payout), room.id, room.phase_instance, row.player_id);
  }
  store.db
    .prepare('UPDATE powerball_draws SET revealed=1 WHERE room_id=? AND phase_instance=?')
    .run(room.id, room.phase_instance);
  return { revealed: true };
}
