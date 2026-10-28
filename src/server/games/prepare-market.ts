import type { Store } from '../core/store.js';
import { GameError, requireRule } from '../core/errors.js';
import type { GameConfig } from '../config.js';
import { validateSnapshot, type MarketProvider } from './market.js';

/** Network preparation occurs outside the transaction, then phase and data are checked again before committing. */
export async function prepareMarket(
  store: Store,
  roomId: string,
  kind: 'opening' | 'closing',
  provider: MarketProvider,
  now: () => number,
): Promise<void> {
  const room = store.room(roomId);
  const allowed = (phase: string) =>
    kind === 'opening' ? phase === 'lobby' : phase === 'investment-review';
  requireRule(
    room.mode === 'party' && allowed(room.phase),
    'INVALID_PHASE',
    'Market preparation is not available now.',
  );
  if (
    store.db.prepare('SELECT 1 FROM market_snapshots WHERE room_id=? AND kind=?').get(roomId, kind)
  )
    return;
  let data;
  try {
    data = await provider.fetch(JSON.parse(room.config) as GameConfig, now());
  } catch {
    throw new GameError('MARKET_UNAVAILABLE', 'Market prices are unavailable. Please retry.');
  }
  store.transaction(() => {
    const current = store.room(roomId);
    requireRule(
      current.phase_instance === room.phase_instance && allowed(current.phase),
      'STALE_PHASE',
      'The round changed while prices were loading.',
      409,
    );
    if (
      store.db
        .prepare('SELECT 1 FROM market_snapshots WHERE room_id=? AND kind=?')
        .get(roomId, kind)
    )
      return;
    try {
      validateSnapshot(data, JSON.parse(current.config) as GameConfig, now());
    } catch {
      throw new GameError(
        'MARKET_UNAVAILABLE',
        'Market prices are unavailable or stale. Please retry.',
      );
    }
    store.db
      .prepare('INSERT INTO market_snapshots(room_id,kind,payload) VALUES(?,?,?)')
      .run(roomId, kind, JSON.stringify(data));
    store.bump(roomId);
  });
}
