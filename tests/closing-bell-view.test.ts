import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvestmentPlayer, InvestmentReviewDisplay } from '../src/client/Investments.js';
import { RoundDescription } from '../src/client/RoundDescription.js';
import { createApp } from '../src/server/app.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';

test('closing bell separates credited profit from pending estimates and caps loss displays', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'view-test-password' });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'investment-review')!,
  );
  const state = app.engine.snapshot({ role: 'player', roomId: room.id, playerId: room.playerId });
  const render = () =>
    renderToStaticMarkup(
      createElement(InvestmentPlayer, { state, command: async () => {}, disabled: true }),
    );
  assert.match(render(), /\+120/);
  assert.match(render(), /720 tokens/);
  assert.match(render(), /✓ Settled/);
  state.investments!.positions[0]!.payout = null;
  assert.match(render(), /preview, not credited yet/);
  assert.doesNotMatch(render(), /✓ Settled/);
  state.investments!.closing!.quotes[0].price = '1';
  assert.match(render(), /−600/);
  assert.match(render(), /0 tokens/);
  state.investments!.closing = null;
  assert.match(render(), /Closing soon/);
  assert.doesNotMatch(render(), /tokens lost|tokens gained<|✓ Settled/);
});

test('public market results show configured assets and moves without private positions; costume rules use room prizes', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'view-test-password' });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'investment-review')!,
  );
  const state = app.engine.snapshot({ role: 'display', roomId: room.id });
  const html = renderToStaticMarkup(
    createElement(InvestmentReviewDisplay, { data: state.investments! }),
  );
  assert.equal((html.match(/<article/g) ?? []).length, 5);
  assert.match(html, /↗ \+1%/);
  assert.match(html, /↘ −1%/);
  assert.doesNotMatch(html, /Sample Alex|600 tokens|player_id|sp500-xstock/);
  const costume = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'costume')!,
  );
  const vote = app.engine.snapshot({ role: 'display', roomId: costume.id });
  vote.costume!.prizes[0].tokens = 1234;
  const rules = renderToStaticMarkup(createElement(RoundDescription, { state: vote }));
  assert.match(rules, /1,234/);
  assert.match(rules, /no voting for yourself/);
  assert.match(rules, /full prize/);
});

test('a refunded closing bell tells phones and the TV that stakes came back in full', async (t) => {
  const app = createApp({ databasePath: ':memory:', hostPassword: 'view-test-password' });
  t.after(() => app.close());
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'investment-review')!,
  );
  const player = app.engine.snapshot({ role: 'player', roomId: room.id, playerId: room.playerId });
  player.investments = { ...player.investments!, closing: null, refunded: true };
  const phone = renderToStaticMarkup(
    createElement(InvestmentPlayer, { state: player, command: async () => {}, disabled: true }),
  );
  assert.match(phone, /returned in full/);
  assert.doesNotMatch(phone, /Closing soon|Pending/);
  const display = app.engine.snapshot({ role: 'display', roomId: room.id });
  display.investments = { ...display.investments!, closing: null, refunded: true };
  const tv = renderToStaticMarkup(
    createElement(InvestmentReviewDisplay, { data: display.investments }),
  );
  assert.match(tv, /every investment was returned in full/);
  assert.doesNotMatch(tv, /<article/);
  assert.match(
    renderToStaticMarkup(createElement(RoundDescription, { state: display })),
    /every stake returned in full/,
  );
});
