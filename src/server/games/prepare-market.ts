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
  const allowed = (phase: string, status: string) =>
    kind === 'opening'
      ? phase === 'lobby' || (phase === 'investments' && status === 'pending')
      : phase === 'investment-review';
  requireRule(
    room.mode === 'party' && allowed(room.phase, room.status),
    'INVALID_PHASE',
    'Market preparation is not available now.',
  );
  const config = JSON.parse(room.config) as GameConfig;
  const existing = store.db
    .prepare('SELECT payload FROM market_snapshots WHERE room_id=? AND kind=?')
    .get(roomId, kind) as { payload: string } | undefined;
  if (existing) {
    if (kind === 'closing') return;
    try {
      validateSnapshot(JSON.parse(existing.payload), config, now());
      return;
    } catch {
      /* Refresh stale opening prices only before the round starts. */
    }
  }
  let data;
  try {
    data = await provider.fetch(JSON.parse(room.config) as GameConfig, now());
  } catch {
    throw new GameError('MARKET_UNAVAILABLE', 'Market prices are unavailable. Please retry.');
  }
  store.transaction(() => {
    const current = store.room(roomId);
    requireRule(
      current.phase_instance === room.phase_instance && allowed(current.phase, current.status),
      'STALE_PHASE',
      'The round changed while prices were loading.',
      409,
    );
    const currentSaved = store.db
      .prepare('SELECT payload FROM market_snapshots WHERE room_id=? AND kind=?')
      .get(roomId, kind) as { payload: string } | undefined;
    if (currentSaved && (!existing || currentSaved.payload !== existing.payload)) return;
    if (kind === 'opening')
      requireRule(
        !store.db.prepare('SELECT 1 FROM investments WHERE room_id=? LIMIT 1').get(roomId),
        'MARKET_LOCKED',
        'Opening prices cannot change after an investment.',
      );
    try {
      validateSnapshot(data, JSON.parse(current.config) as GameConfig, now());
    } catch {
      throw new GameError(
        'MARKET_UNAVAILABLE',
        'Market prices are unavailable or stale. Please retry.',
      );
    }
    store.db
      .prepare(
        'INSERT INTO market_snapshots(room_id,kind,payload) VALUES(?,?,?) ON CONFLICT(room_id,kind) DO UPDATE SET payload=excluded.payload',
      )
      .run(roomId, kind, JSON.stringify(data));
    store.bump(roomId);
  });
}
