import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';

/** The integration owner installs these tables in an ordered shared migration. */
export const costumeSchema = `
CREATE TABLE IF NOT EXISTS costume_votes (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  voter_id TEXT NOT NULL REFERENCES players(id), candidate_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY(room_id, phase_instance, voter_id)
);
CREATE TABLE IF NOT EXISTS costume_reveals (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  revealed_at INTEGER NOT NULL, PRIMARY KEY(room_id, phase_instance)
);
CREATE TABLE IF NOT EXISTS costume_results (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id), place INTEGER NOT NULL, votes INTEGER NOT NULL,
  token_change INTEGER NOT NULL, PRIMARY KEY(room_id, phase_instance, player_id)
);`;

export interface CostumeResult {
  playerId: string;
  name: string;
  emoji: string;
  place: number;
  votes: number;
  tokenChange: number;
}
export interface CostumeProjection {
  prizes: { place: number; tokens: number }[];
  lastPlacePenaltyPool: number;
  votedFor: string | null;
  voteCount: number;
  revealed: boolean;
  results: CostumeResult[] | null;
}

function calculate(context: PhaseContext): CostumeResult[] {
  const { store, room, config } = context;
  const players = store.players(room.id);
  const votes = store.db
    .prepare(
      'SELECT candidate_id, count(*) AS count FROM costume_votes WHERE room_id=? AND phase_instance=? GROUP BY candidate_id',
    )
    .all(room.id, room.phase_instance) as unknown as { candidate_id: string; count: number }[];
  const counts = new Map(votes.map((v) => [v.candidate_id, v.count]));
  const groups = [...new Set(players.map((p) => counts.get(p.id) ?? 0))].sort((a, b) => b - a);
  const total = votes.reduce((sum, v) => sum + v.count, 0);
  const bottom = groups.at(-1);
  const bottomSize = players.filter((p) => (counts.get(p.id) ?? 0) === bottom).length;
  return players
    .map((p) => {
      const count = counts.get(p.id) ?? 0;
      const place = groups.indexOf(count) + 1;
      const prize = total
        ? (config.costume.prizes_per_player.find((prize) => prize.place === place)?.tokens ?? 0)
        : 0;
      const penalty =
        total && count === bottom && !prize && place > 3
          ? Math.min(
              p.spendable,
              Math.floor(config.costume.last_place_penalty_pool_tokens / bottomSize),
            )
          : 0;
      return {
        playerId: p.id,
        name: p.name,
        emoji: p.emoji,
        place,
        votes: count,
        tokenChange: prize - penalty,
      };
    })
    .sort((a, b) => a.place - b.place || a.playerId.localeCompare(b.playerId));
}

export const costume: PhaseModule = {
  id: 'costume',
  durationSeconds: (config) => config.timers.costume_voting_seconds,
  action(context, playerId, action, data) {
    requireRule(action === 'vote', 'UNKNOWN_ACTION', 'Choose a costume to vote for.');
    const candidate = data.candidateId;
    requireRule(
      typeof candidate === 'string' &&
        context.store.players(context.room.id).some((p) => p.id === candidate),
      'INVALID_CANDIDATE',
      'Choose a player in this party.',
    );
    requireRule(
      context.config.costume.allow_self_vote || candidate !== playerId,
      'SELF_VOTE',
      'Choose another player.',
    );
    context.store.db
      .prepare(
        'INSERT INTO costume_votes(room_id,phase_instance,voter_id,candidate_id) VALUES(?,?,?,?) ON CONFLICT(room_id,phase_instance,voter_id) DO UPDATE SET candidate_id=excluded.candidate_id',
      )
      .run(context.room.id, context.room.phase_instance, playerId, candidate);
    return { votedFor: candidate };
  },
  assertCanAdvance(context) {
    requireRule(
      context.store.db
        .prepare('SELECT 1 FROM costume_reveals WHERE room_id=? AND phase_instance=?')
        .get(context.room.id, context.room.phase_instance),
      'REVEAL_REQUIRED',
      'Reveal costume results before advancing.',
    );
  },
};

/** Caller authorizes the host and executes this function in the command transaction. */
export function costumeHostAction(context: PhaseContext, action: string): Record<string, unknown> {
  requireRule(action === 'reveal', 'UNKNOWN_ACTION', 'Choose a costume host action.');
  requireRule(
    context.room.phase === 'costume' && context.room.status === 'closed',
    'ROUND_OPEN',
    'Close costume voting before revealing.',
  );
  const { store, room, now } = context;
  if (
    store.db
      .prepare('SELECT 1 FROM costume_reveals WHERE room_id=? AND phase_instance=?')
      .get(room.id, room.phase_instance)
  )
    return { revealed: true };
  const results = calculate(context);
  const insert = store.db.prepare(
    'INSERT INTO costume_results(room_id,phase_instance,player_id,place,votes,token_change) VALUES(?,?,?,?,?,?)',
  );
  for (const result of results) {
    if (result.tokenChange !== 0)
      store.adjust(
        room.id,
        result.playerId,
        `costume:${room.phase_instance}`,
        'Costume contest',
        { spendable: result.tokenChange, locked: 0, reserved: 0 },
        now,
      );
    insert.run(
      room.id,
      room.phase_instance,
      result.playerId,
      result.place,
      result.votes,
      result.tokenChange,
    );
  }
  store.db
    .prepare('INSERT INTO costume_reveals(room_id,phase_instance,revealed_at) VALUES(?,?,?)')
    .run(room.id, room.phase_instance, now);
  return { revealed: true };
}

/** Never use this as a common broadcast payload: invoke separately for each viewer role. */
export function costumeProjection(
  context: PhaseContext,
  role: 'host' | 'player' | 'display',
  playerId?: string,
): CostumeProjection {
  const { store, room } = context;
  const revealed = !!store.db
    .prepare('SELECT 1 FROM costume_reveals WHERE room_id=? AND phase_instance=?')
    .get(room.id, room.phase_instance);
  const voteCount = (
    store.db
      .prepare('SELECT COUNT(*) AS count FROM costume_votes WHERE room_id=? AND phase_instance=?')
      .get(room.id, room.phase_instance) as { count: number }
  ).count;
  const own =
    role === 'player' && playerId
      ? (store.db
          .prepare(
            'SELECT candidate_id FROM costume_votes WHERE room_id=? AND phase_instance=? AND voter_id=?',
          )
          .get(room.id, room.phase_instance, playerId) as { candidate_id: string } | undefined)
      : undefined;
  let results: CostumeResult[] | null = null;
  if (revealed)
    results = store.db
      .prepare(
        'SELECT r.player_id AS playerId,p.name,p.emoji,r.place,r.votes,r.token_change AS tokenChange FROM costume_results r JOIN players p ON p.id=r.player_id WHERE r.room_id=? AND r.phase_instance=? ORDER BY r.place,r.player_id',
      )
      .all(room.id, room.phase_instance) as unknown as CostumeResult[];
  else if (role === 'host') results = calculate(context);
  return {
    prizes: context.config.costume.prizes_per_player,
    lastPlacePenaltyPool: context.config.costume.last_place_penalty_pool_tokens,
    votedFor: own?.candidate_id ?? null,
    voteCount: role === 'host' || revealed ? voteCount : 0,
    revealed,
    results,
  };
}
