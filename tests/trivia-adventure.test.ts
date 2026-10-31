import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdventureHost } from '../src/client/TriviaAdventure.js';
import { TriviaDisplay, TriviaHost, TriviaPlayer } from '../src/client/Trivia.js';
import { createApp } from '../src/server/app.js';
import {
  createTriviaContent,
  DEMO_TRIVIA_BANK,
  missingPhotoScoringPrompt,
  validateTriviaContent,
} from '../src/server/games/trivia-content.js';
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
  content.photoScoringPrompt = 'Synthetic host-only clipboard fixture';
  content.adventureQuestionBank = {
    charades: Array.from({ length: 30 }, (_, i) => `Word ${i + 1}`),
    yesOrNo: ['Challenge A', 'Challenge B', 'Challenge C'],
  };
  content.adventureRules = {
    charadesSimple: ['Guess six words in two minutes.'],
    charadesComplex: ['Guess eight words in two minutes.'],
    yesOrNoSimple: ['Guess and complete in three minutes.'],
    yesOrNoHard: ['Guess and complete in two minutes.'],
    photoRecreation: ['Pose and let the host judge.'],
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
    if (i === 5)
      cell.referenceImages = [
        '/adventure/photo-recreation-attempt-1.png',
        '/adventure/photo-recreation-attempt-2.png',
      ];
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

test('photo scoring disclosure is host-only and uses the frozen content', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  f.execute('select-cell', 'adventure-5', { teamId: 1 });
  assert.equal(f.snapshot().adventure?.photoScoringPrompt, 'Synthetic host-only clipboard fixture');
  assert.equal(f.snapshot('display').adventure?.photoScoringPrompt, undefined);
  assert.equal(f.snapshot('player').adventure?.photoScoringPrompt, undefined);
});

test('event photo readiness detects a missing saved scoring prompt', () => {
  const content = createTriviaContent([100, 200, 300, 400, 500], DEMO_TRIVIA_BANK);
  content.mode = 'event';
  const cell = content.cells.find((entry) => entry.id === 'adventure-5')!;
  cell.kind = 'adventure';
  cell.adventureVariant = 'photo-recreation';
  cell.unavailableReason = undefined;
  assert.equal(missingPhotoScoringPrompt(content), true);
  content.photoScoringPrompt = 'Synthetic host-only scoring fixture';
  assert.equal(missingPhotoScoringPrompt(content), false);
});

test('retry excludes the failed team when resuming a legacy saved failure', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-fail', cell, { attempt: 1 });
  f.app.store.db.prepare('DELETE FROM trivia_exclusions WHERE room_id=?').run(f.room.id);
  assert.equal(f.snapshot().teams.find((team) => team.id === 1)?.excluded, false);
  f.execute('adventure-steal', cell, { attempt: 1 });
  assert.equal(f.snapshot().teams.find((team) => team.id === 1)?.excluded, true);
  f.execute('arm', cell);
  assert.throws(() => f.buzz(1));
  f.buzz(2);
  assert.equal(f.snapshot().adventure?.teamId, 2);
});

test('revealing a failed adventure blocks retries and leaves a finish path', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-fail', cell, { attempt: 1 });
  f.execute('reveal-answer', cell);
  const markup = renderToStaticMarkup(
    createElement(TriviaHost, {
      trivia: f.snapshot(),
      command: async () => undefined,
      disabled: false,
    }),
  );
  assert.doesNotMatch(markup, /开启下一轮抢答/);
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
  assert.equal(f.snapshot().adventure?.attempt, 1);
  f.execute('adventure-finish-cell', cell, { attempt: 1 });
  assert.equal(f.snapshot().board?.selected, null);
});

