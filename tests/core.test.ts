import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, gameConfigSchema } from '../src/server/config.js';
import { Store, hash, type Session } from '../src/server/core/store.js';
import { Engine } from '../src/server/core/engine.js';
import { connectionCheck } from '../src/server/core/phases.js';
import { GameError } from '../src/server/core/errors.js';
import type { Command } from '../src/shared/contracts.js';

function fixture() {
  const store = new Store(':memory:');
  let now = 1_000_000;
  const config = loadConfig();
  config.timers.investment_selection_seconds = 2;
  const room = store.transaction(() => store.createRoom(config, 'rehearsal', now));
  const joinKey = randomUUID();
  const profile = { name: 'Fox', emoji: '🦦', email: 'fox@example.test', phone: '+1 212 555 0100' };
  const joined = store.join(store.room(room.id), profile, joinKey, now);
  const player = store.authenticate(joined.token, 'player', now, '')!;
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  const engine = new Engine(store, () => now);
  const cmd = (
    type: Command['type'],
    phaseInstance = store.room(room.id).phase_instance,
    payload?: Command['payload'],
  ): Command => ({ requestId: randomUUID(), type, phaseInstance, ...(payload ? { payload } : {}) });
  return {
    store,
    config,
    room,
    joined,
    player,
    host,
    engine,
    profile,
    joinKey,
    cmd,
    setNow: (value: number) => {
      now = value;
    },
  };
}
function errorCode(code: string) {
  return (error: unknown) => error instanceof GameError && error.code === code;
}

