import React, { useState } from 'react';
import type { Command, RoomSnapshot } from '../shared/contracts.js';
import { investmentPayout } from '../server/games/investment-math.js';

type Props = {
  state: RoomSnapshot;
  command: (type: Command['type'], payload?: Command['payload']) => Promise<void>;
  disabled: boolean;
  revealBalance?: boolean;
};
const assetMarks: Record<string, string> = { SOL: '≋', BTC: '₿', DOGE: 'Ð', SPYx: '↗', PEPE: '🐸' };
const metric = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
const usd = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  if (value > 0 && value < 0.000001) return `$${value.toPrecision(6)}`;
  return `$${value.toLocaleString(undefined, { maximumSignificantDigits: 8 })}`;
};
const compactUsd = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? 'Unavailable'
    : `$${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
function RangeBar({
  low,
  high,
  price,
}: {
  low: number | null;
  high: number | null;
  price: number;
}) {
  if (
    low === null ||
    high === null ||
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low < 0 ||
    high <= low ||
    !Number.isFinite(price) ||
    price < low ||
    price > high
  )
    return <p>Opening price position in 24h range: Unavailable</p>;
  const position = ((price - low) / (high - low)) * 100;
  return (
    <div
      className="range-bar"
      role="img"
      aria-label={`Opening price is ${position.toFixed(0)}% of the way from the 24-hour low to the high`}
    >
      <div className="range-track">
        <span className="range-dot" style={{ left: `${position}%` }} />
      </div>
      <div className="range-labels">
        <span>Low {usd(low)}</span>
        <span>High {usd(high)}</span>
      </div>
    </div>
  );
}
function RiskExamples({ multiplier }: { multiplier: number }) {
  const threshold = 100 / multiplier;
  return (
    <section className="investment-risk">
      <h3>Your risk · per 100 tokens</h3>
      <p>
        {threshold <= 100
          ? `A hypothetical price fall of about ${metric(threshold)}% reduces the payout to zero.`
          : 'Even a hypothetical 100% price fall would not reduce the payout to zero at this multiplier.'}{' '}
        Your maximum loss is your stake.
      </p>
      <table>
        <thead>
          <tr>
            <th>Price moves</th>
            <th>Gross payout</th>
          </tr>
        </thead>
        <tbody>
          {[-10, -5, 5, 10].map((move) => (
            <tr key={move}>
              <td>
                {move < 0 ? '−' : '+'}
                {Math.abs(move)}%
              </td>
              <td>{investmentPayout(100, multiplier, '100', String(100 + move))} tokens</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine-print">
        Illustrative examples, not predictions. Settlement uses the saved opening and closing
        prices.
      </p>
    </section>
  );
}
export function InvestmentPlayer({ state, command, disabled, revealBalance = false }: Props) {
  const data = state.investments!;
  const [asset, setAsset] = useState(data.position?.asset_id ?? data.assets[0]?.provider_id ?? '');
  const [amount, setAmount] = useState(String(data.position?.principal ?? ''));
  if (state.room.phase === 'investment-review') {
    const pos = data.position;
    if (!pos) return <p>You did not make an investment.</p>;
    const open = data.opening?.quotes.find((q) => q.id === pos.asset_id);
    const close = data.closing?.quotes.find((q) => q.id === pos.asset_id);
    return (
      <section>
        <h2>Your investment</h2>
        <p>
          {pos.asset_id} · {pos.principal} tokens {pos.payout === null ? 'locked' : 'invested'}
        </p>
        <p>
          Opening: ${open?.price ?? 'Unavailable'} · Closing: ${close?.price ?? 'Pending'}
        </p>
        <p>
          Opening time: {open ? new Date(open.timestamp).toLocaleString() : 'Unavailable'} · Closing
          time: {close ? new Date(close.timestamp).toLocaleString() : 'Pending'}
        </p>
        <p>
          Market return:{' '}
          {open && close
            ? `${((Number(close.price) / Number(open.price) - 1) * 100).toFixed(2)}%`
            : 'Pending'}{' '}
          · Multiplier: {data.multiplier}×
        </p>
        <p>
          {pos.payout === null
            ? 'Waiting for settlement.'
            : `Gross payout: ${pos.payout} tokens · Game P/L: ${pos.payout - pos.principal} tokens`}
        </p>
      </section>
    );
  }
  return (
    <section className="game-panel">
      <h2>Choose one investment</h2>
      <p>
        Up to {data.cap} tokens are locked until review. Returns are multiplied by {data.multiplier}
        ×; your maximum loss is your investment.
      </p>
      {data.position && (
        <p>
          Saved: {data.position.principal} tokens in{' '}
          {data.assets.find((a) => a.provider_id === data.position?.asset_id)?.symbol ??
            data.position.asset_id}
          .
        </p>
      )}
      <div className="investment-order">
        {' '}
        <label>
          Tokens to invest in {data.assets.find((a) => a.provider_id === asset)?.symbol}{' '}
          <input
            type="number"
            min="1"
            max={data.cap}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled}
          />
        </label>
        <p>
          {revealBalance
            ? `Available: ${state.self?.accounts.spendable} tokens${data.position ? ` plus ${data.position.principal} currently locked` : ''}.`
            : 'Available balance hidden. Tap Tokens to reveal it.'}
        </p>
        <button
          className="button primary"
          disabled={disabled}
          onClick={() =>
            void command('phase.action', {
              action: 'invest',
              data: { assetId: asset, amount: Number(amount) },
            })
          }
        >
          Save investment
        </button>
        {data.position && (
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() => void command('phase.action', { action: 'cancel' })}
          >
            Cancel investment
          </button>
        )}
      </div>{' '}
      <p className="fine-print">Tap a card to explore. Choose one, then save your amount above.</p>
      <div className="investment-cards">
        {data.assets.map((a) => {
          const q = data.opening?.quotes.find((q) => q.id === a.provider_id);
          const range =
            q?.high24h != null && q.low24h != null && q.low24h >= 0 && q.high24h >= q.low24h
              ? ((q.high24h - q.low24h) / Number(q.price)) * 100
              : null;
          const selected = asset === a.provider_id;
          return (
            <details
              key={a.provider_id}
              className={`investment-card ${selected ? 'is-selected' : ''}`}
            >
              <summary>
                <span className="asset-mark" aria-hidden="true">
                  {assetMarks[a.symbol] ?? a.symbol[0]}
                </span>
                <span className="asset-identity">
                  <strong>{a.symbol}</strong>
                  <span>{a.name}</span>
                </span>
                <span className="asset-quote">
                  <strong>{q ? usd(Number(q.price)) : 'Price pending'}</strong>
                  <span
                    className={
                      q?.change24h == null || q.change24h === 0
                        ? ''
                        : q.change24h > 0
                          ? 'market-up'
                          : 'market-down'
                    }
                  >
                    {q?.change24h == null
                      ? '24h unavailable'
                      : `${q.change24h > 0 ? '▲ +' : q.change24h < 0 ? '▼ ' : ''}${metric(q.change24h)}% · 24h`}
                  </span>
                </span>
                <span className="card-chevron" aria-hidden="true">
                  ⌄
                </span>
                {selected && <span className="asset-selected">✓ Selected</span>}
              </summary>
              <div className="asset-facts">
                <span className="eyebrow">{a.category.replaceAll('_', ' ')}</span>
                <p>{a.description}</p>
                <RangeBar
                  low={q?.low24h ?? null}
                  high={q?.high24h ?? null}
                  price={q ? Number(q.price) : NaN}
                />
                <dl className="market-facts">
                  <div>
                    <dt>Opening price · USD</dt>
                    <dd>{q ? usd(Number(q.price)) : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>24h high / low · USD</dt>
                    <dd>
                      {usd(q?.high24h)} / {usd(q?.low24h)}
                    </dd>
                  </div>
                  <div>
                    <dt>24h volume · USD</dt>
                    <dd>{compactUsd(q?.volume24h)}</dd>
                  </div>
                  <div>
                    <dt>24h price range</dt>
                    <dd>{range === null ? 'Unavailable' : `${metric(range)}%`}</dd>
                  </div>
                </dl>
                <RiskExamples multiplier={data.multiplier} />
                <p className="fine-print">
                  Opening snapshot · CoinGecko ·{' '}
                  {q
                    ? `${new Date(q.timestamp).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
                    : 'Not prepared yet'}
                </p>
                <div className="research-links">
                  {a.research_links.map((link) => (
                    <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                      {link.label} ↗
                    </a>
                  ))}
                </div>
                <button
                  className={`button ${selected ? 'secondary' : 'primary'}`}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => setAsset(a.provider_id)}
                >
                  {selected ? `✓ ${a.symbol} selected` : `Choose ${a.symbol}`}
                </button>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
