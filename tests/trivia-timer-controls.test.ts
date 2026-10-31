import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/server/app.js';
import { hash, Store, type Session } from '../src/server/core/store.js';
import type { RoomSnapshot } from '../src/shared/contracts.js';
import { createTriviaContent, DEMO_TRIVIA_BANK } from '../src/server/games/trivia-content.js';
import { TriviaHost, TriviaDisplay, TriviaPlayer } from '../src/client/Trivia.js';
import { triviaPlaybackPosition } from '../src/client/trivia-playback.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';

const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
async function fixture(path = ':memory:') {
  let now = 1_000_000;
  let app = createApp({ databasePath: path, hostPassword: 'synthetic-timer-test', now: () => now });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const bank = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  bank.adventureQuestionBank = {
    charades: Array.from({ length: 60 }, (_, i) => `Synthetic ${i}`),
    yesOrNo: ['Synthetic A', 'Synthetic B'],
  };
  bank.adventureRules = {
    charadesSimple: ['Synthetic'],
    charadesComplex: ['Synthetic'],
    yesOrNoSimple: ['Synthetic'],
    yesOrNoHard: ['Synthetic'],
    photoRecreation: ['Synthetic'],
  };
  const variants = [
    'charades-simple',
    'yes-no-simple',
    'charades-complex',
    'yes-no-hard',
    'photo-recreation',
  ] as const;
  variants.forEach((variant, i) => {
    const cell = bank.cells.find((c) => c.id === `adventure-${i + 1}`)!;
    cell.kind = 'adventure';
    cell.adventureVariant = variant;
    cell.publicPrompt = 'Synthetic challenge';
    if (i === 4)
      cell.referenceImages = [
        '/adventure/photo-recreation-attempt-1.png',
        '/adventure/photo-recreation-attempt-2.png',
      ];
  });
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(bank), room.id);
  const state = (role: 'host' | 'display' | 'player' = 'host') =>
    app.engine.snapshot(
      role === 'player'
        ? { role, roomId: room.id, playerId: room.playerId }
        : { role, roomId: room.id },
    ).trivia!;
  const send = (
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
  const timer = (
    action: string,
    cellId: string,
    extra: Record<string, unknown> = {},
    requestId = randomUUID(),
  ) =>
    send(
      action,
      { cellId, attempt: state().timer?.attempt, timerRevision: state().timer?.revision, ...extra },
      requestId,
    );
  return {
    get app() {
      return app;
    },
    room,
    state,
    send,
    timer,
    now: () => now,
    setNow: (value: number) => {
      now = value;
    },
    async restart() {
      await app.close();
      app = createApp({ databasePath: path, hostPassword: 'synthetic-timer-test', now: () => now });
    },
  };
}

test('ordinary timer pause survives restart, resume preserves milliseconds, and restart uses saved duration', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-pause-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = await fixture(join(dir, 'party.sqlite'));
  t.after(() => f.app.close());
  const cellId = 'childhood-1';
  f.send('select-cell', { cellId, teamId: 1 });
  f.setNow(1_012_345);
  const pauseData = { cellId, attempt: 1, timerRevision: 0 };
  const requestId = randomUUID();
  f.send('timer-pause', pauseData, requestId);
  assert.equal(f.state().timer?.pausedRemainingMs, 77_655);
  assert.equal(f.state('display').timer?.pausedRemainingMs, 77_655);
  assert.equal(f.state('player').timer?.pausedRemainingMs, 77_655);
  f.setNow(2_000_000);
  f.send('timer-pause', pauseData, requestId);
  assert.equal(f.state().timer?.revision, 1);
  assert.equal(f.app.engine.expireAll().length, 0);
  await f.restart();
  assert.equal(f.state().answerAttempt?.status, 'active');
  assert.equal(f.state().controls?.canResumeTimer, true);
  f.timer('timer-resume', cellId);
  assert.equal(f.state().timer?.deadlineAt, 2_077_655);
  assert.throws(() => f.send('timer-pause', pauseData));
  f.setNow(2_010_000);
  const restartData = { cellId, attempt: 1, timerRevision: f.state().timer!.revision };
  const restartId = randomUUID();
  f.send('timer-restart', restartData, restartId);
  assert.equal(f.state().timer?.deadlineAt, 2_100_000);
  f.setNow(2_011_000);
  f.send('timer-restart', restartData, restartId);
  assert.equal(f.state().timer?.deadlineAt, 2_100_000);
  assert.equal(f.state().answerAttempt?.teamId, 1);
  f.timer('timer-pause', cellId);
  f.setNow(3_000_000);
  f.timer('timer-restart', cellId);
  assert.equal(f.state().timer?.deadlineAt, 3_090_000);
  assert.equal(f.state().timer?.pausedRemainingMs, null);
  assert.equal(f.state().controls?.canPauseTimer, true);
});