test('configuration rejects broken probabilities, oversized cap, unknown sessions, and duplicate assets', () => {
  const config = loadConfig();
  const badOdds = structuredClone(config);
  badOdds.slots.outcomes[0].probability = 0.2;
  assert.throws(() => gameConfigSchema.parse(badOdds));
  const badCap = structuredClone(config);
  badCap.investments.max_investment_tokens = 1001;
  assert.throws(() => gameConfigSchema.parse(badCap));
  assert.throws(() =>
    gameConfigSchema.parse({ ...config, timers: { ...config.timers, trivia_seconds: 60 } }),
  );
  const badAssets = structuredClone(config);
  badAssets.investments.assets[1].provider_id = badAssets.investments.assets[0].provider_id;
  assert.throws(() => gameConfigSchema.parse(badAssets));
});
test('duplicate joining grants tokens once and protects request identity', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const again = f.store.join(f.store.room(f.room.id), f.profile, f.joinKey, 1_000_001);
  assert.equal(again.playerId, f.joined.playerId);
  assert.equal(f.store.players(f.room.id).length, 1);
  assert.equal(f.store.player(again.playerId).spendable, 1000);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM ledger').get()?.n, 1);
  assert.throws(
    () =>
      f.store.join(f.store.room(f.room.id), { ...f.profile, name: 'Other' }, f.joinKey, 1_000_002),
    errorCode('REQUEST_CONFLICT'),
  );
});
test('role projections do not leak another player’s balance or contact details', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const second = f.store.join(
    f.store.room(f.room.id),
    { ...f.profile, name: 'Frog', email: 'frog@example.test' },
    randomUUID(),
    1_000_001,
  );
  const playerState = f.engine.snapshot({
    role: 'player',
    roomId: f.room.id,
    playerId: f.joined.playerId,
  });
  assert.equal(playerState.self?.accounts.spendable, 1000);
  assert.equal(playerState.host, undefined);
  assert.equal(JSON.stringify(playerState).includes('example.test'), false);
  assert.equal('accounts' in playerState.players.find((p) => p.id === second.playerId)!, false);
  const display = f.engine.snapshot({ role: 'display', roomId: f.room.id });
  assert.equal(display.self, undefined);
  assert.equal(display.host, undefined);
  assert.equal(JSON.stringify(display).includes('spendable'), false);
  assert.equal(JSON.stringify(display).includes('555'), false);
  assert.equal(
    f.engine.snapshot({ role: 'host', roomId: f.room.id }).host?.players[0].email,
    f.profile.email,
  );
  const [hostBatch, displayBatch, playerBatch] = f.engine.snapshots([
    { role: 'host', roomId: f.room.id },
    { role: 'display', roomId: f.room.id },
    { role: 'player', roomId: f.room.id, playerId: second.playerId },
  ]);
  assert.ok(hostBatch.host);
  assert.equal(displayBatch.host, undefined);
  assert.equal(displayBatch.self, undefined);
  assert.equal(playerBatch.host, undefined);
  assert.equal(playerBatch.self?.id, second.playerId);
});
test('only host advances, stale commands fail, and request payloads cannot be replaced', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  assert.throws(
    () => f.engine.execute(f.player, f.room.id, f.cmd('phase.advance')),
    errorCode('FORBIDDEN'),
  );
  const ready = f.cmd('player.ready', 0, { ready: true });
  const first = f.engine.execute(f.player, f.room.id, ready);
  assert.deepEqual(f.engine.execute(f.player, f.room.id, ready), first);
  assert.throws(
    () => f.engine.execute(f.player, f.room.id, { ...ready, payload: { ready: false } }),
    errorCode('REQUEST_CONFLICT'),
  );
  f.engine.execute(f.host, f.room.id, f.cmd('phase.advance'));
  f.engine.execute(f.host, f.room.id, f.cmd('phase.start'));
  assert.throws(
    () => f.engine.execute(f.player, f.room.id, f.cmd('phase.action', 0, { action: 'check-in' })),
    errorCode('STALE_PHASE'),
  );
});
test('deadline boundary closes submissions without creating actions, charges, or advancing', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.engine.execute(f.host, f.room.id, f.cmd('phase.advance'));
  f.engine.execute(f.host, f.room.id, f.cmd('phase.start'));
  const deadline = f.store.room(f.room.id).deadline_at!;
  f.setNow(deadline);
  assert.throws(
    () => f.engine.execute(f.player, f.room.id, f.cmd('phase.action', 1, { action: 'check-in' })),
    errorCode('ROUND_CLOSED'),
  );
  const room = f.store.room(f.room.id);
  assert.equal(room.phase, 'connection-check');
  assert.equal(room.status, 'closed');
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM check_ins').get()?.n, 0);
  assert.equal(f.store.player(f.joined.playerId).spendable, 1000);
  f.engine.execute(f.host, f.room.id, f.cmd('phase.advance'));
  assert.equal(f.store.room(f.room.id).phase, 'finish');
});
test('accepted action remains idempotent after expiry and advancement', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.engine.execute(f.host, f.room.id, f.cmd('phase.advance'));
  f.engine.execute(f.host, f.room.id, f.cmd('phase.start'));
  const action = f.cmd('phase.action', 1, { action: 'check-in' });
  const result = f.engine.execute(f.player, f.room.id, action);
  f.setNow(f.store.room(f.room.id).deadline_at! + 1);
  f.engine.execute(f.host, f.room.id, f.cmd('phase.advance'));
  assert.deepEqual(f.engine.execute(f.player, f.room.id, action), result);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM check_ins').get()?.n, 1);
});
test('two competing debits cannot overspend and ledger retries cannot debit twice', async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const debit = (key: string) =>
    f.store.transaction(() =>
      f.store.adjust(
        f.room.id,
        f.joined.playerId,
        key,
        'Test cost',
        { spendable: -600, locked: 0, reserved: 0 },
        1_000_000,
      ),
    );
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => debit('one')),
    Promise.resolve().then(() => debit('two')),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.store.player(f.joined.playerId).spendable, 400);
  debit('one');
  assert.equal(f.store.player(f.joined.playerId).spendable, 400);
  assert.throws(
    () =>
      f.store.transaction(() =>
        f.store.adjust(
          f.room.id,
          f.joined.playerId,
          'one',
          'Test cost',
          { spendable: -200, locked: 0, reserved: 0 },
          1_000_000,
        ),
      ),
    errorCode('REQUEST_CONFLICT'),
  );
});
test('account reservations and failed game transitions roll back as one unit', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.store.transaction(() =>
    f.store.adjust(
      f.room.id,
      f.joined.playerId,
      'lock',
      'Test lock',
      { spendable: -600, locked: 600, reserved: 0 },
      1_000_000,
    ),
  );
  assert.throws(
    () =>
      f.store.transaction(() =>
        f.store.adjust(
          f.room.id,
          f.joined.playerId,
          'too-much',
          'Test cost',
          { spendable: -500, locked: 0, reserved: 0 },
          1_000_000,
        ),
      ),
    errorCode('INSUFFICIENT_FUNDS'),
  );
  assert.equal(f.store.player(f.joined.playerId).locked, 600);
  const engine = new Engine(f.store, () => 1_000_000, [
    {
      ...connectionCheck,
      open: (context) => {
        context.store.adjust(
          f.room.id,
          f.joined.playerId,
          'bad-open',
          'Must roll back',
          { spendable: 100, locked: 0, reserved: 0 },
          context.now,
        );
        throw new Error('Preparation missing');
      },
    },
  ]);
  assert.throws(() => engine.execute(f.host, f.room.id, f.cmd('phase.advance')));
  assert.equal(f.store.room(f.room.id).phase, 'lobby');
  assert.equal(f.store.player(f.joined.playerId).spendable, 400);
  assert.equal(
    f.store.db.prepare("SELECT 1 FROM ledger WHERE operation_key='bad-open'").get(),
    undefined,
  );
});
test('multiple player tabs keep presence until the last connection leaves', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const connected = () =>
    f.engine.snapshot({ role: 'display', roomId: f.room.id }).players[0].connected;
  f.engine.presence(f.joined.playerId, 1);
  f.engine.presence(f.joined.playerId, 1);
  f.engine.presence(f.joined.playerId, -1);
  assert.equal(connected(), true);
  f.engine.presence(f.joined.playerId, -1);
  assert.equal(connected(), false);
});
test('saved configuration, sessions, ledger, and expired deadline survive reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'omni-fiesta-test-'));
  const path = join(directory, 'party.sqlite');
  let store = new Store(path);
  try {
    const config = loadConfig();
    config.timers.investment_selection_seconds = 2;
    const room = store.createRoom(config, 'rehearsal', 1000);
    const profile = {
      name: 'Fox',
      emoji: '🦦',
      email: 'fox@example.test',
      phone: '+1 212 555 0100',
    };
    const joined = store.join(store.room(room.id), profile, randomUUID(), 1000);
    const hostToken = store.session('host', 1000, hash('a-private-password'));
    const host = store.authenticate(hostToken, 'host', 1000, hash('a-private-password'))!;
    const engine = new Engine(store, () => 1000);
    engine.execute(host, room.id, {
      type: 'phase.advance',
      phaseInstance: 0,
      requestId: randomUUID(),
    });
    engine.execute(host, room.id, {
      type: 'phase.start',
      phaseInstance: 1,
      requestId: randomUUID(),
    });
    store.close();
    store = new Store(path);
    const reopened = new Engine(store, () => 4000);
    reopened.expireAll();
    assert.equal(store.room(room.id).deadline_at, 3000);
    assert.equal(store.room(room.id).status, 'closed');
    assert.equal(
      JSON.parse(store.room(room.id).config).investments.max_investment_tokens,
      config.investments.max_investment_tokens,
    );
    assert.ok(store.authenticate(joined.token, 'player', 4000, ''));
    assert.ok(store.authenticate(hostToken, 'host', 4000, hash('a-private-password')));
    assert.equal(store.authenticate(hostToken, 'host', 4000, hash('a-new-password')), null);
    assert.equal(store.player(joined.playerId).spendable, 1000);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM ledger').get()?.n, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('unimplemented party stages are guarded rather than shown as working games', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.store.db.prepare("UPDATE rooms SET mode='party' WHERE id=?").run(f.room.id);
  assert.throws(
    () => f.engine.execute(f.host, f.room.id, f.cmd('phase.advance')),
    errorCode('CANNOT_ADVANCE'),
  );
  assert.equal(f.store.room(f.room.id).phase, 'lobby');
});

