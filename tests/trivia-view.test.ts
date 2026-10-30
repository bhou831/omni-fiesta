import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TriviaDisplay, TriviaHost, TriviaPlayer } from '../src/client/Trivia.js';
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
  started: true,
  canCancel: false,
};

test('TV landing explains Jeopardy and retains assigned teams without exposing clues', () => {
  const teams = [1, 2, 3, 4].map((id) => ({
    id,
    name: `第 ${id} 队`,
    color: '#8d2727',
    excluded: false,
    members: [{ id: `player-${id}`, name: `玩家 ${id}`, emoji: '🦦' }],
  }));
  const html = renderToStaticMarkup(
    createElement(TriviaDisplay, {
      trivia: {
        ...trivia,
        question: 0,
        winner: null,
        status: 'idle',
        teams,
        board: { ...board, selected: null, started: false },
      },
    }),
  );
  assert.match(html, /今晚的队伍/);
  assert.match(html, /4 支队伍/);
  assert.equal((html.match(/class="team-card"/g) ?? []).length, 4);
  assert.match(html, /组队，选题，抢答/);
  assert.match(html, /最快的队伍口头回答/);
  assert.match(html, /全队每人获得题目分值/);
  assert.match(html, /答错不扣分/);
  assert.match(html, /jeopardy-intro-art/);
  assert.doesNotMatch(html, /示例问题/);
  assert.doesNotMatch(html, /看大屏幕|等待主持人/);
});

test('unassigned landing still shows rules and the closed phone cannot announce an old winner', () => {
  const html = renderToStaticMarkup(
    createElement(TriviaDisplay, {
      trivia: { ...trivia, teams: [], board: { ...board, selected: null, started: false } },
    }),
  );
  assert.match(html, /trivia-intro-rules/);
  assert.match(html, /jeopardy-intro-art/);
  assert.doesNotMatch(html, /今晚的队伍/);
  const phone = renderToStaticMarkup(
    createElement(TriviaPlayer, {
      trivia: { ...trivia, ownTeamId: 1, status: 'armed' },
      command: async () => {},
      disabled: false,
      closed: true,
    }),
  );
  assert.match(phone, /本轮结束/);
  assert.match(phone, /disabled=""/);
  assert.doesNotMatch(phone, /本队抢答成功|可以抢答/);
});

test('host defaults scoring to the actual buzzer winner and makes the award destination explicit', () => {
  const html = renderToStaticMarkup(
    createElement(TriviaHost, {
      trivia: { ...trivia, winner: { teamId: 2, playerId: 'c' }, board },
      command: async () => {},
      disabled: false,
    }),
  );
  assert.match(html, /value="2" selected=""/);
  assert.match(html, /答对 · 奖励Team 2每人/);
  assert.match(html, /不计分 · 完成本题/);
});

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
