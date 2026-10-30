import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';
import {
  costume,
  costumeReveal,
  costumeHostAction,
  costumeRevealHostAction,
  costumeRevealProjection,
  costumeRevealGroups,
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

type Fixture = ReturnType<typeof setup>;
/** Lock the standings, then announce every place so balances reflect the whole contest. */
function settle(f: Fixture) {
  f.store.transaction(() => costumeHostAction(f.context(), 'lock'));
  for (let i = 0; i < 10; i++)
    if (f.store.transaction(() => costumeRevealHostAction(f.context(), 'next')).done) return;
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
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'lock')));
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
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'lock')));
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
  settle(f);
  settle(f);
  const result = costumeProjection(f.context(), 'host').results!;
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
  settle(f);
  assert.deepEqual(
    f.players.map((p) => f.store.player(p.playerId).spendable),
    [1000, 1000, 1000],
  );
  assert.equal(costumeProjection(f.context(), 'host').results?.length, 3);
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
  settle(solo);
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
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'lock')));
  f.store.transaction(() => costumeHostAction(f.context(), 'revote'));
  // Round 2 ties again; the host must re-vote again, and still only the same two can win.
  [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 1],
  ].forEach(([from, to]) => vote(from!, to!));
  close();
  assert.throws(() => f.store.transaction(() => costumeHostAction(f.context(), 'lock')));
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
  settle(f);
  const results = costumeProjection(f.context(), 'host').results!;
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
  settle(f);
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
  settle(f);
  const results = costumeProjection(f.context(), 'host').results!;
  const byId = new Map(results.map((result) => [result.playerId, result]));
  assert.deepEqual(
    f.players.map((p) => byId.get(p.playerId)?.tokenChange).slice(0, 4),
    [1000, 800, 800, 800],
  );
});

test('costume winners are announced 3rd, 2nd, last, then 1st, and tokens move one step at a time', (t) => {
  const f = setup(6);
  t.after(() => f.store.close());
  // Counts: player 0 has 3 votes, player 1 has 2, player 2 has 1; players 3-5 have none and share last place.
  [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 1],
    [0, 2],
  ].forEach(([from, to]) =>
    f.engine.execute(f.sessions[from!], f.room.id, f.cmd(f.players[to!].playerId)),
  );
  f.engine.execute(f.host, f.room.id, {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.close',
  });
  const balances = () => f.players.map((p) => f.store.player(p.playerId).spendable);
  f.store.transaction(() => costumeHostAction(f.context(), 'lock'));
  assert.deepEqual(balances(), [1000, 1000, 1000, 1000, 1000, 1000]);
  // Locked standings stay private to the host until announced.
  assert.equal(costumeProjection(f.context(), 'player', f.players[0].playerId).results, null);
  assert.equal(costumeProjection(f.context(), 'display').locked, true);
  assert.equal(costumeRevealProjection(f.context(), 'host').upcoming.length, 4);
  const display = () => costumeRevealProjection(f.context(), 'display');
  assert.deepEqual(display(), {
    revealed: [],
    upcoming: [],
    step: 0,
    totalSteps: 5,
    list: null,
    listPending: false,
  });
  const next = () => f.store.transaction(() => costumeRevealHostAction(f.context(), 'next'));

  next();
  assert.deepEqual(
    display().revealed.map((g) => g.kind),
    ['third'],
  );
  assert.deepEqual(balances(), [1000, 1000, 1500, 1000, 1000, 1000]);
  assert.throws(() => costumeReveal.assertCanAdvance!(f.context()), /Reveal every costume place/);
  next();
  assert.deepEqual(balances(), [1000, 1800, 1500, 1000, 1000, 1000]);
  next();
  assert.deepEqual(balances(), [1000, 1800, 1500, 834, 834, 834]);
  assert.deepEqual(
    display().revealed.map((g) => g.kind),
    ['third', 'second', 'last'],
  );
  assert.equal(
    display().revealed.some((g) => g.kind === 'first'),
    false,
  );
  next();
  assert.deepEqual(balances(), [2000, 1800, 1500, 834, 834, 834]);
  // Every place is out, but the full list is one more click and the host cannot skip it.
  assert.equal(display().list, null);
  assert.equal(costumeRevealProjection(f.context(), 'host').listPending, true);
  assert.equal(display().listPending, false);
  assert.throws(() => costumeReveal.assertCanAdvance!(f.context()), /Reveal every costume place/);
  next();
  assert.deepEqual(
    display().list?.map((r) => [r.place, r.tokenChange]),
    [
      [1, 1000],
      [2, 800],
      [3, 500],
      [4, -166],
      [4, -166],
      [4, -166],
    ],
  );
  assert.deepEqual(balances(), [2000, 1800, 1500, 834, 834, 834]);
  costumeReveal.assertCanAdvance!(f.context());
  // A repeat announces nothing and moves no more tokens.
  assert.equal(next().done, true);
  assert.deepEqual(balances(), [2000, 1800, 1500, 834, 834, 834]);
  assert.equal(
    f.store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason='Costume contest'").get()?.n,
    6,
  );
});

