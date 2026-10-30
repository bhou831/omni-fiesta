import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';
import { finishRevealSteps, publicRanking } from '../src/server/games/finish-reveal.js';

const ranked = (ranks: number[]) => ranks.map((rank) => ({ rank }));

test('final ranking steps run 3rd, 2nd, 1st then everyone, skipping ranks nobody holds', () => {
  assert.deepEqual(finishRevealSteps(ranked([1, 2, 3, 4, 5])), { ranks: [3, 2, 1], total: 4 });
  // A tie for first leaves no 2nd place to announce.
  assert.deepEqual(finishRevealSteps(ranked([1, 1, 3, 4])), { ranks: [3, 1], total: 3 });
  assert.deepEqual(finishRevealSteps(ranked([1, 2])), { ranks: [], total: 1 });
  const all = ranked([1, 2, 3, 4, 5]);
  assert.deepEqual(publicRanking(all, 0), []);
  assert.deepEqual(publicRanking(all, 1), ranked([3]));
  assert.deepEqual(publicRanking(all, 3), ranked([1, 2, 3]));
  assert.equal(publicRanking(all, 4).length, 5);
  assert.deepEqual(publicRanking(ranked([1, 2]), 0), []);
  assert.equal(publicRanking(ranked([1, 2]), 1).length, 2);
});

test('only the host sees the whole ranking before the last announcement', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = loadConfig();
  const time = 1_000_000;
  const room = store.transaction(() => store.createRoom(config, 'party', time));
  const players = Array.from({ length: 5 }, (_, i) =>
    store.join(
      store.room(room.id),
      { name: `Guest ${i}`, emoji: '🦦', email: `g${i}@example.test`, phone: '2125550100' },
      randomUUID(),
      time + i,
    ),
  );
  players.forEach((p, i) =>
    store.db.prepare('UPDATE players SET spendable=? WHERE id=?').run(5000 - i * 100, p.playerId),
  );
  store.db
    .prepare("UPDATE rooms SET phase='finish',phase_instance=9,status='open' WHERE id=?")
    .run(room.id);
  const engine = new Engine(store, () => time, []);
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const ranks = (role: 'host' | 'display') =>
    engine.snapshot({ role, roomId: room.id }).ranking!.map((r) => r.rank);
  const next = () =>
    engine.execute(host, room.id, {
      requestId: randomUUID(),
      phaseInstance: 9,
      type: 'phase.host',
      payload: { action: 'next' },
    });

  assert.deepEqual(ranks('display'), []);
  assert.deepEqual(ranks('host'), [1, 2, 3, 4, 5]);
  next();
  assert.deepEqual(ranks('display'), [3]);
  next();
  assert.deepEqual(ranks('display'), [2, 3]);
  next();
  assert.deepEqual(ranks('display'), [1, 2, 3]);
  const podiumOnly = engine.snapshot({ role: 'display', roomId: room.id });
  assert.equal(podiumOnly.rankingStep, 3);
  assert.equal(podiumOnly.rankingSteps, 4);
  next();
  assert.deepEqual(ranks('display'), [1, 2, 3, 4, 5]);
  next();
  assert.equal(engine.snapshot({ role: 'display', roomId: room.id }).rankingStep, 4);
  assert.equal(
    JSON.stringify(engine.snapshot({ role: 'display', roomId: room.id })).includes('example.test'),
    false,
  );
});

test('finish reveal rejects a stale step and a tie for first skips 2nd place', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = loadConfig();
  const time = 1_000_000;
  const room = store.transaction(() => store.createRoom(config, 'party', time));
  for (let i = 0; i < 4; i++)
    store.join(
      store.room(room.id),
      { name: `Guest ${i}`, emoji: '🦦', email: `g${i}@example.test`, phone: '2125550100' },
      randomUUID(),
      time + i,
    );
  const balances = [5000, 5000, 3000, 100];
  store
    .players(room.id)
    .forEach((p, i) =>
      store.db.prepare('UPDATE players SET spendable=? WHERE id=?').run(balances[i], p.id),
    );
  store.db
    .prepare("UPDATE rooms SET phase='finish',phase_instance=9,status='open' WHERE id=?")
    .run(room.id);
  const engine = new Engine(store, () => time, []);
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const next = (step?: number) =>
    engine.execute(host, room.id, {
      requestId: randomUUID(),
      phaseInstance: 9,
      type: 'phase.host',
      payload: { action: 'next', ...(step === undefined ? {} : { data: { step } }) },
    });
  const display = () => engine.snapshot({ role: 'display', roomId: room.id });
  // Two players share rank 1, so only ranks 3 and 1 are announced, then everyone.
  assert.equal(display().rankingSteps, 3);
  next(0);
  assert.deepEqual(
    display().ranking!.map((r) => r.rank),
    [3],
  );
  assert.throws(() => next(0), /already announced/);
  assert.equal(display().rankingStep, 1);
  next(1);
  assert.deepEqual(
    display().ranking!.map((r) => r.rank),
    [1, 1, 3],
  );
  next(2);
  assert.equal(display().ranking!.length, 4);
});
