import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';
import type { Stage } from '../../shared/contracts.js';

/** The integration owner installs these tables in an ordered shared migration. */
export const costumeSchema = `
CREATE TABLE IF NOT EXISTS costume_votes (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  voter_id TEXT NOT NULL REFERENCES players(id), candidate_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY(room_id, phase_instance, voter_id)
);
CREATE TABLE IF NOT EXISTS costume_locks (
  room_id TEXT NOT NULL REFERENCES rooms(id), phase_instance INTEGER NOT NULL,
  locked_at INTEGER NOT NULL, PRIMARY KEY(room_id, phase_instance)
);
CREATE TABLE IF NOT EXISTS costume_reveal_progress (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id), step INTEGER NOT NULL
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
  /** Voting is over and the standings are fixed; winners are announced later in the costume reveal stage. */
  locked: boolean;
  /** Host only: the private standings. Everyone else sees results in the costume reveal stage. */
  results: CostumeResult[] | null;
  /** 1 for the first vote; higher when a tie for first has been sent to a re-vote. */
  round: number;
  /** The players still in contention during a re-vote; null while everyone is a candidate. */
  candidates: { playerId: string; name: string; emoji: string }[] | null;
  /** Host only: players currently tied for first, who must be re-voted before results. */
  tiedForFirst: string[];
}

function storedResults(context: PhaseContext, phaseInstance: number): CostumeResult[] {
  return context.store.db
    .prepare(
      'SELECT r.player_id AS playerId,p.name,p.emoji,r.place,r.votes,r.token_change AS tokenChange FROM costume_results r JOIN players p ON p.id=r.player_id WHERE r.room_id=? AND r.phase_instance=? ORDER BY r.place,r.player_id',
    )
    .all(context.room.id, phaseInstance) as unknown as CostumeResult[];
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
        .prepare('SELECT 1 FROM costume_locks WHERE room_id=? AND phase_instance=?')
        .get(context.room.id, context.room.phase_instance),
      'LOCK_REQUIRED',
      'Lock costume results before advancing.',
    );
  },
};

/** Caller authorizes the host and executes this function in the command transaction. */
export function costumeHostAction(context: PhaseContext, action: string): Record<string, unknown> {
  requireRule(
    action === 'lock' || action === 'revote',
    'UNKNOWN_ACTION',
    'Choose a costume host action.',
  );
  requireRule(
    context.room.phase === 'costume' && context.room.status === 'closed',
    'ROUND_OPEN',
    'Close costume voting before locking results.',
  );
  const { store, room, now } = context;
  const locked = store.db
    .prepare('SELECT 1 FROM costume_locks WHERE room_id=? AND phase_instance=?')
    .get(room.id, room.phase_instance);
  if (action === 'revote') {
    requireRule(!locked, 'ALREADY_LOCKED', 'Results are already locked.');
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
  if (locked) return { locked: true };
  requireRule(
    tiedForFirst(context).length === 0,
    'TIE_FOR_FIRST',
    'Players are tied for first. Start a re-vote before locking results.',
  );
  const results = calculate(context);
  const insert = store.db.prepare(
    'INSERT INTO costume_results(room_id,phase_instance,player_id,place,votes,token_change) VALUES(?,?,?,?,?,?)',
  );
  // Tokens move later, one reveal step at a time, so locking never changes a balance.
  for (const result of results)
    insert.run(
      room.id,
      room.phase_instance,
      result.playerId,
      result.place,
      result.votes,
      result.tokenChange,
    );
  store.db
    .prepare('INSERT INTO costume_locks(room_id,phase_instance,locked_at) VALUES(?,?,?)')
    .run(room.id, room.phase_instance, now);
  return { locked: true };
}

/** Never use this as a common broadcast payload: invoke separately for each viewer role. */
export function costumeProjection(
  context: PhaseContext,
  role: 'host' | 'player' | 'display',
  playerId?: string,
): CostumeProjection {
  const { store, room } = context;
  const locked = !!store.db
    .prepare('SELECT 1 FROM costume_locks WHERE room_id=? AND phase_instance=?')
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
  if (role === 'host')
    results = locked ? storedResults(context, room.phase_instance) : calculate(context);
  return {
    prizes: context.config.costume.prizes_per_player,
    lastPlacePenaltyPool: context.config.costume.last_place_penalty_pool_tokens,
    votedFor: own?.candidate_id ?? null,
    voteCount: role === 'host' ? voteCount : 0,
    locked,
    results,
    round,
    candidates: candidates
      ? store
          .players(room.id)
          .filter((p) => candidates.includes(p.id))
          .map((p) => ({ playerId: p.id, name: p.name, emoji: p.emoji }))
      : null,
    tiedForFirst: role === 'host' && !locked ? tiedForFirst(context) : [],
  };
}

export type CostumeRevealKind = 'third' | 'second' | 'last' | 'first' | 'all';
export interface CostumeRevealGroup {
  kind: CostumeRevealKind;
  players: CostumeResult[];
}
export interface CostumeRevealProjection {
  /** Groups announced so far, in reveal order. */
  revealed: CostumeRevealGroup[];
  /** Host only: the groups still to come, in order. */
  upcoming: CostumeRevealGroup[];
  step: number;
  /** Every place announced, plus one final step that shows the full list when there are several places. */
  totalSteps: number;
  /** The full standings, shown once the host has taken the last step. Null before then. */
  list: CostumeResult[] | null;
  /** Host only: every place is announced and the next click shows the full list. */
  listPending: boolean;
}

/**
 * Reveal order is 3rd, 2nd, last place, then 1st. Ties share a step and empty steps are
 * skipped. With fewer than 3 players there is one step that shows everyone.
 */
export function costumeRevealGroups(results: CostumeResult[]): CostumeRevealGroup[] {
  if (!results.length) return [];
  if (results.length < 3) return [{ kind: 'all', players: results }];
  const maxPlace = Math.max(...results.map((r) => r.place));
  const at = (place: number) => results.filter((r) => r.place === place);
  const last = maxPlace > 3 ? at(maxPlace) : [];
  // Only places 1-3 win tokens (the config requires exactly those prizes) and only the bottom group
  // loses them, so players in between have nothing to announce.
  const groups: CostumeRevealGroup[] = [
    { kind: 'third', players: at(3) },
    { kind: 'second', players: at(2) },
    { kind: 'last', players: last },
    { kind: 'first', players: at(1) },
  ];
  return groups.filter((g) => g.players.length > 0);
}

function lockedInstance(context: PhaseContext): number | null {
  const row = context.store.db
    .prepare(
      'SELECT phase_instance FROM costume_locks WHERE room_id=? ORDER BY phase_instance DESC LIMIT 1',
    )
    .get(context.room.id) as { phase_instance: number } | undefined;
  return row?.phase_instance ?? null;
}
function revealStep(context: PhaseContext): number {
  const row = context.store.db
    .prepare('SELECT step FROM costume_reveal_progress WHERE room_id=?')
    .get(context.room.id) as { step: number } | undefined;
  return row?.step ?? 0;
}
function lockedGroups(context: PhaseContext): {
  instance: number | null;
  groups: CostumeRevealGroup[];
  results: CostumeResult[];
  /** One extra step after the last place shows everyone; a single group already does. */
  hasList: boolean;
} {
  const instance = lockedInstance(context);
  const results = instance === null ? [] : storedResults(context, instance);
  const groups = costumeRevealGroups(results);
  return { instance, groups, results, hasList: groups.length > 1 };
}

export const costumeReveal: PhaseModule = {
  id: 'costume-reveal' as Stage,
  durationSeconds: () => null,
  action() {
    requireRule(false, 'INVALID_PHASE', 'The host announces the winners.');
    return {};
  },
  assertCanAdvance(context) {
    requireRule(
      revealStep(context) >=
        (({ groups, hasList }) => groups.length + (hasList ? 1 : 0))(lockedGroups(context)),
      'REVEAL_REQUIRED',
      'Reveal every costume place before advancing.',
    );
  },
};

/** Caller authorizes the host and executes this function in the command transaction. */
export function costumeRevealHostAction(
  context: PhaseContext,
  action: string,
  expectedStep?: unknown,
): Record<string, unknown> {
  requireRule(action === 'next', 'UNKNOWN_ACTION', 'Choose a costume reveal action.');
  const { store, room, now } = context;
  const { instance, groups, hasList } = lockedGroups(context);
  const total = groups.length + (hasList ? 1 : 0);
  const step = revealStep(context);
  // A second tap or tab carries the step it saw, so it can never announce an extra place.
  requireRule(
    expectedStep === undefined || expectedStep === step,
    'STALE_STEP',
    'That place was already announced. Your screen has been refreshed.',
    409,
  );
  if (instance === null || step >= total) return { done: true, step };
  const progress = store.db.prepare(
    'INSERT INTO costume_reveal_progress(room_id,step) VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET step=excluded.step',
  );
  if (step >= groups.length) {
    // The full list only displays what was already announced; no tokens move.
    progress.run(room.id, step + 1);
    return { step: step + 1, kind: 'list', done: true };
  }
  const group = groups[step]!;
  const update = store.db.prepare(
    'UPDATE costume_results SET token_change=? WHERE room_id=? AND phase_instance=? AND player_id=?',
  );
  const pool = context.config.costume.last_place_penalty_pool_tokens;
  for (const player of group.players) {
    let change = player.tokenChange;
    if (group.kind === 'last') {
      // The penalty can only take what the player still has when their place is announced.
      const spendable = store.players(room.id).find((p) => p.id === player.playerId)!.spendable;
      change = -Math.min(spendable, Math.floor(pool / group.players.length));
      update.run(change, room.id, instance, player.playerId);
    }
    if (change !== 0)
      store.adjust(
        room.id,
        player.playerId,
        `costume:${instance}`,
        'Costume contest',
        { spendable: change, locked: 0, reserved: 0 },
        now,
        'costume',
      );
  }
  progress.run(room.id, step + 1);
  return { step: step + 1, kind: group.kind, done: step + 1 >= total };
}

/** Never use this as a common broadcast payload: invoke separately for each viewer role. */
export function costumeRevealProjection(
  context: PhaseContext,
  role: 'host' | 'player' | 'display',
): CostumeRevealProjection {
  const { groups, results, hasList } = lockedGroups(context);
  const step = revealStep(context);
  return {
    revealed: groups.slice(0, step),
    upcoming: role === 'host' ? groups.slice(step) : [],
    step,
    totalSteps: groups.length + (hasList ? 1 : 0),
    list: hasList && step > groups.length ? results : null,
    listPending: role === 'host' && hasList && step === groups.length,
  };
}
