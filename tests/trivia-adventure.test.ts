import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { createTriviaContent, DEMO_TRIVIA_BANK } from '../src/server/games/trivia-content.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';
import type { Session } from '../src/server/core/store.js';

async function fixture() {
  let now = 1_000_000;
  const app = createApp({
    databasePath: ':memory:',
    hostPassword: 'adventure-test-password',
    now: () => now,
  });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const content = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  content.mode = 'event';
  content.adventureQuestionBank = {
    charades: Array.from({ length: 30 }, (_, i) => `Word ${i + 1}`),
    yesOrNo: ['Challenge A', 'Challenge B', 'Challenge C'],
  };
  content.adventureRules = {
    charadesSimple: ['Guess six words in two minutes.'],
    charadesComplex: ['Guess eight words in two minutes.'],
    yesOrNoSimple: ['Guess and complete in three minutes.'],
    yesOrNoHard: ['Guess and complete in two minutes.'],
    photoRecreation: ['Pose and score.'],
  };
  for (let i = 1; i <= 5; i++) {
    const cell = content.cells.find((c) => c.id === `adventure-${i}`)!;
    cell.kind = 'adventure';
    cell.adventureVariant = (
      [
        'charades-simple',
        'yes-no-simple',
        'charades-complex',
        'yes-no-hard',
        'photo-recreation',
      ] as const
    )[i - 1];
    cell.publicPrompt = `Challenge ${i}`;
    cell.hostAnswer = undefined;
    cell.unavailableReason = undefined;
    if (i === 5) cell.referenceImage = 'reference-image-1';
  }
  app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(content), room.id);
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const execute = (
    action: string,
    cellId: string,
    extra: Record<string, unknown> = {},
    requestId = randomUUID(),
  ) =>
    app.engine.execute(host, room.id, {
      type: 'phase.host',
      phaseInstance: app.store.room(room.id).phase_instance,
      requestId,
      payload: { action, data: { cellId, ...extra } },
    });
  const snapshot = (role: 'host' | 'display' | 'player' = 'host') =>
    app.engine.snapshot({
      role,
      roomId: room.id,
      ...(role === 'player' ? { playerId: room.playerId } : {}),
    } as Parameters<typeof app.engine.snapshot>[0]).trivia!;
  const buzz = (teamId: number) => {
    const playerId = snapshot().teams.find((t) => t.id === teamId)!.members[0].id;
    return app.engine.execute(
      { role: 'player', roomId: room.id, playerId, tokenHash: '' },
      room.id,
      {
        type: 'phase.action',
        phaseInstance: app.store.room(room.id).phase_instance,
        requestId: randomUUID(),
        payload: { action: 'buzz', data: { windowId: snapshot().windowId } },
      },
    );
  };
  return {
    app,
    room,
    execute,
    snapshot,
    buzz,
    setNow: (value: number) => {
      now = value;
    },
  };
}

test('charades rules, server timer, unique draws and explicit award survive the host flow', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  f.execute('select-cell', cell);
  assert.equal(f.snapshot().adventure?.phase, 'waiting');
  f.execute('adventure-choose-team', cell, { attempt: 1, teamId: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'rules');
  assert.equal(f.snapshot('player').adventure?.item, null);
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-start', cell, { attempt: 1 });
  const words = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const word = f.snapshot().adventure!.item!;
    assert.ok(!words.has(word));
    assert.equal(f.snapshot('display').adventure?.item, null);
    assert.equal(f.snapshot('player').adventure?.item, null);
    words.add(word);
    f.execute('adventure-correct', cell, { attempt: 1 });
  }
  assert.equal(f.snapshot().adventure?.phase, 'result');
  assert.equal(f.snapshot().teams[0].score, 0);
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
  assert.throws(() => f.execute('adventure-award', cell, { attempt: 1, teamId: 2 }));
  f.execute('adventure-award', cell, { attempt: 1, teamId: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'won');
  assert.equal(f.snapshot().teams[0].score, 100);
  assert.throws(() => f.execute('adventure-correct', cell, { attempt: 1 }));
  f.execute('finish-cell', cell);
  assert.equal(f.snapshot().board?.selected, null);
});

