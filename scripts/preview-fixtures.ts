/** Development-only fixtures. Imported by the standalone in-memory preview server and tests. */
import { randomUUID } from 'node:crypto';
import { EMOJIS, type Stage, type Command } from '../src/shared/contracts.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';
import { hash, type Session } from '../src/server/core/store.js';
import { fixtureProvider } from '../src/server/games/market.js';

export const PREVIEW_SCENARIOS = [
  { key: 'lobby', stage: 'lobby', label: 'Waiting room' },
  { key: 'investments', stage: 'investments', label: 'Investment cards' },
  { key: 'costume', stage: 'costume', label: 'Costume voting' },
  { key: 'costume-results', stage: 'costume-reveal', label: 'Costume winners (3rd revealed)' },
  { key: 'trivia', stage: 'trivia', label: '中文趣味问答题板' },
  { key: 'trivia-scoreboard', stage: 'trivia-scoreboard', label: '团队积分榜' },
  { key: 'slots', stage: 'slots', label: 'Slot machine' },
  { key: 'powerball', stage: 'powerball', label: 'Powerball betting / animation' },
  { key: 'powerball-results', stage: 'powerball', label: 'Powerball results' },
  { key: 'investment-review', stage: 'investment-review', label: 'Investment review' },
  { key: 'somebody-calling', stage: 'somebody-calling', label: 'Somebody’s Calling' },
  { key: 'finish-podium', stage: 'finish', label: 'Final ranking (3rd revealed)' },
  { key: 'finish', stage: 'finish', label: 'Final ranking' },
] as const;
export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];

export async function seedPreviewRoom(
  engine: Engine,
  scenario: PreviewScenario,
  legacyTrivia = false,
  legacyAnswerFlow = false,
) {
  const { store } = engine;
  const now = engine.now();
  const config = loadConfig();
  if (legacyTrivia) delete config.trivia.board_values;
  if (legacyAnswerFlow) delete config.trivia.answer_seconds;
  // Generous inspection windows belong only to these disposable fixture rooms.
  for (const key of Object.keys(config.timers) as (keyof typeof config.timers)[])
    config.timers[key] = 900;
  const room = store.transaction(() => store.createRoom(config, 'party', now, 'fixture'));
  const people = ['Alex', 'Sam', 'Jamie', 'Robin', 'Taylor', 'Casey'].map((name, i) => {
    const joined = store.join(
      store.room(room.id),
      {
        name: `Sample ${name}`,
        emoji: EMOJIS[i],
        email: `sample${i}@example.test`,
        phone: '2125550100',
      },
      randomUUID(),
      now,
    );
    const session: Session = {
      role: 'player',
      roomId: room.id,
      playerId: joined.playerId,
      tokenHash: hash(joined.token),
    };
    return { ...joined, session };
  });
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: 'preview-host' };
  const command = (
    session: Session,
    type: Command['type'],
    action?: string,
    data?: Record<string, unknown>,
  ) =>
    engine.execute(session, room.id, {
      requestId: randomUUID(),
      phaseInstance: store.room(room.id).phase_instance,
      type,
      ...(action ? { payload: { action, data } } : {}),
    });
  const hostAction = (action: string, data?: Record<string, unknown>) =>
    command(host, 'phase.host', action, data);
  const playerAction = (i: number, action: string, data?: Record<string, unknown>) =>
    command(people[i].session, 'phase.action', action, data);
  const opening = await fixtureProvider().fetch(config, now);
  // Explicitly synthetic research facts for visual inspection, never live-market substitutes.
  opening.quotes = opening.quotes.map((q, i) => ({
    ...q,
    change24h: [1.2, -0.4, 3.1, 0.2, -2.5][i],
    high24h: Number(q.price) * 1.04,
    low24h: Number(q.price) * 0.95,
    volume24h: (i + 1) * 10000000,
  }));
  store.db
    .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
    .run(room.id, 'opening', JSON.stringify(opening));
  function stage(next: Stage) {
    store.transaction(() => {
      const duration = engine.modules.get(next)?.durationSeconds(config) ?? null;
      store.db
        .prepare(
          "UPDATE rooms SET phase=?,phase_instance=phase_instance+1,status='open',opened_at=?,deadline_at=?,version=version+1 WHERE id=?",
        )
        .run(next, now, duration === null ? null : now + duration * 1000, room.id);
      engine.modules.get(next)?.open?.(engine.context(store.room(room.id)));
    });
  }
  if (scenario.stage === 'investment-review') {
    stage('investments');
    people.forEach((_, i) =>
      playerAction(i, 'invest', {
        assetId: config.investments.assets[i % config.investments.assets.length].provider_id,
        amount: 600,
      }),
    );
    const closing = {
      ...opening,
      quotes: opening.quotes.map((q, i) => ({
        ...q,
        price: String(Number(q.price) * (i % 2 ? 0.99 : 1.01)),
      })),
    };
    store.db
      .prepare('INSERT INTO market_snapshots VALUES(?,?,?)')
      .run(room.id, 'closing', JSON.stringify(closing));
  }
  if (scenario.stage === 'trivia-scoreboard') {
    stage('trivia');
    hostAction('assign', { count: 5 });
    for (const [cellId, teamId] of [
      ['childhood-1', 1],
      ['childhood-2', 2],
      ['childhood-3', 1],
      ['childhood-4', 3],
    ] as const) {
      hostAction('select-cell', { cellId, teamId });
      hostAction('award', { cellId, teamId, amount: Number(cellId.slice(-1)) * 100, attempt: 1 });
      hostAction('finish-cell', { cellId });
    }
  }
  if (scenario.stage !== 'lobby' && scenario.key !== 'costume-results') stage(scenario.stage);
  if (scenario.stage === 'trivia') {
    hostAction('assign', { count: 2 });
    if (legacyTrivia) {
      hostAction('new-question');
      hostAction('arm');
    }
  }
  if (scenario.stage === 'powerball') {
    for (let i = 1; i < people.length; i++)
      playerAction(i, 'bet', { color: i % 2 ? 'red' : 'blue', amount: 100 });
    if (scenario.key.endsWith('results')) {
      playerAction(0, 'bet', { color: 'red', amount: 100 });
      command(host, 'phase.close');
      hostAction('draw');
      hostAction('reveal');
    }
  }
  if (scenario.key === 'costume-results') {
    stage('costume');
    people.forEach((_, i) =>
      playerAction(i, 'vote', { candidateId: people[i === 0 ? 1 : 0].playerId }),
    );
    command(host, 'phase.close');
    hostAction('lock');
    stage('costume-reveal');
    hostAction('next');
  }
  if (scenario.stage === 'investment-review') hostAction('settle');
  if (scenario.stage === 'finish') {
    people.forEach((p, i) =>
      store.transaction(() =>
        store.adjust(
          room.id,
          p.playerId,
          'preview:sample-score',
          'Preview sample score',
          { spendable: i * 100, locked: 0, reserved: 0 },
          now,
        ),
      ),
    );
    // The podium is announced one place at a time; the plain finish scenario shows the full list.
    for (let step = 0; step < (scenario.key === 'finish-podium' ? 1 : 6); step++)
      hostAction('next');
  }
  return { ...room, playerId: people[0].playerId, scenario };
}
