import { randomInt } from 'node:crypto';
import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';

/** The integration owner registers this schema in an ordered additive migration. */
export const TRIVIA_SCHEMA = `
CREATE TABLE IF NOT EXISTS trivia_state(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,question INTEGER NOT NULL DEFAULT 0,window INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'idle',winner_player TEXT,winner_team INTEGER,awards INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,phase_instance));
CREATE TABLE IF NOT EXISTS trivia_members(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),team INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,player_id));
CREATE TABLE IF NOT EXISTS trivia_exclusions(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,question INTEGER NOT NULL,team INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,question,team));
CREATE TABLE IF NOT EXISTS trivia_awards(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,request_id TEXT NOT NULL,team INTEGER NOT NULL,amount INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,request_id));`;

/** Additive metadata preserves earlier award rows and the append-only ledger. */
export const TRIVIA_RECEIPTS_SCHEMA = `CREATE TABLE IF NOT EXISTS trivia_award_receipts(
room_id TEXT NOT NULL,phase_instance INTEGER NOT NULL,award_id TEXT NOT NULL,
question INTEGER,created_at INTEGER,undone_at INTEGER,
PRIMARY KEY(room_id,phase_instance,award_id),
FOREIGN KEY(room_id,phase_instance,award_id) REFERENCES trivia_awards(room_id,phase_instance,request_id));`;

export type TriviaAward = {
  id: string;
  teamId: number;
  amount: number;
  question: number | null;
  undone: boolean;
};

type State = {
  question: number;
  window: number;
  status: 'idle' | 'armed' | 'locked';
  winner_player: string | null;
  winner_team: number | null;
  awards: number;
};
type Member = { player_id: string; team: number };
export type TriviaProjection = {
  teams: {
    id: number;
    name: string;
    color: string;
    members: { id: string; name: string; emoji: string }[];
    excluded: boolean;
  }[];
  question: number;
  windowId: number;
  status: State['status'];
  winner: { playerId: string; teamId: number } | null;
  ownTeamId: number | null;
  defaultTeamCount: number;
  /** Included only in authenticated host snapshots. */
  awardHistory?: TriviaAward[];
};
const colors = [
  '#8d2727',
  '#20568c',
  '#276641',
  '#755088',
  '#8a5a17',
  '#41656d',
  '#9b4365',
  '#655b36',
];
const state = (c: PhaseContext): State => {
  const row = c.store.db
    .prepare(
      'SELECT question,window,status,winner_player,winner_team,awards FROM trivia_state WHERE room_id=? AND phase_instance=?',
    )
    .get(c.room.id, c.room.phase_instance) as unknown as State | undefined;
  requireRule(row, 'TRIVIA_NOT_READY', 'Trivia is not ready.');
  return row;
};
const members = (c: PhaseContext): Member[] =>
  c.store.db
    .prepare(
      'SELECT player_id,team FROM trivia_members WHERE room_id=? AND phase_instance=? ORDER BY team,player_id',
    )
    .all(c.room.id, c.room.phase_instance) as unknown as Member[];

export function createTrivia(): PhaseModule {
  return {
    id: 'trivia',
    durationSeconds: () => null,
    open(c) {
      c.store.db
        .prepare('INSERT OR IGNORE INTO trivia_state(room_id,phase_instance) VALUES(?,?)')
        .run(c.room.id, c.room.phase_instance);
    },
    action(c, playerId, action, data) {
      requireRule(action === 'buzz', 'UNKNOWN_ACTION', 'That action is not part of trivia.');
      const current = state(c);
      requireRule(
        typeof data.windowId === 'number' &&
          Number.isSafeInteger(data.windowId) &&
          data.windowId === current.window,
        'STALE_WINDOW',
        'That buzzer window has ended.',
        409,
      );
      requireRule(current.status === 'armed', 'BUZZER_CLOSED', 'The buzzer is closed.');
      const team = members(c).find((m) => m.player_id === playerId)?.team;
      requireRule(team !== undefined, 'TEAM_REQUIRED', 'Wait for your team assignment.');
      requireRule(
        !c.store.db
          .prepare(
            'SELECT 1 FROM trivia_exclusions WHERE room_id=? AND phase_instance=? AND question=? AND team=?',
          )
          .get(c.room.id, c.room.phase_instance, current.question, team),
        'TEAM_EXCLUDED',
        'Your team cannot buzz again on this question.',
      );
      const result = c.store.db
        .prepare(
          "UPDATE trivia_state SET status='locked',winner_player=?,winner_team=? WHERE room_id=? AND phase_instance=? AND window=? AND status='armed'",
        )
        .run(playerId, team, c.room.id, c.room.phase_instance, current.window);
      requireRule(result.changes === 1, 'BUZZER_CLOSED', 'Another player buzzed first.');
      return { accepted: true, windowId: current.window };
    },
    close(c) {
      c.store.db
        .prepare(
          "UPDATE trivia_state SET status='idle' WHERE room_id=? AND phase_instance=? AND status='armed'",
        )
        .run(c.room.id, c.room.phase_instance);
    },
    assertCanAdvance(c) {
      requireRule(state(c).status !== 'armed', 'BUZZER_OPEN', 'Close the buzzer before advancing.');
    },
  };
}
export const trivia = createTrivia();

