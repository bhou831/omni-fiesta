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
  /** 1 for the first vote; higher when a tie for first has been sent to a re-vote. */
  round: number;
  /** The players still in contention during a re-vote; null while everyone is a candidate. */
  candidates: { playerId: string; name: string; emoji: string }[] | null;
  /** Host only: players currently tied for first, who must be re-voted before results. */
  tiedForFirst: string[];
}

function currentRound(context: PhaseContext): { round: number; candidates: string[] | null } {
  const row = context.store.db
    .prepare(
      'SELECT round,candidates FROM costume_rounds WHERE room_id=? AND phase_instance=? ORDER BY round DESC LIMIT 1',
    )
    .get(context.room.id, context.room.phase_instance) as
    { round: number; candidates: string } | undefined;
  return row
    ? { round: row.round, candidates: JSON.parse(row.candidates) as string[] }
    : { round: 1, candidates: null };
}
function roundCounts(context: PhaseContext, round: number): Map<string, number> {
  const rows = context.store.db
    .prepare(
      'SELECT candidate_id, count(*) AS count FROM costume_votes WHERE room_id=? AND phase_instance=? AND round=? GROUP BY candidate_id',
    )
    .all(context.room.id, context.room.phase_instance, round) as unknown as {
    candidate_id: string;
    count: number;
  }[];
  return new Map(rows.map((r) => [r.candidate_id, r.count]));
}
/** Players sharing the most votes in the current round, or none when one player leads (or nobody voted). */
function tiedForFirst(context: PhaseContext): string[] {
  const { round, candidates } = currentRound(context);
  const counts = roundCounts(context, round);
  const pool = candidates ?? context.store.players(context.room.id).map((p) => p.id);
  const top = Math.max(0, ...pool.map((id) => counts.get(id) ?? 0));
  const tied = pool.filter((id) => (counts.get(id) ?? 0) === top);
  return top > 0 && tied.length > 1 ? tied : [];
}

/**
 * Standing is each round's vote count in order, so a re-vote only orders players who were
 * tied before it; place is the dense rank of those vectors.
 */
function calculate(context: PhaseContext): CostumeResult[] {
  const { store, room, config } = context;
  const players = store.players(room.id);
  const { round } = currentRound(context);
  const perRound = Array.from({ length: round }, (_, i) => roundCounts(context, i + 1));
  const rounds = store.db
    .prepare(
      'SELECT round,candidates FROM costume_rounds WHERE room_id=? AND phase_instance=? ORDER BY round',
    )
    .all(room.id, room.phase_instance) as unknown as { round: number; candidates: string }[];
  // Shown votes are those from the last round a player took part in, so a re-vote winner shows the re-vote count.
  const lastRound = (id: string) =>
    rounds.reduce((last, r) => (JSON.parse(r.candidates).includes(id) ? r.round : last), 1);
  const vector = (id: string) => perRound.map((counts) => counts.get(id) ?? 0);
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i]! - a[i]!;
    return 0;
  };
  const key = (v: number[]) => v.join(',');
  const groups = [...new Map(players.map((p) => [key(vector(p.id)), vector(p.id)])).values()].sort(
    compare,
  );
  const total = perRound.reduce(
    (sum, counts) => sum + [...counts.values()].reduce((a, b) => a + b, 0),
    0,
  );
  const bottom = groups.at(-1) ? key(groups.at(-1)!) : '';
  const bottomSize = players.filter((p) => key(vector(p.id)) === bottom).length;
  return players
    .map((p) => {
      const v = vector(p.id);
      const place = groups.findIndex((g) => key(g) === key(v)) + 1;
      const prize = total
        ? (config.costume.prizes_per_player.find((prize) => prize.place === place)?.tokens ?? 0)
        : 0;
      const penalty =
        total && key(v) === bottom && !prize && place > 3
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
        votes: v[lastRound(p.id) - 1] ?? 0,
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
    const { round, candidates } = currentRound(context);
    requireRule(
      !candidates || candidates.includes(candidate as string),
      'NOT_IN_REVOTE',
      'Choose one of the players tied for first.',
    );
    context.store.db
      .prepare(
        'INSERT INTO costume_votes(room_id,phase_instance,round,voter_id,candidate_id) VALUES(?,?,?,?,?) ON CONFLICT(room_id,phase_instance,round,voter_id) DO UPDATE SET candidate_id=excluded.candidate_id',
      )
      .run(context.room.id, context.room.phase_instance, round, playerId, candidate);
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
  requireRule(
    action === 'reveal' || action === 'revote',
    'UNKNOWN_ACTION',
    'Choose a costume host action.',
  );
  requireRule(
    context.room.phase === 'costume' && context.room.status === 'closed',
    'ROUND_OPEN',
    'Close costume voting before revealing.',
  );
  const { store, room, now } = context;
  const revealed = store.db
    .prepare('SELECT 1 FROM costume_reveals WHERE room_id=? AND phase_instance=?')
    .get(room.id, room.phase_instance);
  if (action === 'revote') {
    requireRule(!revealed, 'ALREADY_REVEALED', 'Results are already revealed.');
    const tied = tiedForFirst(context);
    requireRule(tied.length > 1, 'NO_TIE', 'No one is tied for first place.');
    const round = currentRound(context).round + 1;
    store.db
      .prepare(
        'INSERT INTO costume_rounds(room_id,phase_instance,round,candidates) VALUES(?,?,?,?)',
      )
      .run(room.id, room.phase_instance, round, JSON.stringify(tied));
    const seconds = context.config.timers.costume_voting_seconds;
    store.db
      .prepare("UPDATE rooms SET status='open',opened_at=?,deadline_at=? WHERE id=?")
      .run(now, now + seconds * 1000, room.id);
    return { round, candidates: tied };
  }
  if (revealed) return { revealed: true };
  requireRule(
    tiedForFirst(context).length === 0,
    'TIE_FOR_FIRST',
    'Players are tied for first. Start a re-vote before revealing.',
  );
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
  const { round, candidates } = currentRound(context);
  const voteCount = (
    store.db
      .prepare(
        'SELECT COUNT(*) AS count FROM costume_votes WHERE room_id=? AND phase_instance=? AND round=?',
      )
      .get(room.id, room.phase_instance, round) as { count: number }
  ).count;
  const own =
    role === 'player' && playerId
      ? (store.db
          .prepare(
            'SELECT candidate_id FROM costume_votes WHERE room_id=? AND phase_instance=? AND round=? AND voter_id=?',
          )
          .get(room.id, room.phase_instance, round, playerId) as
          { candidate_id: string } | undefined)
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
    round,
    candidates: candidates
      ? store
          .players(room.id)
          .filter((p) => candidates.includes(p.id))
          .map((p) => ({ playerId: p.id, name: p.name, emoji: p.emoji }))
      : null,
    tiedForFirst: role === 'host' && !revealed ? tiedForFirst(context) : [],
  };
}
