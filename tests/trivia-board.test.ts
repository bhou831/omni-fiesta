import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../src/server/app.js';
import { Store, type Session } from '../src/server/core/store.js';
import {
  createTriviaContent,
  validateTriviaContent,
  DEMO_TRIVIA_BANK,
  isApprovedApplePreviewUrl,
} from '../src/server/games/trivia-content.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';
import { TriviaDisplay, TriviaPlayer } from '../src/client/Trivia.js';

const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
async function fixture(path = ':memory:') {
  const app = createApp({
    databasePath: path,
    hostPassword: 'board-test-password',
    now: () => 1000000,
  });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
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
  const snapshot = (role: 'host' | 'display' | 'player' = 'host') =>
    app.engine.snapshot({
      role,
      roomId: room.id,
      ...(role === 'player' ? { playerId: room.playerId } : {}),
    } as Parameters<typeof app.engine.snapshot>[0]).trivia!;
  const buzz = (playerId: string, windowId: number) =>
    app.engine.execute({ role: 'player', roomId: room.id, playerId, tokenHash: '' }, room.id, {
      type: 'phase.action',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId: randomUUID(),
      payload: { action: 'buzz', data: { windowId } },
    });
  const cellId = 'childhood-1';
  return { app, room, execute, snapshot, buzz, cellId };
}

test('demo content validates 25 playable slots and stays separate from custom event candidates', () => {
  const content = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  assert.equal(content.cells.length, 25);
  assert.equal(content.cells.filter((c) => !c.unavailableReason).length, 25);
  assert.deepEqual(
    content.categories.map((c) => c.name),
    ['类别 1', '类别 2', '类别 3', '类别 4', '类别 5'],
  );
  assert.equal(content.cells.flatMap((c) => c.musicCandidates ?? []).length, 0);
  const music = content.cells.find((c) => c.kind === 'music')!;
  assert.equal(music.musicAudio?.file, 'demo-tone.wav');
  assert.equal(music.categoryId, 'music');
  assert.equal(music.hostNotes, undefined);
  assert.equal(
    isApprovedApplePreviewUrl(
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview112/v4/example.m4a',
    ),
    true,
  );
  for (const url of [
    'https://audio-ssl.itunes.apple.com.evil.example/itunes-assets/AudioPreview/v4/a.m4a',
    'https://audio-ssl.itunes.apple.com:8443/itunes-assets/AudioPreview/v4/a.m4a',
    'https://user@audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/v4/a.m4a',
    'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview-Evil/a.m4a',
  ])
    assert.equal(isApprovedApplePreviewUrl(url), false, url);
  assert.throws(() =>
    validateTriviaContent({
      ...content,
      cells: content.cells.map((c) =>
        c.id === music.id
          ? { ...c, musicAudio: { file: 'demo-tone.wav', clipStartSeconds: 5, clipEndSeconds: 4 } }
          : c,
      ),
    }),
  );
  assert.throws(() =>
    validateTriviaContent({
      ...content,
      cells: content.cells.map((c) =>
        c.id === music.id
          ? {
              ...c,
              musicAudio: {
                url: 'https://example.com/audio.m4a',
                clipStartSeconds: 0,
                clipEndSeconds: 8,
              },
            }
          : c,
      ),
    }),
  );
  assert.throws(() => createTriviaContent([100, 100, 200, 300, 400]));
  assert.throws(() =>
    validateTriviaContent({ ...content, cells: [...content.cells.slice(1), content.cells[1]] }),
  );
});

test('host can reveal the board after teams are shown on the TV', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal(f.snapshot('display').board!.started, false);
  f.execute('show-board');
  assert.equal(f.snapshot('display').board!.started, true);
  assert.throws(() =>
    f.execute('set-demo-mode', {
      demo: false,
      expectedBankVersion: f.snapshot().board!.version,
    }),
  );
});

