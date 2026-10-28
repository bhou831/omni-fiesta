import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/server/config.js';
import {
  coinGeckoProvider,
  validateSnapshot,
  type MarketSnapshot,
} from '../src/server/games/market.js';

const config = loadConfig();
const now = Date.parse('2026-10-28T12:00:00Z');
function fixture(): MarketSnapshot {
  return {
    provider: 'coingecko',
    fetchedAt: now,
    quotes: config.investments.assets.map((asset) => ({
      id: asset.provider_id,
      price: '0.000001',
      timestamp: now,
      change24h: null,
      high24h: null,
      low24h: null,
      volume24h: null,
    })),
  };
}
test('market batch requires complete fresh prices and consistent timestamps', () => {
  assert.equal(validateSnapshot(fixture(), config, now).quotes.length, 5);
  const missing = fixture();
  missing.quotes.pop();
  assert.throws(() => validateSnapshot(missing, config, now));
  const stale = fixture();
  stale.quotes[3].timestamp -= 301_000;
  assert.throws(() => validateSnapshot(stale, config, now));
  const zero = fixture();
  zero.quotes[3].price = '0';
  assert.throws(() => validateSnapshot(zero, config, now));
  const duplicate = fixture();
  duplicate.quotes[0].id = duplicate.quotes[1].id;
  assert.throws(() => validateSnapshot(duplicate, config, now));
});
test('provider requests configured ids and normalizes optional facts', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(
      url.searchParams.get('ids'),
      config.investments.assets.map((asset) => asset.provider_id).join(','),
    );
    assert.equal(new Headers(init?.headers).get('x-cg-demo-api-key'), 'test-key');
    return new Response(
      JSON.stringify(
        config.investments.assets.map((asset) => ({
          id: asset.provider_id,
          current_price: 0.000001,
          last_updated: new Date(now).toISOString(),
        })),
      ),
      { status: 200 },
    );
  };
  const snapshot = await coinGeckoProvider('test-key', fetcher).fetch(config, now);
  assert.equal(snapshot.quotes[0].price, '0.000001');
  assert.equal(snapshot.quotes[0].volume24h, null);
  await assert.rejects(coinGeckoProvider('', fetcher).fetch(config, now));
});

test('provider failure is retryable and does not yield a partial batch', async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts++;
    if (attempts === 1) return new Response('', { status: 503 });
    return new Response(
      JSON.stringify(
        config.investments.assets.map((asset) => ({
          id: asset.provider_id,
          current_price: 1,
          last_updated: new Date(now).toISOString(),
        })),
      ),
      { status: 200 },
    );
  };
  const provider = coinGeckoProvider('test-key', fetcher);
  await assert.rejects(provider.fetch(config, now));
  assert.equal((await provider.fetch(config, now)).quotes.length, 5);
});

test('preparation never stores failure or stale responses and reuses accepted snapshots', async (t) => {
  const { Store } = await import('../src/server/core/store.js');
  const { prepareMarket } = await import('../src/server/games/prepare-market.js');
  const { fixtureProvider } = await import('../src/server/games/market.js');
  const store = new Store(':memory:');
  t.after(() => store.close());
  const room = store.transaction(() => store.createRoom(config, 'party', now, 'fixture'));
  const failing = {
    fetch: async () => {
      throw new Error('offline');
    },
  };
  await assert.rejects(prepareMarket(store, room.id, 'opening', failing, () => now));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM market_snapshots').get()?.n, 0);
  const stale = {
    fetch: async () => {
      const data = fixture();
      data.quotes[0].timestamp -= 301000;
      return data;
    },
  };
  await assert.rejects(prepareMarket(store, room.id, 'opening', stale, () => now));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM market_snapshots').get()?.n, 0);
  await prepareMarket(store, room.id, 'opening', fixtureProvider(), () => now);
  const saved = store.db.prepare('SELECT payload FROM market_snapshots').get()?.payload;
  await prepareMarket(store, room.id, 'opening', failing, () => now);
  assert.equal(store.db.prepare('SELECT payload FROM market_snapshots').get()?.payload, saved);
});

test('preparation cannot commit after the room changes while fetching', async (t) => {
  const { Store } = await import('../src/server/core/store.js');
  const { prepareMarket } = await import('../src/server/games/prepare-market.js');
  const store = new Store(':memory:');
  t.after(() => store.close());
  const room = store.transaction(() => store.createRoom(config, 'party', now));
  let release!: (value: MarketSnapshot) => void;
  const waiting = {
    fetch: () =>
      new Promise<MarketSnapshot>((resolve) => {
        release = resolve;
      }),
  };
  const pending = prepareMarket(store, room.id, 'opening', waiting, () => now);
  store.db.prepare("UPDATE rooms SET phase='costume',phase_instance=1 WHERE id=?").run(room.id);
  release(fixture());
  await assert.rejects(pending);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM market_snapshots').get()?.n, 0);
});

test('market requests use a bounded abort signal', async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.ok(init?.signal);
    return new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(coinGeckoProvider('test-key', fetcher, 20).fetch(config, now), /aborted/);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('stale opening prices can refresh only before investments open', async (t) => {
  const { Store } = await import('../src/server/core/store.js');
  const { Engine } = await import('../src/server/core/engine.js');
  const { investments } = await import('../src/server/games/investments.js');
  const { prepareMarket } = await import('../src/server/games/prepare-market.js');
  const { fixtureProvider } = await import('../src/server/games/market.js');
  const { randomUUID } = await import('node:crypto');
  const store = new Store(':memory:');
  t.after(() => store.close());
  let clock = now;
  const room = store.transaction(() => store.createRoom(config, 'party', clock, 'fixture'));
  store.join(
    store.room(room.id),
    { name: 'Test', email: 'test@example.test', phone: '2125550100', emoji: '🦊' },
    randomUUID(),
    clock,
  );
  const host = { role: 'host' as const, roomId: null, playerId: null, tokenHash: '' };
  const engine = new Engine(store, () => clock, [investments]);
  await prepareMarket(store, room.id, 'opening', fixtureProvider(), () => clock);
  engine.execute(host, room.id, {
    type: 'phase.advance',
    phaseInstance: 0,
    requestId: randomUUID(),
  });
  clock += 301000;
  assert.throws(
    () =>
      engine.execute(host, room.id, {
        type: 'phase.start',
        phaseInstance: 1,
        requestId: randomUUID(),
      }),
    /stale/,
  );
  await prepareMarket(store, room.id, 'opening', fixtureProvider(), () => clock);
  engine.execute(host, room.id, { type: 'phase.start', phaseInstance: 1, requestId: randomUUID() });
  await assert.rejects(
    prepareMarket(store, room.id, 'opening', fixtureProvider(), () => clock),
    /not available/,
  );
});
