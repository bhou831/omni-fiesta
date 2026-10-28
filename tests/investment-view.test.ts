import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { randomUUID } from 'node:crypto';
import { InvestmentPlayer } from '../src/client/Investments.js';
import { Store } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';

function view(multiplier: number, low: number | null, high: number | null) {
  const store = new Store(':memory:');
  try {
    const config = loadConfig();
    config.investments.return_multiplier = multiplier;
    const room = store.transaction(() => store.createRoom(config, 'party', 1000000));
    const player = store.join(
      store.room(room.id),
      { name: 'Test', emoji: '🦊', email: 'test@example.test', phone: '2125550100' },
      randomUUID(),
      1000000,
    );
    const quotes = config.investments.assets.map((a) => ({
      id: a.provider_id,
      price: '0.00000001',
      timestamp: 1000000,
      low24h: low,
      high24h: high,
      change24h: -1.5,
      volume24h: 1200000000,
    }));
    store.db
      .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
      .run(
        room.id,
        'opening',
        JSON.stringify({ provider: 'coingecko', fetchedAt: 1000000, quotes }),
      );
    store.db.prepare("UPDATE rooms SET phase='investments' WHERE id=?").run(room.id);
    const state = new Engine(store, () => 1000000).snapshot({
      role: 'player',
      roomId: room.id,
      playerId: player.playerId,
    });
    return renderToStaticMarkup(
      createElement(InvestmentPlayer, {
        state,
        command: async () => {},
        disabled: false,
        expandAll: true,
      }),
    );
  } finally {
    store.close();
  }
}
test('investment cards show a valid range, tiny price and configured payoff examples', () => {
  const html = view(20, 0.000000005, 0.000000015);
  assert.match(html, /50% of the way/);
  assert.match(html, /1\.00000e-8/);
  assert.match(html, /▼/);
  assert.match(html, /price fall of about 5%/);
  assert.match(html, /<td>−5%<\/td><td>0 tokens/);
  assert.match(html, /<td>\+5%<\/td><td>200 tokens/);
  assert.match(html, /<td>\+10%<\/td><td>300 tokens/);
  assert.match(html, /CoinGecko/);
});
test('missing or inconsistent range is unavailable and small multipliers do not invent a wipeout', () => {
  const missing = view(0.5, null, null);
  assert.match(missing, /position in 24h range: Unavailable/);
  assert.match(missing, /100% price fall would not reduce the payout to zero/);
  assert.match(view(20, 0.00000002, 0.00000003), /position in 24h range: Unavailable/);
});

test('expanded details lead with a chart button, tuck the payoff table away, and keep a stored draft', () => {
  const html = view(20, 0.000000005, 0.000000015);
  assert.match(html, /See live chart ↗/);
  assert.match(html, /Opens in a new tab/);
  assert.match(html, /<details class="investment-risk"><summary>Payoff examples/);
  // Market and chart is the button, so it is not repeated in the footer links.
  assert.doesNotMatch(html, /Market and chart ↗/);
  assert.match(html, /Project ↗/);
  const store = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () => JSON.stringify({ solana: '250', 'not-an-asset': '5', bitcoin: 7 }),
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
  try {
    const restored = view(20, 0.000000005, 0.000000015);
    assert.match(restored, /Tokens in SOL/);
    assert.match(restored, /value="250"/);
    assert.doesNotMatch(restored, /Tokens in BTC/);
    assert.match(restored, /Invested[^]*250/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
});