test('host selects, safely cancels, and explicitly finishes; unavailable/used/stale cells are rejected', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const { cellId } = f;
  assert.equal(f.snapshot().board!.selected, null);
  assert.throws(() => f.execute('select-cell', { cellId: 'no-such-cell' }));
  const unavailable = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  unavailable.cells.find((c) => c.id === 'music-1')!.unavailableReason =
    'Synthetic fixture: media not supplied';
  f.app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(unavailable), f.room.id);
  assert.throws(() => f.execute('select-cell', { cellId: 'music-1' }));
  const player: Session = {
    role: 'player',
    roomId: f.room.id,
    playerId: f.room.playerId,
    tokenHash: '',
  };
  assert.throws(() => f.execute('select-cell', { cellId }, randomUUID(), player), /Only the host/);
  const selectRequest = randomUUID();
  f.execute('select-cell', { cellId }, selectRequest);
  f.execute('select-cell', { cellId }, selectRequest);
  assert.equal(f.snapshot().question, 1);
  assert.throws(() => f.execute('select-cell', { cellId: 'childhood-2' }));
  assert.throws(() => f.execute('new-question'));
  assert.throws(() => f.execute('cancel-selection', { cellId: 'childhood-2' }));
  f.execute('cancel-selection', { cellId });
  assert.equal(f.snapshot().board!.cells.find((c) => c.id === cellId)!.used, false);
  f.execute('select-cell', { cellId });
  f.execute('arm', { cellId });
  assert.throws(() => f.execute('finish-cell', { cellId }));
  const phaseInstance = f.app.store.room(f.room.id).phase_instance;
  assert.throws(() =>
    f.app.engine.execute(host, f.room.id, {
      type: 'phase.close',
      phaseInstance,
      requestId: randomUUID(),
    }),
  );
  f.execute('close-buzzer', { cellId });
  f.execute('reveal-answer', { cellId });
  assert.throws(() => f.execute('cancel-selection', { cellId }));
  assert.throws(() => f.execute('arm', { cellId }));
  f.execute('finish-cell', { cellId });
  assert.throws(() => f.execute('select-cell', { cellId }));
  assert.throws(() => f.execute('finish-cell', { cellId }));
  assert.equal(f.snapshot().board!.selected, null);
});

test('first buzz, stale windows, exclusion with zero penalty, all-excluded finish and new-cell reset', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const { cellId } = f;
  f.execute('select-cell', { cellId });
  f.execute('arm', { cellId });
  const first = f.snapshot();
  const p1 = first.teams[0].members[0].id,
    p2 = first.teams[1].members[0].id;
  const before = f.app.store.players(f.room.id);
  f.buzz(p1, first.windowId);
  assert.throws(() => f.buzz(p2, first.windowId));
  assert.throws(() => f.execute('cancel-selection', { cellId }));
  f.execute('incorrect', { cellId });
  f.execute('arm', { cellId });
  const second = f.snapshot();
  assert.throws(() => f.buzz(p2, first.windowId));
  assert.throws(() => f.buzz(p1, second.windowId));
  f.buzz(p2, second.windowId);
  f.execute('incorrect', { cellId });
  assert.throws(() => f.execute('arm', { cellId }), /最多两队|所有队伍/);
  assert.deepEqual(f.app.store.players(f.room.id), before);
  f.execute('finish-cell', { cellId });
  f.execute('select-cell', { cellId: 'childhood-2' });
  assert.ok(f.snapshot().teams.every((t) => !t.excluded));
});