test('expired, resolved, stale, unauthorized and untimed attempts cannot be restarted', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cellId = 'childhood-1';
  f.send('select-cell', { cellId, teamId: 1 });
  const player: Session = {
    role: 'player',
    roomId: f.room.id,
    playerId: f.room.playerId,
    tokenHash: '',
  };
  assert.throws(
    () => f.send('timer-pause', { cellId, attempt: 1, timerRevision: 0 }, randomUUID(), player),
    /Only the host/,
  );
  assert.throws(() => f.timer('timer-pause', 'childhood-2'));
  f.setNow(1_090_000);
  for (const action of ['timer-pause', 'timer-resume', 'timer-restart'])
    assert.throws(() => f.timer(action, cellId));
  assert.equal(f.state().answerAttempt?.status, 'failed');
  assert.equal(f.state().teams.find((team) => team.id === 1)?.excluded, true);
  f.send('arm', { cellId });
  const member = f.state().teams.find((team) => team.id === 2)!.members[0];
  f.app.engine.execute({ ...player, playerId: member.id }, f.room.id, {
    type: 'phase.action',
    requestId: randomUUID(),
    phaseInstance: f.app.store.room(f.room.id).phase_instance,
    payload: { action: 'buzz', data: { windowId: f.state().windowId } },
  });
  assert.throws(() => f.timer('timer-restart', cellId, { attempt: 1 }));
  f.timer('timer-pause', cellId);
  f.send('reveal-answer', { cellId });
  assert.equal(f.state().timer, undefined);
  assert.throws(() => f.timer('timer-restart', cellId));
  f.send('award', { cellId, teamId: 2, amount: 100, attempt: 2 });
  assert.throws(() => f.timer('timer-restart', cellId));
  f.send('finish-cell', { cellId });
  const config = JSON.parse(f.app.store.room(f.room.id).config);
  delete config.trivia.answer_seconds;
  f.app.store.db
    .prepare('UPDATE rooms SET config=? WHERE id=?')
    .run(JSON.stringify(config), f.room.id);
  f.send('select-cell', { cellId: 'childhood-2', teamId: 1 });
  assert.equal(f.state().timer, undefined);
  assert.throws(() => f.timer('timer-restart', 'childhood-2'));
});

test('every adventure timer pauses and restarts without changing its team, item or progress', async (t) => {
  for (let i = 1; i <= 5; i++) {
    const f = await fixture();
    t.after(() => f.app.close());
    const cellId = `adventure-${i}`;
    f.send('select-cell', { cellId, teamId: 1 });
    assert.equal(f.state().timer, undefined);
    assert.throws(() => f.timer('timer-restart', cellId));
    f.send('adventure-start', { cellId, attempt: 1 });
    if (i === 1 || i === 3) f.send('adventure-correct', { cellId, attempt: 1 });
    const original = f.state().adventure!;
    f.setNow(1_015_500);
    const paused = f.state().timer!.deadlineAt - f.now();
    f.timer('timer-pause', cellId);
    f.setNow(2_000_000);
    assert.equal(f.state().timer?.pausedRemainingMs, paused);
    f.timer('timer-resume', cellId);
    assert.equal(f.state().timer?.deadlineAt, 2_000_000 + paused);
    f.timer('timer-restart', cellId);
    assert.equal(f.state().timer?.deadlineAt, 2_000_000 + original.durationSeconds * 1000);
    assert.equal(f.state().adventure?.teamId, original.teamId);
    assert.equal(f.state().adventure?.item, original.item);
    assert.equal(f.state().adventure?.correct, original.correct);
    const stale = { cellId, attempt: 1, timerRevision: 0 };
    assert.throws(() => f.send('timer-pause', stale));
    f.setNow(f.state().timer!.deadlineAt);
    assert.equal(f.state().controls?.canRestartTimer, false);
    assert.throws(() => f.timer('timer-restart', cellId));
    f.send(i === 5 ? 'adventure-photo-fail' : 'adventure-fail', { cellId, attempt: 1 });
    assert.equal(f.state().timer, undefined);
    assert.throws(() => f.timer('timer-restart', cellId));
  }
});

