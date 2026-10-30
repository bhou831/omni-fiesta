import {
  createTriviaContent,
  eventTriviaBankFile,
  triviaContentForMode,
  type TriviaContent,
} from './trivia-content.js';
import { existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import type { PhaseContext, PhaseModule } from '../core/phases.js';
import { requireRule } from '../core/errors.js';
import {
  createAdventure,
  draw,
  getAdventure,
  isCharades,
  isYesNo,
  projectAdventure,
  remaining,
  saveAdventure,
  settings,
  type AdventureProjection,
  type AdventureState,
} from './trivia-adventure.js';

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

export const TRIVIA_BOARD_SCHEMA = `
CREATE TABLE IF NOT EXISTS trivia_boards(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,content TEXT NOT NULL,selected_cell TEXT,revealed INTEGER NOT NULL DEFAULT 0,begun INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,phase_instance));
CREATE TABLE IF NOT EXISTS trivia_cells(room_id TEXT NOT NULL,phase_instance INTEGER NOT NULL,cell_id TEXT NOT NULL,question INTEGER NOT NULL,completed_at INTEGER,PRIMARY KEY(room_id,phase_instance,cell_id),FOREIGN KEY(room_id,phase_instance) REFERENCES trivia_boards(room_id,phase_instance));
CREATE TABLE IF NOT EXISTS trivia_cell_awards(room_id TEXT NOT NULL,phase_instance INTEGER NOT NULL,award_id TEXT NOT NULL,cell_id TEXT NOT NULL,PRIMARY KEY(room_id,phase_instance,award_id),FOREIGN KEY(room_id,phase_instance,award_id) REFERENCES trivia_awards(room_id,phase_instance,request_id));`;
type BoardRow = { content: string; selected_cell: string | null; revealed: number; begun: number };
const boardState = (c: PhaseContext) =>
  c.store.db
    .prepare('SELECT * FROM trivia_boards WHERE room_id=? AND phase_instance=?')
    .get(c.room.id, c.room.phase_instance) as BoardRow | undefined;
const contentOf = (board: BoardRow): TriviaContent => JSON.parse(board.content);
export type TriviaBoard = {
  version: string;
  categories: { id: string; name: string }[];
  cells: { id: string; categoryId: string; value: number; used: boolean; available: boolean }[];
  selected: {
    id: string;
    categoryId: string;
    value: number;
    publicPrompt: string;
    answer?: string;
    hostNotes?: string;
    kind?: TriviaContent['cells'][number]['kind'];
    musicClip?: { start: number; end: number };
    musicStoreUrl?: string;
    musicTrack?: {
      trackId: number;
      title: string;
      artist: string;
      album: string;
      storeUrl: string;
    };
    musicPlayback?: { playing: boolean; position: number; changedAt: number };
  } | null;
  revealed: boolean;
  started: boolean;
  canCancel: boolean;
  /** Host-only review data; never sent to the TV or phones. */
  review?: {
    id: string;
    value: number;
    categoryId: string;
    reason: string;
    musicCandidates?: string[];
  }[];
};
export type TriviaAward = {
  id: string;
  teamId: number;
  amount: number;
  question: number | null;
  undone: boolean;
  cellId?: string | null;
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
    score?: number;
  }[];
  question: number;
  windowId: number;
  status: State['status'];
  winner: { playerId: string; teamId: number } | null;
  ownTeamId: number | null;
  defaultTeamCount: number;
  bankLabel?: string;
  demo?: boolean;
  /** Only the host receives switching availability. */
  bankSwitch?: { allowed: boolean; eventAvailable: boolean };
  /** Included only in authenticated host snapshots. */
  awardHistory?: TriviaAward[];
  board?: TriviaBoard;
  adventure?: AdventureProjection;
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
      const inserted = c.store.db
        .prepare('INSERT OR IGNORE INTO trivia_state(room_id,phase_instance) VALUES(?,?)')
        .run(c.room.id, c.room.phase_instance);
      if (inserted.changes && c.config.trivia.board_values) {
        const content = createTriviaContent(c.config.trivia.board_values);
        c.store.db
          .prepare('INSERT INTO trivia_boards(room_id,phase_instance,content) VALUES(?,?,?)')
          .run(c.room.id, c.room.phase_instance, JSON.stringify(content));
      }
    },
    action(c, playerId, action, data) {
      requireRule(action === 'buzz', 'UNKNOWN_ACTION', 'That action is not part of trivia.');
      const current = state(c);
      requireRule(
        typeof data.windowId === 'number' &&
          Number.isSafeInteger(data.windowId) &&
          data.windowId === current.window,
        'STALE_WINDOW',
        '此抢答轮次已结束，请等待主持人。',
        409,
      );
      requireRule(current.status === 'armed', 'BUZZER_CLOSED', '抢答已关闭。');
      const team = members(c).find((m) => m.player_id === playerId)?.team;
      requireRule(team !== undefined, 'TEAM_REQUIRED', 'Wait for your team assignment.');
      requireRule(
        !c.store.db
          .prepare(
            'SELECT 1 FROM trivia_exclusions WHERE room_id=? AND phase_instance=? AND question=? AND team=?',
          )
          .get(c.room.id, c.room.phase_instance, current.question, team),
        'TEAM_EXCLUDED',
        '本队本题已答错，请等待下一题。',
      );
      const result = c.store.db
        .prepare(
          "UPDATE trivia_state SET status='locked',winner_player=?,winner_team=? WHERE room_id=? AND phase_instance=? AND window=? AND status='armed'",
        )
        .run(playerId, team, c.room.id, c.room.phase_instance, current.window);
      requireRule(result.changes === 1, 'BUZZER_CLOSED', '其他玩家已先抢到。');
      c.store.db
        .prepare('UPDATE trivia_boards SET begun=1 WHERE room_id=? AND phase_instance=?')
        .run(c.room.id, c.room.phase_instance);
      const board = boardState(c);
      const adventure = getAdventure(c, board?.selected_cell ?? null);
      if (adventure) {
        requireRule(
          adventure.phase === 'waiting' || adventure.phase === 'steal',
          'INVALID_ADVENTURE',
          '挑战尚未开放抢答。',
        );
        adventure.phase = 'rules';
        adventure.teamId = team;
        if (adventure.attempt === 1) adventure.firstTeamId = team;
        saveAdventure(c, adventure);
      }
      return { accepted: true, windowId: current.window };
    },
    close(c) {
      requireRule(
        !boardState(c)?.selected_cell,
        'CELL_UNFINISHED',
        '请先完成当前题目，再结束本轮。',
      );
      c.store.db
        .prepare(
          "UPDATE trivia_state SET status='idle' WHERE room_id=? AND phase_instance=? AND status='armed'",
        )
        .run(c.room.id, c.room.phase_instance);
    },
    assertCanAdvance(c) {
      requireRule(
        !boardState(c)?.selected_cell,
        'CELL_UNFINISHED',
        '请先完成当前题目，再进入下一轮。',
      );
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
  const board = boardState(c);
  const content = board ? contentOf(board) : undefined;
  const selected = content?.cells.find((cell) => cell.id === board?.selected_cell);
  const adventure = getAdventure(c, board?.selected_cell ?? null);
  const selectedAction = [
    'cancel-selection',
    'music-start',
    'music-stop',
    'arm',
    'close-buzzer',
    'incorrect',
    'reveal-answer',
    'finish-cell',
    'adventure-start',
    'adventure-correct',
    'adventure-skip',
    'adventure-success',
    'adventure-fail',
    'adventure-replace',
    'adventure-score',
    'adventure-steal',
    'adventure-abort',
    'adventure-choose-team',
    'adventure-display-prompt',
    'adventure-award',
    'adventure-finish-cell',
  ].includes(action);
  if (board && selectedAction)
    requireRule(
      selected && data.cellId === selected.id,
      'STALE_CELL',
      '题目已变更，请刷新后重试。',
      409,
    );
  const activeAward = (cellId: string) =>
    c.store.db
      .prepare(
        `SELECT 1 FROM trivia_cell_awards b LEFT JOIN trivia_award_receipts r ON r.room_id=b.room_id AND r.phase_instance=b.phase_instance AND r.award_id=b.award_id WHERE b.room_id=? AND b.phase_instance=? AND b.cell_id=? AND r.undone_at IS NULL`,
      )
      .get(room, phase, cellId);
  if (action.startsWith('adventure-')) {
    requireRule(adventure && selected, 'ADVENTURE_REQUIRED', '请先选择大冒险题目。');
    requireRule(data.attempt === adventure.attempt, 'STALE_ATTEMPT', '挑战轮次已变更。', 409);
    const a = adventure;
    if (action === 'adventure-finish-cell') {
      if (a.phase !== 'won' && a.phase !== 'closed')
        triviaHostAction(
          c,
          'adventure-abort',
          { cellId: a.cellId, attempt: a.attempt },
          requestId,
          random,
        );
      return triviaHostAction(c, 'finish-cell', { cellId: a.cellId }, requestId, random);
    }
    if (action === 'adventure-choose-team') {
      requireRule(
        a.phase === 'waiting' && a.attempt === 1,
        'INVALID_ADVENTURE',
        '首轮队伍已经确定。',
      );
      requireRule(
        typeof data.teamId === 'number' && members(c).some((m) => m.team === data.teamId),
        'INVALID_TEAM',
        '请选择已分配的队伍。',
      );
      a.teamId = data.teamId;
      a.firstTeamId = data.teamId;
      a.phase = 'rules';
      saveAdventure(c, a);
      return { teamId: a.teamId };
    }
    if (action === 'adventure-display-prompt') {
      requireRule(
        isYesNo(a) && a.phase !== 'closed',
        'INVALID_ADVENTURE',
        '只能控制 Yes or No 的题目显示。',
      );
      requireRule(typeof data.visible === 'boolean', 'INVALID_DISPLAY', '请选择显示或隐藏。');
      a.displayPrompt = data.visible;
      saveAdventure(c, a);
      return { visible: a.displayPrompt };
    }
    const result = (success: boolean) => {
      a.success = success;
      a.phase = success || a.attempt === 1 ? 'result' : 'closed';
      saveAdventure(c, a);
      return { success, attempt: a.attempt };
    };
    if (action === 'adventure-award') {
      requireRule(
        a.phase === 'result' && a.success === true && a.teamId !== null,
        'INVALID_ADVENTURE',
        '请先确认挑战成功。',
      );
      requireRule(data.teamId === a.teamId, 'INVALID_TEAM', '只能给本次挑战队伍计分。');
      a.phase = 'won';
      saveAdventure(c, a);
      return triviaHostAction(
        c,
        'award',
        { cellId: a.cellId, teamId: a.teamId, amount: selected.value },
        requestId,
        random,
      );
    }
    if (action === 'adventure-start') {
      requireRule(
        a.phase === 'rules' && a.teamId !== null,
        'INVALID_ADVENTURE',
        '请先选出挑战队伍并展示规则。',
      );
      if (isCharades(a)) {
        requireRule(
          remaining(c, 'charades') >= settings(c, a).target!,
          'QUESTION_POOL_SHORT',
          '剩余词语不足以完成挑战。',
        );
        a.item = draw(c, 'charades');
      }
      a.phase = 'active';
      a.startedAt = c.now;
      a.deadlineAt = c.now + settings(c, a).seconds * 1000;
      saveAdventure(c, a);
      return { deadlineAt: a.deadlineAt };
    }
    if (action === 'adventure-correct' || action === 'adventure-skip') {
      requireRule(
        isCharades(a) && a.phase === 'active' && a.deadlineAt !== null && c.now < a.deadlineAt,
        'ADVENTURE_EXPIRED',
        '挑战时间已结束。',
      );
      if (action === 'adventure-correct') a.correct++;
      else a.skipped++;
      if (a.correct >= settings(c, a).target!) return result(true);
      if (remaining(c, 'charades') === 0) {
        a.item = null;
        saveAdventure(c, a);
        return { exhausted: true };
      }
      a.item = draw(c, 'charades');
      saveAdventure(c, a);
      return { correct: a.correct, skipped: a.skipped };
    }
    if (action === 'adventure-success') {
      requireRule(
        isYesNo(a) && a.phase === 'active' && a.deadlineAt !== null && c.now < a.deadlineAt,
        'ADVENTURE_EXPIRED',
        '挑战时间已结束。',
      );
      return result(true);
    }
    if (action === 'adventure-score') {
      requireRule(
        a.variant === 'photo-recreation' &&
          a.phase === 'active' &&
          a.deadlineAt !== null &&
          c.now >= a.deadlineAt,
        'INVALID_ADVENTURE',
        '请在摆拍时间结束后评分。',
      );
      requireRule(
        typeof data.score === 'number' &&
          Number.isInteger(data.score) &&
          data.score >= 0 &&
          data.score <= 100,
        'INVALID_SCORE',
        '请输入 0–100 的整数分数。',
      );
      requireRule(
        typeof data.reason === 'string' && data.reason.length <= 500,
        'INVALID_SCORE',
        '评分理由过长。',
      );
      a.score = data.score;
      a.reason = data.reason;
      return result(a.score >= settings(c, a).target!);
    }
    if (action === 'adventure-fail') {
      requireRule(a.phase === 'active', 'INVALID_ADVENTURE', '挑战尚未开始。');
      return result(false);
    }
    if (action === 'adventure-replace') {
      requireRule(
        isYesNo(a) && (a.phase === 'rules' || a.phase === 'active'),
        'INVALID_ADVENTURE',
        '当前挑战不能换题。',
      );
      a.item = draw(c, 'yesOrNo');
      a.phase = 'rules';
      a.startedAt = null;
      a.deadlineAt = null;
      saveAdventure(c, a);
      return { replaced: true };
    }
    if (action === 'adventure-steal') {
      requireRule(
        a.phase === 'result' && a.success === false && a.attempt === 1 && a.firstTeamId !== null,
        'INVALID_ADVENTURE',
        '不能再次开启抢答。',
      );
      a.phase = 'steal';
      a.attempt = 2;
      a.teamId = null;
      a.startedAt = null;
      a.deadlineAt = null;
      a.correct = 0;
      a.skipped = 0;
      a.success = null;
      if (isCharades(a)) a.item = null;
      a.displayPrompt = false;
      c.store.db
        .prepare('INSERT OR IGNORE INTO trivia_exclusions VALUES(?,?,?,?)')
        .run(room, phase, current.question, a.firstTeamId);
      c.store.db
        .prepare(
          "UPDATE trivia_state SET status='idle',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
        )
        .run(room, phase);
      saveAdventure(c, a);
      return { steal: true };
    }
    if (action === 'adventure-abort') {
      requireRule(a.phase !== 'won' && a.phase !== 'closed', 'INVALID_ADVENTURE', '挑战已经结束。');
      a.phase = 'closed';
      a.success = false;
      saveAdventure(c, a);
      c.store.db
        .prepare(
          "UPDATE trivia_state SET status='idle',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
        )
        .run(room, phase);
      return { closed: true };
    }
  }
  if (action === 'set-demo-mode') {
    requireRule(
      board && content && c.config.trivia.board_values,
      'BOARD_REQUIRED',
      '本轮使用旧版编号题目。',
    );
    requireRule(typeof data.demo === 'boolean', 'INVALID_MODE', '请选择演示模式或正式题库。');
    requireRule(
      data.expectedBankVersion === content.version,
      'STALE_BANK',
      '题库已变更，请刷新后重试。',
      409,
    );
    requireRule(
      canSwitchBank(c, board, current),
      'BANK_LOCKED',
      '已经选题或计分，不能切换题库。请新建派对。',
    );
    if ((content.mode === 'demo') === data.demo) return { demo: data.demo };
    let nextContent: TriviaContent;
    try {
      nextContent = triviaContentForMode(c.config.trivia.board_values, data.demo);
    } catch {
      requireRule(false, 'BANK_UNAVAILABLE', '无法读取或验证本机题库，请检查本地题库文件。');
    }
    c.store.db
      .prepare(
        'UPDATE trivia_boards SET content=?,revealed=0,begun=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(JSON.stringify(nextContent), room, phase);
    return { demo: data.demo };
  }
  if (action === 'show-board') {
    requireRule(board && members(c).length > 0, 'TEAM_REQUIRED', '请先分队。');
    requireRule(!board.selected_cell, 'CELL_UNFINISHED', '请先完成当前题目。');
    c.store.db
      .prepare('UPDATE trivia_boards SET begun=1 WHERE room_id=? AND phase_instance=?')
      .run(room, phase);
    return { started: true };
  }
  if (action === 'select-cell') {
    requireRule(board && content, 'BOARD_REQUIRED', '本轮使用旧版编号题目。');
    requireRule(members(c).length > 0, 'TEAM_REQUIRED', '请先分队。');
    requireRule(
      !board.selected_cell && current.status === 'idle',
      'CELL_UNFINISHED',
      '请先完成当前题目。',
    );
    const cell = content.cells.find((cell) => cell.id === data.cellId);
    requireRule(cell && !cell.unavailableReason, 'CELL_UNAVAILABLE', '此题尚未准备完成。');
    requireRule(
      !c.store.db
        .prepare('SELECT 1 FROM trivia_cells WHERE room_id=? AND phase_instance=? AND cell_id=?')
        .get(room, phase, cell.id),
      'CELL_USED',
      '此题已经完成。',
    );
    c.store.db
      .prepare('INSERT INTO trivia_cells VALUES(?,?,?,?,NULL)')
      .run(room, phase, cell.id, current.question + 1);
    c.store.db
      .prepare(
        'UPDATE trivia_boards SET selected_cell=?,revealed=0,begun=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(cell.id, room, phase);
    c.store.db
      .prepare(
        'UPDATE trivia_state SET music_playing=0,music_started_at=NULL,music_position=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(room, phase);
    c.store.db
      .prepare(
        "UPDATE trivia_state SET question=question+1,status='idle',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
      )
      .run(room, phase);
    if (cell.kind === 'adventure') createAdventure(c, cell, content, random);
    return { selected: cell.id };
  }
  if (board && action === 'cancel-selection') {
    requireRule(!adventure, 'INVALID_ADVENTURE', '大冒险已抽题，请完成或终止挑战。');
    requireRule(
      !board.begun && current.status !== 'armed',
      'CELL_STARTED',
      '已经开始作答，请使用完成本题。',
    );
    c.store.db
      .prepare('DELETE FROM trivia_cells WHERE room_id=? AND phase_instance=? AND cell_id=?')
      .run(room, phase, selected!.id);
    c.store.db
      .prepare(
        'UPDATE trivia_boards SET selected_cell=NULL,revealed=0,begun=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(room, phase);
    c.store.db
      .prepare(
        'UPDATE trivia_state SET music_playing=0,music_started_at=NULL,music_position=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(room, phase);
    return { cancelled: true };
  }
  if (board && (action === 'music-start' || action === 'music-stop')) {
    requireRule(
      selected?.kind === 'music' && selected.musicAudio,
      'MUSIC_UNAVAILABLE',
      '这首歌尚未准备好。',
    );
    const playback = c.store.db
      .prepare(
        'SELECT music_playing,music_started_at,music_position FROM trivia_state WHERE room_id=? AND phase_instance=?',
      )
      .get(room, phase) as {
      music_playing: number;
      music_started_at: number | null;
      music_position: number;
    };
    const end = selected.musicAudio.clipEndSeconds;
    const currentPosition = Math.max(
      0,
      Math.min(
        end,
        playback.music_position +
          (playback.music_playing && playback.music_started_at !== null
            ? (c.now - playback.music_started_at) / 1000
            : 0),
      ),
    );
    if (action === 'music-start') {
      const nextPosition = currentPosition >= end ? 0 : currentPosition;
      c.store.db
        .prepare(
          'UPDATE trivia_state SET music_playing=1,music_started_at=?,music_position=? WHERE room_id=? AND phase_instance=?',
        )
        .run(c.now, nextPosition, room, phase);
      return { playing: true, position: nextPosition };
    }
    c.store.db
      .prepare(
        'UPDATE trivia_state SET music_playing=0,music_started_at=NULL,music_position=? WHERE room_id=? AND phase_instance=?',
      )
      .run(currentPosition, room, phase);
    return { playing: false, position: currentPosition };
  }
  if (board && action === 'reveal-answer') {
    requireRule(!adventure, 'INVALID_ADVENTURE', '请使用大冒险结果操作。');
    requireRule(!board.revealed, 'ANSWER_REVEALED', '答案已经公布。');
    c.store.db
      .prepare('UPDATE trivia_boards SET revealed=1,begun=1 WHERE room_id=? AND phase_instance=?')
      .run(room, phase);
    c.store.db
      .prepare(
        "UPDATE trivia_state SET status=CASE WHEN status='armed' THEN 'idle' ELSE status END WHERE room_id=? AND phase_instance=?",
      )
      .run(room, phase);
    return { revealed: true };
  }
  if (board && action === 'finish-cell') {
    if (adventure)
      requireRule(
        adventure.phase === 'won' || adventure.phase === 'closed',
        'ADVENTURE_UNFINISHED',
        '请先完成挑战或结束抢答。',
      );
    requireRule(current.status !== 'armed', 'BUZZER_OPEN', '请先关闭抢答。');
    c.store.db
      .prepare(
        'UPDATE trivia_cells SET completed_at=? WHERE room_id=? AND phase_instance=? AND cell_id=? AND completed_at IS NULL',
      )
      .run(c.now, room, phase, selected!.id);
    c.store.db
      .prepare(
        'UPDATE trivia_boards SET selected_cell=NULL,revealed=0,begun=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(room, phase);
    c.store.db
      .prepare(
        'UPDATE trivia_state SET music_playing=0,music_started_at=NULL,music_position=0 WHERE room_id=? AND phase_instance=?',
      )
      .run(room, phase);
    c.store.db
      .prepare(
        "UPDATE trivia_state SET status='idle',winner_player=NULL,winner_team=NULL WHERE room_id=? AND phase_instance=?",
      )
      .run(room, phase);
    return { finished: selected!.id };
  }
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
    requireRule(!board, 'BOARD_MODE', '请在题板上选择题目。');
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
    if (board) {
      if (adventure)
        requireRule(
          adventure.phase === 'steal',
          'INVALID_ADVENTURE',
          '首轮由主持人选择队伍；失败后才可抢答。',
        );
      else {
        const attempts = c.store.db
          .prepare(
            'SELECT count(*) AS n FROM trivia_exclusions WHERE room_id=? AND phase_instance=? AND question=?',
          )
          .get(room, phase, current.question) as { n: number };
        requireRule(
          current.status !== 'locked' && attempts.n < 2,
          'ATTEMPT_LIMIT',
          '本题最多两队尝试。',
        );
      }
      requireRule(
        !board.revealed && !activeAward(selected!.id),
        'CELL_RESOLVED',
        '此题已揭晓或已计分，请完成本题。',
      );
      requireRule(
        triviaProjection(c).teams.some((t) => !t.excluded),
        'NO_ELIGIBLE_TEAMS',
        '所有队伍均已答错，可以公布答案并完成本题。',
      );
    }
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
    if (adventure && adventure.phase === 'steal') {
      adventure.phase = 'closed';
      saveAdventure(c, adventure);
    }
    return { closed: true };
  }
  if (action === 'incorrect') {
    requireRule(!adventure, 'INVALID_ADVENTURE', '请使用大冒险结果操作。');
    if (board)
      requireRule(
        !board.revealed && !activeAward(selected!.id),
        'CELL_RESOLVED',
        '此题已揭晓或已计分。',
      );
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
    if (adventure && selected?.id === data.cellId)
      requireRule(
        adventure.phase === 'won' && data.teamId === adventure.teamId,
        'INVALID_ADVENTURE',
        '只能给挑战成功的队伍计分。',
      );
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
    let awardCell: typeof selected;
    let awardQuestion = current.question;
    if (board && content) {
      awardCell = content.cells.find((cell) => cell.id === data.cellId);
      const prior =
        awardCell &&
        (c.store.db
          .prepare(
            'SELECT question,completed_at FROM trivia_cells WHERE room_id=? AND phase_instance=? AND cell_id=?',
          )
          .get(room, phase, awardCell.id) as
          { question: number; completed_at: number | null } | undefined);
      requireRule(awardCell && prior, 'INVALID_CELL', '请选择当前题目或历史计分题目。');
      requireRule(current.status !== 'armed', 'BUZZER_OPEN', '请先关闭抢答再计分。');
      requireRule(
        awardCell.id === selected?.id ||
          (prior.completed_at !== null &&
            !!c.store.db
              .prepare(
                'SELECT 1 FROM trivia_cell_awards WHERE room_id=? AND phase_instance=? AND cell_id=?',
              )
              .get(room, phase, awardCell.id)),
        'INVALID_CORRECTION',
        '只能修正已有计分的题目。',
      );
      requireRule(amount === awardCell.value, 'INVALID_AWARD', '每名队员的奖励必须等于本题分值。');
      requireRule(!activeAward(awardCell.id), 'CELL_AWARDED', '此题已计分，请先撤销原计分。');
      awardQuestion = prior.question;
    }
    for (const member of teamMembers)
      c.store.adjust(
        room,
        member.player_id,
        `trivia:${phase}:${requestId}`,
        'Trivia team award',
        { spendable: amount, locked: 0, reserved: 0 },
        c.now,
        'trivia',
      );
    c.store.db
      .prepare('INSERT INTO trivia_awards VALUES(?,?,?,?,?)')
      .run(room, phase, requestId, team, amount);
    c.store.db
      .prepare('INSERT INTO trivia_award_receipts VALUES(?,?,?,?,?,NULL)')
      .run(room, phase, requestId, awardQuestion, c.now);
    if (awardCell) {
      c.store.db
        .prepare('INSERT INTO trivia_cell_awards VALUES(?,?,?,?)')
        .run(room, phase, requestId, awardCell.id);
      if (selected?.id === awardCell.id)
        c.store.db
          .prepare('UPDATE trivia_boards SET begun=1 WHERE room_id=? AND phase_instance=?')
          .run(room, phase);
    }
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

/** Explicit role projection: answers/notes only to host; phone receives no board content. */
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
  const board = boardState(c);
  const history = triviaAwardHistory(c);
  return {
    ...(board && !playerId ? { board: projectBoard(c, board, includeAwards) } : {}),
    ...(board?.selected_cell &&
    contentOf(board).cells.find((cell) => cell.id === board.selected_cell)?.kind === 'adventure'
      ? {
          adventure:
            projectAdventure(
              c,
              contentOf(board),
              contentOf(board).cells.find((cell) => cell.id === board.selected_cell)!,
              includeAwards,
              !!playerId,
            ) ?? undefined,
        }
      : {}),
    ...(board
      ? { bankLabel: contentOf(board).label ?? '问答题库', demo: contentOf(board).mode === 'demo' }
      : {}),
    teams: ids.map((id) => ({
      id,
      name: `第 ${id} 队`,
      ...(board && !playerId
        ? {
            score: history
              .filter((a) => a.cellId && !a.undone && a.teamId === id)
              .reduce((sum, a) => sum + a.amount, 0),
          }
        : {}),
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
    ...(includeAwards
      ? {
          awardHistory: history,
          ...(board
            ? {
                bankSwitch: {
                  allowed: c.room.status === 'open' && canSwitchBank(c, board, current),
                  eventAvailable: existsSync(eventTriviaBankFile()),
                },
              }
            : {}),
        }
      : {}),
  };
}

function triviaAwardHistory(c: PhaseContext): TriviaAward[] {
  const rows = c.store.db
    .prepare(
      `SELECT a.request_id AS id,a.team AS teamId,a.amount,r.question,r.undone_at,b.cell_id AS cellId
    FROM trivia_awards a LEFT JOIN trivia_award_receipts r
    ON r.room_id=a.room_id AND r.phase_instance=a.phase_instance AND r.award_id=a.request_id
    LEFT JOIN trivia_cell_awards b ON b.room_id=a.room_id AND b.phase_instance=a.phase_instance AND b.award_id=a.request_id
    WHERE a.room_id=? AND a.phase_instance=? ORDER BY a.rowid DESC`,
    )
    .all(c.room.id, c.room.phase_instance) as unknown as (Omit<TriviaAward, 'undone'> & {
    undone_at: number | null;
  })[];
  return rows.map(({ undone_at, ...award }) => ({ ...award, undone: undone_at !== null }));
}

function projectBoard(c: PhaseContext, board: BoardRow, host: boolean): TriviaBoard {
  const content = contentOf(board);
  const used = new Set(
    (
      c.store.db
        .prepare(
          'SELECT cell_id FROM trivia_cells WHERE room_id=? AND phase_instance=? AND completed_at IS NOT NULL',
        )
        .all(c.room.id, c.room.phase_instance) as { cell_id: string }[]
    ).map((r) => r.cell_id),
  );
  const clue = content.cells.find((cell) => cell.id === board.selected_cell);
  return {
    version: content.version,
    categories:
      content.mode === 'demo'
        ? content.categories.map((category, index) => ({ ...category, name: `类别 ${index + 1}` }))
        : content.categories,
    cells: content.cells.map((cell) => ({
      id: cell.id,
      categoryId: cell.categoryId,
      value: cell.value,
      used: used.has(cell.id),
      available: !cell.unavailableReason,
    })),
    selected: clue
      ? {
          id: clue.id,
          categoryId: clue.categoryId,
          value: clue.value,
          publicPrompt: clue.publicPrompt,
          ...(host || board.revealed ? { answer: clue.hostAnswer } : {}),
          ...(host ? { hostNotes: clue.hostNotes } : {}),
          kind: clue.kind,
          ...(clue.musicTrack ? { musicStoreUrl: clue.musicTrack.storeUrl } : {}),
          ...(clue.musicTrack && (host || board.revealed) ? { musicTrack: clue.musicTrack } : {}),
          ...(clue.musicAudio
            ? {
                musicClip: {
                  start: clue.musicAudio.clipStartSeconds,
                  end: clue.musicAudio.clipEndSeconds,
                },
                musicPlayback: (() => {
                  const p = c.store.db
                    .prepare(
                      'SELECT music_playing,music_started_at,music_position FROM trivia_state WHERE room_id=? AND phase_instance=?',
                    )
                    .get(c.room.id, c.room.phase_instance) as {
                    music_playing: number;
                    music_started_at: number | null;
                    music_position: number;
                  };
                  const position = Math.max(
                    0,
                    Math.min(
                      clue.musicAudio!.clipEndSeconds,
                      p.music_position +
                        (p.music_playing && p.music_started_at !== null
                          ? (c.now - p.music_started_at) / 1000
                          : 0),
                    ),
                  );
                  return {
                    playing: !!p.music_playing && position < clue.musicAudio!.clipEndSeconds,
                    position,
                    changedAt: p.music_started_at ?? c.now,
                  };
                })(),
              }
            : {}),
        }
      : null,
    revealed: !!board.revealed,
    started: !!board.begun || state(c).question > 0,
    canCancel: !!clue && !board.begun && state(c).status !== 'armed',
    ...(host
      ? {
          review: content.cells
            .filter((cell) => cell.unavailableReason)
            .map((cell) => ({
              id: cell.id,
              value: cell.value,
              categoryId: cell.categoryId,
              reason: cell.unavailableReason!,
              ...(cell.musicCandidates ? { musicCandidates: cell.musicCandidates } : {}),
            })),
        }
      : {}),
  };
}

function canSwitchBank(c: PhaseContext, board: BoardRow, current: State): boolean {
  return (
    !board.selected_cell &&
    !board.begun &&
    current.question === 0 &&
    current.awards === 0 &&
    current.status === 'idle' &&
    !c.store.db
      .prepare('SELECT 1 FROM trivia_cells WHERE room_id=? AND phase_instance=? LIMIT 1')
      .get(c.room.id, c.room.phase_instance)
  );
}