test('cell awards credit each teammate once; undo and correction after finish count clue value once per team', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const { cellId } = f;
  f.execute('select-cell', { cellId });
  assert.throws(() => f.execute('award', { cellId, teamId: 1, amount: 200 }));
  const awardId = randomUUID();
  f.execute('award', { cellId, teamId: 1, amount: 100 }, awardId);
  f.execute('award', { cellId, teamId: 1, amount: 100 }, awardId);
  assert.equal(f.snapshot().teams[0].score, 100);
  for (const p of f.snapshot().teams[0].members)
    assert.equal(f.app.store.player(p.id).spendable, 1100);
  assert.throws(() => f.execute('award', { cellId, teamId: 2, amount: 100 }));
  assert.throws(() => f.execute('arm', { cellId }));
  f.execute('finish-cell', { cellId });
  f.execute('undo-award', { awardId });
  f.execute('undo-award', { awardId });
  assert.equal(f.snapshot().teams[0].score, 0);
  f.execute('award', { cellId, teamId: 2, amount: 100 });
  f.execute('award', { cellId, teamId: 1, amount: 100 }, awardId);
  assert.equal(f.snapshot().teams[1].score, 100);
  assert.equal(f.snapshot().teams[0].score, 0);
  assert.equal(f.snapshot().awardHistory![0].cellId, cellId);
  assert.throws(() => f.execute('award', { cellId: 'random-1', teamId: 1, amount: 100 }));
});

test('role snapshots and rendered phones hide clues/answers; TV only gains the answer on reveal', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const { cellId } = f;
  f.execute('select-cell', { cellId });
  const tv = f.snapshot('display'),
    phone = f.snapshot('player');
  const privateText = [
    '哆啦A梦',
    '答「机器猫」也可。',
    'example.test',
    '2125550100',
    'awardHistory',
    'musicCandidates',
  ];
  for (const text of privateText) {
    assert.equal(JSON.stringify(tv).includes(text), false, text);
    assert.equal(JSON.stringify(phone).includes(text), false, text);
  }
  assert.equal(phone.board, undefined);
  assert.equal(phone.teams[0].score, undefined);
  assert.match(JSON.stringify(f.snapshot()), /答「机器猫」也可/);
  assert.equal(f.snapshot().demo, true);
  assert.equal(tv.board!.selected!.answer, undefined);
  const phoneHtml = renderToStaticMarkup(
    createElement(TriviaPlayer, { trivia: phone, command: async () => {}, disabled: false }),
  );
  assert.doesNotMatch(phoneHtml, /四次元口袋|jeopardy-grid|哆啦A梦/);
  f.execute('reveal-answer', { cellId });
  assert.match(f.snapshot('display').board!.selected!.answer!, /哆啦A梦/);
  assert.equal(f.snapshot('player').board, undefined);
  const tvHtml = renderToStaticMarkup(
    createElement(TriviaDisplay, { trivia: f.snapshot('display') }),
  );
  assert.match(tvHtml, /哆啦A梦/);
  assert.doesNotMatch(tvHtml, /答「机器猫」也可|主持人答案/);
});

test('frozen clues, selection, reveal and used cells survive restart and a v12 migration preserves numbered legacy rooms', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-board-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'room.sqlite');
  const f = await fixture(path);
  const { cellId } = f;
  f.execute('select-cell', { cellId });
  f.execute('reveal-answer', { cellId });
  const before = f.snapshot();
  await f.app.close();
  let app = createApp({ databasePath: path, hostPassword: 'board-test-password' });
  assert.deepEqual(app.engine.snapshot({ role: 'host', roomId: f.room.id }).trivia, before);
  app.engine.execute(host, f.room.id, {
    type: 'phase.host',
    phaseInstance: app.store.room(f.room.id).phase_instance,
    requestId: randomUUID(),
    payload: { action: 'finish-cell', data: { cellId } },
  });
  await app.close();
  app = createApp({ databasePath: path, hostPassword: 'board-test-password' });
  assert.equal(
    app.engine.snapshot({ role: 'display', roomId: f.room.id }).trivia!.board!.cells[0].used,
    true,
  );
  // Simulate the actual previous schema, with an existing numbered state and no board tables.
  app.store.db.exec(
    'DROP TABLE trivia_cell_awards; DROP TABLE trivia_cells; DROP TABLE trivia_boards; PRAGMA user_version=12',
  );
  await app.close();
  const store = new Store(path);
  t.after(() => store.close());
  assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 15);
  assert.equal(
    store.db.prepare('SELECT question FROM trivia_state WHERE room_id=?').get(f.room.id)!.question,
    1,
  );
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM trivia_boards').get()!.n, 0);
});

