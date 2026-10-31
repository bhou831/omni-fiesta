import type { PhaseContext } from '../core/phases.js';
import { requireRule } from '../core/errors.js';
import type { TriviaClue, TriviaContent } from './trivia-content.js';

export const TRIVIA_ADVENTURE_SCHEMA = `
CREATE TABLE IF NOT EXISTS trivia_adventures(room_id TEXT NOT NULL, phase_instance INTEGER NOT NULL, cell_id TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(room_id,phase_instance,cell_id));
CREATE TABLE IF NOT EXISTS trivia_adventure_pools(room_id TEXT NOT NULL, phase_instance INTEGER NOT NULL, name TEXT NOT NULL CHECK(name IN ('charades','yesOrNo')), items TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(room_id,phase_instance,name));`;

export type AdventureState = {
  cellId: string;
  variant: NonNullable<TriviaClue['adventureVariant']>;
  phase: 'waiting' | 'rules' | 'active' | 'result' | 'steal' | 'won' | 'closed';
  attempt: number;
  teamId: number | null;
  firstTeamId: number | null;
  item: string | null;
  startedAt: number | null;
  deadlineAt: number | null;
  pausedRemainingMs?: number | null;
  timerRevision?: number;
  correct: number;
  skipped: number;
  success: boolean | null;
  score?: number | null;
  reason?: string | null;
  displayPrompt?: boolean;
};

export type AdventureProjection = AdventureState & {
  title: string;
  rules: string[];
  durationSeconds: number;
  target: number | null;
  remaining: number | null;
  photoScoringPrompt?: string;
};

const key = (c: PhaseContext) => [c.room.id, c.room.phase_instance] as const;
const row = (c: PhaseContext, cellId: string) =>
  c.store.db
    .prepare(
      'SELECT state FROM trivia_adventures WHERE room_id=? AND phase_instance=? AND cell_id=?',
    )
    .get(...key(c), cellId) as { state: string } | undefined;
export const getAdventure = (c: PhaseContext, cellId: string | null): AdventureState | null =>
  cellId && row(c, cellId) ? (JSON.parse(row(c, cellId)!.state) as AdventureState) : null;
export function saveAdventure(c: PhaseContext, a: AdventureState): void {
  c.store.db
    .prepare(
      'INSERT INTO trivia_adventures VALUES(?,?,?,?) ON CONFLICT(room_id,phase_instance,cell_id) DO UPDATE SET state=excluded.state',
    )
    .run(...key(c), a.cellId, JSON.stringify(a));
}
export const isCharades = (a: AdventureState) => a.variant.startsWith('charades');
export const isYesNo = (a: AdventureState) => a.variant.startsWith('yes-no');

export function settings(c: PhaseContext, a: AdventureState) {
  const cfg = c.config.trivia.adventure;
  requireRule(cfg, 'ADVENTURE_UNAVAILABLE', '此派对没有大冒险配置。');
  switch (a.variant) {
    case 'charades-simple':
      return { seconds: cfg.charades_simple_seconds, target: cfg.charades_simple_target };
    case 'charades-complex':
      return { seconds: cfg.charades_complex_seconds, target: cfg.charades_complex_target };
    case 'yes-no-simple':
      return { seconds: cfg.yes_no_simple_seconds, target: null };
    case 'yes-no-hard':
      return { seconds: cfg.yes_no_hard_seconds, target: null };
    case 'photo-recreation':
      return { seconds: cfg.photo_recreation_seconds, target: null };
  }
}

