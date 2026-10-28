import { randomInt } from 'node:crypto';
import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';

/** The integration owner registers this schema in an ordered additive migration. */
export const TRIVIA_SCHEMA = `
CREATE TABLE IF NOT EXISTS trivia_state(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,question INTEGER NOT NULL DEFAULT 0,window INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'idle',winner_player TEXT,winner_team INTEGER,awards INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,phase_instance));
CREATE TABLE IF NOT EXISTS trivia_members(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),team INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,player_id));
CREATE TABLE IF NOT EXISTS trivia_exclusions(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,question INTEGER NOT NULL,team INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,question,team));
CREATE TABLE IF NOT EXISTS trivia_awards(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,request_id TEXT NOT NULL,team INTEGER NOT NULL,amount INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,request_id));`;

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
      return { awarded: true, teamId: team, amount };
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
      .prepare('UPDATE trivia_state SET awards=awards+1 WHERE room_id=? AND phase_instance=?')
      .run(room, phase);
    return { awarded: true, teamId: team, amount };
  }
  requireRule(false, 'UNKNOWN_ACTION', 'That host action is not part of trivia.');
}

/** Public-only projection: callers may send it to any room role. */
export function triviaProjection(c: PhaseContext, playerId?: string): TriviaProjection {
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
  };
}
