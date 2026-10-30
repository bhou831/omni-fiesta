import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/server/core/store.js';
import { loadConfig } from '../src/server/config.js';
import {
  createTrivia,
  triviaHostAction,
  triviaProjection,
  TRIVIA_SCHEMA,
} from '../src/server/games/trivia.js';
import type { PhaseContext } from '../src/server/core/phases.js';

function fixture(count: number) {
  const store = new Store(':memory:');
  store.db.exec(TRIVIA_SCHEMA);
  const config = loadConfig();
  delete config.trivia.board_values;
  const room = store.transaction(() => store.createRoom(config, 'party', 1000));
  const players = Array.from(
    { length: count },
    (_, i) =>
      store.join(
        store.room(room.id),
        { name: `Player ${i}`, emoji: '🦊', email: `person${i}@example.test`, phone: '2125550100' },
        randomUUID(),
        1000,
      ).playerId,
  );
  store.db.prepare("UPDATE rooms SET phase='trivia',phase_instance=3 WHERE id=?").run(room.id);
  const context = (): PhaseContext => ({ store, room: store.room(room.id), config, now: 1000 });
  const module = createTrivia();
  store.transaction(() => module.open!(context()));
  const host = (action: string, data: Record<string, unknown> = {}, id = randomUUID()) =>
    store.transaction(() => triviaHostAction(context(), action, data, id, () => 0));
  const buzz = (id: string, windowId: number) =>
    store.transaction(() => module.action(context(), id, 'buzz', { windowId }));
  return { store, context, players, host, buzz };
}

test('teams are balanced, frozen, public projections exclude contacts, and a single first buzz wins', (t) => {
  const f = fixture(8);
  t.after(() => f.store.close());
  f.host('assign', { count: 3 });
  let projection = triviaProjection(f.context(), f.players[0]);
  assert.deepEqual(projection.teams.map((team) => team.members.length).sort(), [2, 3, 3]);
  assert.equal(JSON.stringify(projection).includes('example.test'), false);
  assert.equal(JSON.stringify(projection).includes('2125550100'), false);
  assert.ok(projection.ownTeamId);
  f.host('new-question');
  f.host('arm');
  projection = triviaProjection(f.context(), f.players[0]);
  assert.equal(f.buzz(f.players[0], projection.windowId).accepted, true);
  assert.throws(() => f.buzz(f.players[1], projection.windowId));
  assert.equal(triviaProjection(f.context()).winner?.playerId, f.players[0]);
  assert.throws(() => f.host('assign', { count: 2 }));
});

test('incorrect team is excluded on a fresh window; stale windows never win; next question clears exclusion', (t) => {
  const f = fixture(4);
  t.after(() => f.store.close());
  f.host('assign', { count: 2 });
  f.host('new-question');
  f.host('arm');
  const first = triviaProjection(f.context(), f.players[0]);
  f.buzz(f.players[0], first.windowId);
  f.host('incorrect');
  f.host('arm');
  const reopened = triviaProjection(f.context(), f.players[0]);
  assert.ok(reopened.windowId > first.windowId);
  assert.throws(() => f.buzz(f.players[0], first.windowId));
  assert.throws(() => f.buzz(f.players[0], reopened.windowId));
  const other = f.players.find(
    (p) => triviaProjection(f.context(), p).ownTeamId !== first.ownTeamId,
  )!;
  assert.equal(f.buzz(other, reopened.windowId).accepted, true);
  f.host('new-question');
  assert.ok(triviaProjection(f.context()).teams.every((team) => !team.excluded));
});

test('team awards are idempotent per request and credit every member, including one-team games', (t) => {
  const f = fixture(4);
  t.after(() => f.store.close());
  f.host('assign', { count: 1 });
  const request = randomUUID();
  f.host('award', { teamId: 1, amount: 100 }, request);
  f.host('award', { teamId: 1, amount: 100 }, request);
  assert.deepEqual(
    f.players.map((p) => f.store.player(p).spendable),
    [1100, 1100, 1100, 1100],
  );
  assert.throws(() => f.host('award', { teamId: 1, amount: 200 }, request));
  f.host('award', { teamId: 1, amount: 100 }, randomUUID());
  assert.deepEqual(
    f.players.map((p) => f.store.player(p).spendable),
    [1200, 1200, 1200, 1200],
  );
  assert.throws(() => f.host('assign', { count: 1 }));
  assert.throws(() => f.host('award', { teamId: 1, amount: 0 }));
});