test('both charades variants resume immediately on retry with a fresh word and deadline', async (t) => {
  for (const cell of ['adventure-1', 'adventure-3']) {
    const f = await fixture();
    t.after(() => f.app.close());
    f.execute('select-cell', cell, { teamId: 1 });
    f.execute('adventure-start', cell, { attempt: 1 });
    const first = f.snapshot().adventure!;
    f.execute('adventure-fail', cell, { attempt: 1 });
    f.execute('adventure-steal', cell, { attempt: 1 });
    f.execute('arm', cell);
    f.setNow(1_010_000);
    f.buzz(2);
    const retry = f.snapshot().adventure!;
    assert.equal(retry.phase, 'active');
    assert.equal(retry.teamId, 2);
    assert.equal(retry.startedAt, 1_010_000);
    assert.equal(retry.deadlineAt, 1_010_000 + retry.durationSeconds * 1000);
    assert.notEqual(retry.item, first.item);
    assert.equal(f.snapshot('display').adventure?.item, retry.item);
    assert.equal(f.snapshot('player').adventure?.item, null);
    assert.throws(() => f.execute('adventure-start', cell, { attempt: 2 }));
    assert.throws(() => f.execute('adventure-correct', cell, { attempt: 1 }));
    assert.equal(f.snapshot().adventure?.deadlineAt, retry.deadlineAt);
    f.execute('adventure-correct', cell, { attempt: 2 });
    assert.equal(f.snapshot().adventure?.correct, 1);
    assert.notEqual(f.snapshot().adventure?.item, retry.item);
  }
});

test('four different teams can attempt charades without reusing an item', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  f.execute('assign', cell, { count: 4 });
  assert.throws(() => f.execute('select-cell', cell));
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  const seen = new Set<string>();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const state = f.snapshot().adventure!;
    assert.equal(state.teamId, attempt);
    assert.ok(state.item && !seen.has(state.item));
    seen.add(state.item!);
    f.execute('adventure-fail', cell, { attempt });
    assert.equal(f.snapshot().teams.find((team) => team.id === attempt)?.excluded, true);
    if (attempt === 4) break;
    f.execute('adventure-steal', cell, { attempt });
    f.execute('arm', cell);
    assert.throws(() => f.buzz(attempt));
    f.buzz(attempt + 1);
    assert.equal(f.snapshot().adventure?.phase, 'active');
  }
  assert.equal(f.snapshot().adventure?.phase, 'closed');
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 4 }));
  f.execute('finish-cell', cell);
});

test('four photo attempts reuse the two frozen references in order', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-5';
  f.execute('assign', cell, { count: 4 });
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  const refs: (string | null)[] = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    refs.push(f.snapshot().adventure!.item);
    f.execute('adventure-photo-fail', cell, { attempt });
    if (attempt === 4) break;
    f.execute('adventure-steal', cell, { attempt });
    f.execute('arm', cell);
    f.buzz(attempt + 1);
  }
  assert.notEqual(refs[0], refs[1]);
  assert.equal(refs[2], refs[0]);
  assert.equal(refs[3], refs[1]);
  assert.equal(f.snapshot().adventure?.phase, 'closed');
});

test('both Yes or No variants stop after two distinct teams', async (t) => {
  for (const cell of ['adventure-2', 'adventure-4']) {
    const f = await fixture();
    t.after(() => f.app.close());
    f.execute('assign', cell, { count: 4 });
    f.execute('select-cell', cell, { teamId: 1 });
    assert.equal(f.snapshot().controls?.attemptLimit, 2);
    f.execute('adventure-start', cell, { attempt: 1 });
    f.execute('adventure-fail', cell, { attempt: 1 });
    f.execute('adventure-steal', cell, { attempt: 1 });
    f.execute('arm', cell);
    f.buzz(2);
    f.execute('adventure-fail', cell, { attempt: 2 });
    assert.equal(f.snapshot().adventure?.phase, 'closed');
    assert.throws(() => f.execute('adventure-steal', cell, { attempt: 2 }));
  }
});

test('an exhausted charades pool prevents retry and leaves a visible finish path', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.app.store.db
    .prepare(
      "UPDATE trivia_adventure_pools SET items='[]',cursor=0 WHERE room_id=? AND name='charades'",
    )
    .run(f.room.id);
  f.execute('adventure-fail', cell, { attempt: 1 });
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
  const markup = renderToStaticMarkup(
    createElement(TriviaHost, {
      trivia: f.snapshot(),
      command: async () => undefined,
      disabled: false,
    }),
  );
  assert.match(markup, /剩余词语不足/);
  f.execute('adventure-finish-cell', cell, { attempt: 1 });
  assert.equal(f.snapshot().board?.selected, null);
});

