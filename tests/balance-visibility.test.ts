import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvestmentPlayer } from '../src/client/Investments.js';
import { SlotsPlayer } from '../src/client/Slots.js';
import { PowerballPlayer } from '../src/client/Powerball.js';
import { loadConfig } from '../src/server/config.js';
import { Engine } from '../src/server/core/engine.js';
import { Store } from '../src/server/core/store.js';

test('game panels reveal spendable balances only when the player opts in', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = loadConfig();
  config.party.initial_tokens = 987;
  const room = store.transaction(() => store.createRoom(config, 'party', 1000000));
  const player = store.join(
    store.room(room.id),
    { name: 'Privacy Test', emoji: '🦦', email: 'privacy@example.test', phone: '2125550100' },
    randomUUID(),
    1000000,
  );
  store.db.prepare("UPDATE rooms SET phase='investments' WHERE id=?").run(room.id);
  const state = new Engine(store, () => 1000000).snapshot({
    role: 'player',
    roomId: room.id,
    playerId: player.playerId,
  });
  const command = async () => {};
  const panels = [
    (revealBalance: boolean) =>
      createElement(InvestmentPlayer, { state, command, disabled: false, revealBalance }),
    (revealBalance: boolean) =>
      createElement(SlotsPlayer, {
        state: { cost: 200, limit: 3, spins: [] },
        spendable: 987,
        revealBalance,
        open: true,
        disabled: false,
        command,
      }),
    (revealBalance: boolean) =>
      createElement(PowerballPlayer, {
        state: { ownBet: null, drawn: false, revealed: false, winningColor: null, hostBets: null },
        players: state.players,
        spendable: 987,
        revealBalance,
        open: true,
        disabled: false,
        onBet: () => {},
        onCancel: () => {},
        onDraw: () => {},
        onReveal: () => {},
      }),
  ];
  // Visible text only: the Powerball slider's range necessarily reflects the player's own maximum (accepted).
  const visible = (html: string) => html.replace(/<[^>]*>/g, ' ');
  for (const panel of panels) {
    assert.doesNotMatch(visible(renderToStaticMarkup(panel(false))), /987/);
    assert.match(visible(renderToStaticMarkup(panel(true))), /987/);
  }
});
