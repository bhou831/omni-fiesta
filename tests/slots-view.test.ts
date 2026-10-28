import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotsDisplay, SlotsPlayer } from '../src/client/Slots.js';
import type { SlotSpin } from '../src/server/games/slots.js';

const spin = (attempt: number, gross: number): SlotSpin =>
  ({
    id: `spin-${attempt}`,
    attempt,
    cost: 200,
    gross,
    net: gross - 200,
    finalBalance: 1000,
    createdAt: 0,
  }) as SlotSpin;
const view = (spins: SlotSpin[], open = true) =>
  renderToStaticMarkup(
    createElement(SlotsPlayer, {
      state: { cost: 200, limit: 3, spins },
      spendable: 987,
      open,
      disabled: false,
      command: async () => {},
    }),
  );

test('saved spins render as settled tickets without replaying the print animation', () => {
  const html = view([spin(1, 0), spin(2, 500)]);
  assert.equal(html.match(/class="slot-ticket/g)?.length, 2);
  assert.doesNotMatch(html, /is-printing|is-rolling/);
  assert.match(html, /Spin 2: 500 returned, net \+300 tokens/);
  assert.match(html, /Spin 1: 0 returned, net −200 tokens/);
});

test('only the newest ticket is full size and only paid spins are highlighted', () => {
  const html = view([spin(1, 0), spin(2, 500)]);
  const [newest, oldest] = html
    .split('<li ')
    .slice(1)
    .map((part) => part.split('</li>')[0]!);
  assert.doesNotMatch(newest!, /is-compact/);
  assert.match(newest!, /is-return/);
  assert.match(oldest!, /is-compact/);
  assert.doesNotMatch(oldest!, /is-return/);
});

test('spin pips and the spin button reflect the remaining spins', () => {
  const html = view([spin(1, 300)]);
  assert.equal(html.match(/<i class="is-used">/g)?.length, 1);
  assert.match(html, /2 spins remaining/);
  assert.match(html, /Spin · 200 tokens/);
  assert.match(view([], false), /Time’s up/);
});

test('TV shows anonymous progress dots and counts, never who spun', () => {
  const html = renderToStaticMarkup(
    createElement(SlotsDisplay, {
      state: { cost: 200, limit: 3, spins: 5, players: 2 },
      roomPlayers: 6,
    }),
  );
  assert.match(html, /<strong>2<\/strong> of 6 players have spun/);
  assert.match(html, /5 spins played/);
  assert.equal(html.match(/<i class="is-filled">/g)?.length, 2);
  assert.equal(html.match(/<i class="">/g)?.length, 4);
  assert.doesNotMatch(html, /returned|Net [+−]/);
});
test('an empty rack invites the first spin instead of showing a bare printer', () => {
  assert.match(view([]), /Your tickets print here\./);
});