/** Host dispatch must be authorized and run inside the core command transaction. */
export function triviaHostAction(
  c: PhaseContext,
  action: string,
  data: Record<string, unknown>,
  requestId: string,
  random: (upperExclusive: number) => number = randomInt,
): Record<string, unknown> {
  const current = state(c);
  const room = c.room.id;
  const phase = c.room.phase_instance;
  if (action === 'assign') {
    const count = data.count;
    const players = c.store.players(room);
    requireRule(
      typeof count === 'number' &&
        Number.isSafeInteger(count) &&
        count >= 1 &&
        count <= players.length,
      'INVALID_TEAMS',
      'Choose between one and the number of joined players.',
    );
    requireRule(
      current.question === 0 && current.awards === 0,
      'TEAMS_FROZEN',
      'Teams are frozen after questions or awards begin.',
    );
    const shuffled = players.map((p) => p.id);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = random(i + 1);
      requireRule(
        Number.isInteger(j) && j >= 0 && j <= i,
        'INVALID_RANDOM',
        'Invalid random sample.',
      );
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    c.store.db
      .prepare('DELETE FROM trivia_members WHERE room_id=? AND phase_instance=?')
      .run(room, phase);
    const insert = c.store.db.prepare(
      'INSERT INTO trivia_members(room_id,phase_instance,player_id,team) VALUES(?,?,?,?)',
    );
    shuffled.forEach((id, index) => insert.run(room, phase, id, (index % count) + 1));
    return { assigned: true, count };
  }
  if (action === 'new-question') {
    requireRule(members(c).length > 0, 'TEAM_REQUIRED', 'Assign teams first.');
    requireRule(current.status !== 'armed', 'BUZZER_OPEN', 'Close the buzzer first.');
    c.store.db
      .prepare(
        "UPDATE trivia_state SET question=question+1,status='idle',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
      )
      .run(room, phase);
    return { question: current.question + 1 };
  }
  if (action === 'arm') {
    requireRule(
      current.question > 0 && current.status === 'idle',
      'INVALID_BUZZER',
      'Start a question or reopen the buzzer first.',
    );
    c.store.db
      .prepare(
        "UPDATE trivia_state SET window=window+1,status='armed',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
      )
      .run(room, phase);
    return { windowId: current.window + 1 };
  }
  if (action === 'close-buzzer') {
    requireRule(current.status === 'armed', 'INVALID_BUZZER', 'The buzzer is not open.');
    c.store.db
      .prepare("UPDATE trivia_state SET status='idle' WHERE room_id=? AND phase_instance=?")
      .run(room, phase);
    return { closed: true };
  }
  if (action === 'incorrect') {
    requireRule(
      current.status === 'locked' && current.winner_team !== null,
      'INVALID_BUZZER',
      'There is no buzz to judge.',
    );
    if (c.config.trivia.exclude_incorrect_teams_for_question)
      c.store.db
        .prepare('INSERT OR IGNORE INTO trivia_exclusions VALUES(?,?,?,?)')
        .run(room, phase, current.question, current.winner_team);
    c.store.db
      .prepare(
        "UPDATE trivia_state SET status='idle',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
      )
      .run(room, phase);
    return { reopened: true };
  }
  if (action === 'award') {
    const team = data.teamId;
    const amount = data.amount;
    requireRule(
      typeof team === 'number' &&
        Number.isSafeInteger(team) &&
        typeof amount === 'number' &&
        Number.isSafeInteger(amount) &&
        amount > 0,
      'INVALID_AWARD',
      'Choose a team and positive whole-token award.',
    );
    const teamMembers = members(c).filter((m) => m.team === team);
    requireRule(teamMembers.length > 0, 'INVALID_TEAM', 'Choose an assigned team.');
    const saved = c.store.db
      .prepare(
        'SELECT team,amount FROM trivia_awards WHERE room_id=? AND phase_instance=? AND request_id=?',
      )
      .get(room, phase, requestId) as { team: number; amount: number } | undefined;
    if (saved) {
      requireRule(
        saved.team === team && saved.amount === amount,
        'REQUEST_CONFLICT',
        'This award request was already used differently.',
        409,
      );
      return { awarded: true, teamId: team, amount, awardId: requestId };
    }
    for (const member of teamMembers)
      c.store.adjust(
        room,
        member.player_id,
        `trivia:${phase}:${requestId}`,
        'Trivia team award',
        { spendable: amount, locked: 0, reserved: 0 },
        c.now,
      );
    c.store.db
      .prepare('INSERT INTO trivia_awards VALUES(?,?,?,?,?)')
      .run(room, phase, requestId, team, amount);
    c.store.db
      .prepare('INSERT INTO trivia_award_receipts VALUES(?,?,?,?,?,NULL)')
      .run(room, phase, requestId, current.question, c.now);
    c.store.db
      .prepare('UPDATE trivia_state SET awards=awards+1 WHERE room_id=? AND phase_instance=?')
      .run(room, phase);
    return { awarded: true, teamId: team, amount, awardId: requestId };
  }
  if (action === 'undo-award') {
    const awardId = data.awardId;
    requireRule(
      typeof awardId === 'string' && awardId.length <= 100,
      'INVALID_AWARD',
      'Choose a saved award to undo.',
    );
    const award = c.store.db
      .prepare(
        `SELECT a.team,a.amount,r.undone_at
      FROM trivia_awards a LEFT JOIN trivia_award_receipts r
      ON r.room_id=a.room_id AND r.phase_instance=a.phase_instance AND r.award_id=a.request_id
      WHERE a.room_id=? AND a.phase_instance=? AND a.request_id=?`,
      )
      .get(room, phase, awardId) as
      { team: number; amount: number; undone_at: number | null } | undefined;
    requireRule(
      award,
      'AWARD_NOT_FOUND',
      'This award does not belong to the current trivia round.',
    );
    if (award.undone_at !== null) return { undone: true, awardId };
    const recipients = members(c).filter((m) => m.team === award.team);
    requireRule(recipients.length > 0, 'INVALID_TEAM', 'The original team is unavailable.');
    for (const member of recipients)
      c.store.adjust(
        room,
        member.player_id,
        `trivia-undo:${phase}:${awardId}`,
        'Undo trivia team award',
        { spendable: -award.amount, locked: 0, reserved: 0 },
        c.now,
      );
    c.store.db
      .prepare(
        `INSERT INTO trivia_award_receipts(room_id,phase_instance,award_id,undone_at)
      VALUES(?,?,?,?) ON CONFLICT(room_id,phase_instance,award_id) DO UPDATE SET undone_at=excluded.undone_at`,
      )
      .run(room, phase, awardId, c.now);
    return { undone: true, awardId };
  }
  requireRule(false, 'UNKNOWN_ACTION', 'That host action is not part of trivia.');
}