test('host-assisted recovery replaces old credentials without another starting grant', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const token = f.store.issueRecovery(f.room.id, f.joined.playerId, 1000000);
  const replacement = f.store.recover(f.room.id, token, 1000001);
  assert.equal(f.store.authenticate(f.joined.token, 'player', 1000001, ''), null);
  assert.equal(
    f.store.authenticate(replacement, 'player', 1000001, '')?.playerId,
    f.joined.playerId,
  );
  assert.equal(f.store.player(f.joined.playerId).spendable, 1000);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM ledger').get()?.n, 1);
  assert.throws(() => f.store.recover(f.room.id, token, 1000002), errorCode('RECOVERY_INVALID'));
  const expired = f.store.issueRecovery(f.room.id, f.joined.playerId, 1000000);
  assert.throws(() => f.store.recover(f.room.id, expired, 1600000), errorCode('RECOVERY_INVALID'));
});

test('party final ranking includes every player with shared tied ranks', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const other = f.store.join(
    f.store.room(f.room.id),
    { ...f.profile, name: 'Frog' },
    randomUUID(),
    1000001,
  );
  f.store.db
    .prepare("UPDATE rooms SET mode='party',phase='finish',status='open' WHERE id=?")
    .run(f.room.id);
  // The ranking stays hidden from public screens until the host announces it; two players are one step.
  assert.deepEqual(f.engine.snapshot({ role: 'display', roomId: f.room.id }).ranking, []);
  f.store.db.prepare('INSERT INTO finish_reveal_progress(room_id,step) VALUES(?,1)').run(f.room.id);
  const state = f.engine.snapshot({ role: 'display', roomId: f.room.id });
  assert.equal(state.ranking?.length, 2);
  assert.deepEqual(
    state.ranking?.map((p) => p.rank),
    [1, 1],
  );
  assert.deepEqual(
    new Set(state.ranking?.map((p) => p.playerId)),
    new Set([f.joined.playerId, other.playerId]),
  );
  assert.doesNotMatch(JSON.stringify(state), /example\.test|212 555/);
});

