import type { CSSProperties } from 'react';
import type { RoomSnapshot } from '../shared/contracts.js';
import { formatTokens } from './format.js';
export function TriviaScoreboard({
  data,
}: {
  data: NonNullable<RoomSnapshot['triviaScoreboard']>;
}) {
  return (
    <section className="trivia-scoreboard" aria-label="团队积分榜">
      <div className="scoreboard-heading">
        <span>名次 / 队伍</span>
        <span>积分</span>
      </div>
      <ol>
        {data.teams.map((team) => (
          <li
            key={team.id}
            className={team.id === data.ownTeamId ? 'is-own-team' : ''}
            style={{ '--team-color': team.color } as CSSProperties}
          >
            <span className="scoreboard-rank">{team.rank}</span>
            <span className="scoreboard-team">
              {team.name}
              {team.id === data.ownTeamId && <small>本队</small>}
            </span>
            <strong>{formatTokens(team.score)}</strong>
          </li>
        ))}
      </ol>
      {!data.teams.length && <p>本轮尚未分组。</p>}
    </section>
  );
}