test('custom banks validate without exposing data and a selected room keeps its frozen bank', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-bank-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'event.json');
  const bank = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  bank.mode = 'event';
  bank.label = 'PRIVATE TEST EVENT';
  bank.version = 'custom-test-1';
  bank.cells[0].hostAnswer = 'PRIVATE TEST ANSWER';
  bank.cells[0].hostNotes = 'PRIVATE TEST NOTES';
  bank.cells.find((c) => c.id === 'music-1')!.musicCandidates = Array.from(
    { length: 9 },
    (_, i) => `PRIVATE TEST SONG ${i + 1}`,
  );
  bank.cells.find((c) => c.id === 'music-1')!.unavailableReason = 'PRIVATE TEST MEDIA PENDING';
  writeFileSync(file, JSON.stringify(bank));
  const loaded = createTriviaContent([10, 20, 30, 40, 50], file);
  assert.equal(loaded.cells[0].value, 10);
  assert.equal(loaded.cells.flatMap((c) => c.musicCandidates ?? []).length, 9);
  const previousBankFile = process.env.TRIVIA_BANK_FILE;
  process.env.TRIVIA_BANK_FILE = file;
  let f: Awaited<ReturnType<typeof fixture>>;
  try {
    f = await fixture();
  } finally {
    if (previousBankFile === undefined) delete process.env.TRIVIA_BANK_FILE;
    else process.env.TRIVIA_BANK_FILE = previousBankFile;
  }
  t.after(() => f.app.close());
  f.execute('select-cell', { cellId: f.cellId });
  bank.cells[0].hostAnswer = 'CHANGED TEST ANSWER';
  writeFileSync(file, JSON.stringify(bank));
  assert.equal(f.snapshot().board!.selected!.answer, 'PRIVATE TEST ANSWER');
  assert.equal(f.snapshot().demo, false);
  assert.doesNotMatch(
    JSON.stringify(f.snapshot('display')),
    /PRIVATE TEST ANSWER|PRIVATE TEST NOTES|PRIVATE TEST SONG/,
  );
  assert.doesNotMatch(
    JSON.stringify(f.snapshot('player')),
    /PRIVATE TEST ANSWER|PRIVATE TEST NOTES|PRIVATE TEST SONG/,
  );
  assert.equal(f.snapshot().board!.review![0].musicCandidates!.length, 9);
  f.execute('reveal-answer', { cellId: f.cellId });
  assert.equal(f.snapshot('display').board!.selected!.answer, 'PRIVATE TEST ANSWER');
  writeFileSync(file, '{"version":"BROKEN PRIVATE INPUT"}');
  assert.throws(
    () => createTriviaContent([100, 200, 300, 400, 500], file),
    (error) => error instanceof Error && !error.message.includes('BROKEN PRIVATE INPUT'),
  );
  assert.throws(() => createTriviaContent([100, 200, 300, 400, 500], join(dir, 'missing.json')));
});