function shuffle<T>(items: T[], random: (upper: number) => number): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = random(i + 1);
    requireRule(Number.isInteger(j) && j >= 0 && j <= i, 'INVALID_RANDOM', '随机抽题失败。');
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
export function initializePools(
  c: PhaseContext,
  content: TriviaContent,
  random: (upper: number) => number,
): void {
  const bank = content.adventureQuestionBank;
  requireRule(bank, 'ADVENTURE_UNAVAILABLE', '大冒险题库未准备。');
  for (const name of ['charades', 'yesOrNo'] as const) {
    const exists = c.store.db
      .prepare(
        'SELECT 1 FROM trivia_adventure_pools WHERE room_id=? AND phase_instance=? AND name=?',
      )
      .get(...key(c), name);
    if (!exists)
      c.store.db
        .prepare('INSERT INTO trivia_adventure_pools VALUES(?,?,?,?,0)')
        .run(...key(c), name, JSON.stringify(shuffle(bank[name], random)));
  }
}
export function remaining(c: PhaseContext, name: 'charades' | 'yesOrNo'): number {
  const pool = c.store.db
    .prepare(
      'SELECT items,cursor FROM trivia_adventure_pools WHERE room_id=? AND phase_instance=? AND name=?',
    )
    .get(...key(c), name) as { items: string; cursor: number } | undefined;
  return pool ? (JSON.parse(pool.items) as string[]).length - pool.cursor : 0;
}
export function draw(c: PhaseContext, name: 'charades' | 'yesOrNo'): string {
  const pool = c.store.db
    .prepare(
      'SELECT items,cursor FROM trivia_adventure_pools WHERE room_id=? AND phase_instance=? AND name=?',
    )
    .get(...key(c), name) as { items: string; cursor: number } | undefined;
  requireRule(pool, 'ADVENTURE_UNAVAILABLE', '大冒险题库未准备。');
  const item = (JSON.parse(pool.items) as string[])[pool.cursor];
  requireRule(item, 'QUESTION_POOL_EMPTY', '题库已用完；不能重复出题。');
  c.store.db
    .prepare(
      'UPDATE trivia_adventure_pools SET cursor=cursor+1 WHERE room_id=? AND phase_instance=? AND name=?',
    )
    .run(...key(c), name);
  return item;
}
export function createAdventure(
  c: PhaseContext,
  cell: TriviaClue,
  content: TriviaContent,
  random: (upper: number) => number,
): void {
  requireRule(
    cell.adventureVariant && c.config.trivia.adventure && content.adventureRules,
    'ADVENTURE_UNAVAILABLE',
    '大冒险尚未准备。',
  );
  initializePools(c, content, random);
  const a: AdventureState = {
    cellId: cell.id,
    variant: cell.adventureVariant,
    phase: 'waiting',
    attempt: 1,
    teamId: null,
    firstTeamId: null,
    item: null,
    startedAt: null,
    deadlineAt: null,
    correct: 0,
    skipped: 0,
    success: null,
    displayPrompt: false,
  };
  if (isYesNo(a)) a.item = draw(c, 'yesOrNo');
  if (a.variant === 'photo-recreation')
    a.item = cell.referenceImages?.[0] ?? cell.referenceImage ?? null;
  saveAdventure(c, a);
}
export function projectAdventure(
  c: PhaseContext,
  content: TriviaContent,
  cell: TriviaClue,
  host: boolean,
  player: boolean,
): AdventureProjection | null {
  const a = getAdventure(c, cell.id);
  if (!a) return null;
  const rulesKey = {
    'charades-simple': 'charadesSimple',
    'charades-complex': 'charadesComplex',
    'yes-no-simple': 'yesOrNoSimple',
    'yes-no-hard': 'yesOrNoHard',
    'photo-recreation': 'photoRecreation',
  } as const;
  const { seconds, target } = settings(c, a);
  return {
    ...a,
    title: cell.publicPrompt,
    rules: content.adventureRules?.[rulesKey[a.variant]] ?? [],
    durationSeconds: seconds,
    target,
    ...(host && a.variant === 'photo-recreation' && content.photoScoringPrompt
      ? { photoScoringPrompt: content.photoScoringPrompt }
      : {}),
    remaining:
      host && a.variant !== 'photo-recreation'
        ? remaining(c, isCharades(a) ? 'charades' : 'yesOrNo')
        : null,
    item:
      player ||
      (isCharades(a) && !host && a.phase !== 'active') ||
      (isYesNo(a) && !host && !a.displayPrompt) ||
      (!host &&
        !(isYesNo(a) && a.displayPrompt && a.phase === 'rules') &&
        a.phase !== 'active' &&
        a.phase !== 'result' &&
        a.phase !== 'won' &&
        a.phase !== 'closed')
        ? null
        : a.item,
    score: undefined,
    reason: undefined,
  };
}
