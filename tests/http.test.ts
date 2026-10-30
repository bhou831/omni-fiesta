import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { EMOJIS, type RoomSnapshot } from '../src/shared/contracts.js';

const password = 'local-test-host-password';
async function fixture() {
  let now = 1_000_000;
  const config = loadConfig();
  config.timers.investment_selection_seconds = 2;
  const server = createApp({
    databasePath: ':memory:',
    hostPassword: password,
    config,
    enableRehearsal: true,
    now: () => now,
  });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const request = async (path: string, body?: unknown, cookie = '', origin?: string) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
      headers: response.headers,
    };
  };
  const login = await request('/api/login', { password });
  assert.equal(login.status, 200);
  const hostCookie = login.cookie;
  const room = (
    await request('/api/rooms', { requestId: randomUUID(), mode: 'rehearsal' }, hostCookie)
  ).data as { code: string; id: string; displayToken: string };
  return {
    server,
    base,
    request,
    hostCookie,
    room,
    setNow: (value: number) => {
      now = value;
    },
  };
}
function stateWhere(
  socket: Socket,
  matches: (state: RoomSnapshot) => boolean = () => true,
): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('state', handle);
      reject(new Error('Timed out waiting for party state'));
    }, 4000);
    const handle = (state: RoomSnapshot) => {
      if (matches(state)) {
        clearTimeout(timer);
        socket.off('state', handle);
        resolve(state);
      }
    };
    socket.on('state', handle);
  });
}
test('HTTP and sockets enforce roles, synchronize players/TV, and preserve accepted commands', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  assert.equal((await f.request('/api/rooms')).status, 401);
  assert.equal(
    (
      await f.request(
        '/api/rooms',
        { requestId: randomUUID(), mode: 'rehearsal' },
        f.hostCookie,
        'https://evil.example',
      )
    ).status,
    403,
  );
  const profile = { name: 'Fox', emoji: '🦊', email: 'fox@example.test', phone: '+1 212 555 0100' };
  const joinBody = { joinKey: randomUUID(), profile };
  const player = await f.request(`/api/rooms/${f.room.code}/join`, joinBody);
  assert.equal(player.status, 200);
  assert.match(player.headers.get('set-cookie')!, /HttpOnly/i);
  const duplicate = await f.request(`/api/rooms/${f.room.code}/join`, joinBody);
  assert.equal(duplicate.data.playerId, player.data.playerId);
  const secondRoom = (
    await f.request('/api/rooms', { requestId: randomUUID(), mode: 'rehearsal' }, f.hostCookie)
  ).data;
  assert.equal(
    (await f.request(`/api/rooms/${secondRoom.code}/state`, undefined, player.cookie)).status,
    403,
  );
  const roleEscalation = await f.request(
    `/api/rooms/${f.room.code}/commands?role=host`,
    { requestId: randomUUID(), phaseInstance: 0, type: 'phase.advance' },
    player.cookie,
  );
  assert.equal(roleEscalation.status, 401);
  const tv = io(f.base, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { role: 'display', code: f.room.code, displayToken: f.room.displayToken },
  });
  const phone = io(f.base, {
    autoConnect: false,
    transports: ['websocket'],
    extraHeaders: { Cookie: player.cookie },
    auth: { role: 'player', code: f.room.code },
  });
  t.after(() => {
    tv.close();
    phone.close();
  });
  const tvInitial = stateWhere(tv);
  tv.connect();
  assert.equal((await tvInitial).host, undefined);
  const phoneInitial = stateWhere(phone);
  phone.connect();
  assert.equal((await phoneInitial).self?.accounts.spendable, 1000);
  const tvRound = stateWhere(tv, (s) => s.room.phase === 'connection-check');
  const phoneRound = stateWhere(phone, (s) => s.room.phase === 'connection-check');
  const advance = { requestId: randomUUID(), phaseInstance: 0, type: 'phase.advance' };
  assert.equal(
    (await f.request(`/api/rooms/${f.room.code}/commands?role=host`, advance, f.hostCookie)).status,
    200,
  );
  const [tvState, phoneState] = await Promise.all([tvRound, phoneRound]);
  assert.equal(tvState.room.deadlineAt, phoneState.room.deadlineAt);
  assert.equal(tvState.room.phaseInstance, 1);
  assert.equal(tvState.room.status, 'pending');
  const openPhone = stateWhere(phone, (s) => s.room.status === 'open');
  const openTV = stateWhere(tv, (s) => s.room.status === 'open');
  assert.equal(
    (
      await f.request(
        `/api/rooms/${f.room.code}/commands?role=host`,
        { requestId: randomUUID(), phaseInstance: 1, type: 'phase.start' },
        f.hostCookie,
      )
    ).status,
    200,
  );
  const [phoneStarted, tvStarted] = await Promise.all([openPhone, openTV]);
  assert.equal(phoneStarted.room.deadlineAt, tvStarted.room.deadlineAt);
  assert.equal(JSON.stringify(tvState).includes('example.test'), false);
  assert.equal(JSON.stringify(tvState).includes('spendable'), false);
  const checkIn = {
    requestId: randomUUID(),
    phaseInstance: 1,
    type: 'phase.action',
    payload: { action: 'check-in' },
  };
  const accepted = await f.request(`/api/rooms/${f.room.code}/commands`, checkIn, player.cookie);
  assert.equal(accepted.status, 200);
  f.setNow(phoneStarted.room.deadlineAt!);
  const late = await f.request(
    `/api/rooms/${f.room.code}/commands`,
    { ...checkIn, requestId: randomUUID() },
    player.cookie,
  );
  assert.equal(late.data.code, 'ROUND_CLOSED');
  assert.deepEqual(
    (await f.request(`/api/rooms/${f.room.code}/commands`, checkIn, player.cookie)).data,
    accepted.data,
  );
  const current = await f.request(`/api/rooms/${f.room.code}/state`, undefined, player.cookie);
  assert.equal(current.data.room.phase, 'connection-check');
  assert.equal(current.data.room.status, 'closed');
  assert.equal(current.data.self.accounts.spendable, 1000);
  phone.disconnect();
  const reconnected = stateWhere(phone, (s) => s.room.status === 'closed');
  phone.connect();
  assert.equal((await reconnected).self?.checkedIn, true);
});
test('unauthenticated public socket needs a capability and cannot masquerade as a host', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  for (const auth of [
    { role: 'display', code: f.room.code },
    { role: 'host', code: f.room.code },
  ]) {
    const socket = io(f.base, {
      transports: ['websocket'],
      auth,
      autoConnect: false,
      reconnection: false,
    });
    const rejected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Unauthorized socket was not rejected')),
        3000,
      );
      socket.once('connect_error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    socket.connect();
    await rejected;
    socket.close();
  }
});
test('production requires an HTTPS origin and rehearsal is disabled unless explicitly enabled', async (t) => {
  assert.throws(() =>
    createApp({ databasePath: ':memory:', hostPassword: password, production: true }),
  );
  const server = createApp({ databasePath: ':memory:', hostPassword: password });
  t.after(() => server.close());
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const response = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), mode: 'rehearsal' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'REHEARSAL_DISABLED');
});

