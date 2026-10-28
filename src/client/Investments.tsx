import React, { useState } from 'react';
import type { Command, RoomSnapshot } from '../shared/contracts.js';

type Props = {
  state: RoomSnapshot;
  command: (type: Command['type'], payload?: Command['payload']) => Promise<void>;
  disabled: boolean;
  revealBalance?: boolean;
};
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
    <section>
      <h2>Choose one investment</h2>
      <p>
        Up to {data.cap} tokens are locked until review. Returns are multiplied by {data.multiplier}
        ×; your maximum loss is your investment.
      </p>
      {data.position && (
        <p>
          Saved: {data.position.principal} tokens in {data.position.asset_id}.
        </p>
      )}
      {data.assets.map((a) => {
        const q = data.opening?.quotes.find((q) => q.id === a.provider_id);
        const range =
          q?.high24h != null && q.low24h != null
            ? ((q.high24h - q.low24h) / Number(q.price)) * 100
            : null;
        return (
          <article key={a.provider_id} className="panel">
            <h3>
              {a.name} — {a.symbol}
            </h3>
            <p>{a.category.replaceAll('_', ' ')}</p>
            <p>{a.description}</p>
            <p>
              Opening USD: ${q?.price ?? 'Unavailable'} · 24h change: {metric(q?.change24h)}%
            </p>
            <p>
              24h high / low: {metric(q?.high24h)} / {metric(q?.low24h)} · Volume USD:{' '}
              {metric(q?.volume24h)}
            </p>
            <p>24h price range: {range === null ? 'Unavailable' : `${metric(range)}%`}</p>
            <p>CoinGecko · {q ? new Date(q.timestamp).toLocaleString() : 'Unavailable'}</p>
            {a.research_links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label} ↗{' '}
              </a>
            ))}
            <p>
              <label>
                <input
                  type="radio"
                  name="asset"
                  checked={asset === a.provider_id}
                  onChange={() => setAsset(a.provider_id)}
                  disabled={disabled}
                />{' '}
                Choose {a.symbol}
              </label>
            </p>
          </article>
        );
      })}
      <label>
        Tokens to invest{' '}
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
    </section>
  );
}