test('charades rules, server timer, unique draws and explicit award survive the host flow', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-1';
  assert.throws(() => f.execute('select-cell', cell));
  f.execute('select-cell', cell, { teamId: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'rules');
  assert.equal(f.snapshot('player').adventure?.item, null);
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-start', cell, { attempt: 1 });
  const words = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const word = f.snapshot().adventure!.item!;
    assert.ok(!words.has(word));
    assert.equal(f.snapshot('display').adventure?.item, word);
    assert.equal(f.snapshot('player').adventure?.item, null);
    words.add(word);
    f.execute('adventure-correct', cell, { attempt: 1 });
  }
  assert.equal(f.snapshot().adventure?.phase, 'result');
  assert.equal(f.snapshot('display').adventure?.item, null);
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
  f.execute('select-cell', cell, { teamId: 1 });
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
  assert.equal(f.snapshot().adventure?.phase, 'active');
  assert.equal(f.snapshot('display').winner?.teamId, 2);
  const tv = renderToStaticMarkup(createElement(TriviaDisplay, { trivia: f.snapshot('display') }));
  assert.match(tv, /抢答成功/);
  assert.match(tv, new RegExp(f.snapshot('display').teams[1].members[0].name));
  assert.throws(() => f.execute('adventure-start', cell, { attempt: 2 }));
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

test('every adventure confirms the accepted steal on phones during active play', async (t) => {
  for (let i = 1; i <= 5; i++) {
    const f = await fixture();
    t.after(() => f.app.close());
    const cell = `adventure-${i}`;
    const fail = i === 5 ? 'adventure-photo-fail' : 'adventure-fail';
    const phone = (playerId: string, closed = false) => {
      const trivia = f.app.engine.snapshot({ role: 'player', roomId: f.room.id, playerId }).trivia!;
      // Phones must never receive the selected clue or challenge prompt.
      assert.equal(trivia.board, undefined);
      if (trivia.adventure) assert.equal(trivia.adventure.item, null);
      return renderToStaticMarkup(
        createElement(TriviaPlayer, { trivia, command: async () => {}, disabled: false, closed }),
      );
    };
    f.execute('select-cell', cell, { teamId: 1 });
    assert.match(phone(f.snapshot().teams[0].members[0].id), /请听规则/);
    f.execute('adventure-start', cell, { attempt: 1 });
    f.setNow(1_200_000);
    f.execute(fail, cell, { attempt: 1 });
    f.execute('adventure-steal', cell, { attempt: 1 });
    f.execute('arm', cell);
    f.buzz(2);
    const winner = f.snapshot().teams.find((team) => team.id === 2)!;
    const opponent = f.snapshot().teams.find((team) => team.id === 1)!.members[0];
    const checkWinner = () => {
      assert.equal(f.snapshot().winner?.teamId, winner.id);
      assert.match(
        renderToStaticMarkup(createElement(TriviaDisplay, { trivia: f.snapshot('display') })),
        /抢答成功/,
      );
      for (const member of winner.members) assert.match(phone(member.id), /本队抢答成功/);
      assert.doesNotMatch(phone(opponent.id), /本队抢答成功/);
      assert.match(phone(winner.members[0].id, true), /本轮结束/);
      assert.doesNotMatch(phone(winner.members[0].id, true), /本队抢答成功/);
    };
    assert.equal(f.snapshot().adventure?.phase, 'active');
    checkWinner();
    f.setNow(1_400_000);
    f.execute(fail, cell, { attempt: 2 });
    assert.match(phone(winner.members[0].id), /挑战结束/);
    assert.doesNotMatch(phone(winner.members[0].id), /本队抢答成功/);
    f.execute('finish-cell', cell);
    assert.doesNotMatch(phone(winner.members[0].id), /抢答成功/);
  }
});

test('Yes or No consent replacement consumes a prompt; second team retries the same prompt', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-2';
  f.execute('select-cell', cell, { teamId: 1 });
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
  f.execute('adventure-success', cell, { attempt: 2 });
  assert.equal(f.snapshot().teams[1].score, 0);
  f.execute('adventure-award', cell, { attempt: 2, teamId: 2 });
  assert.equal(f.snapshot().teams[1].score, 200);
});

test('photo recreation accepts early host judgement and awards the selected team', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-5';
  f.execute('select-cell', cell, { teamId: 1 });
  assert.throws(() => f.execute('arm', cell));
  assert.equal(f.snapshot('display').adventure?.item, null);
  f.execute('adventure-start', cell, { attempt: 1 });
  assert.equal(f.snapshot('display').adventure?.item, '/adventure/photo-recreation-attempt-1.png');
  assert.equal(f.snapshot('player').adventure?.item, null);
  assert.throws(() => f.execute('adventure-score', cell, { attempt: 1, score: 100 }));
  const requestId = randomUUID();
  f.execute('adventure-photo-success', cell, { attempt: 1 }, requestId);
  f.execute('adventure-photo-success', cell, { attempt: 1 }, requestId);
  assert.equal(f.snapshot().adventure?.phase, 'result');
  f.execute('adventure-award', cell, { attempt: 1, teamId: 1 });
  assert.equal(f.snapshot().adventure?.phase, 'won');
  assert.equal(f.snapshot().teams[0].score, 500);
  assert.throws(() => f.execute('adventure-photo-success', cell, { attempt: 1 }));
});

