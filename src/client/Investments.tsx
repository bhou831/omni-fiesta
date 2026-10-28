import React, { useState } from 'react';
import type { Command, RoomSnapshot } from '../shared/contracts.js';
import { investmentPayout } from '../server/games/investment-math.js';

type Props = {
  state: RoomSnapshot;
  command: (type: Command['type'], payload?: Command['payload']) => Promise<void>;
  disabled: boolean;
  revealBalance?: boolean;
};
const assetMarks: Record<string, string> = { SOL: '≋', BTC: '₿', DOGE: 'Ð', SPYx: '↗', PEPE: 'P' };
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
    return <PersonalInvestmentResult data={data} />;
  }
  const saved =
    !!data.position &&
    data.position.asset_id === asset &&
    data.position.principal === Number(amount);
  return (
    <section className="game-panel">
      <h2>Choose one investment</h2>
      <p>
        Up to {data.cap} tokens are locked until review. Returns are multiplied by {data.multiplier}
        ×; your maximum loss is your investment.
      </p>
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
          disabled={disabled || saved}
          onClick={() =>
            void command('phase.action', {
              action: 'invest',
              data: { assetId: asset, amount: Number(amount) },
            })
          }
        >
          {saved ? '✓ Investment saved' : data.position ? 'Update investment' : 'Save investment'}
        </button>
        <p className={`save-feedback ${saved ? 'is-saved' : ''}`} role="status" aria-live="polite">
          {saved
            ? `✓ ${data.position!.principal} tokens in ${data.assets.find((a) => a.provider_id === data.position!.asset_id)?.symbol ?? asset}. You’re all set.`
            : data.position
              ? 'You have unsaved changes. Your previous investment is still saved.'
              : 'No investment saved yet. Sitting out is fine, too.'}
        </p>
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

type InvestmentData = NonNullable<RoomSnapshot['investments']>;
const signed = (value: number, digits = 2) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: digits })}`;
const direction = (value: number) =>
  value > 0 ? 'market-up' : value < 0 ? 'market-down' : 'market-flat';

function PersonalInvestmentResult({ data }: { data: InvestmentData }) {
  const pos = data.position;
  if (!pos)
    return (
      <section className="investment-result">
        <span className="result-icon" aria-hidden="true">
          🛋️
        </span>
        <h2>You sat this one out.</h2>
        <p>No tokens invested. Enjoy the closing bell.</p>
      </section>
    );
  const asset = data.assets.find((a) => a.provider_id === pos.asset_id);
  const open = data.opening?.quotes.find((q) => q.id === pos.asset_id);
  const close = data.closing?.quotes.find((q) => q.id === pos.asset_id);
  const payout =
    pos.payout ??
    (open && close
      ? investmentPayout(pos.principal, data.multiplier, open.price, close.price)
      : null);
  const net = payout === null ? null : payout - pos.principal;
  const marketReturn = open && close ? (Number(close.price) / Number(open.price) - 1) * 100 : null;
  return (
    <section
      className={`investment-result ${net === null ? '' : direction(net)}`}
      aria-live="polite"
    >
      <div className="result-asset">
        <span className="asset-mark" aria-hidden="true">
          {assetMarks[asset?.symbol ?? ''] ?? '↗'}
        </span>
        <div>
          <strong>{asset?.symbol ?? pos.asset_id}</strong>
          <p>{asset?.name}</p>
        </div>
      </div>
      <span className="eyebrow">
        {pos.payout === null ? 'Awaiting settlement' : 'Your game result'}
      </span>
      <strong className="result-number">
        {net === null
          ? 'Closing soon…'
          : `${net > 0 ? '↗ ' : net < 0 ? '↘ ' : ''}${signed(net, 0)}`}
      </strong>
      <p className="result-caption">
        {net === null
          ? 'Your stake is safe in the lockbox until the host settles.'
          : `tokens ${net > 0 ? 'gained' : net < 0 ? 'lost' : 'gained or lost'}${pos.payout === null ? ' · preview, not credited yet' : ''}`}
      </p>
      <dl className="result-breakdown">
        <div>
          <dt>You invested</dt>
          <dd>{pos.principal} tokens</dd>
        </div>
        <div>
          <dt>{pos.payout === null ? 'Expected return' : 'Returned to you'}</dt>
          <dd>{payout === null ? 'Pending' : `${payout} tokens`}</dd>
        </div>
      </dl>
      <p className="settlement-status">
        {pos.payout === null
          ? '⏳ The host will settle this shortly.'
          : '✓ Settled. Returned tokens are available to play.'}
      </p>
      <details className="investment-receipt">
        <summary>How it worked</summary>
        <dl className="market-facts">
          <div>
            <dt>Opening price</dt>
            <dd>{open ? usd(Number(open.price)) : 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Closing price</dt>
            <dd>{close ? usd(Number(close.price)) : 'Pending'}</dd>
          </div>
          <div>
            <dt>Market move</dt>
            <dd>{marketReturn === null ? 'Pending' : `${signed(marketReturn)}%`}</dd>
          </div>
          <div>
            <dt>Return multiplier</dt>
            <dd>{data.multiplier}× · losses capped at your stake</dd>
          </div>
        </dl>
        <p className="fine-print">
          Opened {open ? new Date(open.timestamp).toLocaleString() : 'Unavailable'}
          <br />
          Closed {close ? new Date(close.timestamp).toLocaleString() : 'Pending'}
        </p>
      </details>
    </section>
  );
}

export function InvestmentReviewDisplay({ data }: { data: InvestmentData }) {
  return (
    <section className="market-results" aria-label="Opening to closing market results">
      {data.assets.map((asset) => {
        const open = data.opening?.quotes.find((q) => q.id === asset.provider_id);
        const close = data.closing?.quotes.find((q) => q.id === asset.provider_id);
        const change = open && close ? (Number(close.price) / Number(open.price) - 1) * 100 : null;
        const payout =
          open && close ? investmentPayout(100, data.multiplier, open.price, close.price) : null;
        return (
          <article
            className={`market-result-card ${change === null ? '' : direction(change)}`}
            key={asset.provider_id}
          >
            <span className="asset-mark" aria-hidden="true">
              {assetMarks[asset.symbol] ?? asset.symbol[0]}
            </span>
            <h2>{asset.symbol}</h2>
            <p className="asset-name">{asset.name}</p>
            <strong className="market-change">
              {change === null
                ? 'Pending'
                : `${change > 0 ? '↗' : change < 0 ? '↘' : '→'} ${signed(change)}%`}
            </strong>
            <span>market move</span>
            <dl>
              <div>
                <dt>Open</dt>
                <dd>{open ? usd(Number(open.price)) : '—'}</dd>
              </div>
              <div>
                <dt>Close</dt>
                <dd>{close ? usd(Number(close.price)) : '—'}</dd>
              </div>
            </dl>
            <p className="amplified-return">
              {payout === null
                ? 'Waiting for closing prices'
                : `${signed(payout - 100, 0)} tokens per 100 invested`}
            </p>
          </article>
        );
      })}
    </section>
  );
}
