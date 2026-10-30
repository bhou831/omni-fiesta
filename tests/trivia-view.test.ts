import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TriviaDisplay } from '../src/client/Trivia.js';
import type { TriviaProjection } from '../src/server/games/trivia.js';

const trivia: TriviaProjection = {
  teams: [
    {
      id: 1,
      name: 'Team 1',
      color: '#8d2727',
      excluded: false,
      members: [
        { id: 'a', name: 'Alex', emoji: '🦊' },
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

test('TV board highlights the buzzing team and member and dims excluded teams', () => {
  const html = renderToStaticMarkup(createElement(TriviaDisplay, { trivia }));
  assert.match(html, /team-card is-buzzer/);
  assert.match(html, /team-card\s+is-excluded/);
  assert.equal(html.match(/class="is-first"/g)?.length, 1);
  assert.match(html, /本题已答错/);
  assert.match(html, /Sam 为Team 1抢答成功/);
});
