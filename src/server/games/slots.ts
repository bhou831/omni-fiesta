import { randomBytes, randomUUID } from 'node:crypto';
import type { GameConfig } from '../config.js';
import { requireRule } from '../core/errors.js';
import type { PhaseContext, PhaseModule } from '../core/phases.js';

/** The integration owner registers this schema in an ordered core migration. */
export const slotsSchema = `
CREATE TABLE IF NOT EXISTS slot_spins (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  phase_instance INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  request_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  cost INTEGER NOT NULL,
  gross INTEGER NOT NULL,
  final_balance INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(room_id, phase_instance, player_id, attempt),
  UNIQUE(room_id, player_id, request_id)
);`;

export interface SlotSpin {
  id: string;
  attempt: number;
  cost: number;
  gross: number;
  net: number;
  finalBalance: number;
  createdAt: number;
}
export interface SlotsPlayerState {
  cost: number;
  limit: number;
  spins: SlotSpin[];
}
export interface SlotsHostState {
  cost: number;
  limit: number;
  acceptedSpins: number;
}
export interface SlotsDisplayState {
  cost: number;
  limit: number;
}
export type RandomBelow = (exclusive: bigint) => bigint;

/** Uniform rejection sampling, with no floating point or modulo bias. */
export const cryptoRandomBelow: RandomBelow = (exclusive) => {
  if (exclusive <= 0n) throw new Error('Invalid random range');
  if (exclusive === 1n) return 0n;
  const bits = (exclusive - 1n).toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const sample = BigInt(`0x${randomBytes(bytes).toString('hex')}`) & mask;
    if (sample < exclusive) return sample;
  }
};

function decimalWeight(value: number): { numerator: bigint; scale: number } {
  const parts = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!parts) throw new Error('Invalid slot probability');
  const fractional = parts[2] ?? '';
  const exponent = Number(parts[3] ?? 0) - fractional.length;
  const numerator = BigInt(parts[1] + fractional);
  if (exponent >= 0) return { numerator: numerator * 10n ** BigInt(exponent), scale: 0 };
  return { numerator, scale: -exponent };
}
/** Decimal probabilities become exact integer weights, preserving all configured ratios. */
export function slotWeights(config: GameConfig['slots']): bigint[] {
  const fractions = config.outcomes.map((outcome) => decimalWeight(outcome.probability));
  const scale = Math.max(...fractions.map((fraction) => fraction.scale));
  return fractions.map((fraction) => fraction.numerator * 10n ** BigInt(scale - fraction.scale));
}
export function drawSlotOutcome(config: GameConfig['slots'], randomBelow: RandomBelow): number {
  const weights = slotWeights(config);
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  requireRule(total > 0n, 'INVALID_CONFIG', 'Slot probabilities are unavailable.');
  const sample = randomBelow(total);
  requireRule(sample >= 0n && sample < total, 'INVALID_RANDOM', 'Slot draw failed.');
  let threshold = 0n;
  for (let i = 0; i < weights.length; i++) {
    threshold += weights[i];
    if (sample < threshold) return config.outcomes[i].gross_payout_tokens;
  }
  throw new Error('Invalid slot probabilities');
}

type SpinRow = {
  id: string;
  attempt: number;
  cost: number;
  gross: number;
  final_balance: number;
  created_at: number;
};
export function slotsPlayerState(context: PhaseContext, playerId: string): SlotsPlayerState {
  const rows = context.store.db
    .prepare(
      'SELECT id,attempt,cost,gross,final_balance,created_at FROM slot_spins WHERE room_id=? AND phase_instance=? AND player_id=? ORDER BY attempt',
    )
    .all(context.room.id, context.room.phase_instance, playerId) as unknown as SpinRow[];
  return {
    cost: context.config.slots.cost_per_spin_tokens,
    limit: context.config.slots.max_spins_per_player,
    spins: rows.map((row) => ({
      id: row.id,
      attempt: row.attempt,
      cost: row.cost,
      gross: row.gross,
      net: row.gross - row.cost,
      finalBalance: row.final_balance,
      createdAt: row.created_at,
    })),
  };
}
export function slotsHostState(context: PhaseContext): SlotsHostState {
  const result = context.store.db
    .prepare('SELECT COUNT(*) AS n FROM slot_spins WHERE room_id=? AND phase_instance=?')
    .get(context.room.id, context.room.phase_instance) as { n: number };
  return {
    cost: context.config.slots.cost_per_spin_tokens,
    limit: context.config.slots.max_spins_per_player,
    acceptedSpins: result.n,
  };
}
export function slotsDisplayState(context: PhaseContext): SlotsDisplayState {
  return {
    cost: context.config.slots.cost_per_spin_tokens,
    limit: context.config.slots.max_spins_per_player,
  };
}

/** Invoked inside Engine's authorized, deadline-checked, idempotent transaction. */
export function createSlotsModule(randomBelow: RandomBelow = cryptoRandomBelow): PhaseModule {
  return {
    id: 'slots',
    durationSeconds: (config) => config.timers.slots_seconds,
    action(context, playerId, action) {
      requireRule(action === 'spin', 'UNKNOWN_ACTION', 'Choose spin to play slots.');
      const requestId = (context as PhaseContext & { requestId?: string }).requestId;
      requireRule(requestId, 'INVALID_ACTION', 'The spin request is missing its ID.');
      const state = slotsPlayerState(context, playerId);
      const attempt = state.spins.length + 1;
      requireRule(attempt <= state.limit, 'SPIN_LIMIT', 'You have used all your spins.');
      const player = context.store.player(playerId);
      requireRule(
        player.room_id === context.room.id,
        'FORBIDDEN',
        'This player belongs to another party.',
        403,
      );
      requireRule(
        player.spendable >= state.cost,
        'INSUFFICIENT_FUNDS',
        'Not enough available tokens for a spin.',
      );
      const gross = drawSlotOutcome(context.config.slots, randomBelow);
      const id = randomUUID();
      context.store.adjust(
        context.room.id,
        playerId,
        `slot:${id}:cost`,
        'Slot spin cost',
        { spendable: -state.cost, locked: 0, reserved: 0 },
        context.now,
      );
      const balance = context.store.adjust(
        context.room.id,
        playerId,
        `slot:${id}:payout`,
        'Slot spin payout',
        { spendable: gross, locked: 0, reserved: 0 },
        context.now,
      );
      context.store.db
        .prepare(
          'INSERT INTO slot_spins(id,room_id,phase_instance,player_id,request_id,attempt,cost,gross,final_balance,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          context.room.id,
          context.room.phase_instance,
          playerId,
          requestId,
          attempt,
          state.cost,
          gross,
          balance.spendable,
          context.now,
        );
      return {
        id,
        attempt,
        cost: state.cost,
        gross,
        net: gross - state.cost,
        finalBalance: balance.spendable,
        createdAt: context.now,
      };
    },
  };
}
