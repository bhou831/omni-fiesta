import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';
import {
  costume,
  costumeHostAction,
  costumeProjection,
  costumeSchema,
} from '../src/server/games/costume.js';
import type { Command } from '../src/shared/contracts.js';

function setup(count: number) {
  const store = new Store(':memory:');
  store.db.exec(costumeSchema);
  const config = loadConfig();
  let time = 1_000_000;
  const room = store.transaction(() => store.createRoom(config, 'party', time));
  const players = Array.from({ length: count }, (_, i) =>
    store.join(
      store.room(room.id),
      { name: `Guest ${i}`, emoji: '🦊', email: `guest${i}@example.test`, phone: '2125550100' },
      randomUUID(),
      time + i,
    ),
  );
  store.db
    .prepare(
      "UPDATE rooms SET phase='costume',phase_instance=2,status='open',opened_at=?,deadline_at=? WHERE id=?",
    )
    .run(time, time + config.timers.costume_voting_seconds * 1000, room.id);
  const engine = new Engine(store, () => time, [costume]);
  const sessions = players.map((p) => store.authenticate(p.token, 'player', time, '')!);
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const cmd = (target: string): Command => ({
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.action',
    payload: { action: 'vote', data: { candidateId: target } },
  });
  const context = () => engine.context(store.room(room.id));
  return {
    store,
    config,
    room,
    players,
    sessions,
    engine,
    host,
    cmd,
    context,
    setTime: (v: number) => {
      time = v;
    },
  };
}

test('costume votes, capped penalty, privacy, and atomic repeated reveal', (t) => {
  const f = setup(9);
  t.after(() => f.store.close());
  f.store.transaction(() => {
    f.store.adjust(
      f.room.id,
      f.players[4].playerId,
      'test-lock',
      'Test lock',
      { spendable: -940, locked: 300, reserved: 0 },
      f.context().now,
    );
    f.store.adjust(
      f.room.id,
      f.players[5].playerId,
      'test-balance',
      'Test balance',
      { spendable: -860, locked: 0, reserved: 0 },
      f.context().now,
    );
  });
  const targets = [1, 0, 0, 0, 1, 1, 2, 2, 3];
  const first = f.cmd(f.players[targets[0]].playerId);
  f.engine.execute(f.sessions[0], f.room.id, first);
  f.engine.execute(f.sessions[0], f.room.id, first);
  for (let i = 1; i < 9; i++)
    f.engine.execute(f.sessions[i], f.room.id, f.cmd(f.players[targets[i]].playerId));
  assert.throws(() => f.engine.execute(f.sessions[0], f.room.id, f.cmd(f.players[0].playerId)));
  const own = costumeProjection(f.context(), 'player', f.players[0].playerId);
  assert.equal(own.votedFor, f.players[1].playerId);
  assert.equal(own.results, null);
  assert.equal(costumeProjection(f.context(), 'display').results, null);
  assert.equal(costumeProjection(f.context(), 'host').results?.length, 9);
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'reveal')));
  f.engine.execute(f.host, f.room.id, {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.close',
  });
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  const result = costumeProjection(f.context(), 'display').results!;
  const byId = new Map(result.map((r) => [r.playerId, r]));
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.votes),
    [3, 3, 2, 1, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.tokenChange),
    [1000, 1000, 800, 500, -60, -100, -100, -100, -100],
  );
  assert.equal(f.store.player(f.players[4].playerId).spendable, 0);
  assert.equal(f.store.player(f.players[4].playerId).locked, 300);
  assert.equal(f.store.player(f.players[5].playerId).spendable, 40);
  assert.equal(JSON.stringify(result).includes('example.test'), false);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason='Costume contest'").get()?.n,
    9,
  );
});

test('no ballots have no financial effects and expiry never votes', (t) => {
  const f = setup(3);
  t.after(() => f.store.close());
  const deadline = f.store.room(f.room.id).deadline_at!;
  f.setTime(deadline);
  assert.throws(() => f.engine.execute(f.sessions[0], f.room.id, f.cmd(f.players[1].playerId)));
  assert.equal(f.store.room(f.room.id).status, 'closed');
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  assert.deepEqual(
    f.players.map((p) => f.store.player(p.playerId).spendable),
    [1000, 1000, 1000],
  );
  assert.equal(costumeProjection(f.context(), 'display').results?.length, 3);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason='Costume contest'").get()?.n,
    0,
  );
});

test('vote revisions overwrite the previous ballot and one player can close without voting', (t) => {
  const f = setup(3);
  t.after(() => f.store.close());
  f.engine.execute(f.sessions[0], f.room.id, f.cmd(f.players[1].playerId));
  f.engine.execute(f.sessions[0], f.room.id, f.cmd(f.players[2].playerId));
  assert.equal(
    costumeProjection(f.context(), 'player', f.players[0].playerId).votedFor,
    f.players[2].playerId,
  );
  assert.equal(costumeProjection(f.context(), 'host').voteCount, 1);
  const solo = setup(1);
  t.after(() => solo.store.close());
  assert.throws(() =>
    solo.engine.execute(solo.sessions[0], solo.room.id, solo.cmd(solo.players[0].playerId)),
  );
  solo.engine.execute(solo.host, solo.room.id, {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.close',
  });
  solo.store.transaction(() => costumeHostAction(solo.context(), 'reveal'));
  assert.equal(solo.store.player(solo.players[0].playerId).spendable, 1000);
});

test('five tied winners each receive full first prize and third group is never penalized', (t) => {
  const f = setup(15);
  t.after(() => f.store.close());
  const targets = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7];
  targets.forEach((target, i) =>
    f.engine.execute(f.sessions[(i + 8) % 15], f.room.id, f.cmd(f.players[target].playerId)),
  );
  f.engine.execute(f.host, f.room.id, {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.close',
  });
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  const results = costumeProjection(f.context(), 'display').results!;
  const byId = new Map(results.map((result) => [result.playerId, result]));
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.tokenChange),
    [1000, 1000, 1000, 1000, 1000, 800, 800, 800, 500, 500, 500, 500, 500, 500, 500],
  );
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.place),
    [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3],
  );
});
