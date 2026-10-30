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
export function positions(context: PhaseContext, playerId: string): Position[] {
  return context.store.db
    .prepare(
      'SELECT player_id,asset_id,principal,payout FROM investments WHERE room_id=? AND player_id=? ORDER BY asset_id',
    )
    .all(context.room.id, playerId) as unknown as Position[];
}
/** `invest` replaces the whole portfolio; the single `{ assetId, amount }` form is a one-asset portfolio. */
function allocationsFrom(data: Record<string, unknown>): { assetId: string; amount: number }[] {
  const list = Array.isArray(data.allocations)
    ? data.allocations
    : [{ assetId: data.assetId, amount: data.amount }];
  return list.map((item) => ({
    assetId: (item as { assetId?: unknown })?.assetId as string,
    amount: (item as { amount?: unknown })?.amount as number,
  }));
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
      'Choose or cancel your investments.',
    );
    const { assets, max_investment_tokens: cap } = context.config.investments;
    const allocations = action === 'cancel' ? [] : allocationsFrom(data);
    if (action === 'invest') {
      requireRule(
        allocations.length > 0 && allocations.length <= assets.length,
        'INVALID_ASSET',
        'Choose at least one available asset.',
      );
      requireRule(
        allocations.every(
          (item) =>
            typeof item.assetId === 'string' && assets.some((a) => a.provider_id === item.assetId),
        ) && new Set(allocations.map((item) => item.assetId)).size === allocations.length,
        'INVALID_ASSET',
        'Choose each available asset at most once.',
      );
      requireRule(
        allocations.every(
          (item) =>
            typeof item.amount === 'number' && Number.isSafeInteger(item.amount) && item.amount > 0,
        ) && allocations.reduce((sum, item) => sum + item.amount, 0) <= cap,
        'INVALID_AMOUNT',
        'Choose whole-token amounts that total no more than the investment cap.',
      );
    }
    const amount = allocations.reduce((sum, item) => sum + item.amount, 0);
    const delta = amount - positions(context, playerId).reduce((sum, p) => sum + p.principal, 0);
    context.store.adjust(
      context.room.id,
      playerId,
      `investment-edit:${randomUUID()}`,
      'Investment reservation',
      { spendable: -delta, locked: delta, reserved: 0 },
      context.now,
    );
    context.store.db
      .prepare('DELETE FROM investments WHERE room_id=? AND player_id=?')
      .run(context.room.id, playerId);
    const insert = context.store.db.prepare(
      'INSERT INTO investments(room_id,player_id,asset_id,principal) VALUES(?,?,?,?)',
    );
    for (const item of allocations)
      insert.run(context.room.id, playerId, item.assetId, item.amount);
    return { allocations, principal: amount };
  },
};
export const investmentReview: PhaseModule = {
  id: 'investment-review',
  durationSeconds: () => null,
  action() {
    throw new Error('No player action in investment review');
  },
  assertCanAdvance(context) {
    const any = context.store.db
      .prepare('SELECT 1 FROM investments WHERE room_id=? LIMIT 1')
      .get(context.room.id);
    // Settled at closing prices, refunded without them, or nobody invested.
    requireRule(
      (snapshot(context, 'closing') || refunded(context) || !any) && !unsettled(context),
      'REVIEW_PENDING',
      'Prepare closing prices and settle investments first.',
    );
  },
};
const unsettled = (context: PhaseContext) =>
  !!context.store.db
    .prepare('SELECT 1 FROM investments WHERE room_id=? AND payout IS NULL LIMIT 1')
    .get(context.room.id);
/** True once the host refunded every position because closing prices were unavailable. */
export function refunded(context: PhaseContext): boolean {
  return !!context.store.db
    .prepare("SELECT 1 FROM ledger WHERE room_id=? AND reason='Investment refund' LIMIT 1")
    .get(context.room.id);
}
/** Fallback when closing prices cannot be loaded: every position returns exactly its principal. */
export function refundInvestments(context: PhaseContext): void {
  requireRule(
    !snapshot(context, 'closing'),
    'MARKET_AVAILABLE',
    'Closing prices are saved. Settle investments instead.',
  );
  const open = context.store.db
    .prepare('SELECT player_id,asset_id,principal,payout FROM investments WHERE room_id=?')
    .all(context.room.id) as unknown as Position[];
  for (const item of open) {
    if (item.payout !== null) continue;
    // Same key as settlement, so a position can be paid out only once either way.
    context.store.adjust(
      context.room.id,
      item.player_id,
      `investment-settlement:${item.asset_id}`,
      'Investment refund',
      { spendable: item.principal, locked: -item.principal, reserved: 0 },
      context.now,
    );
    context.store.db
      .prepare('UPDATE investments SET payout=? WHERE room_id=? AND player_id=? AND asset_id=?')
      .run(item.principal, context.room.id, item.player_id, item.asset_id);
  }
}
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
      `investment-settlement:${item.asset_id}`,
      'Investment settlement',
      { spendable: payout, locked: -item.principal, reserved: 0 },
      context.now,
      payout > item.principal ? 'investment' : undefined,
    );
    context.store.db
      .prepare('UPDATE investments SET payout=? WHERE room_id=? AND player_id=? AND asset_id=?')
      .run(payout, context.room.id, item.player_id, item.asset_id);
  }
}
