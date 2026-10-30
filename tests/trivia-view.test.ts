import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TriviaDisplay, TriviaPlayer } from '../src/client/Trivia.js';
import type { TriviaProjection } from '../src/server/games/trivia.js';

const trivia: TriviaProjection = {
  teams: [
    {
      id: 1,
      name: 'Team 1',
      color: '#8d2727',
      excluded: false,
      members: [
        { id: 'a', name: 'Alex', emoji: '🦦' },
        { id: 'b', name: 'Sam', emoji: '🐸' },
      ],
    },
    {
      id: 2,
      name: 'Team 2',
      color: '#20568c',
      excluded: true,
      members: [{ id: 'c', name: 'Robin', emoji: '🐼' }],
    },
  ],
  question: 2,
  windowId: 1,
  status: 'locked',
  winner: { playerId: 'b', teamId: 1 },
  ownTeamId: null,
  defaultTeamCount: 2,
};

test('phone shows one accurate state for own and opposing winners, and keeps buzzer status accessible', () => {
  const command = async () => ({}) as never;
  const ownWin = renderToStaticMarkup(
    createElement(TriviaPlayer, {
      trivia: { ...trivia, ownTeamId: 1 },
      command,
      disabled: false,
    }),
  );
  assert.match(ownWin, /本队抢答成功/);
  assert.doesNotMatch(ownWin, /Team 1抢答成功/);
  assert.equal((ownWin.match(/role="status"/g) ?? []).length, 1);
  assert.match(ownWin, /class="button primary trivia-buzzer"/);

  const otherWin = renderToStaticMarkup(
    createElement(TriviaPlayer, {
      trivia: {
        ...trivia,
        ownTeamId: 2,
        teams: trivia.teams.map((team) => ({ ...team, excluded: false })),
      },
      command,
      disabled: false,
    }),
  );
  assert.match(otherWin, /Team 1抢答成功/);
});

test('TV board highlights the buzzing team and member and dims excluded teams', () => {
  const html = renderToStaticMarkup(createElement(TriviaDisplay, { trivia }));
  assert.match(html, /team-card is-buzzer/);
  assert.match(html, /team-card\s+is-excluded/);
  assert.equal(html.match(/class="is-first"/g)?.length, 1);
  assert.match(html, /本题已答错/);
  assert.match(html, /Sam 为Team 1抢答成功/);
});

const board: NonNullable<TriviaProjection['board']> = {
  version: 'display-test',
  categories: [{ id: 'sample', name: '类别 1' }],
  cells: [{ id: 'sample-100', categoryId: 'sample', value: 100, used: false, available: true }],
  selected: { id: 'sample-100', categoryId: 'sample', value: 100, publicPrompt: '示例问题？' },
  revealed: false,
  canCancel: false,
};

test('question display identifies the buzzer winner without repeating instructions or a roster', () => {
  const html = renderToStaticMarkup(createElement(TriviaDisplay, { trivia: { ...trivia, board } }));
  assert.match(html, /示例问题？/);
  assert.match(html, /is-answering/);
  assert.match(html, /Sam/);
  assert.doesNotMatch(html, /Alex|Robin|请口头回答|看大屏幕/);
  assert.match(html, /本题已答错/);
});

test('answer reveal replaces buzzer ownership while retaining the question and public team scores', () => {
  const html = renderToStaticMarkup(
    createElement(TriviaDisplay, {
      trivia: {
        ...trivia,
        teams: trivia.teams.map((team) => ({ ...team, score: 1200 })),
        board: { ...board, revealed: true, selected: { ...board.selected!, answer: '示例答案' } },
      },
    }),
  );
  assert.match(html, /示例问题？/);
  assert.match(html, /示例答案/);
  assert.match(html, /答案已公布/);
  assert.match(html, /1,200/);
  assert.doesNotMatch(html, /is-answering|is-buzzer|Sam/);
});

test('the board distinguishes selection, unarmed and armed states without announcing a stale winner', () => {
  for (const [selected, status, label] of [
    [null, 'idle', '选题'],
    [board.selected, 'idle', '抢答未开启'],
    [board.selected, 'armed', '抢答开启'],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(TriviaDisplay, {
        trivia: { ...trivia, status, board: { ...board, selected } },
      }),
    );
    assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /is-answering|Sam/);
  }
});