test('first failure gives one other team a fresh full attempt, then closes with no award', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-3';
  f.execute('select-cell', cell);
  f.execute('adventure-choose-team', cell, { attempt: 1, teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  const firstWord = f.snapshot().adventure!.item;
  f.setNow(1_120_000);
  assert.throws(() => f.execute('adventure-correct', cell, { attempt: 1 }));
  f.execute('adventure-fail', cell, { attempt: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'result');
  f.execute('adventure-steal', cell, { attempt: 1 });
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
  f.execute('arm', cell);
  assert.throws(() => f.buzz(1));
  f.buzz(2);
  assert.equal(f.snapshot().adventure?.phase, 'rules');
  f.execute('adventure-start', cell, { attempt: 2 });
  assert.equal(f.snapshot().adventure?.deadlineAt, 1_240_000);
  assert.notEqual(f.snapshot().adventure?.item, firstWord);
  f.execute('adventure-fail', cell, { attempt: 2 });
  assert.equal(f.snapshot().adventure?.phase, 'closed');
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 2 }));
  f.execute('finish-cell', cell);
  assert.equal(
    f.snapshot().teams.reduce((n, team) => n + (team.score ?? 0), 0),
    0,
  );
});

test('Yes or No consent replacement consumes a prompt; second team retries the same prompt', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-2';
  f.execute('select-cell', cell);
  f.execute('adventure-choose-team', cell, { attempt: 1, teamId: 1 });
  const first = f.snapshot().adventure!.item;
  f.execute('adventure-replace', cell, { attempt: 1 });
  const second = f.snapshot().adventure!.item;
  assert.notEqual(second, first);
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-display-prompt', cell, { attempt: 1, visible: true });
  assert.equal(f.snapshot('display').adventure?.item, second);
  f.execute('adventure-display-prompt', cell, { attempt: 1, visible: false });
  f.execute('adventure-start', cell, { attempt: 1 });
  assert.equal(f.snapshot('player').adventure?.item, null);
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-display-prompt', cell, { attempt: 1, visible: true });
  assert.equal(f.snapshot('display').adventure?.item, second);
  f.execute('adventure-display-prompt', cell, { attempt: 1, visible: false });
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-fail', cell, { attempt: 1 });
  f.execute('adventure-steal', cell, { attempt: 1 });
  f.execute('arm', cell);
  f.buzz(2);
  assert.equal(f.snapshot().adventure?.item, second);
  f.execute('adventure-start', cell, { attempt: 2 });
  f.execute('adventure-success', cell, { attempt: 2 });
  assert.equal(f.snapshot().teams[1].score, 0);
  f.execute('adventure-award', cell, { attempt: 2, teamId: 2 });
  assert.equal(f.snapshot().teams[1].score, 200);
});

test('photo recreation displays its reference, scores after the pose timer, and awards only at threshold', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-5';
  f.execute('select-cell', cell);
  assert.throws(() => f.execute('arm', cell));
  f.execute('adventure-choose-team', cell, { attempt: 1, teamId: 1 });
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-start', cell, { attempt: 1 });
  assert.equal(f.snapshot('display').adventure?.item, 'reference-image-1');
  assert.equal(f.snapshot('player').adventure?.item, null);
  assert.throws(() =>
    f.execute('adventure-score', cell, { attempt: 1, score: 80, reason: 'Good pose' }),
  );
  f.setNow(1_120_000);
  f.execute('adventure-score', cell, { attempt: 1, score: 80, reason: 'Good pose' });
  assert.equal(f.snapshot().adventure?.phase, 'result');
  f.execute('adventure-award', cell, { attempt: 1, teamId: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'won');
  assert.equal(f.snapshot().teams[0].score, 500);
  assert.throws(() =>
    f.execute('adventure-score', cell, { attempt: 1, score: 80, reason: 'Again' }),
  );
});

test('host may pass a failed challenge without inviting every team', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-4';
  f.execute('select-cell', cell);
  f.execute('adventure-choose-team', cell, { attempt: 1, teamId: 2 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-fail', cell, { attempt: 1 });
  f.execute('adventure-abort', cell, { attempt: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'closed');
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
  f.execute('finish-cell', cell);
  assert.equal(
    f.snapshot().teams.reduce((sum, team) => sum + (team.score ?? 0), 0),
    0,
  );
});

test('host can end an active adventure early and return to the trivia board', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  f.execute('select-cell', cell);
  f.execute('adventure-choose-team', cell, { attempt: 1, teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-finish-cell', cell, { attempt: 1 });
  assert.equal(f.snapshot().board?.selected, null);
  assert.equal(
    f.snapshot().teams.reduce((sum, team) => sum + (team.score ?? 0), 0),
    0,
  );
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
});
