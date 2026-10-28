import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/server/app.js';
import { PARTY_STAGES, type RoomSnapshot } from '../src/shared/contracts.js';

function next(socket: Socket, matches: (s: RoomSnapshot) => boolean) {
  return new Promise<RoomSnapshot>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('state', handler);
      reject(new Error('Socket state timeout'));
    }, 4000);
    const handler = (state: RoomSnapshot) => {
      if (matches(state)) {
        clearTimeout(timer);
        socket.off('state', handler);
        resolve(state);
      }
    };
    socket.on('state', handler);
  });
}
test('investment HTTP and sockets preserve role privacy and committed state', async (t) => {
  let now = 1000000;
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: 'test-host-password',
    enableRehearsal: true,
    now: () => now,
  });
  const port = await server.listen();
  t.after(() => server.close());
  // Exercise normal startup, so a test-only module override cannot hide missing registration.
  assert.deepEqual(
    [...server.engine.modules.keys()].sort(),
    [
      ...PARTY_STAGES.filter((stage) => stage !== 'lobby' && stage !== 'finish'),
      'connection-check',
    ].sort(),
  );
  const base = `http://127.0.0.1:${port}`;
  const request = async (path: string, body?: unknown, cookie = '', token = '') => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  };
  const login = await request('/api/login', { password: 'test-host-password' });
  const room = (
    await request(
      '/api/rooms',
      { requestId: randomUUID(), mode: 'party', marketSource: 'fixture' },
      login.cookie,
    )
  ).data;
  const joined = await request(`/api/rooms/${room.code}/join`, {
    joinKey: randomUUID(),
    profile: { name: 'Fox', emoji: '🦊', email: 'private@example.test', phone: '2125550100' },
  });
  assert.equal(
    (await request(`/api/rooms/${room.code}/market/opening`, {}, joined.cookie)).status,
    401,
  );
  assert.equal(
    (await request(`/api/rooms/${room.code}/market/opening`, {}, login.cookie)).status,
    200,
  );
  const phone = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: joined.cookie },
    auth: { role: 'player', code: room.code },
  });
  const tv = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { role: 'display', code: room.code, displayToken: room.displayToken },
  });
  const host = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: login.cookie },
    auth: { role: 'host', code: room.code },
  });
  t.after(() => {
    phone.close();
    tv.close();
    host.close();
  });
  const initial = [next(phone, () => true), next(tv, () => true), next(host, () => true)];
  phone.connect();
  tv.connect();
  host.connect();
  await Promise.all(initial);
  const updates = [
    next(phone, (s) => s.room.phase === 'investments'),
    next(tv, (s) => s.room.phase === 'investments'),
    next(host, (s) => s.room.phase === 'investments'),
  ];
  assert.equal(
    (
      await request(
        `/api/rooms/${room.code}/commands?role=host`,
        { requestId: randomUUID(), phaseInstance: 0, type: 'phase.advance' },
        login.cookie,
      )
    ).status,
    200,
  );
  const [phoneState, tvState] = await Promise.all(updates);
  assert.equal(phoneState.room.marketSource, 'fixture');
  assert.equal(phoneState.room.status, 'pending');
  const startedPhone = next(phone, (s) => s.room.status === 'open');
  assert.equal(
    (
      await request(
        `/api/rooms/${room.code}/commands?role=host`,
        { requestId: randomUUID(), phaseInstance: 1, type: 'phase.start' },
        login.cookie,
      )
    ).status,
    200,
  );
  const started = await startedPhone;
  assert.equal(tvState.room.deadlineAt, phoneState.room.deadlineAt);
  const investment = {
    requestId: randomUUID(),
    phaseInstance: 1,
    type: 'phase.action',
    payload: { action: 'invest', data: { assetId: 'bitcoin', amount: 600 } },
  };
  const playerUpdate = next(phone, (s) => s.self?.accounts.locked === 600);
  const hostUpdate = next(host, (s) => s.host?.investments.length === 1);
  assert.equal(
    (await request(`/api/rooms/${room.code}/commands`, investment, joined.cookie)).status,
    200,
  );
  const [playerSnapshot, hostSnapshot] = await Promise.all([playerUpdate, hostUpdate]);
  assert.equal(playerSnapshot.self?.accounts.spendable, 400);
  assert.equal(hostSnapshot.host?.investments[0].principal, 600);
  const publicState = await request(
    `/api/rooms/${room.code}/state?role=display`,
    undefined,
    '',
    room.displayToken,
  );
  assert.deepEqual(publicState.data.investments.positions, []);
  assert.doesNotMatch(
    JSON.stringify(publicState.data),
    /private@example|2125550100|spendable|principal/,
  );
  assert.equal(
    (await request(`/api/rooms/${room.code}/commands`, investment, joined.cookie)).status,
    200,
  );
  now = started.room.deadlineAt!;
  assert.equal(
    (
      await request(
        `/api/rooms/${room.code}/commands`,
        { ...investment, requestId: randomUUID() },
        joined.cookie,
      )
    ).data.code,
    'ROUND_CLOSED',
  );
  phone.disconnect();
  const reconnected = next(phone, (s) => s.self?.accounts.locked === 600);
  phone.connect();
  assert.equal((await reconnected).room.status, 'closed');
  // Isolated transport harness moves directly to review; production exposes no skip command.
  server.store.db
    .prepare(
      "UPDATE rooms SET phase='investment-review',phase_instance=2,status='open',deadline_at=NULL WHERE id=?",
    )
    .run(room.id);
  assert.equal(
    (await request(`/api/rooms/${room.code}/market/closing`, {}, login.cookie)).status,
    200,
  );
  const settle = {
    requestId: randomUUID(),
    phaseInstance: 2,
    type: 'phase.host',
    payload: { action: 'settle' },
  };
  assert.equal(
    (await request(`/api/rooms/${room.code}/commands?role=host`, settle, login.cookie)).status,
    200,
  );
  assert.equal(
    (await request(`/api/rooms/${room.code}/commands?role=host`, settle, login.cookie)).status,
    200,
  );
  const review = (await request(`/api/rooms/${room.code}/state`, undefined, joined.cookie)).data;
  assert.equal(review.self.accounts.locked, 0);
  assert.equal(review.self.accounts.spendable, 1000);
  assert.equal(review.investments.positions[0].payout, 600);
  assert.equal(
    (
      await request(
        `/api/rooms/${room.code}/recovery`,
        { playerId: joined.data.playerId },
        joined.cookie,
      )
    ).status,
    401,
  );
  const link = await request(
    `/api/rooms/${room.code}/recovery`,
    { playerId: joined.data.playerId },
    login.cookie,
  );
  const recovered = await request(`/api/rooms/${room.code}/recover`, { token: link.data.token });
  assert.equal(recovered.status, 200);
  assert.equal(
    (await request(`/api/rooms/${room.code}/state`, undefined, joined.cookie)).status,
    401,
  );
  assert.equal(
    (await request(`/api/rooms/${room.code}/state`, undefined, recovered.cookie)).data.self.accounts
      .spendable,
    1000,
  );
  assert.equal(
    (await request(`/api/rooms/${room.code}/recover`, { token: link.data.token })).status,
    400,
  );
});