function eventFixture(t: { after: (cleanup: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'trivia-mode-'));
  const file = join(dir, 'event.json');
  const bank = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  bank.mode = 'event';
  bank.version = 'test-event-toggle-1';
  bank.label = 'TEST EVENT BANK';
  bank.categories.forEach((category, index) => {
    category.name = `活动类别 ${index + 1}`;
  });
  bank.cells[0].hostAnswer = 'PRIVATE SWITCH ANSWER';
  writeFileSync(file, JSON.stringify(bank));
  const previous = process.env.TRIVIA_EVENT_BANK_FILE;
  process.env.TRIVIA_EVENT_BANK_FILE = file;
  t.after(() => {
    if (previous === undefined) delete process.env.TRIVIA_EVENT_BANK_FILE;
    else process.env.TRIVIA_EVENT_BANK_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return { file, dir, bank };
}

test('host toggles banks before play, preserves teams/accounts, rejects stale modes and persists selection across restart', async (t) => {
  const event = eventFixture(t);
  const f = await fixture(join(event.dir, 'room.sqlite'));
  let app = f.app;
  t.after(() => app.close());
  const players = app.store.players(f.room.id);
  const teams = f.snapshot().teams;
  const version = f.snapshot().board!.version;
  assert.deepEqual(f.snapshot().bankSwitch, { allowed: true, eventAvailable: true });
  assert.equal(f.snapshot('display').bankSwitch, undefined);
  assert.equal(f.snapshot('player').bankSwitch, undefined);
  const request = randomUUID();
  f.execute('set-demo-mode', { demo: false, expectedBankVersion: version }, request);
  f.execute('set-demo-mode', { demo: false, expectedBankVersion: version }, request);
  assert.equal(f.snapshot().demo, false);
  assert.equal(f.snapshot().bankLabel, 'TEST EVENT BANK');
  assert.equal(f.snapshot('display').board!.categories[0].name, '活动类别 1');
  assert.doesNotMatch(JSON.stringify(f.snapshot('display')), /PRIVATE SWITCH ANSWER/);
  assert.throws(
    () => f.execute('set-demo-mode', { demo: true, expectedBankVersion: version }),
    /题库已变更/,
  );
  assert.deepEqual(app.store.players(f.room.id), players);
  assert.deepEqual(f.snapshot().teams, teams);
  await app.close();
  app = createApp({
    databasePath: join(event.dir, 'room.sqlite'),
    hostPassword: 'board-test-password',
  });
  const restored = app.engine.snapshot({ role: 'host', roomId: f.room.id }).trivia!;
  assert.equal(restored.demo, false);
  assert.equal(restored.board!.version, event.bank.version);
  app.engine.execute(host, f.room.id, {
    requestId: randomUUID(),
    phaseInstance: app.store.room(f.room.id).phase_instance,
    type: 'phase.host',
    payload: {
      action: 'set-demo-mode',
      data: { demo: true, expectedBankVersion: restored.board!.version },
    },
  });
  const demo = app.engine.snapshot({ role: 'display', roomId: f.room.id }).trivia!;
  assert.equal(demo.demo, true);
  assert.deepEqual(
    demo.board!.categories.map((c) => c.name),
    ['类别 1', '类别 2', '类别 3', '类别 4', '类别 5'],
  );
});

test('switching locks after any selection and cannot discard an award or reopen used cells', async (t) => {
  eventFixture(t);
  const f = await fixture();
  t.after(() => f.app.close());
  f.execute('select-cell', { cellId: f.cellId });
  const switchMode = () =>
    f.execute('set-demo-mode', { demo: false, expectedBankVersion: f.snapshot().board!.version });
  assert.throws(switchMode, /已经选题或计分/);
  assert.equal(f.snapshot().bankSwitch!.allowed, false);
  f.execute('award', { cellId: f.cellId, teamId: 1, amount: 100 });
  f.execute('finish-cell', { cellId: f.cellId });
  const before = f.app.store.players(f.room.id);
  assert.throws(switchMode, /已经选题或计分/);
  assert.deepEqual(f.app.store.players(f.room.id), before);
  assert.equal(f.snapshot().teams[0].score, 100);
  assert.equal(f.snapshot().board!.cells.find((c) => c.id === f.cellId)!.used, true);
  const cancelled = await fixture();
  t.after(() => cancelled.app.close());
  cancelled.execute('select-cell', { cellId: cancelled.cellId });
  cancelled.execute('cancel-selection', { cellId: cancelled.cellId });
  assert.throws(
    () =>
      cancelled.execute('set-demo-mode', {
        demo: false,
        expectedBankVersion: cancelled.snapshot().board!.version,
      }),
    /已经选题或计分/,
  );
});

test('missing, malformed or wrong-mode event banks cannot replace the current board', async (t) => {
  const event = eventFixture(t);
  const f = await fixture();
  t.after(() => f.app.close());
  const original = f.app.store.db
    .prepare('SELECT content FROM trivia_boards WHERE room_id=?')
    .get(f.room.id)!.content;
  const switchMode = () =>
    f.execute('set-demo-mode', { demo: false, expectedBankVersion: f.snapshot().board!.version });
  writeFileSync(event.file, '{"private invalid input":');
  assert.throws(switchMode, /无法读取或验证本机题库/);
  writeFileSync(
    event.file,
    JSON.stringify(createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK)),
  );
  assert.throws(switchMode, /无法读取或验证本机题库/);
  rmSync(event.file);
  assert.equal(f.snapshot().bankSwitch!.eventAvailable, false);
  assert.throws(switchMode, /无法读取或验证本机题库/);
  assert.throws(
    () =>
      f.execute('set-demo-mode', {
        demo: 'false',
        expectedBankVersion: f.snapshot().board!.version,
      }),
    /请选择演示模式/,
  );
  assert.equal(
    f.app.store.db.prepare('SELECT content FROM trivia_boards WHERE room_id=?').get(f.room.id)!
      .content,
    original,
  );
  assert.equal(f.snapshot().demo, true);
});

test('older frozen demo banks also mask descriptive category labels on host and TV', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const content = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  content.categories.forEach((c, i) => {
    c.name = `HIDDEN ORIGINAL CATEGORY ${i + 1}`;
  });
  f.app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(content), f.room.id);
  for (const role of ['host', 'display'] as const) {
    const snapshot = f.snapshot(role);
    assert.deepEqual(
      snapshot.board!.categories.map((c) => c.name),
      ['类别 1', '类别 2', '类别 3', '类别 4', '类别 5'],
    );
    assert.doesNotMatch(JSON.stringify(snapshot), /HIDDEN ORIGINAL CATEGORY/);
  }
});

