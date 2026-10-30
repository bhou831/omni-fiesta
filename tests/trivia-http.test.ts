import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/server/app.js';
import { hash } from '../src/server/core/store.js';
import type { RoomSnapshot } from '../src/shared/contracts.js';
import { PREVIEW_SCENARIOS, seedPreviewRoom } from '../scripts/preview-fixtures.js';

function next(socket: Socket, match: (state: RoomSnapshot) => boolean) {
  return new Promise<RoomSnapshot>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('state', handler);
      reject(new Error('Trivia socket timeout'));
    }, 4000);
    function handler(state: RoomSnapshot) {
      if (match(state)) {
        clearTimeout(timeout);
        socket.off('state', handler);
        resolve(state);
      }
    }
    socket.on('state', handler);
  });
}
test('trivia HTTP and socket snapshots protect hidden content, authorize host actions and restore selection on reconnect', async (t) => {
  const password = 'trivia-transport-password';
  const app = createApp({ databasePath: ':memory:', hostPassword: password });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const base = `http://127.0.0.1:${await app.listen()}`;
  t.after(() => app.close());
  const hostCookie = `of_host=${app.store.session('host', Date.now(), hash(password))}`;
  const playerCookie = `of_player=${app.store.session('player', Date.now(), null, room.playerId, room.id)}`;
  const request = async (role: string, cookie: string, body?: unknown) => {
    const response = await fetch(
      `${base}/api/rooms/${room.code}/${body ? 'commands' : 'state'}?role=${role}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(role === 'display' ? { Authorization: `Bearer ${room.displayToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  const command = (action: string, data: Record<string, unknown> = { cellId: 'childhood-1' }) => ({
    requestId: randomUUID(),
    phaseInstance: app.store.room(room.id).phase_instance,
    type: 'phase.host',
    payload: { action, data },
  });
  const tv = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { role: 'display', code: room.code, displayToken: room.displayToken },
  });
  const phone = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { role: 'player', code: room.code },
    extraHeaders: { Cookie: playerCookie },
  });
  const host = io(base, {
    autoConnect: false,
    transports: ['websocket'],
    auth: { role: 'host', code: room.code },
    extraHeaders: { Cookie: hostCookie },
  });
  t.after(() => {
    tv.close();
    phone.close();
    host.close();
  });
  const initial = [next(tv, () => true), next(phone, () => true), next(host, () => true)];
  tv.connect();
  phone.connect();
  host.connect();
  await Promise.all(initial);
  assert.equal((await request('player', playerCookie, command('select-cell'))).status, 403);
  // Display is not a valid command role; transport rejects it before dispatch.
  assert.equal((await request('display', '', command('select-cell'))).status, 400);
  assert.equal(
    (
      await request(
        'player',
        playerCookie,
        command('set-demo-mode', { demo: false, expectedBankVersion: 'demo-2' }),
      )
    ).status,
    403,
  );
  assert.equal((await request('display', '')).data.trivia.bankSwitch, undefined);
  assert.equal((await request('player', playerCookie)).data.trivia.bankSwitch, undefined);
  const selected = next(tv, (s) => !!s.trivia?.board?.selected);
  assert.equal((await request('host', hostCookie, command('select-cell'))).status, 200);
  const tvState = await selected;
  const forbidden =
    /哆啦A梦|答「机器猫」也可|example.test|2125550100|awardHistory|hostNotes|musicCandidates|spendable|bankSwitch/;
  assert.doesNotMatch(JSON.stringify(tvState), forbidden);
  assert.doesNotMatch(JSON.stringify((await request('display', '')).data), forbidden);
  const phoneState = (await request('player', playerCookie)).data;
  assert.equal(phoneState.trivia.board, undefined);
  assert.doesNotMatch(JSON.stringify(phoneState.trivia), /四次元口袋|哆啦A梦|score/);
  assert.match(JSON.stringify((await request('host', hostCookie)).data.trivia), /哆啦A梦/);
  tv.disconnect();
  const reconnected = next(tv, (s) => !!s.trivia?.board?.selected);
  tv.connect();
  assert.equal((await reconnected).trivia!.board!.selected!.id, 'childhood-1');
  assert.equal((await request('host', hostCookie, command('arm'))).status, 200);
  const windowId = (await request('player', playerCookie)).data.trivia.windowId;
  const otherId = app.store.players(room.id).find((p) => p.id !== room.playerId)!.id;
  const otherCookie = `of_player=${app.store.session('player', Date.now(), null, otherId, room.id)}`;
  const buzz = () => ({
    requestId: randomUUID(),
    phaseInstance: app.store.room(room.id).phase_instance,
    type: 'phase.action',
    payload: { action: 'buzz', data: { windowId } },
  });
  const race = await Promise.all([
    request('player', playerCookie, buzz()),
    request('player', otherCookie, buzz()),
  ]);
  assert.equal(race.filter((result) => result.status === 200).length, 1);
  assert.equal(race.filter((result) => result.data.code === 'BUZZER_CLOSED').length, 1);
  const revealed = next(tv, (s) => !!s.trivia?.board?.revealed);
  await request('host', hostCookie, command('reveal-answer'));
  assert.match((await revealed).trivia!.board!.selected!.answer!, /哆啦A梦/);
  assert.equal((await request('player', playerCookie)).data.trivia.board, undefined);

  // Score, correct, finish and change questions through the real transport, with all roles live.
  const winningTeam = (await request('host', hostCookie)).data.trivia.winner.teamId;
  const before = (await request('player', playerCookie)).data.self.accounts.spendable;
  const ownTeam = (await request('player', playerCookie)).data.trivia.ownTeamId;
  const beforeAwardVersion = (await request('host', hostCookie)).data.room.version;
  const sync = (match: (s: RoomSnapshot) => boolean) =>
    Promise.all([next(host, match), next(tv, match), next(phone, match)]);
  const scored = sync(
    (s) =>
      s.trivia?.teams.find((t) => t.id === winningTeam)?.score === 100 ||
      (s.self !== undefined && s.trivia?.question === 1 && s.room.version > beforeAwardVersion),
  );
  const award = await request(
    'host',
    hostCookie,
    command('award', {
      cellId: 'childhood-1',
      teamId: winningTeam,
      amount: 100,
    }),
  );
  assert.equal(award.status, 200);
  await scored;
  assert.equal(
    (await request('player', playerCookie)).data.self.accounts.spendable,
    before + (ownTeam === winningTeam ? 100 : 0),
  );
  const awardId = (await request('host', hostCookie)).data.trivia.awardHistory[0].id;
  assert.equal((await request('host', hostCookie, command('undo-award', { awardId }))).status, 200);
  assert.equal((await request('player', playerCookie)).data.self.accounts.spendable, before);
  assert.ok(
    (await request('display', '')).data.trivia.teams.every((t: { score: number }) => t.score === 0),
  );
  const finished = sync(
    (s) =>
      s.trivia?.question === 1 &&
      s.trivia.status === 'idle' &&
      !s.trivia.winner &&
      (!s.trivia.board || (!s.trivia.board.selected && s.trivia.board.cells[0].used)),
  );
  assert.equal((await request('host', hostCookie, command('finish-cell'))).status, 200);
  await finished;
  const changed = sync(
    (s) => s.trivia?.question === 2 && s.trivia.status === 'idle' && !s.trivia.winner,
  );
  assert.equal(
    (await request('host', hostCookie, command('select-cell', { cellId: 'childhood-2' }))).status,
    200,
  );
  await changed;
  assert.equal(
    (await request('host', hostCookie, command('arm', { cellId: 'childhood-2' }))).status,
    200,
  );
  assert.equal((await request('player', playerCookie, buzz())).data.code, 'STALE_WINDOW');
  const nextWindow = (await request('player', playerCookie)).data.trivia.windowId;
  const locked = sync((s) => s.trivia?.windowId === nextWindow && s.trivia?.status === 'locked');
  const newBuzz = buzz();
  newBuzz.payload.data.windowId = nextWindow;
  assert.equal((await request('player', playerCookie, newBuzz)).status, 200);
  await locked;
});

