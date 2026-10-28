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
  // Players 0 and 1 tie for first, so results are held back until a re-vote picks one winner.
  assert.deepEqual(costumeProjection(f.context(), 'host').tiedForFirst, [
    f.players[0].playerId,
    f.players[1].playerId,
  ]);
  assert.deepEqual(costumeProjection(f.context(), 'display').tiedForFirst, []);
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'reveal')));
  f.store.transaction(() => costumeHostAction(f.context(), 'revote'));
  assert.equal(f.store.room(f.room.id).status, 'open');
  assert.equal(costumeProjection(f.context(), 'display').round, 2);
  assert.equal(costumeProjection(f.context(), 'player', f.players[0].playerId).votedFor, null);
  // Re-vote: only the tied players are candidates (a vote for anyone else is rejected).
  assert.throws(() => f.engine.execute(f.sessions[0], f.room.id, f.cmd(f.players[2].playerId)));
  const round2 = [1, 0, 0, 0, 0, 0, 0, 1, 1];
  round2.forEach((target, i) =>
    f.engine.execute(f.sessions[i], f.room.id, f.cmd(f.players[target].playerId)),
  );
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
    [6, 3, 2, 1, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.tokenChange),
    [1000, 800, 500, 0, -60, -100, -100, -100, -100],
  );
  assert.equal(f.store.player(f.players[4].playerId).spendable, 0);
  assert.equal(f.store.player(f.players[4].playerId).locked, 300);
  assert.equal(f.store.player(f.players[5].playerId).spendable, 40);
  assert.equal(JSON.stringify(result).includes('example.test'), false);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason='Costume contest'").get()?.n,
    8,
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

test('a tie for first is re-voted among the tied players until one player leads', (t) => {
  const f = setup(5);
  t.after(() => f.store.close());
  const close = () =>
    f.engine.execute(f.host, f.room.id, {
      requestId: randomUUID(),
      phaseInstance: 2,
      type: 'phase.close',
    });
  const vote = (from: number, to: number) =>
    f.engine.execute(f.sessions[from], f.room.id, f.cmd(f.players[to].playerId));
  // Round 1: players 0 and 1 tie with two votes each.
  [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 1],
    [4, 2],
  ].forEach(([from, to]) => vote(from!, to!));
  close();
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'reveal')));
  f.store.transaction(() => costumeHostAction(f.context(), 'revote'));
  // Round 2 ties again; the host must re-vote again, and still only the same two can win.
  [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 1],
  ].forEach(([from, to]) => vote(from!, to!));
  close();
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'reveal')));
  f.store.transaction(() => costumeHostAction(f.context(), 'revote'));
  assert.equal(costumeProjection(f.context(), 'display').round, 3);
  assert.deepEqual(
    costumeProjection(f.context(), 'display').candidates?.map((c) => c.playerId),
    [f.players[0].playerId, f.players[1].playerId],
  );
  // Round 3 has a clear leader.
  [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 0],
  ].forEach(([from, to]) => vote(from!, to!));
  close();
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'revote')));
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  const results = costumeProjection(f.context(), 'display').results!;
  const byId = new Map(results.map((result) => [result.playerId, result]));
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.place),
    [1, 2, 3, 4, 4],
  );
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.tokenChange),
    [1000, 800, 500, -250, -250],
  );
  // Revealed results can no longer be re-voted, and a repeat settles nothing twice.
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'revote')));
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason='Costume contest'").get()?.n,
    5,
  );
});

test('three-way ties for second place still share the second prize', (t) => {
  const f = setup(8);
  t.after(() => f.store.close());
  // Player 0 leads outright; players 1-3 tie for second and are not re-voted.
  [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 1],
    [6, 2],
    [7, 3],
  ].forEach(([from, to]) =>
    f.engine.execute(f.sessions[from!], f.room.id, f.cmd(f.players[to!].playerId)),
  );
  f.engine.execute(f.host, f.room.id, {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.close',
  });
  assert.deepEqual(costumeProjection(f.context(), 'host').tiedForFirst, []);
  f.store.transaction(() => costumeHostAction(f.context(), 'reveal'));
  const results = costumeProjection(f.context(), 'display').results!;
  const byId = new Map(results.map((result) => [result.playerId, result]));
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.tokenChange).slice(0, 4),
    [1000, 800, 800, 800],
  );
});
