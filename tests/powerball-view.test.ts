import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PowerballDisplay, PowerballPlayer } from '../src/client/Powerball.js';
import type { PowerballProjection } from '../src/server/games/powerball.js';

const draw = (payout: number, balance = false) => {
  const state: PowerballProjection = {
    ownBet: { color: 'red', amount: 100, payout },
    drawn: true,
    revealed: true,
    winningColor: 'red',
    hostBets: null,
  };
  return renderToStaticMarkup(
    createElement(PowerballPlayer, {
      state,
      players: [],
      spendable: 987,
      revealBalance: balance,
      open: false,
      disabled: false,
      onBet: () => {},
      onCancel: () => {},
      onDraw: () => {},
      onReveal: () => {},
    }),
  );
};
test('Powerball reports gains, losses and break-even accurately', () => {
  assert.match(draw(160), /Gain \+60 tokens/);
  assert.match(draw(50), /Loss −50 tokens/);
  assert.match(draw(100), /No change/);
  assert.doesNotMatch(draw(100), /refund|win/i);
});
test('quick Max does not disclose hidden balance', () => {
  const state: PowerballProjection = {
    ownBet: null,
    drawn: false,
    revealed: false,
    winningColor: null,
    hostBets: null,
  };
  const view = (revealBalance: boolean) =>
    renderToStaticMarkup(
      createElement(PowerballPlayer, {
        state,
        players: [],
        spendable: 987,
        revealBalance,
        open: true,
        disabled: false,
        onBet: () => {},
        onCancel: () => {},
        onDraw: () => {},
        onReveal: () => {},
      }),
    );
  assert.doesNotMatch(view(false), />Max<|987/);
  assert.match(view(true), />Max<|987/);
});

const machine = (state: PowerballProjection) =>
  renderToStaticMarkup(
    createElement(PowerballPlayer, {
      state,
      players: [],
      spendable: 987,
      open: false,
      disabled: false,
      onBet: () => {},
      onCancel: () => {},
      onDraw: () => {},
      onReveal: () => {},
    }),
  );
test('gumball machine shows the capsule only once the draw is ready or revealed', () => {
  const idle = machine({
    ownBet: null,
    drawn: false,
    revealed: false,
    winningColor: null,
    hostBets: null,
  });
  assert.doesNotMatch(idle, /is-ready|is-revealed|is-drawing/);
  assert.match(idle, /Waiting for the draw/);
  const ready = machine({
    ownBet: null,
    drawn: true,
    revealed: false,
    winningColor: null,
    hostBets: null,
  });
  assert.match(ready, /gumball is-ready|is-ready/);
  assert.match(ready, /Ready to reveal/);
  assert.doesNotMatch(ready, /gb-in (red|blue)/);
  const revealed = machine({
    ownBet: null,
    drawn: true,
    revealed: true,
    winningColor: 'blue',
    hostBets: null,
  });
  assert.match(revealed, /is-revealed/);
  assert.match(revealed, /gb-in blue/);
  assert.match(revealed, /Result: Blue/);
});

test('TV shows live bet counts per color and highlights only the revealed winner', () => {
  const base: PowerballProjection = {
    ownBet: null,
    drawn: false,
    revealed: false,
    winningColor: null,
    hostBets: null,
    tally: { red: 3, blue: 1 },
  };
  const live = renderToStaticMarkup(createElement(PowerballDisplay, { state: base }));
  assert.match(live, /<strong>3<\/strong><small>bets<\/small>/);
  assert.match(live, /<strong>1<\/strong><small>bet<\/small>/);
  assert.doesNotMatch(live, /is-result/);
  const done = renderToStaticMarkup(
    createElement(PowerballDisplay, {
      state: { ...base, drawn: true, revealed: true, winningColor: 'blue' },
    }),
  );
  assert.match(done, /tally-side is-blue is-result/);
  assert.doesNotMatch(done, /tally-side is-red is-result/);
});
test('phones never render the public tally', () => {
  const html = machine({
    ownBet: null,
    drawn: false,
    revealed: false,
    winningColor: null,
    hostBets: null,
    tally: { red: 9, blue: 8 },
  });
  assert.doesNotMatch(html, /tally/);
});
