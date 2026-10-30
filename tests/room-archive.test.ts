import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { loadConfig } from '../src/server/config.js';

const profile = {
  name: 'Archive Test',
  emoji: '🦦',
  email: 'archive@example.test',
  phone: '2125550100',
};
test('host archives offline rooms, disconnects host/TV, and restores without deleting balances or extending timers', async (t) => {
  let now = 1000000;
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: 'archive-test-password',
    enableRehearsal: true,
    now: () => now,
  });
  const port = await server.listen();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const request = async (path: string, body?: unknown, cookie = '', origin = '') => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  };
  const host = (await request('/api/login', { password: 'archive-test-password' })).cookie;
  const room = (await request('/api/rooms', { requestId: randomUUID(), mode: 'rehearsal' }, host))
    .data;
  const player = await request(`/api/rooms/${room.code}/join`, { joinKey: randomUUID(), profile });
  const path = `/api/rooms/${room.code}/archive`;
  assert.equal((await request(path, { archived: true })).status, 401);
  assert.equal((await request(path, { archived: true }, player.cookie)).status, 401);
  assert.equal((await request(path, { archived: true }, host, 'https://evil.example')).status, 403);
  assert.equal((await request(path, { archived: 'yes' }, host)).status, 400);
  const connect = async (role: string, cookie: string, displayToken?: string) => {
    const socket = io(base, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      auth: { role, code: room.code, displayToken },
    });
    t.after(() => socket.disconnect());
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No socket state')), 3000);
      socket.once('state', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.connect();
    });
    return socket;
  };
  const online = await connect('player', player.cookie);
  assert.equal((await request(path, { archived: true }, host)).data.code, 'PLAYERS_CONNECTED');
  assert.equal(server.store.isArchived(room.id), false);
  const serverPlayer = [...server.io.sockets.sockets.values()].find(
    (s) => s.data.viewer.role === 'player',
  )!;
  const disconnected = new Promise<void>((resolve) =>
    serverPlayer.once('disconnect', () => resolve()),
  );
  online.disconnect();
  await disconnected;
  const hostSocket = await connect('host', host);
  const tvSocket = await connect('display', '', room.displayToken);
  const archivedEvents = [hostSocket, tvSocket].map(
    (socket) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Archive notification missing')), 3000);
        socket.once('room-archived', () => {
          clearTimeout(timer);
          resolve();
        });
      }),
  );
  server.store.db
    .prepare(
      "UPDATE rooms SET phase='connection-check',status='open',opened_at=?,deadline_at=? WHERE id=?",
    )
    .run(now, now + 1000, room.id);
  const before = server.store.player(player.data.playerId);
  const ledgerCount = server.store.db
    .prepare('SELECT count(*) AS n FROM ledger WHERE room_id=?')
    .get(room.id)?.n;
  assert.equal((await request(path, { archived: true }, host)).status, 200);
  await Promise.all(archivedEvents);
  const archivedVersion = server.store.db
    .prepare('SELECT version FROM rooms WHERE id=?')
    .get(room.id)?.version;
  assert.equal((await request(path, { archived: true }, host)).status, 200);
  assert.equal(
    server.store.db.prepare('SELECT version FROM rooms WHERE id=?').get(room.id)?.version,
    archivedVersion,
  );
  assert.equal((await request('/api/rooms', undefined, host)).data.rooms[0].archived, 1);
  const archivedSession = await request('/api/session?role=player', undefined, player.cookie);
  assert.equal(archivedSession.status, 200);
  assert.equal(archivedSession.data.authenticated, false);
  const nextRoom = (
    await request('/api/rooms', { requestId: randomUUID(), mode: 'rehearsal' }, host)
  ).data;
  const nextPlayer = await request(
    `/api/rooms/${nextRoom.code}/join`,
    { joinKey: randomUUID(), profile },
    player.cookie,
  );
  assert.equal(nextPlayer.status, 200);
  assert.equal(nextPlayer.data.roomCode, nextRoom.code);
  assert.equal(
    (await request(`/api/rooms/${room.code}/state?role=host`, undefined, host)).status,
    410,
  );
  assert.equal(
    (await request(`/api/rooms/${room.code}/join`, { joinKey: randomUUID(), profile })).status,
    410,
  );
  assert.equal(
    (
      await request(
        `/api/rooms/${room.code}/commands?role=host`,
        { requestId: randomUUID(), phaseInstance: 0, type: 'phase.close' },
        host,
      )
    ).status,
    410,
  );
  now += 2000;
  assert.deepEqual(server.engine.expireAll(), []);
  assert.equal((await request(path, { archived: false }, host)).status, 200);
  assert.equal(
    (await request('/api/session?role=player', undefined, player.cookie)).data.roomCode,
    room.code,
  );
  const restored = (await request(`/api/rooms/${room.code}/state`, undefined, player.cookie)).data;
  assert.equal(restored.room.status, 'closed');
  assert.equal(restored.room.deadlineAt, 1001000);
  assert.deepEqual(server.store.player(player.data.playerId), before);
  assert.equal(
    server.store.db.prepare('SELECT count(*) AS n FROM ledger WHERE room_id=?').get(room.id)?.n,
    ledgerCount,
  );
});

test('archive migration and restoration survive restart with the saved room and ledger intact', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'party-archive-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'party.sqlite');
  let store = new Store(path);
  const room = store.createRoom(loadConfig(), 'party', 1000);
  const player = store.join(store.room(room.id), profile, randomUUID(), 1000);
  store.transaction(() =>
    store.adjust(
      room.id,
      player.playerId,
      'test:lock',
      'Test investment lock',
      { spendable: -600, locked: 600, reserved: 0 },
      1100,
    ),
  );
  store.transaction(() =>
    store.adjust(
      room.id,
      player.playerId,
      'test:reserve',
      'Test bet reservation',
      { spendable: -100, locked: 0, reserved: 100 },
      1200,
    ),
  );
  // Emulate an existing version-7 party before the additive archive migration.
  store.db.exec('DROP TABLE archived_rooms; PRAGMA user_version=7');
  store.close();
  store = new Store(path);
  assert.equal(store.db.prepare('PRAGMA user_version').get()?.user_version, 18);
  assert.equal(store.player(player.playerId).spendable, 300);
  store.setArchived(room.code, true, 2000);
  store.close();
  store = new Store(path);
  t.after(() => store.close());
  assert.throws(() => store.roomByCode(room.code), /archived/);
  assert.deepEqual(new Engine(store).expireAll(), []);
  store.setArchived(room.code, false, 3000);
  assert.equal(store.roomByCode(room.code).id, room.id);
  assert.equal(store.player(player.playerId).spendable, 300);
  assert.equal(store.player(player.playerId).locked, 600);
  assert.equal(store.player(player.playerId).reserved, 100);
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM ledger WHERE player_id=?').get(player.playerId)?.n,
    3,
  );
});
