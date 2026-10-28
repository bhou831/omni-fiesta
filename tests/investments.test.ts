import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { investments, investmentReview } from '../src/server/games/investments.js';
import { loadConfig } from '../src/server/config.js';
import type { Command } from '../src/shared/contracts.js';

test('investment reservations and settlement are atomic and retry-safe', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = loadConfig();
  let now = 1000000;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const joined = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦊', email: 'fox@example.test', phone: '2125550100' },
    randomUUID(),
    now,
  );
  const player = store.authenticate(joined.token, 'player', now, '')!;
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const engine = new Engine(store, () => now, [investments, investmentReview]);
  const market = (price: string) =>
    JSON.stringify({
      provider: 'coingecko',
      fetchedAt: now,
      quotes: config.investments.assets.map((a) => ({
        id: a.provider_id,
        price,
        timestamp: now,
        change24h: null,
        high24h: null,
        low24h: null,
        volume24h: null,
      })),
    });
  store.db
    .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
    .run(room.id, 'opening', market('100'));
  const command = (type: Command['type'], payload?: Command['payload']): Command => ({
    requestId: randomUUID(),
    phaseInstance: store.room(room.id).phase_instance,
    type,
    payload,
  });
  engine.execute(host, room.id, command('phase.advance'));
  const invest = command('phase.action', {
    action: 'invest',
    data: { amount: 600, assetId: 'bitcoin' },
  });
  engine.execute(player, room.id, invest);
  engine.execute(player, room.id, invest);
  assert.equal(store.player(joined.playerId).spendable, 400);
  assert.equal(store.player(joined.playerId).locked, 600);
  assert.throws(() =>
    engine.execute(
      player,
      room.id,
      command('phase.action', { action: 'invest', data: { amount: 601, assetId: 'bitcoin' } }),
    ),
  );
  engine.execute(
    player,
    room.id,
    command('phase.action', { action: 'invest', data: { amount: 400, assetId: 'bitcoin' } }),
  );
  assert.equal(store.player(joined.playerId).spendable, 600);
  engine.execute(player, room.id, command('phase.action', { action: 'cancel' }));
  assert.equal(store.player(joined.playerId).spendable, 1000);
  engine.execute(
    player,
    room.id,
    command('phase.action', { action: 'invest', data: { amount: 600, assetId: 'bitcoin' } }),
  );
  const display = engine.snapshot({ role: 'display', roomId: room.id });
  assert.equal(display.investments?.position, null);
  now += config.timers.investment_selection_seconds * 1000;
  assert.throws(() =>
    engine.execute(player, room.id, command('phase.action', { action: 'cancel' })),
  );
  store.db
    .prepare(
      "UPDATE rooms SET phase='investment-review',phase_instance=phase_instance+1,status='open',deadline_at=NULL WHERE id=?",
    )
    .run(room.id);
  store.db
    .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
    .run(room.id, 'closing', market('101'));
  const settle = command('phase.host', { action: 'settle' });
  engine.execute(host, room.id, settle);
  engine.execute(host, room.id, settle);
  engine.execute(host, room.id, command('phase.host', { action: 'settle' }));
  assert.equal(store.player(joined.playerId).spendable, 1120);
  assert.equal(store.player(joined.playerId).locked, 0);
});

test('additive migration and restart preserve old rooms and locked investments', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'party-investments-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let store = new Store(path);
  const config = loadConfig();
  const now = 1000000;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const joined = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦊', email: 'fox@example.test', phone: '2125550100' },
    randomUUID(),
    now,
  );
  store.db.exec(
    'DROP TABLE room_market_modes; DROP TABLE investments; DROP TABLE market_snapshots; PRAGMA user_version=1',
  );
  store.close();
  store = new Store(path);
  assert.equal(store.player(joined.playerId).spendable, 1000);
  const prices = {
    provider: 'coingecko',
    fetchedAt: now,
    quotes: config.investments.assets.map((a) => ({
      id: a.provider_id,
      price: '100',
      timestamp: now,
      change24h: null,
      high24h: null,
      low24h: null,
      volume24h: null,
    })),
  };
  store.db
    .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
    .run(room.id, 'opening', JSON.stringify(prices));
  const engine = new Engine(store, () => now, [investments, investmentReview]);
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const player = store.authenticate(joined.token, 'player', now, '')!;
  engine.execute(host, room.id, {
    requestId: randomUUID(),
    phaseInstance: 0,
    type: 'phase.advance',
  });
  engine.execute(player, room.id, {
    requestId: randomUUID(),
    phaseInstance: 1,
    type: 'phase.action',
    payload: { action: 'invest', data: { amount: 600, assetId: 'bitcoin' } },
  });
  const deadline = store.room(room.id).deadline_at;
  store.close();
  store = new Store(path);
  assert.equal(store.room(room.id).deadline_at, deadline);
  assert.equal(store.player(joined.playerId).locked, 600);
  assert.equal(
    store.db.prepare('SELECT principal FROM investments WHERE player_id=?').get(joined.playerId)
      ?.principal,
    600,
  );
  assert.deepEqual(
    JSON.parse(
      (
        store.db
          .prepare('SELECT payload FROM market_snapshots WHERE room_id=? AND kind=?')
          .get(room.id, 'opening') as { payload: string }
      ).payload,
    ),
    prices,
  );
  store.close();
});
