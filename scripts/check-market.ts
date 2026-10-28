/** Read-only live probe. Never print credentials, headers, or raw provider errors. */
import { loadConfig } from '../src/server/config.js';
import { coinGeckoProvider } from '../src/server/games/market.js';

const config = loadConfig();
const key = process.env.COINGECKO_API_KEY ?? '';
if (!key) {
  console.error('COINGECKO_API_KEY is missing; no request was made.');
  process.exitCode = 1;
} else {
  let status: number | null = null;
  let rows: Record<string, unknown>[] = [];
  const provider = coinGeckoProvider(key, async (input, init) => {
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
    status = response.status;
    if (response.ok) {
      const body: unknown = await response.clone().json();
      if (Array.isArray(body)) rows = body;
    }
    return response;
  });
  let accepted = false;
  let failure: { message: string; code: string | null } | null = null;
  try {
    await provider.fetch(config, Date.now());
    accepted = true;
  } catch (error) {
    const safeMessages = new Set([
      'Market provider request failed',
      'Invalid market response',
      'Invalid market snapshot',
      'Market prices are missing or stale',
      'Invalid market metric',
      'Market timestamps are too far apart',
    ]);
    const problem = error as { message?: string; code?: string; cause?: { code?: string } };
    const rawCode = problem.cause?.code ?? problem.code;
    failure = {
      message: safeMessages.has(problem.message ?? '')
        ? problem.message!
        : 'Network/request failed',
      code: rawCode && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : null,
    };
    process.exitCode = 1;
  }
  const checkedAt = Date.now();
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date(checkedAt).toISOString(),
        httpStatus: status,
        acceptedByApplication: accepted,
        failure,
        assets: config.investments.assets.map((asset) => {
          const quote = rows.find((row) => row.id === asset.provider_id);
          const timestamp = Date.parse(String(quote?.last_updated));
          const ageSeconds = Number.isFinite(timestamp) ? (checkedAt - timestamp) / 1000 : null;
          return {
            symbol: asset.symbol,
            id: asset.provider_id,
            returned: !!quote,
            usdPrice: typeof quote?.current_price === 'number' ? quote.current_price : null,
            updatedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
            ageSeconds,
            fresh:
              ageSeconds !== null &&
              ageSeconds >= 0 &&
              ageSeconds <= config.investments.market_data.max_snapshot_age_seconds,
          };
        }),
      },
      null,
      2,
    ),
  );
}
