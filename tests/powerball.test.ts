import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';
import {
  createPowerballModule,
  powerballHostAction,
  powerballProjection,
  powerballSchema,
  drawColor,
} from '../src/server/games/powerball.js';
import type { Command } from '../src/shared/contracts.js';

function setup(n: number) {
  const store = new Store(':memory:');
  store.db.exec(powerballSchema);
  const config = loadConfig();
  let now = 1000000;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const players = Array.from({ length: n }, (_, i) =>
    store.join(
      store.room(room.id),
      { name: `P${i}`, emoji: '🦊', email: `p${i}@example.test`, phone: '2125550100' },
      randomUUID(),
      now + i,
    ),
  );
  store.db
    .prepare(
      "UPDATE rooms SET phase='powerball',phase_instance=5,status='open',deadline_at=? WHERE id=?",
    )
    .run(now + config.timers.powerball_betting_seconds * 1000, room.id);
  const engine = new Engine(store, () => now, [createPowerballModule()]);
  const sessions = players.map((p) => store.authenticate(p.token, 'player', now, '')!);
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const command = (color: 'red' | 'blue', amount: number): Command => ({
    requestId: randomUUID(),
    phaseInstance: 5,
    type: 'phase.action',
    payload: { action: 'bet', data: { color, amount } },
  });
  const ctx = () => engine.context(store.room(room.id));
  const close = () =>
    engine.execute(host, room.id, {
      requestId: randomUUID(),
      phaseInstance: 5,
      type: 'phase.close',
    });
  return {
    store,
    config,
    room,
    players,
    sessions,
    engine,
    host,
    command,
    ctx,
    close,
    setNow: (value: number) => {
      now = value;
    },
  };
}

test('bets reserve, revise and cancel atomically and enforce deadlines', (t) => {
  const f = setup(2);
  t.after(() => f.store.close());
  const first = f.command('red', 600);
  f.engine.execute(f.sessions[0], f.room.id, first);
  f.engine.execute(f.sessions[0], f.room.id, first);
  assert.equal(f.store.player(f.players[0].playerId).reserved, 600);
  assert.throws(() => f.engine.execute(f.sessions[0], f.room.id, f.command('blue', 1001)));
  f.engine.execute(f.sessions[0], f.room.id, f.command('blue', 400));
  assert.equal(f.store.player(f.players[0].playerId).spendable, 600);
  assert.equal(powerballProjection(f.ctx(), 'player', f.players[0].playerId).ownBet?.color, 'blue');
  f.engine.execute(f.sessions[0], f.room.id, {
    requestId: randomUUID(),
    phaseInstance: 5,
    type: 'phase.action',
    payload: { action: 'cancel' },
  });
  assert.equal(f.store.player(f.players[0].playerId).spendable, 1000);
  assert.equal(f.store.player(f.players[0].playerId).reserved, 0);
  f.setNow(f.store.room(f.room.id).deadline_at!);
  assert.throws(() => f.engine.execute(f.sessions[1], f.room.id, f.command('red', 200)));
  assert.equal(f.store.player(f.players[1].playerId).spendable, 1000);
  assert.equal(f.store.room(f.room.id).status, 'closed');
});

test('secret draw persists, settlement pays shares once, and projections keep bets private', (t) => {
  const f = setup(3);
  t.after(() => f.store.close());
  [f.command('red', 100), f.command('red', 400), f.command('blue', 300)].forEach((cmd, i) =>
    f.engine.execute(f.sessions[i], f.room.id, cmd),
  );
  assert.throws(() => f.store.transaction(() => powerballHostAction(f.ctx(), 'draw', () => 0n)));
  f.close();
  let calls = 0;
  f.store.transaction(() =>
    powerballHostAction(f.ctx(), 'draw', () => {
      calls++;
      return 0n;
    }),
  );
  f.store.transaction(() =>
    powerballHostAction(f.ctx(), 'draw', () => {
      calls++;
      return 1n;
    }),
  );
  assert.equal(calls, 1);
  for (const role of ['host', 'player', 'display'] as const)
    assert.equal(powerballProjection(f.ctx(), role, f.players[0].playerId).winningColor, null);
  assert.equal(powerballProjection(f.ctx(), 'display').hostBets, null);
  assert.equal(powerballProjection(f.ctx(), 'player', f.players[1].playerId).ownBet?.amount, 400);
  assert.deepEqual(
    f.players.map((p) => f.store.player(p.playerId).reserved),
    [100, 400, 300],
  );
  f.store.transaction(() => powerballHostAction(f.ctx(), 'reveal'));
  f.store.transaction(() => powerballHostAction(f.ctx(), 'reveal'));
  const results = f.players.map(
    (p) => powerballProjection(f.ctx(), 'player', p.playerId).ownBet?.payout,
  );
  assert.deepEqual(results, [160, 640, 0]);
  assert.equal(
    results.reduce((a, b) => a! + b!, 0),
    800,
  );
  assert.deepEqual(
    f.players.map((p) => f.store.player(p.playerId).reserved),
    [0, 0, 0],
  );
  assert.equal(powerballProjection(f.ctx(), 'display').winningColor, 'red');
  assert.equal(
    JSON.stringify(powerballProjection(f.ctx(), 'display')).includes('example.test'),
    false,
  );
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason='Powerball settlement'").get()
      ?.n,
    3,
  );
});

test('largest remainders use stable player ID, refund absent winning side, and never mint', (t) => {
  const f = setup(4);
  t.after(() => f.store.close());
  [f.command('red', 1), f.command('red', 1), f.command('red', 1), f.command('blue', 2)].forEach(
    (cmd, i) => f.engine.execute(f.sessions[i], f.room.id, cmd),
  );
  f.close();
  f.store.transaction(() => powerballHostAction(f.ctx(), 'draw', () => 0n));
  f.store.transaction(() => powerballHostAction(f.ctx(), 'reveal'));
  const ordered = f.players
    .slice(0, 3)
    .map((p) => p.playerId)
    .sort((a, b) => a.localeCompare(b));
  assert.deepEqual(
    ordered.map((id) => powerballProjection(f.ctx(), 'player', id).ownBet?.payout),
    [2, 2, 1],
  );
  assert.equal(
    f.players.reduce((sum, p) => sum + f.store.player(p.playerId).spendable, 0),
    4000,
  );
  const g = setup(2);
  t.after(() => g.store.close());
  g.engine.execute(g.sessions[0], g.room.id, g.command('blue', 200));
  g.close();
  g.store.transaction(() => powerballHostAction(g.ctx(), 'draw', () => 0n));
  g.store.transaction(() => powerballHostAction(g.ctx(), 'reveal'));
  assert.equal(g.store.player(g.players[0].playerId).spendable, 1000);
  assert.equal(powerballProjection(g.ctx(), 'player', g.players[0].playerId).ownBet?.payout, 200);
});

test('configured probability boundary selects red or blue with no automatic wagers', (t) => {
  const f = setup(1);
  t.after(() => f.store.close());
  assert.equal(
    drawColor(f.ctx(), () => 0n),
    'red',
  );
  assert.equal(
    drawColor(f.ctx(), (n) => n / 2n),
    'blue',
  );
  f.close();
  f.store.transaction(() => powerballHostAction(f.ctx(), 'draw', () => 0n));
  f.store.transaction(() => powerballHostAction(f.ctx(), 'reveal'));
  assert.equal(f.store.player(f.players[0].playerId).spendable, 1000);
  assert.equal(f.store.player(f.players[0].playerId).reserved, 0);
});
