import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';
import { investments, investmentReview } from '../src/server/games/investments.js';
import { costume } from '../src/server/games/costume.js';
import { trivia } from '../src/server/games/trivia.js';
import { createSlotsModule } from '../src/server/games/slots.js';
import { createPowerballModule } from '../src/server/games/powerball.js';
import { somebodyCalling } from '../src/server/games/somebody-calling.js';
import { fixtureProvider } from '../src/server/games/market.js';
import { prepareMarket } from '../src/server/games/prepare-market.js';
import type { Command } from '../src/shared/contracts.js';

for (const count of [15, 100])
  test(`in-process complete party integrates ${count} players`, async (t) => {
    const store = new Store(':memory:');
    t.after(() => store.close());
    const config = loadConfig();
    const now = 1000000;
    const room = store.transaction(() => store.createRoom(config, 'party', now, 'fixture'));
    const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
    const players = Array.from({ length: count }, (_, i) => {
      const joined = store.join(
        store.room(room.id),
        { name: `Guest ${i}`, emoji: '🦊', email: `guest${i}@example.test`, phone: '2125550100' },
        randomUUID(),
        now,
      );
      return store.authenticate(joined.token, 'player', now, '')!;
    });
    const engine = new Engine(store, () => now, [
      investments,
      costume,
      trivia,
      createSlotsModule(() => 0n),
      createPowerballModule(),
      investmentReview,
      somebodyCalling,
    ]);
    const execute = (session: Session, type: Command['type'], payload?: Command['payload']) =>
      engine.execute(session, room.id, {
        requestId: randomUUID(),
        phaseInstance: store.room(room.id).phase_instance,
        type,
        payload,
      });
    const hostAction = (action: string, data?: Record<string, unknown>) =>
      execute(host, 'phase.host', { action, data });
    const close = () => execute(host, 'phase.close');
    const advance = () => execute(host, 'phase.advance');
    await prepareMarket(store, room.id, 'opening', fixtureProvider(), () => now);
    advance();
    players.forEach((p) =>
      execute(p, 'phase.action', { action: 'invest', data: { assetId: 'bitcoin', amount: 600 } }),
    );
    close();
    advance();
    players.forEach((p, i) =>
      execute(p, 'phase.action', {
        action: 'vote',
        data: { candidateId: players[(i + 1) % count].playerId },
      }),
    );
    close();
    hostAction('reveal');
    advance();
    hostAction('assign', { count: 4 });
    hostAction('new-question');
    hostAction('arm');
    const window = engine.snapshot({
      role: 'player',
      roomId: room.id,
      playerId: players[0].playerId!,
    }).trivia!.windowId;
    execute(players[0], 'phase.action', { action: 'buzz', data: { windowId: window } });
    hostAction('award', { teamId: 1, amount: 100 });
    close();
    advance();
    players.forEach((p) => execute(p, 'phase.action', { action: 'spin' }));
    close();
    advance();
    players.forEach((p, i) =>
      execute(p, 'phase.action', {
        action: 'bet',
        data: { color: i % 2 ? 'blue' : 'red', amount: 100 },
      }),
    );
    close();
    hostAction('draw');
    const hidden = engine.snapshot({ role: 'display', roomId: room.id });
    assert.equal(hidden.powerball?.winningColor, null);
    hostAction('reveal');
    advance();
    await prepareMarket(store, room.id, 'closing', fixtureProvider(), () => now);
    hostAction('settle');
    close();
    advance();
    const before = players.map((p) => store.player(p.playerId!).spendable);
    hostAction('draw');
    assert.deepEqual(
      players.map((p) => store.player(p.playerId!).spendable),
      before,
    );
    const publicDraw = engine.snapshot({ role: 'display', roomId: room.id });
    assert.equal(publicDraw.calling?.role, 'public');
    assert.doesNotMatch(JSON.stringify(publicDraw), /2125550100|example\.test/);
    hostAction('reveal');
    close();
    advance();
    const final = engine.snapshot({ role: 'display', roomId: room.id });
    assert.equal(final.ranking?.length, count);
    assert.ok(store.players(room.id).every((p) => p.locked === 0 && p.reserved === 0));
  });
