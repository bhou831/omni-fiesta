import type { GameConfig } from '../config.js';

export interface MarketQuote {
  id: string;
  price: string;
  timestamp: number;
  change24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
}
export interface MarketSnapshot {
  provider: 'coingecko';
  fetchedAt: number;
  quotes: MarketQuote[];
}
export interface MarketProvider {
  fetch(config: GameConfig, now: number): Promise<MarketSnapshot>;
}

/** Validate the entire batch before it is eligible for persistence. */
export function validateSnapshot(
  snapshot: MarketSnapshot,
  config: GameConfig,
  now: number,
): MarketSnapshot {
  const ids = config.investments.assets.map((asset) => asset.provider_id);
  if (
    snapshot.provider !== config.investments.market_data.provider ||
    !Number.isFinite(snapshot.fetchedAt) ||
    snapshot.fetchedAt > now ||
    snapshot.quotes.length !== ids.length
  )
    throw new Error('Invalid market snapshot');
  const seen = new Set<string>();
  for (const quote of snapshot.quotes) {
    const price = Number(quote.price);
    if (
      !ids.includes(quote.id) ||
      seen.has(quote.id) ||
      !/^(\d+)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(quote.price) ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(quote.timestamp) ||
      quote.timestamp > now ||
      now - quote.timestamp > config.investments.market_data.max_snapshot_age_seconds * 1000
    )
      throw new Error('Market prices are missing or stale');
    for (const metric of [quote.change24h, quote.high24h, quote.low24h, quote.volume24h])
      if (metric !== null && !Number.isFinite(metric)) throw new Error('Invalid market metric');
    seen.add(quote.id);
  }
  const times = snapshot.quotes.map((quote) => quote.timestamp);
  if (
    Math.max(...times) - Math.min(...times) >
    config.investments.market_data.max_asset_timestamp_spread_seconds * 1000
  )
    throw new Error('Market timestamps are too far apart');
  return snapshot;
}

/** Credentials remain on the server; callers perform network I/O outside SQLite transactions. */
export function coinGeckoProvider(apiKey: string, fetcher: typeof fetch = fetch): MarketProvider {
  return {
    async fetch(config, now) {
      if (!apiKey) throw new Error('CoinGecko API key is required');
      const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
      url.searchParams.set('vs_currency', config.investments.quote_currency);
      url.searchParams.set(
        'ids',
        config.investments.assets.map((asset) => asset.provider_id).join(','),
      );
      const response = await fetcher(url, { headers: { 'x-cg-demo-api-key': apiKey } });
      if (!response.ok) throw new Error('Market provider request failed');
      const body: unknown = await response.json();
      if (!Array.isArray(body)) throw new Error('Invalid market response');
      const optional = (value: unknown): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null;
      const quotes: MarketQuote[] = body.map((item: Record<string, unknown>) => ({
        id: String(item.id),
        price: String(item.current_price),
        timestamp: Date.parse(String(item.last_updated)),
        change24h: optional(item.price_change_percentage_24h),
        high24h: optional(item.high_24h),
        low24h: optional(item.low_24h),
        volume24h: optional(item.total_volume),
      }));
      return validateSnapshot({ provider: 'coingecko', fetchedAt: now, quotes }, config, now);
    },
  };
}

/** Deterministic demonstration prices, explicitly restricted to fixture rooms. */
export function fixtureProvider(): MarketProvider {
  return {
    async fetch(config, now) {
      return {
        provider: 'coingecko',
        fetchedAt: now,
        quotes: config.investments.assets.map((asset, index) => ({
          id: asset.provider_id,
          price: String([150, 80000, 0.15, 600, 0.00001][index] ?? 1),
          timestamp: now,
          change24h: null,
          high24h: null,
          low24h: null,
          volume24h: null,
        })),
      };
    },
  };
}
