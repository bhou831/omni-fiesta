import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { RoomSnapshot } from '../src/shared/contracts.js';

const count = Number(process.argv[2] ?? 15);
if (!Number.isInteger(count) || count < 1 || count > 100)
  throw new Error('Choose between 1 and 100 simulated players.');
const password = process.env.HOST_PASSWORD;
if (!password) throw new Error('Set HOST_PASSWORD in .env before running the simulator.');
const base = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
async function request(path: string, body?: unknown, cookie = '') {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const host = await request('/api/login', { password });
const { data: room } = await request(
  '/api/rooms',
  { requestId: randomUUID(), mode: 'rehearsal' },
  host.cookie,
);
const sockets: Socket[] = [];
try {
  const players = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const player = await request(`/api/rooms/${room.code}/join`, {
        joinKey: randomUUID(),
        profile: {
          name: `Guest ${index + 1}`,
          emoji: ['🦊', '🐸', '🦄', '🐼'][index % 4],
          email: `guest${index + 1}@example.test`,
          phone: '+1 212 555 0100',
        },
      });
      const socket = io(base, {
        autoConnect: false,
        transports: ['websocket'],
        extraHeaders: { Cookie: player.cookie },
        auth: { role: 'player', code: room.code },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Player connection timed out')), 5000);
        socket.once('state', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once('connect_error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        socket.connect();
      });
      await request(
        `/api/rooms/${room.code}/commands`,
        {
          requestId: randomUUID(),
          phaseInstance: 0,
          type: 'player.ready',
          payload: { ready: true },
        },
        player.cookie,
      );
      return player;
    }),
  );
  await request(
    `/api/rooms/${room.code}/commands?role=host`,
    { requestId: randomUUID(), phaseInstance: 0, type: 'phase.advance' },
    host.cookie,
  );
  await Promise.all(
    players.map((player) =>
      request(
        `/api/rooms/${room.code}/commands`,
        {
          requestId: randomUUID(),
          phaseInstance: 1,
          type: 'phase.action',
          payload: { action: 'check-in' },
        },
        player.cookie,
      ),
    ),
  );
  const state = (await request(`/api/rooms/${room.code}/state?role=host`, undefined, host.cookie))
    .data as RoomSnapshot;
  assert.equal(state.players.length, count);
  assert.equal(state.players.filter((p) => p.checkedIn).length, count);
  assert.equal(state.host?.ledger.length, count);
  assert.ok(state.host?.players.every((p) => p.accounts.spendable === 1000));
  await request(
    `/api/rooms/${room.code}/commands?role=host`,
    { requestId: randomUUID(), phaseInstance: 1, type: 'phase.close' },
    host.cookie,
  );
  await request(
    `/api/rooms/${room.code}/commands?role=host`,
    { requestId: randomUUID(), phaseInstance: 1, type: 'phase.advance' },
    host.cookie,
  );
  console.log(
    `Rehearsal ${room.code}: ${count} isolated players joined, connected, readied, checked in, and finished. One starting grant each; no tokens spent.`,
  );
} finally {
  sockets.forEach((socket) => socket.close());
}
