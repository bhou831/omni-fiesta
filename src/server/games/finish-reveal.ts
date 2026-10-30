import type { PhaseContext } from '../core/phases.js';
import { requireRule } from '../core/errors.js';

type Ranked = { rank: number };

/**
 * The final ranking is announced from 3rd place down to 1st, then everyone is shown. A rank that
 * nobody holds (a tie for first has no 2nd) is skipped, and fewer than 3 players is one step.
 */
export function finishRevealSteps(ranking: Ranked[]): { ranks: number[]; total: number } {
  if (ranking.length < 3) return { ranks: [], total: 1 };
  const ranks = [...new Set(ranking.map((r) => r.rank).filter((rank) => rank <= 3))].sort(
    (a, b) => b - a,
  );
  return { ranks, total: ranks.length + 1 };
}

export function finishRevealStep(context: PhaseContext): number {
  const row = context.store.db
    .prepare('SELECT step FROM finish_reveal_progress WHERE room_id=?')
    .get(context.room.id) as { step: number } | undefined;
  return row?.step ?? 0;
}

/** What a public screen may show after `step` announcements; the last step shows everyone. */
export function publicRanking<T extends Ranked>(ranking: T[], step: number): T[] {
  const { ranks, total } = finishRevealSteps(ranking);
  if (step >= total) return ranking;
  const shown = new Set(ranks.slice(0, step));
  return ranking.filter((r) => shown.has(r.rank));
}

/** Caller authorizes the host and executes this function in the command transaction. */
export function finishRevealAction(
  context: PhaseContext,
  action: string,
  ranking: Ranked[],
  expectedStep?: unknown,
): Record<string, unknown> {
  requireRule(action === 'next', 'UNKNOWN_ACTION', 'Choose a ranking reveal action.');
  requireRule(context.room.phase === 'finish', 'INVALID_PHASE', 'The party is not finished yet.');
  const { total } = finishRevealSteps(ranking);
  const step = finishRevealStep(context);
  requireRule(
    expectedStep === undefined || expectedStep === step,
    'STALE_STEP',
    'That place was already announced. Your screen has been refreshed.',
    409,
  );
  if (step >= total) return { done: true, step };
  context.store.db
    .prepare(
      'INSERT INTO finish_reveal_progress(room_id,step) VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET step=excluded.step',
    )
    .run(context.room.id, step + 1);
  return { step: step + 1, done: step + 1 >= total };
}
