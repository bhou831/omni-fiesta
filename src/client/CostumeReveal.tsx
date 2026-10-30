import React from 'react';
import type {
  CostumeRevealGroup,
  CostumeRevealKind,
  CostumeRevealProjection,
} from '../server/games/costume.js';
import { formatTokens } from './format.js';
import { useRotatingPage } from './useRotatingPage.js';

const TITLES: Record<CostumeRevealKind, string> = {
  third: '3rd place',
  second: '2nd place',
  last: 'Last place',
  first: '1st place',
  all: 'Best dressed',
};
const title = (group: CostumeRevealGroup) =>
  group.kind === 'first' && group.players.length === 1 ? 'The winner' : TITLES[group.kind];
const votes = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

function GroupCard({ group, isNew }: { group: CostumeRevealGroup; isNew: boolean }) {
  return (
    <article className={`reveal-card kind-${group.kind}${isNew ? ' is-new' : ''}`}>
      <h3>{title(group)}</h3>
      <ul>
        {group.players.map((p) => (
          <li key={p.playerId}>
            <strong>
              {p.emoji} {p.name}
            </strong>
            <span className="costume-result-meta">
              {votes(p.votes)} · {formatTokens(p.tokenChange, { signed: true })} tokens
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

const LIST_PAGE = 4;
function FullList({
  list,
  rotate,
}: {
  list: NonNullable<CostumeRevealProjection['list']>;
  rotate: boolean;
}) {
  // Like the final ranking: the podium stays put and, on the TV, everyone else rotates beneath it.
  const podium = list.filter((r) => r.place <= 3);
  const rest = list.filter((r) => r.place > 3);
  const page = useRotatingPage(rotate ? rest.length : 0, LIST_PAGE);
  const shown = rotate
    ? [...podium, ...rest.slice(page * LIST_PAGE, page * LIST_PAGE + LIST_PAGE)]
    : list;
  return (
    <ol className="ranking-list costume-list">
      {shown.map((r) => (
        <li key={r.playerId} className={r.place <= 3 ? `is-top rank-${r.place}` : ''}>
          <span className="rank-number">{r.place}</span>
          <span className="rank-name">
            {r.emoji} {r.name}
          </span>
          <span className="rank-tokens">
            {votes(r.votes)} · {formatTokens(r.tokenChange, { signed: true })} tokens
          </span>
        </li>
      ))}
    </ol>
  );
}

/** TV: every announced place stays up, and the newest one animates in. */
export function CostumeRevealDisplay({ state }: { state: CostumeRevealProjection }) {
  return (
    <section className="costume-reveal">
      {state.revealed.length === 0 && <p className="costume-locked">And the winners are…</p>}
      {state.list ? (
        <FullList list={state.list} rotate />
      ) : (
        <div className="reveal-cards">
          {state.revealed.map((group, i) => (
            <GroupCard key={group.kind} group={group} isNew={i === state.revealed.length - 1} />
          ))}
        </div>
      )}
    </section>
  );
}

export function CostumeRevealPlayer({
  state,
  selfId,
}: {
  state: CostumeRevealProjection;
  selfId: string;
}) {
  const own = state.revealed.find((g) => g.players.some((p) => p.playerId === selfId));
  const mine = own?.players.find((p) => p.playerId === selfId);
  return (
    <section className="costume-reveal">
      <h2>Best dressed</h2>
      {state.revealed.length === 0 && <p>Watch the screen. The host announces the winners.</p>}
      {mine && (
        <p role="status">
          You were {own!.kind === 'last' ? 'last' : TITLES[own!.kind].toLowerCase()} ·{' '}
          {formatTokens(mine.tokenChange, { signed: true })} tokens
        </p>
      )}
      {state.list ? (
        <FullList list={state.list} rotate={false} />
      ) : (
        <div className="reveal-cards">
          {state.revealed.map((group, i) => (
            <GroupCard key={group.kind} group={group} isNew={i === state.revealed.length - 1} />
          ))}
        </div>
      )}
    </section>
  );
}

export function CostumeRevealHost({
  state,
  disabled,
  busyKey,
  onNext,
}: {
  state: CostumeRevealProjection;
  disabled: boolean;
  busyKey?: string | null;
  onNext: () => void;
}) {
  const next = state.upcoming[0];
  const label = !next
    ? 'Show the full list'
    : next.kind === 'all'
      ? 'Reveal the results'
      : next.kind === 'first'
        ? next.players.length === 1
          ? 'Reveal the winner'
          : 'Reveal 1st place'
        : `Reveal ${TITLES[next.kind].toLowerCase()}`;
  return (
    <section>
      <h3>Costume winners</h3>
      <p>
        {state.step} of {state.totalSteps} announced. Tokens move as each place is revealed.
      </p>
      {next || state.listPending ? (
        <button className="button primary" disabled={disabled} onClick={onNext}>
          {busyKey === 'phase.host:next' ? 'Revealing…' : label}
        </button>
      ) : (
        <p role="status">
          ✓ Every place and the full list are on screen. Close the round, then move on to the final
          ranking.
        </p>
      )}
      {state.upcoming.length > 0 && (
        <>
          <p className="fine-print">Still to come (private):</p>
          <ol>
            {state.upcoming.map((group) => (
              <li key={group.kind}>
                <strong>{title(group)}:</strong>{' '}
                {group.players.map((p) => `${p.emoji} ${p.name}`).join(', ')}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
