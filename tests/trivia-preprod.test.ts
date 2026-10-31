import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { io, type Socket } from 'socket.io-client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../src/server/app.js';
import { hash, Store, type Session } from '../src/server/core/store.js';
import { createTriviaContent, DEMO_TRIVIA_BANK } from '../src/server/games/trivia-content.js';
import { loadConfig } from '../src/server/config.js';
import { TriviaHost } from '../src/client/Trivia.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';
import type { RoomSnapshot } from '../src/shared/contracts.js';

const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
const password = 'preproduction-test-password';
async function fixture(path = ':memory:') {
  let now = 1_000_000;
  const app = createApp({ databasePath: path, hostPassword: password, now: () => now });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const content = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  content.cells[0].questionVideo = '/trivia/synthetic.mp4';
  content.cells[0].publicPrompt = 'Synthetic video question';
  content.cells[0].hostAnswer = 'Synthetic private answer';
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(content), room.id);
  const send = (action: string, data: Record<string, unknown> = {}, requestId = randomUUID()) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId,
      payload: { action, data: { cellId: 'childhood-1', ...data } },
    });
  const state = (role: 'host' | 'display' | 'player' = 'host') =>
    app.engine.snapshot({
      role,
      roomId: room.id,
      ...(role === 'player' ? { playerId: room.playerId } : {}),
    } as Parameters<typeof app.engine.snapshot>[0]);
  return {
    app,
    room,
    send,
    state,
    setNow: (value: number) => {
      now = value;
    },
  };
}

// Relocate the actual loader so project-relative paths match a release without public/.
// This test needs neither a prior build nor the private event bank.
test('packaged trivia accepts built image/video assets and still rejects missing files', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src/server/games'), { recursive: true });
  mkdirSync(join(dir, 'dist/client/trivia'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  cpSync(
    resolve('src/server/games/trivia-content.ts'),
    join(dir, 'src/server/games/trivia-content.ts'),
  );
  const loader = await import(pathToFileURL(join(dir, 'src/server/games/trivia-content.ts')).href);
  const bank = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  bank.cells[0].questionImage = '/trivia/synthetic.png';
  bank.cells[0].questionVideo = '/trivia/synthetic.mp4';
  assert.throws(() => loader.validateTriviaContent(bank), /image is missing/);
  writeFileSync(join(dir, 'dist/client/trivia/synthetic.png'), 'synthetic image');
  assert.throws(() => loader.validateTriviaContent(bank), /video is missing/);
  writeFileSync(join(dir, 'dist/client/trivia/synthetic.mp4'), 'synthetic video');
  assert.doesNotThrow(() => loader.validateTriviaContent(bank));
});

for (const teamId of [1, 2])
  test(`reveal preserves scoring for answering team ${teamId} without reopening the timer`, async (t) => {
    const f = await fixture();
    t.after(() => f.app.close());
    f.send('select-cell', { teamId: 1 });
    if (teamId === 2) {
      f.send('incorrect', { attempt: 1 });
      f.send('arm');
      const trivia = f.state().trivia!;
      const playerId = trivia.teams.find((team) => team.id === 2)!.members[0].id;
      f.app.engine.execute(
        { role: 'player', roomId: f.room.id, playerId, tokenHash: '' },
        f.room.id,
        {
          type: 'phase.action',
          phaseInstance: f.state().room.phaseInstance,
          requestId: randomUUID(),
          payload: { action: 'buzz', data: { windowId: trivia.windowId } },
        },
      );
    }
    const attempt = f.state().trivia!.answerAttempt!.attempt;
    f.send('reveal-answer');
    assert.equal(f.state().trivia?.answerAttempt?.status, 'revealed');
    assert.equal(f.state().trivia?.controls?.canAward, true);
    const html = renderToStaticMarkup(
      createElement(TriviaHost, {
        trivia: f.state().trivia!,
        command: async () => undefined,
        disabled: false,
      }),
    );
    assert.match(html, new RegExp(`<option value="${teamId}" selected="">`));
    assert.throws(() => f.send('award', { teamId: teamId === 1 ? 2 : 1, amount: 100, attempt }));
    assert.throws(() => f.send('incorrect', { attempt }));
    assert.throws(() => f.send('arm'));
    f.setNow(1_100_000);
    assert.equal(f.app.engine.expireAll().includes(f.room.id), false);
    const id = randomUUID();
    f.send('award', { teamId, amount: 100, attempt }, id);
    f.send('award', { teamId, amount: 100, attempt }, id);
    assert.equal(f.state().trivia?.teams.find((team) => team.id === teamId)?.score, 100);
    assert.equal(f.state().trivia?.answerAttempt?.status, 'resolved');
    f.send('undo-award', { awardId: id });
    f.send('award', { teamId: teamId === 1 ? 2 : 1, amount: 100, attempt });
    f.send('finish-cell');
  });

test('revealing after timeout cannot restore expired scoring eligibility', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  f.send('select-cell', { teamId: 1 });
  f.setNow(1_090_000);
  f.send('reveal-answer');
  assert.equal(f.state().trivia?.answerAttempt?.status, 'failed');
  assert.equal(f.state().trivia?.controls?.canAward, false);
  assert.throws(() => f.send('award', { teamId: 1, amount: 100, attempt: 1 }));
  f.send('finish-cell');
});

