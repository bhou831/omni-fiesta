import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';
import { triviaProjection } from './trivia.js';
import type { RoomSnapshot } from '../../shared/contracts.js';

export const triviaScoreboard: PhaseModule = {
  id: 'trivia-scoreboard',
  durationSeconds: () => null,
  action() {
    requireRule(false, 'READ_ONLY', 'The scoreboard is read-only.');
    return {};
  },
};
export function triviaScoreboardProjection(
  c: PhaseContext,
  playerId?: string,
): NonNullable<RoomSnapshot['triviaScoreboard']> {
  const saved = c.store.db
    .prepare(
      'SELECT phase_instance FROM trivia_state WHERE room_id=? ORDER BY phase_instance DESC LIMIT 1',
    )
    .get(c.room.id) as { phase_instance: number } | undefined;
  if (!saved) return { teams: [], ownTeamId: null };
  const context = { ...c, room: { ...c.room, phase_instance: saved.phase_instance } };
  const trivia = triviaProjection(context);
  const awards = c.store.db
    .prepare(
      `SELECT a.team, SUM(a.amount) AS score FROM trivia_awards a LEFT JOIN trivia_award_receipts r ON r.room_id=a.room_id AND r.phase_instance=a.phase_instance AND r.award_id=a.request_id WHERE a.room_id=? AND a.phase_instance=? AND r.undone_at IS NULL GROUP BY a.team`,
    )
    .all(c.room.id, saved.phase_instance) as { team: number; score: number }[];
  const teams = trivia.teams
    .map(({ id, name, color }) => ({
      id,
      name,
      color,
      score: awards.find((a) => a.team === id)?.score ?? 0,
      rank: 0,
    }))
    .sort((a, b) => b.score - a.score || a.id - b.id);
  teams.forEach((team, i) => {
    team.rank = i > 0 && team.score === teams[i - 1].score ? teams[i - 1].rank : i + 1;
  });
  return {
    teams,
    ownTeamId: playerId
      ? (trivia.teams.find((t) => t.members.some((m) => m.id === playerId))?.id ?? null)
      : null,
  };
}