test('paused clocks render consistently on all roles without leaking host capabilities or clues', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cellId = 'adventure-1';
  f.send('select-cell', { cellId, teamId: 1 });
  f.send('adventure-start', { cellId, attempt: 1 });
  f.setNow(1_020_000);
  f.timer('timer-pause', cellId);
  const hostMarkup = renderToStaticMarkup(
    createElement(TriviaHost, {
      trivia: f.state(),
      command: async () => undefined,
      disabled: false,
    }),
  );
  const tvMarkup = renderToStaticMarkup(
    createElement(TriviaDisplay, { trivia: f.state('display') }),
  );
  const phoneMarkup = renderToStaticMarkup(
    createElement(TriviaPlayer, {
      trivia: f.state('player'),
      command: async () => undefined,
      disabled: false,
    }),
  );
  for (const markup of [hostMarkup, tvMarkup, phoneMarkup]) {
    assert.match(markup, /1:40/);
    assert.match(markup, /已暂停/);
  }
  assert.match(hostMarkup, /暂停计时/);
  assert.match(hostMarkup, /继续计时/);
  assert.match(hostMarkup, /重新计时/);
  assert.doesNotMatch(tvMarkup, /继续计时|重新计时/);
  assert.doesNotMatch(phoneMarkup, /Synthetic \d|继续计时|重新计时/);
  assert.equal(f.state('player').controls, undefined);
  assert.equal(f.state('display').controls, undefined);
});

test('v20 timer migration preserves saved config, balances and active deadlines', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-timer-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  const f = await fixture(path);
  f.send('select-cell', { cellId: 'childhood-1', teamId: 1 });
  const config = f.app.store.room(f.room.id).config;
  const balances = f.app.store.players(f.room.id).map((p) => p.spendable);
  f.app.store.db.exec(
    'ALTER TABLE trivia_answer_attempts DROP COLUMN paused_remaining_ms; ALTER TABLE trivia_answer_attempts DROP COLUMN timer_revision; PRAGMA user_version=20',
  );
  await f.app.close();
  let store = new Store(path);
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 21);
  assert.equal(store.room(f.room.id).config, config);
  assert.deepEqual(
    store.players(f.room.id).map((p) => p.spendable),
    balances,
  );
  const row = store.db
    .prepare('SELECT * FROM trivia_answer_attempts WHERE room_id=?')
    .get(f.room.id)!;
  assert.equal(row.deadline_at, 1_090_000);
  assert.equal(row.paused_remaining_ms, null);
  assert.equal(row.timer_revision, 0);
  store.close();
  store = new Store(path);
  store.close();
});

test('replacing a Yes/No prompt cannot reuse a stale timer control from its previous start', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cellId = 'adventure-2';
  f.send('select-cell', { cellId, teamId: 1 });
  f.send('adventure-start', { cellId, attempt: 1 });
  const old = { cellId, attempt: 1, timerRevision: f.state().timer!.revision };
  f.send('adventure-replace', { cellId, attempt: 1 });
  f.send('adventure-start', { cellId, attempt: 1 });
  assert.throws(() => f.send('timer-pause', old));
  f.timer('timer-pause', cellId);
});

test('a paused adventure survives server restart with its progress and saved duration intact', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-adventure-pause-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = await fixture(join(dir, 'party.sqlite'));
  t.after(() => f.app.close());
  const cellId = 'adventure-1';
  f.send('select-cell', { cellId, teamId: 1 });
  f.send('adventure-start', { cellId, attempt: 1 });
  f.send('adventure-correct', { cellId, attempt: 1 });
  const item = f.state().adventure!.item;
  f.setNow(1_030_123);
  f.timer('timer-pause', cellId);
  f.setNow(2_000_000);
  await f.restart();
  assert.equal(f.state().timer?.pausedRemainingMs, 89_877);
  assert.equal(f.state().adventure?.item, item);
  assert.equal(f.state().adventure?.correct, 1);
  f.timer('timer-resume', cellId);
  assert.equal(f.state().timer?.deadlineAt, 2_089_877);
  f.send('adventure-correct', { cellId, attempt: 1 });
  assert.equal(f.state().adventure?.correct, 2);
});

