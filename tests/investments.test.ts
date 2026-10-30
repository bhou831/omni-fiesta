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
  engine.execute(host, room.id, command('phase.start'));
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
  assert.deepEqual(display.investments?.positions, []);
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
  engine.execute(host, room.id, { requestId: randomUUID(), phaseInstance: 1, type: 'phase.start' });
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

test('a player can hold several positions, revise them together and settle each once', (t) => {
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
  const market = (price: (id: string) => string) =>
    JSON.stringify({
      provider: 'coingecko',
      fetchedAt: now,
      quotes: config.investments.assets.map((a) => ({
        id: a.provider_id,
        price: price(a.provider_id),
        timestamp: now,
        change24h: null,
        high24h: null,
        low24h: null,
        volume24h: null,
      })),
    });
  store.db.prepare('INSERT INTO market_snapshots VALUES(?,?,?)').run(
    room.id,
    'opening',
    market(() => '100'),
  );
  const command = (type: Command['type'], payload?: Command['payload']): Command => ({
    requestId: randomUUID(),
    phaseInstance: store.room(room.id).phase_instance,
    type,
    payload,
  });
  const invest = (allocations: { assetId: string; amount: number }[]) =>
    engine.execute(
      player,
      room.id,
      command('phase.action', { action: 'invest', data: { allocations } }),
    );
  engine.execute(host, room.id, command('phase.advance'));
  engine.execute(host, room.id, command('phase.start'));

  invest([
    { assetId: 'bitcoin', amount: 300 },
    { assetId: 'solana', amount: 200 },
  ]);
  assert.equal(store.player(joined.playerId).spendable, 500);
  assert.equal(store.player(joined.playerId).locked, 500);
  const snapshot = () =>
    engine.snapshot({ role: 'player', roomId: room.id, playerId: joined.playerId });
  assert.equal(snapshot().investments?.positions.length, 2);

  // The cap is a total across assets, and each asset appears at most once.
  assert.throws(() =>
    invest([
      { assetId: 'bitcoin', amount: 400 },
      { assetId: 'solana', amount: 201 },
    ]),
  );
  assert.throws(() =>
    invest([
      { assetId: 'bitcoin', amount: 100 },
      { assetId: 'bitcoin', amount: 100 },
    ]),
  );
  assert.throws(() => invest([{ assetId: 'bitcoin', amount: 0 }]));
  assert.throws(() => invest([{ assetId: 'not-an-asset', amount: 10 }]));
  assert.equal(store.player(joined.playerId).locked, 500);

  // Revising replaces the whole portfolio and releases the difference.
  invest([{ assetId: 'bitcoin', amount: 100 }]);
  assert.equal(store.player(joined.playerId).spendable, 900);
  assert.equal(snapshot().investments?.positions.length, 1);
  invest([
    { assetId: 'bitcoin', amount: 300 },
    { assetId: 'solana', amount: 200 },
  ]);

  now += config.timers.investment_selection_seconds * 1000;
  store.db
    .prepare(
      "UPDATE rooms SET phase='investment-review',phase_instance=phase_instance+1,status='open',deadline_at=NULL WHERE id=?",
    )
    .run(room.id);
  // Bitcoin +1% (x20 = +20%), Solana -1% (x20 = -20%).
  store.db.prepare('INSERT INTO market_snapshots VALUES(?,?,?)').run(
    room.id,
    'closing',
    market((id) => (id === 'bitcoin' ? '101' : id === 'solana' ? '99' : '100')),
  );
  const settle = command('phase.host', { action: 'settle' });
  engine.execute(host, room.id, settle);
  engine.execute(host, room.id, command('phase.host', { action: 'settle' }));
  assert.equal(store.player(joined.playerId).locked, 0);
  // 500 spendable + 360 (BTC) + 160 (SOL).
  assert.equal(store.player(joined.playerId).spendable, 1020);
  assert.deepEqual(
    snapshot().investments?.positions.map((p) => [p.asset_id, p.payout]),
    [
      ['bitcoin', 360],
      ['solana', 160],
    ],
  );
});

test('version-10 databases keep their single position when upgraded to per-asset positions', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'party-positions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let store = new Store(path);
  const config = loadConfig();
  const room = store.transaction(() => store.createRoom(config, 'party', 1000000));
  const joined = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦊', email: 'fox@example.test', phone: '2125550100' },
    randomUUID(),
    1000000,
  );
  store.db.exec(`DROP TABLE investments;
    CREATE TABLE investments(room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES players(id), asset_id TEXT NOT NULL, principal INTEGER NOT NULL CHECK(principal>0), payout INTEGER, PRIMARY KEY(room_id,player_id));
    PRAGMA user_version=10;`);
  store.db
    .prepare('INSERT INTO investments(room_id,player_id,asset_id,principal) VALUES(?,?,?,?)')
    .run(room.id, joined.playerId, 'bitcoin', 600);
  store.close();
  store = new Store(path);
  t.after(() => store.close());
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 13);
  assert.deepEqual(
    store.db
      .prepare('SELECT asset_id,principal FROM investments WHERE player_id=?')
      .all(joined.playerId)
      .map((r) => [r.asset_id, r.principal]),
    [['bitcoin', 600]],
  );
  // The new key allows a second asset for the same player.
  store.db
    .prepare('INSERT INTO investments(room_id,player_id,asset_id,principal) VALUES(?,?,?,?)')
    .run(room.id, joined.playerId, 'solana', 100);
});