test('photo failure rotates to the second image and permits only the other team', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-5';
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-photo-fail', cell, { attempt: 1 });
  f.execute('adventure-steal', cell, { attempt: 1 });
  assert.equal(f.snapshot().adventure?.item, '/adventure/photo-recreation-attempt-2.png');
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
  f.execute('arm', cell);
  assert.throws(() => f.buzz(1));
  f.buzz(2);
  assert.equal(f.snapshot('display').adventure?.item, '/adventure/photo-recreation-attempt-2.png');
  assert.equal(f.snapshot().adventure?.deadlineAt, 1_120_000);
  assert.throws(() => f.execute('adventure-photo-fail', cell, { attempt: 1 }));
  f.setNow(1_120_000);
  f.execute('adventure-photo-fail', cell, { attempt: 2 });
  assert.equal(f.snapshot().adventure?.phase, 'closed');
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 2 }));
  assert.equal(
    f.snapshot().teams.reduce((n, team) => n + (team.score ?? 0), 0),
    0,
  );
});

for (const action of ['adventure-photo-success', 'adventure-photo-fail'] as const) {
  for (const [label, time] of [
    ['before', 1_119_999],
    ['at', 1_120_000],
    ['after', 1_120_001],
  ] as const) {
    test(`photo ${action} works ${label} the deadline`, async (t) => {
      const f = await fixture();
      t.after(() => f.app.close());
      const cell = 'adventure-5';
      f.execute('select-cell', cell, { teamId: 1 });
      assert.throws(() => f.execute(action, cell, { attempt: 1 }));
      f.execute('adventure-start', cell, { attempt: 1 });
      assert.throws(() => f.execute(action, cell, { attempt: 2 }));
      assert.throws(() => f.execute(action, 'adventure-4', { attempt: 1 }));
      assert.throws(() =>
        f.app.engine.execute(
          { role: 'player', roomId: f.room.id, playerId: f.room.playerId, tokenHash: '' },
          f.room.id,
          {
            type: 'phase.host',
            phaseInstance: f.app.store.room(f.room.id).phase_instance,
            requestId: randomUUID(),
            payload: { action, data: { cellId: cell, attempt: 1 } },
          },
        ),
      );
      f.setNow(time);
      f.execute(action, cell, { attempt: 1 });
      assert.equal(f.snapshot().adventure?.success, action === 'adventure-photo-success');
      assert.equal(f.snapshot().adventure?.phase, 'result');
      assert.equal(f.snapshot('player').adventure?.item, null);
    });
  }
}

test('photo host judging buttons are enabled while the countdown is running', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-5';
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  const html = renderToStaticMarkup(
    createElement(AdventureHost, {
      adventure: f.snapshot().adventure!,
      teams: f.snapshot().teams,
      busy: false,
      clockOffset: 1_000_000 - Date.now(),
      button: (action, label, blocked) =>
        createElement('button', { key: action, disabled: blocked }, label),
    }),
  );
  assert.match(html, /role="timer"/);
  assert.match(html, /<button>挑战成功<\/button>/);
  assert.match(html, /<button>挑战失败<\/button>/);
});

test('new event photo content requires two distinct local images', () => {
  const content = createTriviaContent([100, 200, 300, 400, 500], 'config/trivia-event.json');
  const photo = content.cells.find((cell) => cell.adventureVariant === 'photo-recreation')!;
  assert.equal(photo.referenceImages?.length, 2);
  const invalid = (referenceImages: string[]) => ({
    ...content,
    cells: content.cells.map((cell) =>
      cell.id === photo.id ? { ...cell, referenceImages } : cell,
    ),
  });
  assert.throws(() =>
    validateTriviaContent(invalid(['/adventure/photo-recreation-attempt-1.png'])),
  );
  assert.throws(() =>
    validateTriviaContent(invalid(['https://example.com/a.png', '/adventure/b.png'])),
  );
  assert.throws(() =>
    validateTriviaContent(invalid(['/adventure/../secret.png', '/adventure/b.png'])),
  );
  assert.throws(() =>
    validateTriviaContent(
      invalid(['/adventure/missing.png', '/adventure/photo-recreation-attempt-2.png']),
    ),
  );
});