test('email is optional at registration; provided addresses are validated and retries do not duplicate grants', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  for (const [index, email] of [undefined, '', '   ', 'guest@example.test'].entries()) {
    const profile = {
      name: `Guest ${index}`,
      emoji: '🦊',
      phone: '2125550100',
      ...(email === undefined ? {} : { email }),
    };
    const body = { joinKey: randomUUID(), profile };
    const joined = await f.request(`/api/rooms/${f.room.code}/join`, body);
    assert.equal(joined.status, 200);
    const retry = await f.request(`/api/rooms/${f.room.code}/join`, body);
    assert.equal(retry.data.playerId, joined.data.playerId);
    const state = await f.request(`/api/rooms/${f.room.code}/state`, undefined, joined.cookie);
    assert.equal(state.data.self.accounts.spendable, 1000);
    assert.equal(f.server.store.player(joined.data.playerId).email, email?.trim() ?? '');
  }
  const invalid = await f.request(`/api/rooms/${f.room.code}/join`, {
    joinKey: randomUUID(),
    profile: { name: 'Invalid', emoji: '🦊', phone: '2125550100', email: 'not-an-email' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(f.server.store.players(f.room.id).length, 4);
});

test(
  'independent host devices control one room while an authenticated TV receives only public state',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture();
    t.after(() => f.server.close());
    // The fixture signed in the phone first. Signing in on the Mac must leave it valid.
    const mac = await f.request('/api/login', { password });
    assert.notEqual(mac.cookie, f.hostCookie);
    for (const cookie of [f.hostCookie, mac.cookie])
      assert.equal(
        (await f.request('/api/session?role=host', undefined, cookie)).data.authenticated,
        true,
      );
    const guest = await f.request(`/api/rooms/${f.room.code}/join`, {
      joinKey: randomUUID(),
      profile: { name: 'Otter', emoji: '🦦', phone: '2125550100', email: 'private@example.test' },
    });
    assert.equal(guest.status, 200);
    // Token-free /screen uses the Mac's host session but still projects the display role.
    const displayPath = `/api/rooms/${f.room.code}/state?role=display`;
    const publicState = await f.request(displayPath, undefined, mac.cookie);
    assert.equal(publicState.status, 200);
    assert.equal(publicState.data.host, undefined);
    assert.equal(publicState.data.self, undefined);
    for (const privateValue of ['2125550100', 'private@example.test', 'spendable'])
      assert.equal(JSON.stringify(publicState.data).includes(privateValue), false);
    for (const cookie of ['', guest.cookie])
      assert.equal((await f.request(displayPath, undefined, cookie)).status, 401);
    const invalidToken = await fetch(f.base + displayPath, {
      headers: { Cookie: mac.cookie, Authorization: 'Bearer invalid' },
    });
    assert.equal(invalidToken.status, 403); // Never silently upgrade a stale capability link.

    const tv = io(f.base, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Cookie: mac.cookie },
      auth: { role: 'display', code: f.room.code },
    });
    const phone = io(f.base, {
      autoConnect: false,
      transports: ['websocket'],
      extraHeaders: { Cookie: f.hostCookie },
      auth: { role: 'host', code: f.room.code },
    });
    const capabilityTv = io(f.base, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { role: 'display', code: f.room.code, displayToken: f.room.displayToken },
    });
    t.after(() => {
      tv.close();
      phone.close();
      capabilityTv.close();
    });
    const initial = stateWhere(tv);
    const hostInitial = stateWhere(phone);
    const capabilityInitial = stateWhere(capabilityTv);
    tv.connect();
    phone.connect();
    capabilityTv.connect();
    assert.equal((await initial).host, undefined);
    assert.equal((await hostInitial).host?.players[0].phone, '2125550100');
    assert.equal((await capabilityInitial).host, undefined);
    const nextTv = stateWhere(tv, (s) => s.room.phaseInstance === 1);
    const nextHost = stateWhere(phone, (s) => s.room.phaseInstance === 1);
    assert.equal(
      (
        await f.request(
          `/api/rooms/${f.room.code}/commands?role=host`,
          {
            requestId: randomUUID(),
            phaseInstance: 0,
            type: 'phase.advance',
          },
          f.hostCookie,
        )
      ).status,
      200,
    );
    assert.equal((await nextTv).host, undefined);
    assert.equal((await nextHost).room.phaseInstance, 1);
    // Signing out on the Mac disconnects only its session-backed TV, not the phone or capability TV.
    const disconnected = new Promise<void>((resolve) => tv.once('disconnect', () => resolve()));
    assert.equal((await f.request('/api/logout', {}, mac.cookie)).status, 200);
    await disconnected;
    assert.equal((await f.request(displayPath, undefined, mac.cookie)).status, 401);
    assert.equal(
      (await f.request('/api/session?role=host', undefined, f.hostCookie)).data.authenticated,
      true,
    );
    const syncedHost = stateWhere(phone);
    const syncedCapability = stateWhere(capabilityTv);
    phone.emit('sync');
    capabilityTv.emit('sync');
    assert.equal((await syncedHost).room.phaseInstance, 1);
    assert.equal((await syncedCapability).host, undefined);
  },
);

test('the refreshed avatar palette is accepted at registration; saved older avatars remain intact', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  assert.equal(EMOJIS.length, 24);
  assert.equal(new Set(EMOJIS).size, 24);
  const legacy = f.server.store.join(
    f.server.store.room(f.room.id),
    {
      name: 'Existing guest',
      emoji: '🐯',
      phone: '2125550100',
    },
    randomUUID(),
    1000000,
  );
  for (const [index, emoji] of EMOJIS.entries()) {
    const result = await f.request(`/api/rooms/${f.room.code}/join`, {
      joinKey: randomUUID(),
      profile: { name: `Guest ${index}`, emoji, phone: '2125550100' },
    });
    assert.equal(result.status, 200, emoji);
  }
  const state = await f.request(
    `/api/rooms/${f.room.code}/state?role=host`,
    undefined,
    f.hostCookie,
  );
  assert.equal(
    state.data.players.find((p: { id: string }) => p.id === legacy.playerId).emoji,
    '🐯',
  );
});
