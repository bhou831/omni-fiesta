import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApp } from '../src/server/app.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';
import { TriviaScoreboard } from '../src/client/TriviaScoreboard.js';
import type { Command } from '../src/shared/contracts.js';

test('scoreboard follows persisted awards once per team, excludes undo, shares ties and exposes no private data', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'score-test-password' });
  t.after(() => app.store.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const host = { role: 'host' as const, roomId: null, playerId: null, tokenHash: '' };
  const player = {
    role: 'player' as const,
    roomId: room.id,
    playerId: room.playerId,
    tokenHash: '',
  };
  const command = (
    type: Command['type'],
    action?: string,
    data?: Record<string, unknown>,
    session = host as typeof host | typeof player,
  ) =>
    app.engine.execute(session, room.id, {
      requestId: randomUUID(),
      phaseInstance: app.store.room(room.id).phase_instance,
      type,
      payload: { action, data },
    });
  command('phase.host', 'assign', { count: 5 });
  const award = (teamId: number, amount: number, cellId: string) => {
    command('phase.host', 'select-cell', { cellId });
    const result = command('phase.host', 'award', { teamId, amount, cellId });
    command('phase.host', 'finish-cell', { cellId });
    return result;
  };
  award(1, 300, 'childhood-3');
  award(2, 300, 'music-3');
  award(3, 100, 'childhood-1');
  award(4, 500, 'childhood-5');
  const awards = app.engine.snapshot({ role: 'host', roomId: room.id }).trivia!.awardHistory!;
  command('phase.host', 'undo-award', { awardId: awards[0].id });
  command('phase.close');
  command('phase.advance');
  assert.equal(app.store.room(room.id).phase, 'trivia-scoreboard');
  const display = app.engine.snapshot({ role: 'display', roomId: room.id });
  const board = display.triviaScoreboard!;
  assert.deepEqual(
    board.teams.map((t) => [t.id, t.score, t.rank]),
    [
      [1, 300, 1],
      [2, 300, 1],
      [3, 100, 3],
      [4, 0, 4],
      [5, 0, 4],
    ],
  );
  assert.equal(display.self, undefined);
  assert.equal(display.host, undefined);
  assert.equal(display.trivia, undefined);
  assert.doesNotMatch(JSON.stringify(board), /phone|email|answer|awardHistory|accounts/);
  const phone = app.engine.snapshot({ role: 'player', roomId: room.id, playerId: room.playerId });
  assert.ok(phone.triviaScoreboard!.ownTeamId);
  const markup = renderToStaticMarkup(
    createElement(TriviaScoreboard, { data: phone.triviaScoreboard! }),
  );
  assert.equal((markup.match(/<li /g) ?? []).length, 5);
  assert.match(markup, /本队/);
  assert.throws(() => command('phase.advance', undefined, undefined, player));
  assert.throws(() => command('phase.host', 'award', { teamId: 1, amount: 100 }));
  command('phase.close');
  command('phase.advance');
  assert.equal(app.store.room(room.id).phase, 'slots');
});

test('scoreboard preview includes five teams and zero scores together', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'score-test-password' });
  t.after(() => app.store.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia-scoreboard')!,
  );
  const teams = app.engine.snapshot({ role: 'display', roomId: room.id }).triviaScoreboard!.teams;
  assert.equal(teams.length, 5);
  assert.deepEqual(
    teams.map((t) => t.score),
    [400, 400, 200, 0, 0],
  );
});

test('scoreboard and reward cues survive restart without recreating awards', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fiesta-score-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const databasePath = join(dir, 'party.sqlite');
  const options = { databasePath, hostPassword: 'restart-test-password' };
  const app = createApp(options);
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia-scoreboard')!,
  );
  const viewer = { role: 'player' as const, roomId: room.id, playerId: room.playerId };
  const before = app.engine.snapshot(viewer);
  const count = app.store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()!.n;
  app.store.close();
  const restarted = createApp(options);
  t.after(() => restarted.store.close());
  const after = restarted.engine.snapshot(viewer);
  assert.deepEqual(after.triviaScoreboard, before.triviaScoreboard);
  assert.deepEqual(after.self!.rewardCue, before.self!.rewardCue);
  assert.equal(restarted.store.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()!.n, count);
});