for (const original of ['upstream-reveals-v13', 'local-trivia-v13'] as const)
  test(`v14 reconciles ${original} without losing rooms, awards or saved bank state`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'trivia-main-compat-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'room.sqlite');
    const f = await fixture(path);
    f.execute('select-cell', { cellId: f.cellId });
    f.execute('award', { cellId: f.cellId, teamId: 1, amount: 100 });
    const players = f.app.store.players(f.room.id);
    const content = f.app.store.db
      .prepare('SELECT content FROM trivia_boards WHERE room_id=?')
      .get(f.room.id)!.content;
    if (original === 'upstream-reveals-v13')
      f.app.store.db.exec(
        'DROP TABLE trivia_cell_awards; DROP TABLE trivia_cells; DROP TABLE trivia_boards;',
      );
    else
      f.app.store.db.exec(
        'DROP TABLE costume_locks; DROP TABLE costume_reveal_progress; DROP TABLE finish_reveal_progress;',
      );
    f.app.store.db.exec('PRAGMA user_version=13');
    await f.app.close();
    const app = createApp({ databasePath: path, hostPassword: 'board-test-password' });
    t.after(() => app.close());
    assert.equal(app.store.db.prepare('PRAGMA user_version').get()!.user_version, 15);
    for (const name of [
      'trivia_boards',
      'trivia_cells',
      'trivia_cell_awards',
      'costume_locks',
      'costume_reveal_progress',
      'finish_reveal_progress',
    ])
      assert.ok(
        app.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
      );
    assert.deepEqual(app.store.players(f.room.id), players);
    const restored = app.engine.snapshot({ role: 'host', roomId: f.room.id }).trivia!;
    assert.equal(restored.awardHistory!.length, 1);
    if (original === 'local-trivia-v13') {
      assert.equal(
        app.store.db.prepare('SELECT content FROM trivia_boards WHERE room_id=?').get(f.room.id)!
          .content,
        content,
      );
      assert.equal(restored.board!.selected!.id, f.cellId);
      assert.equal(restored.teams[0].score, 100);
    } else {
      assert.equal(restored.board, undefined);
      assert.equal(restored.awardHistory![0].cellId, null);
    }
  });
