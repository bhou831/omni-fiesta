import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/server/core/store.js';
import { loadConfig } from '../src/server/config.js';

for (const version of [15, 16, 17]) {
  for (const history of ['main', 'adventure'] as const) {
    test(`v${version} ${history} migration preserves data and repairs both schemas`, (t) => {
      const directory = mkdtempSync(join(tmpdir(), 'party-migration-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const path = join(directory, 'party.sqlite');
      let store = new Store(path);
      const room = store.createRoom(loadConfig(), 'party', 1000);
      const player = store.join(
        store.room(room.id),
        { name: 'Test', emoji: '🦦', email: '', phone: '2125550100' },
        randomUUID(),
        1000,
      );
      if (history === 'main') {
        store.db.exec('DROP TABLE trivia_adventures; DROP TABLE trivia_adventure_pools');
      } else {
        store.db
          .prepare('INSERT INTO trivia_adventures VALUES(?,?,?,?)')
          .run(room.id, 1, 'cell', '{"saved":true}');
        store.db.exec('ALTER TABLE ledger DROP COLUMN reward_kind');
      }
      store.db.exec(`PRAGMA user_version=${version}`);
      store.close();
      store = new Store(path);
      assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 18);
      assert.equal(store.room(room.id).code, room.code);
      assert.equal(store.player(player.playerId).spendable, 1000);
      assert.equal(
        store.db.prepare('SELECT count(*) AS n FROM ledger WHERE player_id=?').get(player.playerId)
          ?.n,
        1,
      );
      assert.ok(
        store.db
          .prepare('PRAGMA table_info(ledger)')
          .all()
          .some((col) => col.name === 'reward_kind'),
      );
      assert.ok(
        store.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trivia_adventure_pools'",
          )
          .get(),
      );
      const row = store.db
        .prepare('SELECT state FROM trivia_adventures WHERE room_id=?')
        .get(room.id);
      if (history === 'adventure') assert.equal(row?.state, '{"saved":true}');
      store.close();
      store = new Store(path);
      assert.equal(store.room(room.id).code, room.code);
      store.close();
    });
  }
}
