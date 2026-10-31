import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import type { Session } from '../src/server/core/store.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';

const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
const password = 'undo-test-host-password';
async function fixture(databasePath = ':memory:') {
  const app = createApp({ databasePath, hostPassword: password, now: () => 1000000 });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
    true,
  );
  const execute = (
    action: string,
    data: Record<string, unknown> = {},
    requestId = randomUUID(),
    session = host,
  ) =>
    app.engine.execute(session, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId,
      payload: { action, data },
    });
  const snapshot = () => app.engine.snapshot({ role: 'host', roomId: room.id });
  return { app, room, execute, snapshot };
}

test('host undo reverses exactly the original team award once, preserving accounts and private history', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const team = f.snapshot().trivia!.teams[0];
  const before = f.app.store.players(f.room.id).map((p) => ({ id: p.id, spendable: p.spendable }));
  const awardId = randomUUID();
  f.execute('award', { teamId: team.id, amount: 100 }, awardId);
  const player: Session = {
    role: 'player',
    roomId: f.room.id,
    playerId: f.room.playerId,
    tokenHash: '',
  };
  assert.throws(() => f.execute('undo-award', { awardId }, randomUUID(), player), /Only the host/);
  assert.throws(() => f.execute('undo-award', { awardId: randomUUID() }), /does not belong/);
  assert.equal(
    f.app.engine.snapshot({ role: 'display', roomId: f.room.id }).trivia?.awardHistory,
    undefined,
  );
  assert.equal(
    f.app.engine.snapshot({ role: 'player', roomId: f.room.id, playerId: f.room.playerId }).trivia
      ?.awardHistory,
    undefined,
  );
  assert.equal(f.snapshot().trivia!.awardHistory![0].question, 1);
  const undoId = randomUUID();
  f.execute('undo-award', { awardId }, undoId);
  f.execute('undo-award', { awardId }, undoId);
  f.execute('undo-award', { awardId });
  f.execute('award', { teamId: team.id, amount: 100 }, awardId);
  assert.equal(f.snapshot().trivia!.awardHistory![0].undone, true);
  assert.deepEqual(
    f.app.store.players(f.room.id).map((p) => ({ id: p.id, spendable: p.spendable })),
    before,
  );
  const entries = f.app.store.db
    .prepare("SELECT * FROM ledger WHERE room_id=? AND reason='Undo trivia team award'")
    .all(f.room.id);
  assert.equal(entries.length, team.members.length);
  f.execute('award', { teamId: team.id, amount: 100 });
  assert.equal(f.snapshot().trivia!.awardHistory!.length, 2);
  assert.equal(f.snapshot().trivia!.awardHistory![0].undone, false);
  f.app.engine.execute(host, f.room.id, {
    requestId: randomUUID(),
    type: 'phase.close',
    phaseInstance: f.app.store.room(f.room.id).phase_instance,
  });
  assert.throws(() => f.execute('undo-award', { awardId }), /Trivia is closed/);
});

test('failed undo rolls back all teammate debits and never touches locked/reserved funds', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const members = f.snapshot().trivia!.teams[0].members;
  const awardId = randomUUID();
  f.execute('award', { teamId: 1, amount: 100 }, awardId);
  const last = [...members].sort((a, b) => a.id.localeCompare(b.id)).at(-1)!;
  f.app.store.transaction(() =>
    f.app.store.adjust(
      f.room.id,
      last.id,
      'fixture-lock',
      'Fixture lock',
      { spendable: -1100, locked: 1000, reserved: 100 },
      1000000,
    ),
  );
  const before = f.app.store.players(f.room.id);
  assert.throws(() => f.execute('undo-award', { awardId }), /Not enough available tokens/);
  assert.deepEqual(f.app.store.players(f.room.id), before);
  assert.equal(f.snapshot().trivia!.awardHistory![0].undone, false);
  assert.equal(
    f.app.store.db
      .prepare("SELECT COUNT(*) AS count FROM ledger WHERE reason='Undo trivia team award'")
      .get()?.count,
    0,
  );
});

test('version-9 awards migrate without deletion, and undo persists across restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-undo-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  const f = await fixture(path);
  const awardId = randomUUID();
  f.execute('award', { teamId: 1, amount: 100 }, awardId);
  f.app.store.db.exec('DROP TABLE trivia_award_receipts; PRAGMA user_version=9');
  await f.app.close();
  let app = createApp({ databasePath: path, hostPassword: password });
  assert.equal(app.store.db.prepare('PRAGMA user_version').get()?.user_version, 20);
  const phaseInstance = app.store.room(f.room.id).phase_instance;
  assert.equal(
    app.engine.snapshot({ role: 'host', roomId: f.room.id }).trivia!.awardHistory![0].question,
    null,
  );
  const undo = {
    type: 'phase.host' as const,
    phaseInstance,
    requestId: randomUUID(),
    payload: { action: 'undo-award', data: { awardId } },
  };
  app.engine.execute(host, f.room.id, undo);
  const players = app.store.players(f.room.id);
  assert.ok(players.every((p) => p.spendable === 1000));
  await app.close();
  app = createApp({ databasePath: path, hostPassword: password });
  t.after(() => app.close());
  app.engine.execute(host, f.room.id, { ...undo, requestId: randomUUID() });
  assert.deepEqual(app.store.players(f.room.id), players);
  assert.equal(
    app.engine.snapshot({ role: 'host', roomId: f.room.id }).trivia!.awardHistory![0].undone,
    true,
  );
});
