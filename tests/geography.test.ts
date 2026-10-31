import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../src/server/app.js';
import {
  createTriviaContent,
  DEMO_TRIVIA_BANK,
  validateTriviaContent,
} from '../src/server/games/trivia-content.js';
import { TriviaDisplay, TriviaHost } from '../src/client/Trivia.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';

test('location content requires a scene and private host answer, with no grading rule', () => {
  const prepared = JSON.parse(
    JSON.stringify(createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK)),
  );
  const cell = prepared.cells.find((clue: { id: string }) => clue.id === 'geography-5');
  cell.kind = 'location';
  delete cell.unavailableReason;
  cell.hostAnswer = 'Synthetic city';
  cell.location = {
    countryCode: 'JP',
    city: 'Synthetic city',
    latitude: 0,
    longitude: 0,
    panoId: 'test-pano',
  };
  assert.doesNotThrow(() => validateTriviaContent(prepared));
  delete cell.location;
  assert.throws(() => validateTriviaContent(prepared));
});

test('location is answered aloud and host uses ordinary wrong, second buzz, award, reveal and finish', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'geography-test-password' });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
    false,
    true,
  );
  const board = app.store.db
    .prepare('SELECT content FROM trivia_boards WHERE room_id=?')
    .get(room.id) as { content: string };
  const bank = JSON.parse(board.content);
  const cellId = 'geography-5';
  const scene = bank.cells.find((clue: { id: string }) => clue.id === cellId);
  scene.kind = 'location';
  delete scene.unavailableReason;
  scene.hostAnswer = 'Synthetic city';
  scene.location = {
    countryCode: 'JP',
    city: 'Synthetic city',
    latitude: 0,
    longitude: 0,
    panoId: 'test-pano',
    heading: 0,
    pitch: 0,
    zoom: 1,
  };
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(bank), room.id);
  const phaseInstance = app.store.room(room.id).phase_instance;
  const hostAction = (action: string, data: Record<string, unknown> = {}) =>
    app.engine.execute({ role: 'host', roomId: null, playerId: null, tokenHash: '' }, room.id, {
      requestId: randomUUID(),
      phaseInstance,
      type: 'phase.host',
      payload: { action, data: { cellId, ...data } },
    });
  const snapshot = (role: 'host' | 'display' | 'player' = 'host') =>
    app.engine.snapshot({
      role,
      roomId: room.id,
      ...(role === 'player' ? { playerId: room.playerId } : {}),
    } as Parameters<typeof app.engine.snapshot>[0]).trivia!;
  const buzz = (team: { members: { id: string }[] }, windowId: number) =>
    app.engine.execute(
      { role: 'player', roomId: room.id, playerId: team.members[0].id, tokenHash: '' },
      room.id,
      {
        requestId: randomUUID(),
        phaseInstance,
        type: 'phase.action',
        payload: { action: 'buzz', data: { windowId } },
      },
    );
  assert.equal(
    (app.store.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    21,
  );
  hostAction('select-cell', { teamId: 1 });
  assert.equal(snapshot('display').board?.selected?.locationView?.panoId, 'test-pano');
  assert.equal(JSON.stringify(snapshot('display').board).includes('latitude'), false);
  assert.equal(JSON.stringify(snapshot('display').board).includes('longitude'), false);
  assert.equal(snapshot('display').board?.selected?.answer, undefined);
  assert.equal(snapshot('player').board, undefined);
  assert.equal(snapshot('host').board?.selected?.answer, 'Synthetic city');
  const hostMarkup = renderToStaticMarkup(
    createElement(TriviaHost, {
      trivia: snapshot('host'),
      command: async () => undefined,
      disabled: false,
    }),
  );
  assert.match(hostMarkup, /开启抢答/);
  assert.match(hostMarkup, /公布答案/);
  assert.match(hostMarkup, /记分与修正/);
  assert.match(hostMarkup, /不计分 · 完成本题/);
  const displayMarkup = renderToStaticMarkup(
    createElement(TriviaDisplay, { trivia: snapshot('display') }),
  );
  assert.match(displayMarkup, /可旋转和缩放的街景地图/);
  assert.doesNotMatch(displayMarkup, /提交答案|输入你猜的国家或城市/);
  const port = await app.listen();
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${port}/api/rooms/${room.code}/trivia-location-guess`, {
        method: 'POST',
      })
    ).status,
    404,
  );
  const first = snapshot();
  const firstTeam = first.teams[0];
  hostAction('incorrect');
  hostAction('arm');
  const second = snapshot();
  const secondTeam = second.teams.find((team) => team.id !== firstTeam.id)!;
  buzz(secondTeam, second.windowId);
  const before = app.store
    .players(room.id)
    .filter((p) => secondTeam.members.some((m) => m.id === p.id))
    .map((p) => p.spendable);
  hostAction('award', { teamId: secondTeam.id, amount: 500 });
  const after = app.store
    .players(room.id)
    .filter((p) => secondTeam.members.some((m) => m.id === p.id))
    .map((p) => p.spendable);
  assert.deepEqual(
    after,
    before.map((value) => value + 500),
  );
  hostAction('reveal-answer');
  hostAction('finish-cell');
  assert.equal(snapshot('display').board?.selected, null);
});