/** Public-only projection: callers may send it to any room role. */
export function triviaProjection(
  c: PhaseContext,
  playerId?: string,
  includeAwards = false,
): TriviaProjection {
  const current = state(c);
  const all = members(c);
  const players = c.store.players(c.room.id);
  const excluded = new Set(
    (
      c.store.db
        .prepare(
          'SELECT team FROM trivia_exclusions WHERE room_id=? AND phase_instance=? AND question=?',
        )
        .all(c.room.id, c.room.phase_instance, current.question) as { team: number }[]
    ).map((r) => r.team),
  );
  const ids = [...new Set(all.map((m) => m.team))].sort((a, b) => a - b);
  return {
    teams: ids.map((id) => ({
      id,
      name: `Team ${id}`,
      color: colors[(id - 1) % colors.length],
      members: all
        .filter((m) => m.team === id)
        .map((m) => {
          const p = players.find((p) => p.id === m.player_id)!;
          return { id: p.id, name: p.name, emoji: p.emoji };
        }),
      excluded: excluded.has(id),
    })),
    question: current.question,
    windowId: current.window,
    status: current.status,
    winner:
      current.winner_player && current.winner_team !== null
        ? { playerId: current.winner_player, teamId: current.winner_team }
        : null,
    ownTeamId: playerId ? (all.find((m) => m.player_id === playerId)?.team ?? null) : null,
    defaultTeamCount: Math.min(c.config.trivia.default_team_count, players.length),
    ...(includeAwards ? { awardHistory: triviaAwardHistory(c) } : {}),
  };
}

function triviaAwardHistory(c: PhaseContext): TriviaAward[] {
  const rows = c.store.db
    .prepare(
      `SELECT a.request_id AS id,a.team AS teamId,a.amount,r.question,r.undone_at
    FROM trivia_awards a LEFT JOIN trivia_award_receipts r
    ON r.room_id=a.room_id AND r.phase_instance=a.phase_instance AND r.award_id=a.request_id
    WHERE a.room_id=? AND a.phase_instance=? ORDER BY a.rowid DESC`,
    )
    .all(c.room.id, c.room.phase_instance) as unknown as (Omit<TriviaAward, 'undone'> & {
    undone_at: number | null;
  })[];
  return rows.map(({ undone_at, ...award }) => ({ ...award, undone: undone_at !== null }));
}