test('music snapshots anchor advanced positions once; late enable follows server time and clip bounds', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cellId = 'music-1';
  f.send('select-cell', { cellId, teamId: 1 });
  f.send('music-start', { cellId });
  f.setNow(1_001_000);
  const selected = f.state('display').board!.selected!;
  const playback = selected.musicPlayback!;
  assert.equal(playback.position, 1);
  assert.equal(playback.changedAt, f.now());
  const duration = selected.musicClip!.end - selected.musicClip!.start;
  assert.equal(triviaPlaybackPosition(playback, 1_002_000, 0, duration), 2);
  assert.equal(triviaPlaybackPosition(playback, 1_001_000, 1000, duration), 2);
  assert.equal(triviaPlaybackPosition(playback, 999_000, 0, duration), 1);
  assert.equal(triviaPlaybackPosition(playback, 2_000_000, 0, duration), duration);
  assert.equal(triviaPlaybackPosition({ ...playback, playing: false }, 2_000_000, 0, duration), 1);
});

function nextState(socket: Socket, predicate: (s: RoomSnapshot) => boolean) {
  return new Promise<RoomSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('state', listener);
      reject(new Error('Timer snapshot not received'));
    }, 3000);
    const listener = (s: RoomSnapshot) => {
      if (predicate(s)) {
        clearTimeout(timeout);
        socket.off('state', listener);
        resolve(s);
      }
    };
    socket.on('state', listener);
  });
}
test('HTTP timer controls synchronize all sockets and a reconnecting TV', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const base = `http://127.0.0.1:${await f.app.listen()}`;
  const hostCookie = `of_host=${f.app.store.session('host', f.now(), hash('synthetic-timer-test'))}`;
  const playerCookie = `of_player=${f.app.store.session('player', f.now(), null, f.room.playerId, f.room.id)}`;
  const sockets = [
    io(base, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { role: 'host', code: f.room.code },
      extraHeaders: { Cookie: hostCookie },
    }),
    io(base, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { role: 'player', code: f.room.code },
      extraHeaders: { Cookie: playerCookie },
    }),
    io(base, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { role: 'display', code: f.room.code, displayToken: f.room.displayToken },
    }),
  ];
  t.after(() => sockets.forEach((s) => s.close()));
  const initial = sockets.map((s) => nextState(s, () => true));
  sockets.forEach((s) => s.connect());
  await Promise.all(initial);
  const command = async (action: string, data: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/rooms/${f.room.code}/commands?role=host`, {
      method: 'POST',
      headers: { Cookie: hostCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'phase.host',
        phaseInstance: f.app.store.room(f.room.id).phase_instance,
        requestId: randomUUID(),
        payload: { action, data: { cellId: 'childhood-1', ...data } },
      }),
    });
    assert.equal(response.status, 200);
  };
  await command('select-cell', { teamId: 1 });
  f.setNow(1_010_000);
  const paused = sockets.map((s) =>
    nextState(s, (state) => state.trivia?.timer?.pausedRemainingMs === 80_000),
  );
  await command('timer-pause', { attempt: 1, timerRevision: 0 });
  const snapshots = await Promise.all(paused);
  assert.equal(snapshots[1].trivia?.board, undefined);
  assert.equal(snapshots[1].trivia?.controls, undefined);
  assert.equal(snapshots[2].trivia?.controls, undefined);
  sockets[2].disconnect();
  const reconnected = nextState(
    sockets[2],
    (state) => state.trivia?.timer?.pausedRemainingMs === 80_000,
  );
  sockets[2].connect();
  await reconnected;
  f.setNow(2_000_000);
  const resumed = sockets.map((s) =>
    nextState(s, (state) => state.trivia?.timer?.deadlineAt === 2_080_000),
  );
  await command('timer-resume', { attempt: 1, timerRevision: 1 });
  await Promise.all(resumed);
  const restarted = sockets.map((s) =>
    nextState(s, (state) => state.trivia?.timer?.deadlineAt === 2_090_000),
  );
  await command('timer-restart', { attempt: 1, timerRevision: 2 });
  await Promise.all(restarted);
});
