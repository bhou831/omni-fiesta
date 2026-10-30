import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/server/config.js';
import { Store } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import {
  callingHostAction,
  callingHostState,
  callingPublicState,
  somebodyCalling,
  somebodyCallingSchema,
} from '../src/server/games/somebody-calling.js';

test('secret draw includes disconnected players, does not affect balances, and reveals exactly once', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.db.exec(somebodyCallingSchema);
  const config = loadConfig();
  const now = 1_000_000;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const one = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦦', email: 'fox@example.test', phone: '1112223333' },
    randomUUID(),
    now,
  );
  const two = store.join(
    store.room(room.id),
    { name: 'Frog', emoji: '🐸', email: 'frog@example.test', phone: '4445556666' },
    randomUUID(),
    now + 1,
  );
  store.db
    .prepare("UPDATE rooms SET phase='somebody-calling',phase_instance=7 WHERE id=?")
    .run(room.id);
  const engine = new Engine(store, () => now, [somebodyCalling]);
  engine.presence(one.playerId, 1); // Second player has never connected but remains eligible.
  const context = () => engine.context(store.room(room.id));
  const before = callingPublicState(context());
  let draws = 0;
  store.transaction(() =>
    callingHostAction(context(), 'draw', (max) => {
      draws++;
      assert.equal(max, 2);
      return 1;
    }),
  );
  assert.deepEqual(callingPublicState(context()), before);
  assert.equal(callingHostState(context()).selected?.id, two.playerId);
  assert.equal(callingHostState(context()).selected?.phone, '4445556666');
  assert.equal(store.player(one.playerId).spendable, 1000);
  assert.equal(store.player(two.playerId).spendable, 1000);
  store.transaction(() =>
    callingHostAction(context(), 'draw', () => {
      throw new Error('reroll');
    }),
  );
  assert.equal(draws, 1);
  assert.throws(() => somebodyCalling.assertCanAdvance!(context()));
  store.transaction(() => callingHostAction(context(), 'reveal'));
  store.transaction(() => callingHostAction(context(), 'reveal'));
  assert.equal(store.player(two.playerId).spendable, 1500);
  assert.equal(store.player(one.playerId).spendable, 1000);
  assert.deepEqual(callingPublicState(context()), {
    revealed: true,
    winner: { name: 'Frog', emoji: '🐸', award: 500 },
  });
  assert.doesNotMatch(JSON.stringify(callingPublicState(context())), /4445556666|example\.test/);
  assert.doesNotThrow(() => somebodyCalling.assertCanAdvance!(context()));
});

test('selection and reveal survive restart, and a failed reveal rolls back its award', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'calling-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let store = new Store(path);
  store.db.exec(somebodyCallingSchema);
  const now = 1_000_000,
    config = loadConfig();
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const joined = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦦', email: 'fox@example.test', phone: '1112223333' },
    randomUUID(),
    now,
  );
  store.db
    .prepare("UPDATE rooms SET phase='somebody-calling',phase_instance=7 WHERE id=?")
    .run(room.id);
  let engine = new Engine(store, () => now, [somebodyCalling]);
  store.transaction(() => callingHostAction(engine.context(store.room(room.id)), 'draw', () => 0));
  store.close();
  store = new Store(path);
  engine = new Engine(store, () => now + 1, [somebodyCalling]);
  assert.equal(callingHostState(engine.context(store.room(room.id))).selected?.id, joined.playerId);
  store.db.exec(
    "CREATE TRIGGER fail_reveal BEFORE UPDATE ON phone_draws BEGIN SELECT RAISE(ABORT,'failed reveal'); END",
  );
  assert.throws(() =>
    store.transaction(() => callingHostAction(engine.context(store.room(room.id)), 'reveal')),
  );
  assert.equal(store.player(joined.playerId).spendable, 1000);
  assert.equal(callingPublicState(engine.context(store.room(room.id))).revealed, false);
  store.db.exec('DROP TRIGGER fail_reveal');
  store.transaction(() => callingHostAction(engine.context(store.room(room.id)), 'reveal'));
  store.close();
  store = new Store(path);
  engine = new Engine(store, () => now + 2, [somebodyCalling]);
  assert.equal(callingPublicState(engine.context(store.room(room.id))).revealed, true);
  assert.equal(store.player(joined.playerId).spendable, 1500);
  store.close();
});
