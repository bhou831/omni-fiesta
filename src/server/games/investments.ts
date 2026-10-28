import { randomUUID } from 'node:crypto';
import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';
import { investmentPayout } from './investment-math.js';
import type { MarketSnapshot } from './market.js';

interface Position {
  player_id: string;
  asset_id: string;
  principal: number;
  payout: number | null;
}
export function snapshot(
  context: PhaseContext,
  kind: 'opening' | 'closing',
): MarketSnapshot | null {
  const row = context.store.db
    .prepare('SELECT payload FROM market_snapshots WHERE room_id=? AND kind=?')
    .get(context.room.id, kind) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as MarketSnapshot) : null;
}
export function position(context: PhaseContext, playerId: string): Position | undefined {
  return context.store.db
    .prepare(
      'SELECT player_id,asset_id,principal,payout FROM investments WHERE room_id=? AND player_id=?',
    )
    .get(context.room.id, playerId) as unknown as Position | undefined;
}
export const investments: PhaseModule = {
  id: 'investments',
  durationSeconds: (config) => config.timers.investment_selection_seconds,
  open(context) {
    requireRule(snapshot(context, 'opening'), 'MARKET_REQUIRED', 'Prepare opening prices first.');
  },
  action(context, playerId, action, data) {
    requireRule(
      action === 'invest' || action === 'cancel',
      'UNKNOWN_ACTION',
      'Choose or cancel an investment.',
    );
    const old = position(context, playerId);
    const amount = action === 'cancel' ? 0 : data.amount;
    const asset = action === 'cancel' ? '' : data.assetId;
    requireRule(
      typeof amount === 'number' &&
        Number.isSafeInteger(amount) &&
        (action === 'cancel' || amount > 0) &&
        amount <= context.config.investments.max_investment_tokens,
      'INVALID_AMOUNT',
      'Choose a whole-token amount within the investment cap.',
    );
    requireRule(
      action === 'cancel' ||
        (typeof asset === 'string' &&
          context.config.investments.assets.some((a) => a.provider_id === asset)),
      'INVALID_ASSET',
      'Choose an available asset.',
    );
    const delta = amount - (old?.principal ?? 0);
    context.store.adjust(
      context.room.id,
      playerId,
      `investment-edit:${randomUUID()}`,
      'Investment reservation',
      { spendable: -delta, locked: delta, reserved: 0 },
      context.now,
    );
    if (amount === 0)
      context.store.db
        .prepare('DELETE FROM investments WHERE room_id=? AND player_id=?')
        .run(context.room.id, playerId);
    else
      context.store.db
        .prepare(
          'INSERT INTO investments(room_id,player_id,asset_id,principal) VALUES(?,?,?,?) ON CONFLICT(room_id,player_id) DO UPDATE SET asset_id=excluded.asset_id,principal=excluded.principal',
        )
        .run(context.room.id, playerId, asset as string, amount);
    return { assetId: asset, principal: amount };
  },
};
export const investmentReview: PhaseModule = {
  id: 'investment-review',
  durationSeconds: () => null,
  action() {
    throw new Error('No player action in investment review');
  },
  assertCanAdvance(context) {
    const remaining = context.store.db
      .prepare('SELECT 1 FROM investments WHERE room_id=? AND payout IS NULL LIMIT 1')
      .get(context.room.id);
    requireRule(
      snapshot(context, 'closing') && !remaining,
      'REVIEW_PENDING',
      'Prepare closing prices and settle investments first.',
    );
  },
};
export function settleInvestments(context: PhaseContext): void {
  const opening = snapshot(context, 'opening');
  const closing = snapshot(context, 'closing');
  requireRule(opening && closing, 'MARKET_REQUIRED', 'Prepare both market snapshots first.');
  const positions = context.store.db
    .prepare('SELECT player_id,asset_id,principal,payout FROM investments WHERE room_id=?')
    .all(context.room.id) as unknown as Position[];
  for (const item of positions) {
    if (item.payout !== null) continue;
    const open = opening.quotes.find((q) => q.id === item.asset_id);
    const close = closing.quotes.find((q) => q.id === item.asset_id);
    requireRule(open && close, 'MARKET_REQUIRED', 'A price is missing.');
    const payout = investmentPayout(
      item.principal,
      context.config.investments.return_multiplier,
      open.price,
      close.price,
    );
    context.store.adjust(
      context.room.id,
      item.player_id,
      'investment-settlement',
      'Investment settlement',
      { spendable: payout, locked: -item.principal, reserved: 0 },
      context.now,
    );
    context.store.db
      .prepare('UPDATE investments SET payout=? WHERE room_id=? AND player_id=?')
      .run(payout, context.room.id, item.player_id);
  }
}