test('reveal groups share a step for ties, skip empty places, and collapse for small parties', () => {
  const r = (playerId: string, place: number) => ({
    playerId,
    name: playerId,
    emoji: '🦊',
    place,
    votes: 0,
    tokenChange: 0,
  });
  const kinds = (places: number[]) =>
    costumeRevealGroups(places.map((place, i) => r(`p${i}`, place))).map((g) => g.kind);
  assert.deepEqual(kinds([1, 2, 3]), ['third', 'second', 'first']);
  assert.deepEqual(kinds([1, 2, 3, 4, 5]), ['third', 'second', 'last', 'first']);
  assert.deepEqual(kinds([1, 2, 2, 3]), ['third', 'second', 'first']);
  assert.deepEqual(
    costumeRevealGroups([r('a', 1), r('b', 2), r('c', 2), r('d', 3)])
      .find((g) => g.kind === 'second')
      ?.players.map((p) => p.playerId),
    ['b', 'c'],
  );
  assert.deepEqual(kinds([1, 1, 1]), ['first']);
  assert.deepEqual(kinds([1, 2]), ['all']);
  assert.deepEqual(kinds([1]), ['all']);
  assert.deepEqual(kinds([]), []);
});

test('the last-place penalty uses the balance at reveal time, and a stale step announces nothing', (t) => {
  const f = setup(6);
  t.after(() => f.store.close());
  // Votes: player 0 has 3, player 1 has 2, player 2 has 1; players 3-5 have none and share last place.
  [
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [5, 1],
    [0, 2],
  ].forEach(([from, to]) =>
    f.engine.execute(f.sessions[from!], f.room.id, f.cmd(f.players[to!].playerId)),
  );
  f.engine.execute(f.host, f.room.id, {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.close',
  });
  // Player 3 is broke when standings lock, then regains tokens before the winners are announced.
  f.store.db.prepare('UPDATE players SET spendable=0 WHERE id=?').run(f.players[3].playerId);
  f.store.transaction(() => costumeHostAction(f.context(), 'lock'));
  f.store.db.prepare('UPDATE players SET spendable=1000 WHERE id=?').run(f.players[3].playerId);
  const next = (step?: number) =>
    f.store.transaction(() => costumeRevealHostAction(f.context(), 'next', step));
  next(0);
  // A second tap that still carries step 0 is rejected rather than announcing another place.
  assert.throws(() => next(0), /already announced/);
  assert.equal(costumeRevealProjection(f.context(), 'display').step, 1);
  while (!next().done);
  assert.equal(f.store.player(f.players[3].playerId).spendable, 834);
  assert.equal(f.store.player(f.players[4].playerId).spendable, 834);
  assert.equal(
    costumeRevealProjection(f.context(), 'display').revealed.find((g) => g.kind === 'last')
      ?.players[0]?.tokenChange,
    -166,
  );
});