test('host video commands persist playback, reject stale cells, and preserve answer deadlines and phone privacy', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-video-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  const f = await fixture(path);
  f.send('select-cell', { teamId: 1 });
  const id = randomUUID();
  f.send('video-start', {}, id);
  f.setNow(1_005_000);
  f.send('video-start', {}, id);
  assert.equal(f.state('display').trivia?.board?.selected?.videoPlayback?.position, 5);
  assert.equal(f.state('display').trivia?.board?.selected?.videoPlayback?.playing, true);
  assert.equal(f.state().trivia?.answerAttempt?.deadlineAt, 1_090_000);
  assert.throws(() => f.send('video-stop', { cellId: 'childhood-2' }));
  assert.throws(() => f.send('video-start', { restart: 'yes' }));
  f.send('video-stop');
  f.setNow(1_010_000);
  assert.equal(f.state('display').trivia?.board?.selected?.videoPlayback?.position, 5);
  f.send('video-start');
  f.setNow(1_012_000);
  assert.equal(f.state().trivia?.board?.selected?.videoPlayback?.position, 7);
  assert.equal(f.state('player').trivia?.board, undefined);
  assert.doesNotMatch(
    JSON.stringify(f.state('player').trivia),
    /synthetic|videoPlayback|private answer/i,
  );
  f.send('video-start', { restart: true });
  assert.equal(f.state('display').trivia?.board?.selected?.videoPlayback?.position, 0);
  await f.app.close();
  const reopened = createApp({ databasePath: path, hostPassword: password, now: () => 1_014_000 });
  t.after(() => reopened.close());
  const resumed = reopened.engine.snapshot({ role: 'display', roomId: f.room.id });
  assert.equal(resumed.trivia?.board?.selected?.videoPlayback?.position, 2);
  assert.equal(resumed.trivia?.board?.selected?.videoPlayback?.playing, true);
  reopened.engine.execute(host, f.room.id, {
    type: 'phase.host',
    phaseInstance: resumed.room.phaseInstance,
    requestId: randomUUID(),
    payload: { action: 'finish-cell', data: { cellId: 'childhood-1' } },
  });
  assert.equal(
    reopened.store.db
      .prepare('SELECT playing FROM trivia_video_playback WHERE room_id=?')
      .get(f.room.id)?.playing,
    0,
  );
});

function next(socket: Socket, predicate: (s: RoomSnapshot) => boolean) {
  return new Promise<RoomSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('state', handler);
      reject(new Error('Timed trivia sync timeout'));
    }, 3000);
    const handler = (s: RoomSnapshot) => {
      if (predicate(s)) {
        clearTimeout(timeout);
        socket.off('state', handler);
        resolve(s);
      }
    };
    socket.on('state', handler);
  });
}

