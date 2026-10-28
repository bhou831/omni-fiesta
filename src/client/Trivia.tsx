import React, { useRef, useState, type CSSProperties } from 'react';
import type { TriviaProjection } from '../server/games/trivia.js';
import type { CommandSender } from '../shared/contracts.js';

type CommandFn = CommandSender;
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
    <section
      className="trivia-player"
      style={{ '--team-color': team?.color ?? '#202020' } as CSSProperties}
    >
      <h2>
        {team ? <span style={{ color: team.color }}>{team.name}</span> : 'Waiting for your team'}
      </h2>
      <BuzzStatus trivia={trivia} />
      {team?.excluded && <p>Your team is waiting for the next question.</p>}
      <button
        className="button primary trivia-buzzer"
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
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState<{
    action: string;
    message: string;
    signature: string;
    awardId?: string;
  } | null>(null);
  const lock = useRef(false);
  const signature = `${trivia.question}:${team}:${amount}`;
  const history = trivia.awardHistory ?? [];
  const alreadyAwarded =
    history.some(
      (award) =>
        !award.undone &&
        award.question === trivia.question &&
        award.teamId === Number(team) &&
        award.amount === Number(amount),
    ) ||
    (feedback?.action === 'award' &&
      feedback.signature === signature &&
      !history.some((a) => a.id === feedback.awardId));
  const host = async (action: string, data?: Record<string, unknown>) => {
    if (disabled || lock.current) return;
    lock.current = true;
    setPending(action);
    setFeedback(null);
    try {
      const receipt = await command('phase.host', { action, data });
      if (!receipt) return;
      const messages: Record<string, string> = {
        assign: 'Teams assigned.',
        'new-question': 'New question ready.',
        arm: 'Buzzer opened.',
        'close-buzzer': 'Buzzer closed.',
        incorrect: 'Team excluded. Ready to arm the next attempt.',
        award: `${trivia.teams.find((t) => t.id === Number(team))?.name ?? 'Team'} received ${amount} tokens per teammate.`,
        'undo-award': 'Award reversed. You can now award the correct team or amount.',
      };
      setFeedback({
        action,
        message: messages[action] ?? 'Done.',
        signature,
        ...(typeof receipt.result.awardId === 'string' ? { awardId: receipt.result.awardId } : {}),
      });
    } finally {
      lock.current = false;
      setPending('');
    }
  };
  const button = (
    action: string,
    label: string,
    blocked: boolean,
    data?: Record<string, unknown>,
    primary = false,
  ) => {
    const completed = action === 'award' ? alreadyAwarded : feedback?.action === action;
    return (
      <button
        className={`button ${completed ? 'success' : primary ? 'primary' : 'secondary'}`}
        disabled={disabled || !!pending || blocked}
        onClick={() => void host(action, data)}
      >
        {pending === action ? 'Saving…' : completed ? `✓ ${label}` : label}
      </button>
    );
  };
  return (
    <section className="host-game-controls">
      <p className="host-action-feedback" role="status" aria-live="polite">
        {feedback ? `✓ ${feedback.message}` : pending ? 'Saving…' : ''}
      </p>
      <fieldset className="control-group">
        <legend>1 · Teams</legend>
        <label>
          Number of teams{' '}
          <input
            type="number"
            min="1"
            max={trivia.teams.reduce((n, t) => n + t.members.length, 0) || undefined}
            disabled={disabled || !!pending}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>{' '}
        {button('assign', 'Assign teams', trivia.question > 0, { count: Number(count) })}
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
          {button(
            'new-question',
            'New question',
            !trivia.teams.length || trivia.status === 'armed',
          )}
          {button(
            'arm',
            'Arm buzzer',
            !trivia.question || trivia.status !== 'idle',
            undefined,
            true,
          )}
          {button('close-buzzer', 'Close buzzer', trivia.status !== 'armed')}
          {button('incorrect', 'Incorrect · reopen', trivia.status !== 'locked')}
        </div>
      </fieldset>
      <fieldset className="control-group">
        <legend>3 · Award points</legend>
        <label>
          Team{' '}
          <select
            disabled={disabled || !!pending}
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
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
            disabled={disabled || !!pending}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>{' '}
        {button(
          'award',
          alreadyAwarded ? 'Awarded' : 'Award team',
          !trivia.teams.length || alreadyAwarded,
          { teamId: Number(team), amount: Number(amount) },
        )}
        <p className="fine-print">Each teammate receives this many tokens.</p>
        {history.length > 0 && (
          <div className="award-history">
            <h4>Awards &amp; corrections</h4>
            <ul>
              {history.map((award) => (
                <li key={award.id}>
                  <div>
                    <strong>
                      {trivia.teams.find((t) => t.id === award.teamId)?.name} · +{award.amount} each
                    </strong>
                    <span>
                      {award.question === null ? 'Earlier award' : `Question ${award.question}`} ·{' '}
                      {award.undone ? 'Undone' : 'Awarded'}
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    disabled={disabled || !!pending || award.undone}
                    onClick={() => void host('undo-award', { awardId: award.id })}
                  >
                    {award.undone ? '✓ Undone' : 'Undo award'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