test('selected synthetic music is served only to authenticated host or TV and never exposed on phones', async (t) => {
  const password = 'trivia-audio-password';
  const app = createApp({ databasePath: ':memory:', hostPassword: password });
  const room = await seedPreviewRoom(
    app.engine,
    PREVIEW_SCENARIOS.find((s) => s.key === 'trivia')!,
  );
  const base = `http://127.0.0.1:${await app.listen()}`;
  t.after(() => app.close());
  const hostCookie = `of_host=${app.store.session('host', Date.now(), hash(password))}`;
  const content = JSON.parse(
    (
      app.store.db.prepare('SELECT content FROM trivia_boards WHERE room_id=?').get(room.id) as {
        content: string;
      }
    ).content,
  ) as { cells: { id: string; kind: string }[] };
  const cell = content.cells.find((c) => c.kind === 'music')!;
  const hostSession = app.store.authenticate(
    hostCookie.split('=')[1],
    'host',
    Date.now(),
    hash(password),
  )!;
  app.engine.execute(hostSession, room.id, {
    requestId: randomUUID(),
    phaseInstance: app.store.room(room.id).phase_instance,
    type: 'phase.host',
    payload: { action: 'select-cell', data: { cellId: cell.id } },
  });
  const path = `${base}/api/rooms/${room.code}/trivia-audio/${cell.id}`;
  assert.equal((await fetch(path)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/api/rooms/${room.code}/trivia-audio/childhood-1`, {
        headers: { Cookie: hostCookie },
      })
    ).status,
    404,
  );
  const hostAudio = await fetch(path, { headers: { Cookie: hostCookie } });
  assert.equal(hostAudio.status, 200);
  assert.equal(hostAudio.headers.get('content-type'), 'audio/wav');
  const audioSize = Number(hostAudio.headers.get('content-length'));
  assert.ok(audioSize > 44);
  const partial = await fetch(path, {
    headers: { Cookie: hostCookie, Range: 'bytes=0-43' },
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 0-43/${audioSize}`);
  assert.equal((await partial.arrayBuffer()).byteLength, 44);
  const invalidRange = await fetch(path, {
    headers: { Cookie: hostCookie, Range: 'bytes=999999999-' },
  });
  assert.equal(invalidRange.status, 416);
  const tvAudio = await fetch(`${path}?displayToken=${encodeURIComponent(room.displayToken)}`);
  assert.equal(tvAudio.status, 200);
  const hostStateResponse = await fetch(`${base}/api/rooms/${room.code}/state?role=host`, {
    headers: { Cookie: hostCookie },
  });
  const hostState = (await hostStateResponse.json()) as RoomSnapshot;
  assert.equal(hostState.trivia?.board?.selected?.answer, '三段音逐渐升高。');
  const tvStateResponse = await fetch(`${base}/api/rooms/${room.code}/state?role=display`, {
    headers: { Authorization: `Bearer ${room.displayToken}` },
  });
  const tvState = (await tvStateResponse.json()) as RoomSnapshot;
  assert.deepEqual(tvState.trivia?.board?.selected?.musicClip, { start: 0, end: 1.2 });
  assert.equal(tvState.trivia?.board?.selected?.answer, undefined);
  const phone = await fetch(`${base}/api/rooms/${room.code}/state?role=player`, {
    headers: {
      Cookie: `of_player=${app.store.session('player', Date.now(), null, room.playerId, room.id)}`,
    },
  });
  const phoneState = (await phone.json()) as RoomSnapshot;
  assert.equal(phoneState.trivia?.board, undefined);
  assert.doesNotMatch(
    JSON.stringify(phoneState.trivia),
    /demo-tone|audio-ssl|musicClip|hostAnswer/,
  );
});
