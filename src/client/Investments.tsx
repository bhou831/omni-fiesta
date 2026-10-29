import React, { useEffect, useState } from 'react';
import type { CommandSender, RoomSnapshot } from '../shared/contracts.js';
import { investmentPayout } from '../server/games/investment-math.js';

type Props = {
  state: RoomSnapshot;
  command: CommandSender;
  disabled: boolean;
  /** The command in flight (`type:action`), so the tapped button can show it is working. */
  busyKey?: string | null;
  revealBalance?: boolean;
  /** Opens every card's details; used by tests and previews. */
  expandAll?: boolean;
};
// Plain ticker letters in every mark: one font, one size, nothing that reads as a market direction.
const assetMark = (symbol: string | undefined) => (symbol ?? '').slice(0, 3).toUpperCase();
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
/** The unsaved draft for this round, or `fallback` when none is stored or it cannot be trusted. */
export function loadDraft(
  key: string,
  validAssets: Set<string>,
  fallback: Record<string, string>,
): Record<string, string> {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          validAssets.has(entry[0]) && typeof entry[1] === 'string',
      ),
    );
  } catch {
    return fallback;
  }
}
function RiskExamples({ multiplier }: { multiplier: number }) {
  const threshold = 100 / multiplier;
  return (
    <details className="investment-risk">
      <summary>Payoff examples · per 100 tokens</summary>
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
    </details>
  );
}
export function InvestmentPlayer({
  state,
  command,
  disabled,
  busyKey = null,
  revealBalance = false,
  expandAll = false,
}: Props) {
  const data = state.investments!;
  if (state.room.phase === 'investment-review') return <PersonalInvestmentResult data={data} />;
  return (
    <InvestmentPicker
      state={state}
      command={command}
      disabled={disabled}
      busyKey={busyKey}
      revealBalance={revealBalance}
      expandAll={expandAll}
    />
  );
}

