import React from 'react';
import type { CostumeProjection } from '../server/games/costume.js';
import type { PublicPlayer } from '../shared/contracts.js';
import { formatTokens } from './format.js';

export interface CostumeViewProps {
  state: CostumeProjection;
  players: PublicPlayer[];
  selfId?: string;
  open: boolean;
  disabled: boolean;
  /** The command in flight (`type:action`), so the tapped button can show it is working. */
  busyKey?: string | null;
  allowSelfVote: boolean;
  onVote: (candidateId: string) => void;
  onReveal: () => void;
  onRevote?: () => void;
}

function Results({ state }: { state: CostumeProjection }) {
  if (!state.results) return <p>Results are waiting for the host.</p>;
  return (
    <ol>
      {state.results.map((result) => (
        <li key={result.playerId} value={result.place}>
          <strong>
            {result.emoji} {result.name}
          </strong>{' '}
          · {result.votes} {result.votes === 1 ? 'vote' : 'votes'} ·{' '}
          {formatTokens(result.tokenChange, { signed: true })} tokens
        </li>
      ))}
    </ol>
  );
}
export function CostumePlayer(props: CostumeViewProps) {
  const { state, players, selfId, open, disabled, allowSelfVote, onVote } = props;
  return (
    <section>
      <h2>{state.round > 1 ? 'Tie-break vote' : 'Vote for a costume'}</h2>
      {state.revealed ? (
        <Results state={state} />
      ) : (
        <>
          {state.round > 1 && !state.revealed && (
            <p>Tied for first. Vote again between the players below.</p>
          )}
          <p>
            {open
              ? 'Choose one person. You can change your vote until voting closes.'
              : 'Voting is closed. Wait for the host to reveal the results.'}
          </p>
          {state.votedFor && (
            <p>Saved vote: {players.find((p) => p.id === state.votedFor)?.name ?? 'Player'}</p>
          )}
          <div className="costume-choices">
            {players
              .filter((p) => !state.candidates || state.candidates.some((c) => c.playerId === p.id))
              .filter((p) => allowSelfVote || p.id !== selfId)
              .map((p) => (
                <button
                  className="button secondary"
                  key={p.id}
                  disabled={disabled || !open}
                  onClick={() => onVote(p.id)}
                  aria-pressed={state.votedFor === p.id}
                >
                  {p.emoji} {p.name}
                  {state.votedFor === p.id ? ' ✓' : ''}
                </button>
              ))}
          </div>
          {players.length === 1 && !allowSelfVote && <p>There is no other player to vote for.</p>}
        </>
      )}
    </section>
  );
}
export function CostumeHost(props: CostumeViewProps) {
  const tied = props.state.tiedForFirst.map(
    (id) => props.players.find((p) => p.id === id)?.name ?? 'A player',
  );
  return (
    <section>
      <h3>Costume voting</h3>
      <p>
        {props.state.voteCount} {props.state.voteCount === 1 ? 'vote' : 'votes'} received.
      </p>
      {props.state.round > 1 && !props.state.revealed && (
        <p>Re-vote round {props.state.round}: only the players tied for first can win.</p>
      )}
      {!props.state.revealed && <p>Private preview; results become public when revealed.</p>}
      <Results state={props.state} />
      {tied.length > 0 && (
        <p className="notice">
          Tied for first: {tied.join(', ')}. Start a re-vote to choose one winner.
        </p>
      )}
      {!props.state.revealed && tied.length > 0 && (
        <button
          className="button primary"
          disabled={props.disabled || props.open}
          onClick={props.onRevote}
        >
          {props.busyKey === 'phase.host:revote'
            ? 'Starting re-vote…'
            : `Start re-vote between ${tied.length} players`}
        </button>
      )}
      {!props.state.revealed && (
        <button
          className="button secondary"
          disabled={props.disabled || props.open || tied.length > 0}
          onClick={props.onReveal}
        >
          {props.busyKey === 'phase.host:reveal' ? 'Revealing…' : 'Settle and reveal results'}
        </button>
      )}
    </section>
  );
}
/** TV results: name over votes and tokens, flowed into columns so every guest fits on the stage. */
function DisplayResults({ results }: { results: NonNullable<CostumeProjection['results']> }) {
  return (
    <ol className="costume-results">
      {results.map((result) => (
        <li key={result.playerId} className={result.place <= 3 ? 'is-top' : ''}>
          <span className="rank-number">{result.place}</span>
          <strong>
            {result.emoji} {result.name}
          </strong>
          <span className="costume-result-meta">
            {result.votes} {result.votes === 1 ? 'vote' : 'votes'} ·{' '}
            {formatTokens(result.tokenChange, { signed: true })} tokens
          </span>
        </li>
      ))}
    </ol>
  );
}
export function CostumeDisplay({ state }: Pick<CostumeViewProps, 'state'>) {
  return (
    <section>
      {state.revealed && state.results && <DisplayResults results={state.results} />}
      {!state.revealed && state.candidates && (
        <ul className="tie-candidates" aria-label="Tied for first">
          {state.candidates.map((c) => (
            <li key={c.playerId}>
              <span aria-hidden="true">{c.emoji}</span> {c.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
