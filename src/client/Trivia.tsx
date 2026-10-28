import React, { useState } from 'react';
import type { TriviaProjection } from '../server/games/trivia.js';
import type { Command } from '../shared/contracts.js';

type CommandFn = (type: Command['type'], payload?: Command['payload']) => Promise<void>;
export type TriviaViewProps = { trivia: TriviaProjection; command: CommandFn; disabled: boolean };
function TeamList({ trivia }: { trivia: TriviaProjection }) {
  return (
    <div className="team-list">
      {trivia.teams.map((team) => (
        <p key={team.id}>
          <strong style={{ color: team.color }}>{team.name}</strong>
          {team.excluded ? ' · Excluded this question' : ''}:{' '}
          {team.members.map((p) => `${p.emoji} ${p.name}`).join(', ')}
        </p>
      ))}
    </div>
  );
}
function BuzzStatus({ trivia }: { trivia: TriviaProjection }) {
  const team = trivia.teams.find((t) => t.id === trivia.winner?.teamId);
  const winner = team?.members.find((p) => p.id === trivia.winner?.playerId);
  if (winner)
    return (
      <p>
        {winner.emoji} {winner.name} buzzed first for {team?.name}.
      </p>
    );
  return (
    <p>
      {trivia.status === 'armed'
        ? 'Buzzer is open.'
        : trivia.question
          ? 'Waiting for the host.'
          : trivia.teams.length
            ? 'Teams are ready.'
            : 'Finding your teammates…'}
    </p>
  );
}
export function TriviaPlayer({ trivia, command, disabled }: TriviaViewProps) {
  const team = trivia.teams.find((t) => t.id === trivia.ownTeamId);
  const canBuzz = team && !team.excluded && trivia.status === 'armed' && !disabled;
  return (
    <section>
      <h2>
        {team ? <span style={{ color: team.color }}>{team.name}</span> : 'Waiting for your team'}
      </h2>
      <BuzzStatus trivia={trivia} />
      {team?.excluded && <p>Your team is waiting for the next question.</p>}
      <button
        className="button primary"
        disabled={!canBuzz}
        onClick={() =>
          void command('phase.action', { action: 'buzz', data: { windowId: trivia.windowId } })
        }
      >
        Buzz in
      </button>
      <TeamList trivia={trivia} />
    </section>
  );
}
export function TriviaHost({ trivia, command, disabled }: TriviaViewProps) {
  const [count, setCount] = useState(String(trivia.defaultTeamCount || 1));
  const [team, setTeam] = useState('1');
  const [amount, setAmount] = useState('100');
  const host = (action: string, data?: Record<string, unknown>) =>
    void command('phase.host', { action, data });
  return (
    <section className="host-game-controls">
      <fieldset className="control-group">
        <legend>1 · Teams</legend>
        <label>
          Number of teams{' '}
          <input
            type="number"
            min="1"
            max={trivia.teams.reduce((n, t) => n + t.members.length, 0) || undefined}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>{' '}
        <button
          className="button secondary"
          disabled={disabled || trivia.question > 0}
          onClick={() => host('assign', { count: Number(count) })}
        >
          Assign teams
        </button>
        <details>
          <summary>View teams and players</summary>
          <TeamList trivia={trivia} />
        </details>
      </fieldset>
      <fieldset className="control-group">
        <legend>2 · Question &amp; buzzer</legend>
        <BuzzStatus trivia={trivia} />
        <p>
          Question {trivia.question || 'not started'} · {trivia.status}
        </p>
        <div className="actions">
          <button
            className="button secondary"
            disabled={disabled || !trivia.teams.length || trivia.status === 'armed'}
            onClick={() => host('new-question')}
          >
            New question
          </button>
          <button
            className="button primary"
            disabled={disabled || !trivia.question || trivia.status !== 'idle'}
            onClick={() => host('arm')}
          >
            Arm buzzer
          </button>
          <button
            className="button secondary"
            disabled={disabled || trivia.status !== 'armed'}
            onClick={() => host('close-buzzer')}
          >
            Close buzzer
          </button>
          <button
            className="button secondary"
            disabled={disabled || trivia.status !== 'locked'}
            onClick={() => host('incorrect')}
          >
            Incorrect · reopen
          </button>
        </div>
      </fieldset>
      <fieldset className="control-group">
        <legend>3 · Award points</legend>
        <label>
          Team{' '}
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            {trivia.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Tokens per teammate{' '}
          <input
            type="number"
            min="1"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>{' '}
        <button
          className="button secondary"
          disabled={disabled || !trivia.teams.length}
          onClick={() => host('award', { teamId: Number(team), amount: Number(amount) })}
        >
          Award team
        </button>
        <p className="fine-print">Each teammate receives this many tokens.</p>
      </fieldset>
    </section>
  );
}
export function TriviaDisplay({ trivia }: { trivia: TriviaProjection }) {
  return (
    <section>
      {(trivia.question > 0 || trivia.winner) && (
        <div className="trivia-buzz-status">
          <BuzzStatus trivia={trivia} />
        </div>
      )}
      <TeamList trivia={trivia} />
    </section>
  );
}
