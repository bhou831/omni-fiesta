import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server/app.js';
import { seedPreviewRoom, PREVIEW_SCENARIOS } from '../scripts/preview-fixtures.js';

test('each independent preview seeds real game projections with fixture prices and usable actions', async (t) => {
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: 'preview-test-password',
    now: () => 1000000,
  });
  t.after(() => server.close());
  for (const scenario of PREVIEW_SCENARIOS) {
    const room = await seedPreviewRoom(server.engine, scenario);
    const player = server.engine.snapshot({
      role: 'player',
      roomId: room.id,
      playerId: room.playerId,
    });
    const display = server.engine.snapshot({ role: 'display', roomId: room.id });
    assert.equal(player.room.phase, scenario.stage);
    assert.equal(player.room.marketSource, 'fixture');
    assert.equal(player.players.length, 6);
    assert.equal(display.self, undefined);
    assert.equal(display.host, undefined);
    if (scenario.stage === 'investments')
      assert.equal(player.investments?.opening?.quotes.length, 5);
    if (scenario.stage === 'slots')
      assert.equal(player.slots?.role === 'player' && player.slots.data.spins.length, 0);
    if (scenario.stage === 'trivia') {
      assert.equal(player.trivia?.status, 'idle');
      assert.equal(player.trivia?.board, undefined);
      assert.equal(display.trivia?.board?.cells.length, 25);
      assert.equal(display.trivia?.demo, true);
      assert.equal(player.trivia?.demo, true);
      assert.ok(display.trivia?.board?.cells.every((cell) => cell.available));
      assert.equal(display.trivia?.board?.selected, null);
    }
    if (scenario.key === 'costume-results') {
      assert.equal(display.costumeReveal?.revealed.length, 1);
      assert.equal(display.costumeReveal?.upcoming.length, 0);
    }
    if (scenario.key === 'powerball-results') assert.equal(display.powerball?.revealed, true);
    if (scenario.stage === 'investment-review') {
      assert.equal(player.self?.accounts.locked, 0);
      assert.equal(player.investments?.positions[0]?.payout, 720);
    }
    if (scenario.key === 'finish-podium') assert.equal(display.ranking?.length, 1);
    if (scenario.key === 'finish') assert.equal(display.ranking?.length, 6);
  }
});

test('normal application exposes no preview entry routes; preview cookies cannot replace normal sessions', async (t) => {
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: 'preview-test-password',
    cookiePrefix: 'of_preview',
  });
  const port = await server.listen();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'preview-test-password' }),
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.match(cookie, /^of_preview_host=/);
  const wrongCookie = cookie.replace('of_preview_host=', 'of_host=');
  assert.equal(
    (await fetch(base + '/api/rooms', { headers: { Cookie: wrongCookie } })).status,
    401,
  );
  assert.equal((await fetch(base + '/api/rooms', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/preview/open/slots/host')).status, 404);
});
