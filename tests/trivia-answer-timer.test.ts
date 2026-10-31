import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';
import { createTriviaContent, DEMO_TRIVIA_BANK } from '../src/server/games/trivia-content.js';
import type { Session } from '../src/server/core/store.js';

const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
test('limited categories and geography tier ranks permit only two teams', async (t) => {
  for (const cellId of [
    'geography-1',
    'geography-2',
    'geography-3',
    'random-1',
    'random-2',
    'random-3',
    'random-4',
    'random-5',
  ]) {
    const app = createApp({
      databasePath: ':memory:',
      hostPassword: 'synthetic-test-password',
      now: () => 1_000_000,
    });
    t.after(() => app.close());
    const room = await seedPreviewRoom(
      app.engine,
      PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
    );
    const send = (action: string, data: Record<string, unknown> = {}) =>
      app.engine.execute(host, room.id, {
        type: 'phase.host',
        phaseInstance: app.store.room(room.id).phase_instance,
        requestId: randomUUID(),
        payload: { action, data: { cellId, ...data } },
      });
    const state = () => app.engine.snapshot({ role: 'host', roomId: room.id }).trivia!;
    send('assign', { count: 4 });
    send('select-cell', { teamId: 1 });
    assert.equal(state().controls?.attemptLimit, 2);
    send('incorrect', { attempt: 1 });
    send('arm');
    const playerId = state().teams.find((team) => team.id === 2)!.members[0].id;
    app.engine.execute({ role: 'player', roomId: room.id, playerId, tokenHash: '' }, room.id, {
      type: 'phase.action',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId: randomUUID(),
      payload: { action: 'buzz', data: { windowId: state().windowId } },
    });
    send('incorrect', { attempt: 2 });
    assert.throws(() => send('arm'));
    send('finish-cell');
  }
});
test('four distinct teams can attempt an ordinary clue with a fresh timer each', async (t) => {
  let now = 1_000_000;
  const app = createApp({
    databasePath: ':memory:',
    hostPassword: 'synthetic-test-password',
    now: () => now,
  });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const send = (action: string, data: Record<string, unknown> = {}) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId: randomUUID(),
      payload: { action, data: { cellId: 'childhood-1', ...data } },
    });
  const state = () => app.engine.snapshot({ role: 'host', roomId: room.id }).trivia!;
  send('assign', { count: 4 });
  assert.throws(() => send('select-cell'));
  send('select-cell', { teamId: 1 });
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.equal(state().answerAttempt?.teamId, attempt);
    assert.equal(state().answerAttempt?.deadlineAt, now + 90_000);
    send('incorrect', { attempt });
    assert.equal(state().teams.find((team) => team.id === attempt)?.excluded, true);
    if (attempt === 4) break;
    send('arm');
    const windowId = state().windowId;
    const playerId = state().teams.find((team) => team.id === attempt + 1)!.members[0].id;
    now += 1000;
    app.engine.execute({ role: 'player', roomId: room.id, playerId, tokenHash: '' }, room.id, {
      type: 'phase.action',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId: randomUUID(),
      payload: { action: 'buzz', data: { windowId } },
    });
  }
  assert.throws(() => send('arm'));
  send('reveal-answer');
  send('finish-cell');
});
test('ordinary attempts expire atomically, exclude teams and survive restart', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-timer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let now = 1_000_000;
  let app = createApp({
    databasePath: path,
    hostPassword: 'synthetic-test-password',
    now: () => now,
  });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const demo = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(demo), room.id);
  const send = (action: string, data: Record<string, unknown> = {}, requestId = randomUUID()) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId,
      payload: { action, data: { cellId: 'childhood-1', ...data } },
    });
  const state = () => app.engine.snapshot({ role: 'host', roomId: room.id }).trivia!;
  assert.throws(() => send('select-cell'));
  const requestId = randomUUID();
  send('select-cell', { teamId: 1 }, requestId);
  send('select-cell', { teamId: 1 }, requestId);
  assert.equal(state().answerAttempt?.deadlineAt, 1_090_000);
  assert.equal(state().winner, null);
  const tv = app.engine.snapshot({ role: 'display', roomId: room.id }).trivia!;
  const phone = app.engine.snapshot({
    role: 'player',
    roomId: room.id,
    playerId: room.playerId,
  }).trivia!;
  assert.equal(tv.answerAttempt?.deadlineAt, 1_090_000);
  assert.equal(phone.answerAttempt?.teamId, 1);
  assert.equal(phone.board, undefined);
  assert.equal(phone.awardHistory, undefined);
  assert.equal(tv.awardHistory, undefined);
  now = 1_090_000;
  assert.throws(() => send('award', { teamId: 1, amount: 100, attempt: 1 }));
  assert.equal(state().answerAttempt?.status, 'failed');
  assert.equal(state().teams.find((team) => team.id === 1)?.excluded, true);
  assert.equal(app.store.room(room.id).status, 'open');
  await app.close();
  app = createApp({ databasePath: path, hostPassword: 'synthetic-test-password', now: () => now });
  t.after(() => app.close());
  assert.equal(state().teams.find((team) => team.id === 1)?.excluded, true);
  send('arm');
  const windowId = state().windowId;
  const buzz = (team: number, window = windowId) => {
    const playerId = state().teams.find((entry) => entry.id === team)!.members[0].id;
    return app.engine.execute(
      { role: 'player', roomId: room.id, playerId, tokenHash: '' },
      room.id,
      {
        type: 'phase.action',
        phaseInstance: app.store.room(room.id).phase_instance,
        requestId: randomUUID(),
        payload: { action: 'buzz', data: { windowId: window } },
      },
    );
  };
  assert.throws(() => buzz(1));
  buzz(2);
  assert.equal(state().answerAttempt?.deadlineAt, 1_180_000);
  assert.throws(() => buzz(3, windowId - 1));
  assert.throws(() => send('incorrect', { attempt: 1 }));
  now = 1_100_000;
  send('incorrect', { attempt: 2 });
  assert.equal(state().teams.find((team) => team.id === 2)?.excluded, true);
  assert.throws(() => send('arm'));
  send('reveal-answer');
  send('finish-cell');
  assert.equal(
    state().teams.some((team) => team.excluded),
    true,
  ); // scoped to prior clue until next selection
  send('select-cell', { cellId: 'childhood-2', teamId: 1 });
  assert.equal(
    state().teams.some((team) => team.excluded),
    false,
  );
});