test('host starts a timed round once; waiting and retries never consume time', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.engine.execute(f.host, f.room.id, f.cmd('phase.advance'));
  assert.equal(f.store.room(f.room.id).status, 'pending');
  assert.equal(f.store.room(f.room.id).deadline_at, null);
  f.setNow(5_000_000);
  assert.equal(f.engine.expire(f.room.id), false);
  assert.throws(
    () => f.engine.execute(f.player, f.room.id, f.cmd('phase.action', 1, { action: 'check-in' })),
    errorCode('ROUND_PENDING'),
  );
  assert.throws(
    () => f.engine.execute(f.player, f.room.id, f.cmd('phase.start')),
    errorCode('FORBIDDEN'),
  );
  const start = f.cmd('phase.start');
  const result = f.engine.execute(f.host, f.room.id, start);
  assert.equal(f.store.room(f.room.id).deadline_at, 5_002_000);
  f.setNow(5_001_000);
  assert.deepEqual(f.engine.execute(f.host, f.room.id, start), result);
  assert.throws(
    () => f.engine.execute(f.host, f.room.id, f.cmd('phase.start')),
    errorCode('CANNOT_START'),
  );
  assert.equal(f.store.room(f.room.id).deadline_at, 5_002_000);
});

test('pending timer survives restart without losing any of its duration', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'party-pending-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let store = new Store(path);
  const config = loadConfig();
  config.timers.investment_selection_seconds = 2;
  const room = store.transaction(() => store.createRoom(config, 'rehearsal', 1000));
  store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦦', email: 'fox@example.test', phone: '2125550100' },
    randomUUID(),
    1000,
  );
  const host: Session = { role: 'host', roomId: null, playerId: null, tokenHash: '' };
  new Engine(store, () => 1000).execute(host, room.id, {
    type: 'phase.advance',
    phaseInstance: 0,
    requestId: randomUUID(),
  });
  store.close();
  store = new Store(path);
  assert.equal(store.room(room.id).status, 'pending');
  assert.equal(store.room(room.id).deadline_at, null);
  const engine = new Engine(store, () => 999999);
  engine.execute(host, room.id, { type: 'phase.start', phaseInstance: 1, requestId: randomUUID() });
  assert.equal(store.room(room.id).deadline_at, 1001999);
  store.close();
});

test('recovery retries reissue the same credential only for the same request and within expiry', (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const token = f.store.issueRecovery(f.room.id, f.joined.playerId, 1000000);
  const requestId = randomUUID();
  const secret = 'test-secret';
  const replacement = f.store.recover(f.room.id, token, 1000001, requestId, secret);
  assert.equal(f.store.recover(f.room.id, token, 1000002, requestId, secret), replacement);
  assert.throws(
    () => f.store.recover(f.room.id, token, 1000003, randomUUID(), secret),
    errorCode('RECOVERY_INVALID'),
  );
  assert.throws(
    () => f.store.recover(f.room.id, token, 1600000, requestId, secret),
    errorCode('RECOVERY_INVALID'),
  );
  assert.equal(f.store.authenticate(f.joined.token, 'player', 1000001, ''), null);
  assert.equal(
    f.store.authenticate(replacement, 'player', 1000001, '')?.playerId,
    f.joined.playerId,
  );
  assert.equal(f.store.player(f.joined.playerId).spendable, 1000);
  f.store.issueRecovery(f.room.id, f.joined.playerId, 1000004);
  assert.throws(
    () => f.store.recover(f.room.id, token, 1000005, requestId, secret),
    errorCode('RECOVERY_INVALID'),
  );
});

test('recovery retry survives a server restart without issuing a second grant', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'party-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'party.sqlite');
  let store = new Store(path);
  const config = loadConfig();
  const room = store.transaction(() => store.createRoom(config, 'party', 1000));
  const player = store.join(
    store.room(room.id),
    { name: 'Fox', emoji: '🦦', email: 'fox@example.test', phone: '2125550100' },
    randomUUID(),
    1000,
  );
  const token = store.issueRecovery(room.id, player.playerId, 1000);
  const id = randomUUID();
  const replacement = store.recover(room.id, token, 1001, id, 'same-server-secret');
  store.close();
  store = new Store(path);
  t.after(() => store.close());
  assert.equal(store.recover(room.id, token, 1002, id, 'same-server-secret'), replacement);
  assert.equal(store.player(player.playerId).spendable, config.party.initial_tokens);
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM ledger WHERE player_id=?').get(player.playerId)?.n,
    1,
  );
});