/** Tick any assets, size each stake, then save the whole portfolio at once. */
function InvestmentPicker({ state, command, disabled, busyKey, revealBalance, expandAll }: Props) {
  const data = state.investments!;
  const saved = Object.fromEntries(data.positions.map((p) => [p.asset_id, String(p.principal)]));
  const key = `of_invest_draft_${state.room.code}_${state.room.phaseInstance}`;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    loadDraft(key, new Set(data.assets.map((a) => a.provider_id)), saved),
  );
  // A phone may discard this tab while the player checks a chart; keep their unsaved stakes.
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {
      // Storage can be unavailable (private mode); the draft just lives in memory.
    }
  }, [key, draft]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const symbolOf = (id: string) => data.assets.find((a) => a.provider_id === id)?.symbol ?? id;
  const chosen = Object.keys(draft);
  const amountOf = (id: string) => Number(draft[id]);
  const total = chosen.reduce(
    (sum, id) => sum + (Number.isFinite(amountOf(id)) ? amountOf(id) : 0),
    0,
  );
  const savedTotal = data.positions.reduce((sum, p) => sum + p.principal, 0);
  const remaining = data.cap - total;
  const available = (state.self?.accounts.spendable ?? 0) + savedTotal;
  const valid = chosen.every((id) => Number.isSafeInteger(amountOf(id)) && amountOf(id) > 0);
  const unchanged =
    chosen.length === data.positions.length &&
    chosen.every((id) => amountOf(id) === Number(saved[id]));
  const problem = !chosen.length
    ? ''
    : !valid
      ? 'Enter a whole number of tokens for each asset you ticked.'
      : total > data.cap
        ? `Over the ${data.cap.toLocaleString()}-token limit by ${(-remaining).toLocaleString()}.`
        : total > available
          ? 'That is more than your available tokens.'
          : '';
  const toggle = (id: string, on: boolean) =>
    setDraft((current) => {
      const next = { ...current };
      if (!on) delete next[id];
      else next[id] = remaining > 0 ? String(Math.min(100, remaining)) : '';
      return next;
    });
  const expand = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <section className="game-panel">
      <h2>Choose your investments</h2>
      <div className="investment-cap">
        <span>Investment limit</span>
        <strong>
          {data.cap.toLocaleString()} <small>tokens in total</small>
        </strong>
      </div>
      <p>
        Tick one or more assets and set a stake for each. Returns are multiplied by{' '}
        {data.multiplier}
        ×. Stakes are locked until review; you can’t lose more than you invest.
      </p>
      <div className="investment-cards">
        {data.assets.map((a) => {
          const q = data.opening?.quotes.find((q) => q.id === a.provider_id);
          const range =
            q?.high24h != null && q.low24h != null && q.low24h >= 0 && q.high24h >= q.low24h
              ? ((q.high24h - q.low24h) / Number(q.price)) * 100
              : null;
          const selected = a.provider_id in draft;
          const expanded = expandAll || open.has(a.provider_id);
          const chart = a.research_links.find((l) => /chart/i.test(l.label)) ?? a.research_links[0];
          const otherLinks = a.research_links.filter((l) => l !== chart);
          return (
            <article
              key={a.provider_id}
              className={`investment-card ${selected ? 'is-selected' : ''}`}
            >
              <div className="asset-row">
                <label className="asset-check">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={(e) => toggle(a.provider_id, e.target.checked)}
                  />
                  <span className="sr-only">Invest in {a.symbol}</span>
                </label>
                <button
                  type="button"
                  className="asset-summary"
                  aria-expanded={expanded}
                  aria-label={`${a.symbol} details`}
                  onClick={() => expand(a.provider_id)}
                >
                  <span className="asset-mark" aria-hidden="true">
                    {assetMark(a.symbol)}
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
                </button>
              </div>
              {selected && (
                <div className="asset-stake">
                  <label>
                    Tokens in {a.symbol}
                    <input
                      type="number"
                      min="1"
                      max={data.cap}
                      step="1"
                      inputMode="numeric"
                      value={draft[a.provider_id]}
                      disabled={disabled}
                      onChange={(e) =>
                        setDraft((current) => ({ ...current, [a.provider_id]: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled || remaining <= 0}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        [a.provider_id]: String(
                          (Number(current[a.provider_id]) || 0) + Math.max(0, remaining),
                        ),
                      }))
                    }
                  >
                    Add the rest
                  </button>
                </div>
              )}
              {expanded && (
                <div className="asset-facts">
                  <span className="eyebrow">{a.category.replaceAll('_', ' ')}</span>
                  <p>{a.description}</p>
                  {chart && (
                    <>
                      <a
                        className="button secondary chart-link"
                        href={chart.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        See live chart ↗
                      </a>
                      <p className="fine-print">Opens in a new tab. The timer keeps running.</p>
                    </>
                  )}
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
                  {otherLinks.length > 0 && (
                    <div className="research-links">
                      {otherLinks.map((link) => (
                        <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                          {link.label} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="fine-print">
        Tap a stock’s name for its details. Tick the box to invest.
        {revealBalance ? ` Available: ${available.toLocaleString()} tokens.` : ''}
      </p>
      <div className="invest-bar">
        <span className="invest-total">
          <span className="eyebrow">Invested</span>
          <strong>
            {total.toLocaleString()} <small>/ {data.cap.toLocaleString()}</small>
          </strong>
        </span>
        <button
          className="button primary"
          disabled={disabled || !chosen.length || !!problem || unchanged}
          onClick={() =>
            void command('phase.action', {
              action: 'invest',
              data: {
                allocations: chosen.map((id) => ({ assetId: id, amount: amountOf(id) })),
              },
            })
          }
        >
          {busyKey === 'phase.action:invest'
            ? 'Saving…'
            : unchanged && data.positions.length
              ? '✓ Investments saved'
              : data.positions.length
                ? 'Update investments'
                : 'Save investments'}
        </button>
      </div>
      <p
        className={`save-feedback ${unchanged && data.positions.length ? 'is-saved' : ''}`}
        role="status"
        aria-live="polite"
      >
        {problem ||
          (unchanged && data.positions.length
            ? `✓ ${data.positions.map((p) => `${p.principal.toLocaleString()} in ${symbolOf(p.asset_id)}`).join(' · ')}. You’re all set.`
            : data.positions.length
              ? 'You have unsaved changes. Your saved investments still stand.'
              : 'Nothing saved yet. Sitting out is fine, too.')}
      </p>
      {data.positions.length > 0 && (
        <button
          className="button secondary"
          disabled={disabled}
          onClick={() =>
            // Clear the draft only once the server has confirmed the cancellation.
            void command('phase.action', { action: 'cancel' }).then((receipt) => {
              if (receipt) setDraft({});
            })
          }
        >
          {busyKey === 'phase.action:cancel' ? 'Cancelling…' : 'Cancel all investments'}
        </button>
      )}
    </section>
  );
}

type InvestmentData = NonNullable<RoomSnapshot['investments']>;
const signed = (value: number, digits = 2) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: digits })}`;
const direction = (value: number) =>
  value > 0 ? 'market-up' : value < 0 ? 'market-down' : 'market-flat';

function PersonalInvestmentResult({ data }: { data: InvestmentData }) {
  if (!data.positions.length)
    return (
      <section className="investment-result">
        <h2>You sat this one out.</h2>
        <p>No tokens invested. Enjoy the closing bell.</p>
      </section>
    );
  if (data.refunded) {
    const principal = data.positions.reduce((sum, p) => sum + p.principal, 0);
    return (
      <section className="investment-result market-flat" aria-live="polite">
        <span className="eyebrow">Your game result</span>
        <strong className="result-number">0</strong>
        <p className="result-caption">tokens gained or lost</p>
        <p>
          Closing prices were unavailable, so your {principal.toLocaleString()} tokens were returned
          in full.
        </p>
        <p className="settlement-status">✓ Returned tokens are available to play.</p>
      </section>
    );
  }
  const rows = data.positions.map((pos) => {
    const asset = data.assets.find((a) => a.provider_id === pos.asset_id);
    const open = data.opening?.quotes.find((q) => q.id === pos.asset_id);
    const close = data.closing?.quotes.find((q) => q.id === pos.asset_id);
    const payout =
      pos.payout ??
      (open && close
        ? investmentPayout(pos.principal, data.multiplier, open.price, close.price)
        : null);
    const marketReturn =
      open && close ? (Number(close.price) / Number(open.price) - 1) * 100 : null;
    return { pos, asset, open, close, payout, marketReturn };
  });
  const settled = rows.every((r) => r.pos.payout !== null);
  const principal = rows.reduce((sum, r) => sum + r.pos.principal, 0);
  const payout = rows.some((r) => r.payout === null)
    ? null
    : rows.reduce((sum, r) => sum + (r.payout ?? 0), 0);
  const net = payout === null ? null : payout - principal;
  return (
    <section
      className={`investment-result ${net === null ? '' : direction(net)}`}
      aria-live="polite"
    >
      <span className="eyebrow">{settled ? 'Your game result' : 'Awaiting settlement'}</span>
      <strong className="result-number">
        {net === null
          ? 'Closing soon…'
          : `${net > 0 ? '↗ ' : net < 0 ? '↘ ' : ''}${signed(net, 0)}`}
      </strong>
      <p className="result-caption">
        {net === null
          ? 'Your stake is safe in the lockbox until the host settles.'
          : `tokens ${net > 0 ? 'gained' : net < 0 ? 'lost' : 'gained or lost'}${settled ? '' : ' · preview, not credited yet'}`}
      </p>
      <ul className="result-assets">
        {rows.map(({ pos, asset, payout: assetPayout }) => (
          <li key={pos.asset_id}>
            <span className="asset-mark" aria-hidden="true">
              {assetMark(asset?.symbol)}
            </span>
            <span className="result-asset-name">
              <strong>{asset?.symbol ?? pos.asset_id}</strong>
              <span>{pos.principal.toLocaleString()} invested</span>
            </span>
            <span
              className={`result-asset-net ${assetPayout === null ? '' : direction(assetPayout - pos.principal)}`}
            >
              {assetPayout === null ? 'Pending' : signed(assetPayout - pos.principal, 0)}
            </span>
          </li>
        ))}
      </ul>
      <dl className="result-breakdown">
        <div>
          <dt>You invested</dt>
          <dd>{principal.toLocaleString()} tokens</dd>
        </div>
        <div>
          <dt>{settled ? 'Returned to you' : 'Expected return'}</dt>
          <dd>{payout === null ? 'Pending' : `${payout.toLocaleString()} tokens`}</dd>
        </div>
      </dl>
      <p className="settlement-status">
        {settled
          ? '✓ Settled. Returned tokens are available to play.'
          : 'The host will settle this shortly.'}
      </p>
      <details className="investment-receipt">
        <summary>How it worked</summary>
        {rows.map(({ pos, asset, open, close, marketReturn }) => (
          <div key={pos.asset_id}>
            <h3>{asset?.symbol ?? pos.asset_id}</h3>
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
            </dl>
          </div>
        ))}
        <dl className="market-facts">
          <div>
            <dt>Return multiplier</dt>
            <dd>{data.multiplier}× · losses capped at your stake</dd>
          </div>
        </dl>
        <p className="fine-print">
          Opened {rows[0]?.open ? new Date(rows[0].open.timestamp).toLocaleString() : 'Unavailable'}
          <br />
          Closed {rows[0]?.close ? new Date(rows[0].close.timestamp).toLocaleString() : 'Pending'}
        </p>
      </details>
    </section>
  );
}

export function InvestmentReviewDisplay({ data }: { data: InvestmentData }) {
  if (data.refunded)
    return (
      <section className="investment-refund">
        <h2>Markets closed early.</h2>
        <p>Closing prices were unavailable, so every investment was returned in full.</p>
      </section>
    );
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
              {assetMark(asset.symbol)}
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