test('early wrong answer starts a fresh second timer and timeout cannot award or open a third', async (t) => {
  let now = 1_000_000;
  const app = createApp({
    databasePath: ':memory:',
    hostPassword: 'synthetic-test-password',
    now: () => now,
  });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const demo = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(demo), room.id);
  const send = (action: string, data: Record<string, unknown> = {}, requestId = randomUUID()) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId,
      payload: { action, data: { cellId: 'childhood-1', ...data } },
    });
  const snapshot = () => app.engine.snapshot({ role: 'host', roomId: room.id }).trivia!;
  send('select-cell', { teamId: 1 });
  now += 10_000;
  send('incorrect', { attempt: 1 });
  send('arm');
  const team = snapshot().teams.find((entry) => entry.id === 2)!;
  const windowId = snapshot().windowId;
  const playerId = team.members[0].id;
  const buzzId = randomUUID();
  const buzz = () =>
    app.engine.execute({ role: 'player', roomId: room.id, playerId, tokenHash: '' }, room.id, {
      type: 'phase.action',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId: buzzId,
      payload: { action: 'buzz', data: { windowId } },
    });
  buzz();
  now += 20_000;
  buzz();
  assert.equal(snapshot().answerAttempt?.deadlineAt, 1_100_000);
  now = 1_100_000;
  assert.equal(app.engine.expireAll().includes(room.id), true);
  assert.equal(app.engine.expireAll().includes(room.id), false);
  assert.equal(snapshot().answerAttempt?.status, 'failed');
  assert.throws(() => send('award', { attempt: 2, teamId: 2, amount: 100 }));
  assert.throws(() => send('arm'));
  assert.equal(
    snapshot().teams.reduce((sum, item) => sum + (item.score ?? 0), 0),
    0,
  );
  send('reveal-answer');
  send('finish-cell');
});

test('early correct award is idempotent and the original timer cannot change it', async (t) => {
  let now = 1_000_000;
  const app = createApp({
    databasePath: ':memory:',
    hostPassword: 'synthetic-test-password',
    now: () => now,
  });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const demo = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(demo), room.id);
  const send = (action: string, data: Record<string, unknown> = {}, requestId = randomUUID()) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId,
      payload: { action, data: { cellId: 'childhood-1', ...data } },
    });
  const state = () => app.engine.snapshot({ role: 'host', roomId: room.id }).trivia!;
  send('select-cell', { teamId: 1 });
  const id = randomUUID();
  send('award', { teamId: 1, amount: 100, attempt: 1 }, id);
  send('award', { teamId: 1, amount: 100, attempt: 1 }, id);
  assert.throws(() => send('award', { teamId: 1, amount: 100, attempt: 1 }));
  now = 1_100_000;
  app.engine.expireAll();
  assert.equal(state().teams.find((team) => team.id === 1)?.score, 100);
  assert.equal(state().teams.find((team) => team.id === 1)?.excluded, false);
  send('undo-award', { awardId: id });
  send('award', { teamId: 2, amount: 100, attempt: 1 });
  assert.equal(state().teams.find((team) => team.id === 1)?.score, 0);
  assert.equal(state().teams.find((team) => team.id === 2)?.score, 100);
});

test('startup reconciles an overdue active answer without closing the trivia phase', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-restart-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let now = 1_000_000;
  let app = createApp({
    databasePath: path,
    hostPassword: 'synthetic-test-password',
    now: () => now,
  });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const demo = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(demo), room.id);
  app.engine.execute(host, room.id, {
    type: 'phase.host',
    phaseInstance: app.store.room(room.id).phase_instance,
    requestId: randomUUID(),
    payload: { action: 'select-cell', data: { cellId: 'childhood-1', teamId: 1 } },
  });
  await app.close();
  now = 1_090_000;
  app = createApp({ databasePath: path, hostPassword: 'synthetic-test-password', now: () => now });
  t.after(() => app.close());
  const snapshot = app.engine.snapshot({ role: 'host', roomId: room.id });
  assert.equal(snapshot.room.status, 'open');
  assert.equal(snapshot.trivia?.answerAttempt?.status, 'failed');
  assert.equal(snapshot.trivia?.teams.find((team) => team.id === 1)?.excluded, true);
});

test('music controls do not modify the answering deadline', async (t) => {
  let now = 1_000_000;
  const app = createApp({
    databasePath: ':memory:',
    hostPassword: 'synthetic-test-password',
    now: () => now,
  });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const demo = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(demo), room.id);
  const cellId = demo.cells.find((cell) => cell.kind === 'music')!.id;
  const send = (action: string, data: Record<string, unknown> = {}) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId: randomUUID(),
      payload: { action, data: { cellId, ...data } },
    });
  send('select-cell', { teamId: 1 });
  now += 1000;
  send('music-start');
  now += 1000;
  send('music-stop');
  assert.equal(
    app.engine.snapshot({ role: 'host', roomId: room.id }).trivia?.answerAttempt?.deadlineAt,
    1_090_000,
  );
});
