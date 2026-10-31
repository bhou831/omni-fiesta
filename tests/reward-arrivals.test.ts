import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';
import { createSlotsModule } from '../src/server/games/slots.js';
import { RewardArrivals } from '../src/client/reward-arrivals.js';
import type { RoomSnapshot } from '../src/shared/contracts.js';

const snapshot = (sequence: number, id: number, serverInstance = 'server-a') =>
  ({
    serverInstance,
    snapshotSequence: sequence,
    self: { rewardCue: { id, kind: 'trivia' } },
  }) as RoomSnapshot;
test('live reward arrivals ignore baselines, duplicates, gaps, stale packets, hidden pages and reconnect history', () => {
  const arrivals = new RewardArrivals();
  assert.equal(arrivals.accept(snapshot(1, 5), true).cue, null);
  assert.equal(arrivals.accept(snapshot(2, 6), true).cue?.id, 6);
  assert.equal(arrivals.accept(snapshot(2, 6), true).accepted, false);
  assert.equal(arrivals.accept(snapshot(1, 5), true).accepted, false);
  assert.equal(arrivals.accept(snapshot(5, 9), true).cue?.id, 9);
  assert.equal(arrivals.accept(snapshot(6, 9), true).cue, null);
  assert.equal(arrivals.accept(snapshot(7, 10), false).cue, null);
  arrivals.reset();
  assert.equal(arrivals.accept(snapshot(8, 11), true).cue, null);
  assert.equal(arrivals.accept(snapshot(9, 12), true).cue?.id, 12);
  assert.equal(arrivals.accept(snapshot(1, 13, 'server-b'), true).cue, null);
  assert.equal(arrivals.accept(snapshot(2, 14, 'server-b'), true).cue?.id, 14);
});

test('a 100-token slot payout triggers a private saved cue despite the 200-token cost; retries stay quiet', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'reward-test-password' });
  t.after(() => app.store.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'slots')!,
  );
  // Exercise an older saved room whose positive return is below the spin cost.
  const savedConfig = JSON.parse(app.store.room(room.id).config);
  savedConfig.slots.outcomes[2].gross_payout_tokens = 100;
  app.store.db
    .prepare('UPDATE rooms SET config=? WHERE id=?')
    .run(JSON.stringify(savedConfig), room.id);
  app.engine.modules.set(
    'slots',
    createSlotsModule((max) => (max * 35n) / 100n),
  );
  const player = {
    role: 'player' as const,
    roomId: room.id,
    playerId: room.playerId,
    tokenHash: '',
  };
  const before = app.engine.snapshot(player);
  assert.equal(before.self!.rewardCue, null);
  const command = {
    requestId: randomUUID(),
    phaseInstance: before.room.phaseInstance,
    type: 'phase.action' as const,
    payload: { action: 'spin' },
  };
  app.engine.execute(player, room.id, command);
  const after = app.engine.snapshot(player);
  assert.equal(after.self!.accounts.spendable, before.self!.accounts.spendable - 100);
  assert.equal(after.self!.rewardCue?.kind, 'slots');
  const saved = after.self!.rewardCue;
  app.engine.execute(player, room.id, command);
  assert.deepEqual(app.engine.snapshot(player).self!.rewardCue, saved);
  const display = app.engine.snapshot({ role: 'display', roomId: room.id });
  assert.equal(display.self, undefined);
  assert.doesNotMatch(JSON.stringify(display), /rewardCue|reward_kind/);
  app.engine.modules.set(
    'slots',
    createSlotsModule((max) => (max * 9n) / 10n),
  );
  app.engine.execute(player, room.id, { ...command, requestId: randomUUID() });
  assert.deepEqual(app.engine.snapshot(player).self!.rewardCue, saved);
});

test('settlement cues distinguish profits and prizes from principal, losses, grants and reservations', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'reward-test-password' });
  t.after(() => app.store.close());
  for (const key of [
    'investment-review',
    'powerball-results',
    'costume-results',
    'trivia-scoreboard',
  ] as const) {
    const room = await seedPreviewRoom(
      app.engine,
      PREVIEW_SCENARIOS.find((s) => s.key === key)!,
    );
    const ledger = app.store.db
      .prepare('SELECT spendable,locked,reserved,reward_kind,reason FROM ledger WHERE room_id=?')
      .all(room.id);
    assert.ok(
      ledger.some((row) => row.reward_kind),
      key,
    );
    for (const row of ledger) {
      if (row.reason === 'Investment settlement')
        assert.equal(
          row.reward_kind,
          Number(row.spendable) + Number(row.locked) > 0 ? 'investment' : null,
        );
      if (row.reason === 'Powerball settlement')
        assert.equal(
          row.reward_kind,
          Number(row.spendable) + Number(row.reserved) > 0 ? 'powerball' : null,
        );
      if (Number(row.spendable) <= 0) assert.equal(row.reward_kind, null);
    }
    assert.ok(
      ledger
        .filter((row) => row.reason === 'Initial grant')
        .every((row) => row.reward_kind === null),
    );
  }
});
