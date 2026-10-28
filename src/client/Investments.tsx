import React, { useState } from 'react';
import type { Command, RoomSnapshot } from '../shared/contracts.js';

type Props = {
  state: RoomSnapshot;
  command: (type: Command['type'], payload?: Command['payload']) => Promise<void>;
  disabled: boolean;
  revealBalance?: boolean;
};
const assetMarks: Record<string, string> = { SOL: '≋', BTC: '₿', DOGE: 'Ð', SPYx: '↗', PEPE: '🐸' };
const metric = (value: number | null | undefined) =>
  value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
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
            q?.high24h != null && q.low24h != null
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
                  <strong>{q ? `$${metric(Number(q.price))}` : 'Price pending'}</strong>
                  <span className={q?.change24h != null && q.change24h >= 0 ? 'market-up' : ''}>
                    {q?.change24h == null
                      ? '24h unavailable'
                      : `${q.change24h > 0 ? '+' : ''}${metric(q.change24h)}% · 24h`}
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
                <dl className="market-facts">
                  <div>
                    <dt>Opening price · USD</dt>
                    <dd>{q ? `$${metric(Number(q.price))}` : 'Unavailable'}</dd>
                  </div>
                  <div>
                    <dt>24h high / low · USD</dt>
                    <dd>
                      {metric(q?.high24h)} / {metric(q?.low24h)}
                    </dd>
                  </div>
                  <div>
                    <dt>24h volume · USD</dt>
                    <dd>{metric(q?.volume24h)}</dd>
                  </div>
                  <div>
                    <dt>24h price range</dt>
                    <dd>{range === null ? 'Unavailable' : `${metric(range)}%`}</dd>
                  </div>
                </dl>
                <p className="fine-print">
                  Opening snapshot · CoinGecko ·{' '}
                  {q ? new Date(q.timestamp).toLocaleString() : 'Not prepared yet'}
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
