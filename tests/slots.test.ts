import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/server/config.js';
import { Store } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import {
  createSlotsModule,
  drawSlotOutcome,
  slotsDisplayState,
  slotsPlayerState,
  slotsSchema,
  slotWeights,
} from '../src/server/games/slots.js';
import type { Command } from '../src/shared/contracts.js';

function setup(samples: bigint[] = []) {
  const store = new Store(':memory:');
  store.db.exec(slotsSchema);
  const config = loadConfig();
  let now = 1_000_000;
  let draws = 0;
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  const joined = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦊', email: 'fox@example.test', phone: '2125550100' },
    randomUUID(),
    now,
  );
  const player = store.authenticate(joined.token, 'player', now, '')!;
  store.db
    .prepare(
      "UPDATE rooms SET phase='slots',phase_instance=4,status='open',opened_at=?,deadline_at=? WHERE id=?",
    )
    .run(now, now + 1000, room.id);
  const engine = new Engine(store, () => now, [
    createSlotsModule(() => {
      const value = samples[draws] ?? 0n;
      draws++;
      return value;
    }),
  ]);
  const command = (): Command => ({
    requestId: randomUUID(),
    phaseInstance: 4,
    type: 'phase.action',
    payload: { action: 'spin' },
  });
  return {
    store,
    config,
    room,
    joined,
    player,
    engine,
    command,
    draws: () => draws,
    setNow: (n: number) => {
      now = n;
    },
  };
}

test('slot weights and boundaries exactly follow configured probabilities', () => {
  const slots = loadConfig().slots;
  assert.deepEqual(slotWeights(slots), [1n, 2n, 3n, 4n]);
  for (const [sample, gross] of [
    [0n, 500],
    [1n, 300],
    [2n, 300],
    [3n, 100],
    [5n, 100],
    [6n, 0],
    [9n, 0],
  ] as const)
    assert.equal(
      drawSlotOutcome(slots, () => sample),
      gross,
    );
  assert.throws(() => drawSlotOutcome(slots, () => 10n));
  const fine = {
    ...slots,
    outcomes: [
      { gross_payout_tokens: 1, probability: 0.00000001 },
      { gross_payout_tokens: 0, probability: 0.99999999 },
    ],
  };
  assert.deepEqual(slotWeights(fine), [1n, 99999999n]);
});

test('accepted spin is charged and saved once; retry survives closure and reconnect', (t) => {
  const f = setup([6n]);
  t.after(() => f.store.close());
  const spin = f.command();
  const first = f.engine.execute(f.player, f.room.id, spin);
  assert.equal(first.result.gross, 0);
  assert.equal(first.result.net, -200);
  assert.equal(first.result.finalBalance, 800);
  f.setNow(1_001_000);
  assert.deepEqual(f.engine.execute(f.player, f.room.id, spin), first);
  assert.equal(f.draws(), 1);
  assert.equal(f.store.player(f.joined.playerId).spendable, 800);
  const restored = slotsPlayerState(f.engine.context(f.store.room(f.room.id)), f.joined.playerId);
  assert.equal(restored.spins.length, 1);
  assert.equal(restored.spins[0].id, first.result.id);
  assert.throws(() => f.engine.execute(f.player, f.room.id, f.command()));
  assert.deepEqual(slotsDisplayState(f.engine.context(f.store.room(f.room.id))), {
    cost: 200,
    limit: 3,
    spins: 1,
    players: 1,
  });
  const exposed = JSON.stringify(slotsDisplayState(f.engine.context(f.store.room(f.room.id))));
  assert.doesNotMatch(exposed, /gross|net|balance|attempt|example\.test|Fox/);
});

test('distinct requests cannot overspend or exceed attempt limit', (t) => {
  const f = setup([6n, 6n, 6n, 6n]);
  t.after(() => f.store.close());
  for (let i = 0; i < 3; i++) f.engine.execute(f.player, f.room.id, f.command());
  assert.equal(f.store.player(f.joined.playerId).spendable, 400);
  assert.throws(() => f.engine.execute(f.player, f.room.id, f.command()));
  assert.equal(f.draws(), 3);
  const other = setup([6n]);
  t.after(() => other.store.close());
  other.store.transaction(() =>
    other.store.adjust(
      other.room.id,
      other.joined.playerId,
      'test-debit',
      'Test',
      { spendable: -850, locked: 0, reserved: 0 },
      1_000_000,
    ),
  );
  assert.throws(() => other.engine.execute(other.player, other.room.id, other.command()));
  assert.equal(other.draws(), 0);
  assert.equal(other.store.player(other.joined.playerId).spendable, 150);
});

test('competing spin commands serialize and failed persistence rolls back charging', async (t) => {
  const f = setup([0n, 0n, 0n, 0n]);
  t.after(() => f.store.close());
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      Promise.resolve().then(() => f.engine.execute(f.player, f.room.id, f.command())),
    ),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(f.draws(), 3);
  assert.equal(f.store.player(f.joined.playerId).spendable, 1900);
  assert.equal(
    slotsPlayerState(f.engine.context(f.store.room(f.room.id)), f.joined.playerId).spins.length,
    3,
  );
  const failure = setup([0n]);
  t.after(() => failure.store.close());
  failure.store.db.exec(
    "CREATE TRIGGER fail_slot_insert BEFORE INSERT ON slot_spins BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  assert.throws(() => failure.engine.execute(failure.player, failure.room.id, failure.command()));
  assert.equal(failure.store.player(failure.joined.playerId).spendable, 1000);
  assert.equal(failure.store.db.prepare('SELECT count(*) AS n FROM slot_spins').get()?.n, 0);
  assert.equal(
    failure.store.db
      .prepare('SELECT count(*) AS n FROM ledger WHERE reason LIKE ?')
      .get('Slot spin%')?.n,
    0,
  );
});
