import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PowerballPlayer } from '../src/client/Powerball.js';
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