test('a frozen one-image photo room remains playable', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const board = f.app.store.db
    .prepare('SELECT content FROM trivia_boards WHERE room_id=?')
    .get(f.room.id) as { content: string };
  const frozen = JSON.parse(board.content);
  const photo = frozen.cells.find((cell: { id: string }) => cell.id === 'adventure-5');
  delete photo.referenceImages;
  photo.referenceImage = '/adventure/sample-pose.png';
  f.app.store.db
    .prepare('UPDATE trivia_boards SET content=? WHERE room_id=?')
    .run(JSON.stringify(frozen), f.room.id);
  f.execute('select-cell', 'adventure-5', { teamId: 1 });
  f.execute('adventure-start', 'adventure-5', { attempt: 1 });
  assert.equal(f.snapshot('display').adventure?.item, '/adventure/sample-pose.png');
  f.setNow(1_120_000);
  f.execute('adventure-photo-fail', 'adventure-5', { attempt: 1 });
  f.execute('adventure-steal', 'adventure-5', { attempt: 1 });
  assert.equal(f.snapshot().adventure?.item, '/adventure/sample-pose.png');
});

test('host may pass a failed challenge without inviting every team', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-4';
  f.execute('select-cell', cell, { teamId: 2 });
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
  f.execute('select-cell', cell, { teamId: 1 });
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-finish-cell', cell, { attempt: 1 });
  assert.equal(f.snapshot().board?.selected, null);
  assert.equal(
    f.snapshot().teams.reduce((sum, team) => sum + (team.score ?? 0), 0),
    0,
  );
  assert.throws(() => f.execute('adventure-steal', cell, { attempt: 1 }));
});

test('shared award validates adventure success, credits once, and undo reopens correction', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const cell = 'adventure-2';
  f.execute('select-cell', cell, { teamId: 1 });
  assert.equal(f.snapshot().controls?.canAward, false);
  assert.equal(f.snapshot('display').controls, undefined);
  assert.equal(f.snapshot('player').controls, undefined);
  assert.throws(() => f.execute('award', cell, { teamId: 1, amount: 200 }));
  f.execute('adventure-start', cell, { attempt: 1 });
  f.execute('adventure-success', cell, { attempt: 1 });
  assert.deepEqual(f.snapshot().controls?.awardableTeamIds, [1]);
  assert.equal(f.snapshot().controls?.canAward, true);
  assert.throws(() => f.execute('award', cell, { teamId: 2, amount: 200 }));
  const receipt = f.execute('award', cell, { teamId: 1, amount: 200 });
  assert.equal(f.snapshot().adventure?.phase, 'won');
  assert.equal(f.snapshot().teams[0].score, 200);
  assert.equal(f.snapshot().controls?.canAward, false);
  assert.throws(() => f.execute('award', cell, { teamId: 1, amount: 200 }));
  f.execute('undo-award', cell, { awardId: receipt.result.awardId });
  assert.equal(f.snapshot().adventure?.phase, 'result');
  assert.equal(f.snapshot().teams[0].score, 0);
  assert.equal(f.snapshot().controls?.canAward, true);
  f.execute('award', cell, { teamId: 1, amount: 200 });
  assert.equal(f.snapshot().teams[0].score, 200);
});

test('all five adventure variants render the same host decision sections', async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  for (let i = 1; i <= 5; i++) {
    const cell = `adventure-${i}`;
    f.execute('select-cell', cell, { teamId: 1 });
    const markup = renderToStaticMarkup(
      createElement(TriviaHost, {
        trivia: f.snapshot(),
        command: async () => undefined,
        disabled: false,
      }),
    );
    assert.match(markup, /<legend>题目<\/legend>/);
    assert.match(markup, /<legend>抢答与公布答案<\/legend>/);
    assert.match(markup, /<legend>记分与修正<\/legend>/);
    assert.equal((markup.match(/开启抢答/g) ?? []).length, 1);
    assert.match(markup, /选择获奖队伍/);
    f.execute('adventure-finish-cell', cell, { attempt: 1 });
  }
});
