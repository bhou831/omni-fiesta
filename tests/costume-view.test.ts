import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CostumeDisplay } from '../src/client/Costume.js';
import {
  CostumeRevealDisplay,
  CostumeRevealHost,
  CostumeRevealPlayer,
} from '../src/client/CostumeReveal.js';
import type { CostumeProjection, CostumeRevealGroup } from '../src/server/games/costume.js';

const result = (i: number, place: number, tokenChange: number) => ({
  playerId: `p${i}`,
  name: `Guest ${i}`,
  emoji: '🦊',
  place,
  votes: Math.max(0, 4 - place),
  tokenChange,
});
const third: CostumeRevealGroup = { kind: 'third', players: [result(3, 3, 500)] };
const last: CostumeRevealGroup = { kind: 'last', players: [result(15, 5, -83)] };

test('TV costume voting view hides results once voting is locked', () => {
  const state: CostumeProjection = {
    prizes: [],
    lastPlacePenaltyPool: 500,
    votedFor: null,
    voteCount: 0,
    locked: true,
    results: null,
    round: 1,
    candidates: null,
    tiedForFirst: [],
  };
  const html = renderToStaticMarkup(createElement(CostumeDisplay, { state }));
  assert.match(html, /Winners come later tonight/);
  assert.doesNotMatch(html, /costume-results|Guest/);
});

test('TV costume reveal shows only announced places and animates the newest', () => {
  const html = renderToStaticMarkup(
    createElement(CostumeRevealDisplay, {
      state: {
        revealed: [last, third],
        upcoming: [],
        step: 2,
        totalSteps: 5,
        list: null,
        listPending: false,
      },
    }),
  );
  assert.equal(html.match(/<article/g)?.length, 2);
  assert.equal(html.match(/is-new/g)?.length, 1);
  assert.match(html, /Last place/);
  assert.match(html, /Guest 3/);
  assert.match(html, /0 votes · −83 tokens/);
  assert.doesNotMatch(html, /1st place|The winner/);
});

test('host sees the next reveal button and the private upcoming list; phones see their own result', () => {
  const winner: CostumeRevealGroup = { kind: 'first', players: [result(1, 1, 1000)] };
  const host = renderToStaticMarkup(
    createElement(CostumeRevealHost, {
      state: {
        revealed: [],
        upcoming: [third, winner],
        step: 0,
        totalSteps: 3,
        list: null,
        listPending: false,
      },
      disabled: false,
      onNext: () => {},
    }),
  );
  assert.match(host, /Reveal 3rd place/);
  assert.match(host, /Guest 1/);
  const phone = renderToStaticMarkup(
    createElement(CostumeRevealPlayer, {
      state: {
        revealed: [third],
        upcoming: [],
        step: 1,
        totalSteps: 3,
        list: null,
        listPending: false,
      },
      selfId: 'p3',
    }),
  );
  assert.match(phone, /You were 3rd place · \+500 tokens/);
});

test('after the last place the TV and phones show the full list with votes and token changes', () => {
  const list = [result(1, 1, 1000), result(3, 3, 500), result(15, 5, -83)];
  const state = {
    revealed: [third, last],
    upcoming: [],
    step: 5,
    totalSteps: 5,
    list,
    listPending: false,
  };
  for (const html of [
    renderToStaticMarkup(createElement(CostumeRevealDisplay, { state })),
    renderToStaticMarkup(createElement(CostumeRevealPlayer, { state, selfId: 'p3' })),
  ]) {
    assert.match(html, /costume-list/);
    assert.doesNotMatch(html, /reveal-card/);
    assert.match(html, /Guest 15/);
    assert.match(html, /−83 tokens/);
  }
  const host = renderToStaticMarkup(
    createElement(CostumeRevealHost, {
      state: { ...state, step: 4, list: null, listPending: true },
      disabled: false,
      onNext: () => {},
    }),
  );
  assert.match(host, /Show the full list/);
});
