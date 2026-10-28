import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { prepareMarket } from '../src/server/games/prepare-market.js';
import { fixtureProvider } from '../src/server/games/market.js';
import { loadConfig } from '../src/server/config.js';
import { PARTY_STAGES } from '../src/shared/contracts.js';
import { api, RequestError } from '../src/client/api.js';

test('normal app registers every party phase and opens investments', async (t) => {
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: 'review-test-password',
    now: () => 1000000,
  });
  t.after(() => server.close());
  for (const stage of PARTY_STAGES) {
    if (stage !== 'lobby' && stage !== 'finish') assert.ok(server.engine.modules.has(stage), stage);
  }
  const room = server.store.createRoom(loadConfig(), 'party', 1000000, 'fixture');
  server.store.join(
    server.store.room(room.id),
    { name: 'Guest', emoji: '🦊', email: 'guest@example.test', phone: '2125550100' },
    randomUUID(),
    1000000,
  );
  await prepareMarket(server.store, room.id, 'opening', fixtureProvider(), () => 1000000);
  server.engine.execute({ role: 'host', roomId: null, playerId: null, tokenHash: '' }, room.id, {
    requestId: randomUUID(),
    phaseInstance: 0,
    type: 'phase.advance',
  });
  assert.equal(server.store.room(room.id).phase, 'investments');
});

test('body-read interruption retries the identical command and preserves uncertainty', async (t) => {
  const bodies: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_path: unknown, options: RequestInit) => {
    bodies.push(options.body);
    return {
      json: async () => {
        throw new TypeError('terminated');
      },
    };
  });
  const body = JSON.stringify({ requestId: randomUUID() });
  await assert.rejects(
    api('/commands', { method: 'POST', body }),
    (error: unknown) => error instanceof RequestError && error.code === 'NETWORK',
  );
  assert.deepEqual(bodies, [body, body]);
});

test('production trusts only local proxy addresses', async (t) => {
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: 'review-test-password',
    production: true,
    publicOrigin: 'https://party.example',
  });
  t.after(() => server.close());
  const trust = server.app.get('trust proxy fn') as (address: string) => boolean;
  assert.equal(trust('127.0.0.1'), true);
  assert.equal(trust('::1'), true);
  assert.equal(trust('203.0.113.20'), false);
  // Express's IP getter resolves distinct clients through the trusted proxy.
  const ip =
    Object.getOwnPropertyDescriptor(server.app.request, 'ip') ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(server.app.request), 'ip');
  const resolve = (address: string) =>
    ip!.get!.call({
      app: server.app,
      connection: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': address },
    });
  assert.equal(resolve('203.0.113.20'), '203.0.113.20');
  assert.equal(resolve('203.0.113.21'), '203.0.113.21');
});