test('without closing prices the host refunds every stake once, and the closing bell can finish', async (t) => {
  const { prepareMarket } = await import('../src/server/games/prepare-market.js');
  const { fixtureProvider } = await import('../src/server/games/market.js');
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = loadConfig();
  const now = 1000000;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const join = (name: string) =>
    store.join(
      store.room(room.id),
      { name, emoji: '🦊', email: `${name}@example.test`, phone: '2125550100' },
      randomUUID(),
      now,
    );
  const fox = join('fox');
  const owl = join('owl');
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const engine = new Engine(store, () => now, [investments, investmentReview]);
  const snapshotRow = JSON.stringify({
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
  });
  store.db
    .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
    .run(room.id, 'opening', snapshotRow);
  const command = (type: Command['type'], payload?: Command['payload']): Command => ({
    requestId: randomUUID(),
    phaseInstance: store.room(room.id).phase_instance,
    type,
    payload,
  });
  engine.execute(host, room.id, command('phase.advance'));
  engine.execute(host, room.id, command('phase.start'));
  for (const [joined, amount] of [
    [fox, 600],
    [owl, 250],
  ] as const)
    engine.execute(
      store.authenticate(joined.token, 'player', now, '')!,
      room.id,
      command('phase.action', {
        action: 'invest',
        data: {
          allocations: [
            { assetId: 'bitcoin', amount: amount - 50 },
            { assetId: 'dogecoin', amount: 50 },
          ],
        },
      }),
    );
  store.db
    .prepare(
      "UPDATE rooms SET phase='investment-review',phase_instance=phase_instance+1,status='open',deadline_at=NULL WHERE id=?",
    )
    .run(room.id);
  const review = () => investmentReview.assertCanAdvance!(engine.context(store.room(room.id)));
  assert.throws(review, /settle investments first/);
  assert.equal(engine.snapshot({ role: 'display', roomId: room.id }).investments?.refunded, false);

  const refund = command('phase.host', { action: 'refund' });
  engine.execute(host, room.id, refund);
  engine.execute(host, room.id, refund);
  engine.execute(host, room.id, command('phase.host', { action: 'refund' }));
  for (const joined of [fox, owl]) {
    const player = store.player(joined.playerId);
    assert.deepEqual([player.spendable, player.locked], [1000, 0]);
  }
  const refunds = store.db
    .prepare("SELECT COUNT(*) AS n FROM ledger WHERE room_id=? AND reason='Investment refund'")
    .get(room.id) as { n: number };
  assert.equal(refunds.n, 4);
  assert.doesNotThrow(review);
  assert.equal(engine.snapshot({ role: 'display', roomId: room.id }).investments?.refunded, true);
  // Settlement needs closing prices, and closing prices can no longer be prepared.
  assert.throws(
    () => engine.execute(host, room.id, command('phase.host', { action: 'settle' })),
    /market snapshots/,
  );
  await assert.rejects(
    prepareMarket(store, room.id, 'closing', fixtureProvider(), () => now),
    /refunded/,
  );
  assert.equal(store.player(fox.playerId).spendable, 1000);
});

test('refund is refused once closing prices are saved, and an empty closing bell can finish', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = loadConfig();
  const now = 1000000;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const engine = new Engine(store, () => now, [investments, investmentReview]);
  store.db
    .prepare(
      "UPDATE rooms SET phase='investment-review',phase_instance=1,status='open',deadline_at=NULL WHERE id=?",
    )
    .run(room.id);
  // Nobody invested: nothing to settle, so missing closing prices do not block the party.
  assert.doesNotThrow(() =>
    investmentReview.assertCanAdvance!(engine.context(store.room(room.id))),
  );
  store.db
    .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
    .run(room.id, 'closing', JSON.stringify({ provider: 'coingecko', fetchedAt: now, quotes: [] }));
  assert.throws(
    () =>
      engine.execute(host, room.id, {
        requestId: randomUUID(),
        phaseInstance: 1,
        type: 'phase.host',
        payload: { action: 'refund' },
      }),
    /Settle investments instead/,
  );
});