for (const transport of ['socket', 'http'])
  test(`${transport} sync deadline reconciliation broadcasts to host, phone and TV even when ticker sees no remaining work`, async (t) => {
    const f = await fixture();
    t.after(() => f.app.close());
    const base = `http://127.0.0.1:${await f.app.listen()}`;
    const hostToken = f.app.store.session('host', 1_000_000, hash(password));
    const playerToken = f.app.store.session('player', 1_000_000, null, f.room.playerId, f.room.id);
    const sockets = [
      io(base, {
        autoConnect: false,
        transports: ['websocket'],
        auth: { role: 'host', code: f.room.code },
        extraHeaders: { Cookie: `of_host=${hostToken}` },
      }),
      io(base, {
        autoConnect: false,
        transports: ['websocket'],
        auth: { role: 'player', code: f.room.code },
        extraHeaders: { Cookie: `of_player=${playerToken}` },
      }),
      io(base, {
        autoConnect: false,
        transports: ['websocket'],
        auth: { role: 'display', code: f.room.code, displayToken: f.room.displayToken },
      }),
    ];
    t.after(() => sockets.forEach((socket) => socket.close()));
    const initial = sockets.map((socket) => next(socket, () => true));
    sockets.forEach((socket) => socket.connect());
    await Promise.all(initial);
    f.send('select-cell', { teamId: 1 });
    const selected = sockets.map((socket) =>
      next(socket, (s) => s.trivia?.answerAttempt?.status === 'active'),
    );
    f.app.broadcast(f.room.id);
    await Promise.all(selected);
    // Prevent the periodic ticker from winning the race: sync must perform and publish expiry itself.
    f.app.engine.expireAll = () => [];
    const failed = sockets.map((socket) =>
      next(socket, (s) => s.trivia?.answerAttempt?.status === 'failed'),
    );
    f.setNow(1_090_000);
    if (transport === 'socket') sockets[0].emit('sync');
    else
      assert.equal(
        (
          await fetch(`${base}/api/rooms/${f.room.code}/state?role=host`, {
            headers: { Cookie: `of_host=${hostToken}` },
          })
        ).status,
        200,
      );
    const snapshots = await Promise.all(failed);
    assert.ok(snapshots.every((s) => s.trivia?.teams.find((team) => team.id === 1)?.excluded));
    assert.equal(snapshots[1].trivia?.board, undefined);
    assert.equal(snapshots[2].trivia?.board?.selected?.answer, undefined);
    const denied = await fetch(`${base}/api/rooms/${f.room.code}/commands?role=player`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `of_player=${playerToken}` },
      body: JSON.stringify({
        type: 'phase.host',
        phaseInstance: snapshots[1].room.phaseInstance,
        requestId: randomUUID(),
        payload: { action: 'video-start', data: { cellId: 'childhood-1' } },
      }),
    });
    assert.equal(denied.status, 403);
  });

for (const version of [18, 19])
  test(`v${version} upgrades to video playback without altering saved rooms or attempts`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'trivia-video-migration-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'party.sqlite');
    let store = new Store(path);
    const config = loadConfig();
    if (version === 18) delete config.trivia.answer_seconds;
    const room = store.createRoom(config, 'party', 1000);
    const player = store.join(
      store.room(room.id),
      { name: 'Migration guest', emoji: '🦦', email: '', phone: '2125550100' },
      randomUUID(),
      1000,
    );
    const savedConfig = store.room(room.id).config;
    if (version === 19)
      store.db
        .prepare(
          "INSERT INTO trivia_answer_attempts(room_id,phase_instance,question,cell_id,attempt,team,deadline_at,status) VALUES(?,?,?,?,?,?,?,'active')",
        )
        .run(room.id, 1, 1, 'synthetic', 1, 1, 91000);
    else store.db.exec('DROP TABLE trivia_answer_attempts');
    store.db.exec(`DROP TABLE trivia_video_playback; PRAGMA user_version=${version}`);
    store.close();
    store = new Store(path);
    assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 21);
    assert.ok(
      store.db.prepare("SELECT name FROM sqlite_master WHERE name='trivia_video_playback'").get(),
    );
    assert.equal(store.room(room.id).config, savedConfig);
    assert.equal(store.player(player.playerId).spendable, 1000);
    if (version === 19)
      assert.equal(
        store.db
          .prepare('SELECT deadline_at FROM trivia_answer_attempts WHERE room_id=?')
          .get(room.id)?.deadline_at,
        91000,
      );

    store.close();
    store = new Store(path);
    store.close();
  });
