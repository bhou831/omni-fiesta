import React from 'react';
import type { CostumeProjection } from '../server/games/costume.js';
import type { PublicPlayer } from '../shared/contracts.js';

export interface CostumeViewProps {
  state: CostumeProjection;
  players: PublicPlayer[];
  selfId?: string;
  open: boolean;
  disabled: boolean;
  allowSelfVote: boolean;
  onVote: (candidateId: string) => void;
  onReveal: () => void;
}

function Results({ state }: { state: CostumeProjection }) {
  if (!state.results) return <p>Results are waiting for the host.</p>;
  return (
    <ol>
      {state.results.map((result) => (
        <li key={result.playerId}>
          <strong>
            {result.place}. {result.emoji} {result.name}
          </strong>{' '}
          · {result.votes} {result.votes === 1 ? 'vote' : 'votes'} ·{' '}
          {result.tokenChange > 0 ? '+' : ''}
          {result.tokenChange} tokens
        </li>
      ))}
    </ol>
  );
}
export function CostumePlayer(props: CostumeViewProps) {
  const { state, players, selfId, open, disabled, allowSelfVote, onVote } = props;
  return (
    <section>
      <h2>Vote for a costume</h2>
      {state.revealed ? (
        <Results state={state} />
      ) : (
        <>
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
  return (
    <section>
      <h3>Costume voting</h3>
      <p>
        {props.state.voteCount} {props.state.voteCount === 1 ? 'vote' : 'votes'} received.
      </p>
      {!props.state.revealed && <p>Private preview; results become public when revealed.</p>}
      <Results state={props.state} />
      {!props.state.revealed && (
        <button
          className="button secondary"
          disabled={props.disabled || props.open}
          onClick={props.onReveal}
        >
          Settle and reveal results
        </button>
      )}
    </section>
  );
}
export function CostumeDisplay({ state }: Pick<CostumeViewProps, 'state'>) {
  return <section>{state.revealed && <Results state={state} />}</section>;
}
