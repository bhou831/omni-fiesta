import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CostumeDisplay } from '../src/client/Costume.js';
import type { CostumeProjection } from '../src/server/games/costume.js';

test('TV costume results list every guest in the column layout, with places and token changes', () => {
  const results = Array.from({ length: 15 }, (_, i) => ({
    playerId: `p${i}`,
    name: `Guest ${i + 1}`,
    emoji: '🦊',
    place: Math.min(i + 1, 5),
    votes: Math.max(0, 4 - i),
    tokenChange: i < 3 ? [1000, 800, 500][i] : i >= 4 ? -83 : 0,
  }));
  const state: CostumeProjection = {
    prizes: [],
    lastPlacePenaltyPool: 500,
    votedFor: null,
    voteCount: 15,
    revealed: true,
    results,
    round: 1,
    candidates: null,
    tiedForFirst: [],
  };
  const html = renderToStaticMarkup(createElement(CostumeDisplay, { state }));
  assert.match(html, /<ol class="costume-results">/);
  assert.equal(html.match(/<li/g)?.length, 15);
  assert.equal(html.match(/class="is-top"/g)?.length, 3);
  assert.match(html, /Guest 15/);
  assert.match(html, /4 votes · \+1,000 tokens/);
  assert.match(html, /0 votes · −83 tokens/);
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(CostumeDisplay, { state: { ...state, revealed: false } })),
    /costume-results/,
  );
});
