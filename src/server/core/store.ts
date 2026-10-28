import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Accounts, Profile, Stage } from '../../shared/contracts.js';
import { configHash, type GameConfig } from '../config.js';
import { requireRule } from './errors.js';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface RoomRow {
  id: string;
  code: string;
  mode: 'party' | 'rehearsal';
  config: string;
  config_hash: string;
  phase: Stage;
  phase_instance: number;
  status: 'open' | 'closed';
  opened_at: number | null;
  deadline_at: number | null;
  version: number;
  created_at: number;
}
export interface PlayerRow {
  id: string;
  room_id: string;
  name: string;
  email: string;
  phone: string;
  emoji: string;
  ready: number;
  spendable: number;
  locked: number;
  reserved: number;
  created_at: number;
}
export interface Session {
  role: 'host' | 'player';
  playerId: string | null;
  roomId: string | null;
  tokenHash: string;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    const schemaVersion = Number(this.db.prepare('PRAGMA user_version').get()?.user_version);
    if (schemaVersion > 1) {
      this.db.close();
      throw new Error(
        'Database schema is newer than this application. Use the matching application version.',
      );
    }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,mode TEXT NOT NULL,config TEXT NOT NULL,config_hash TEXT NOT NULL,phase TEXT NOT NULL,phase_instance INTEGER NOT NULL,status TEXT NOT NULL,opened_at INTEGER,deadline_at INTEGER,version INTEGER NOT NULL,display_token_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,emoji TEXT NOT NULL,ready INTEGER NOT NULL DEFAULT 0,spendable INTEGER NOT NULL DEFAULT 0 CHECK(spendable>=0),locked INTEGER NOT NULL DEFAULT 0 CHECK(locked>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS room_player_name ON players(room_id,name COLLATE NOCASE);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,room_id TEXT REFERENCES rooms(id),player_id TEXT REFERENCES players(id),credential_hash TEXT,expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS joins(key_hash TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),player_id TEXT NOT NULL REFERENCES players(id),fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(scope TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(scope,request_id));
      CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL REFERENCES rooms(id),player_id TEXT NOT NULL REFERENCES players(id),operation_key TEXT NOT NULL,reason TEXT NOT NULL,spendable INTEGER NOT NULL,locked INTEGER NOT NULL,reserved INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(player_id,operation_key));
      CREATE TABLE IF NOT EXISTS check_ins(room_id TEXT NOT NULL REFERENCES rooms(id),phase_instance INTEGER NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),created_at INTEGER NOT NULL,PRIMARY KEY(room_id,phase_instance,player_id));
      PRAGMA user_version=1;`);
  }
  transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  room(id: string): RoomRow {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id=?').get(id) as unknown as
      RoomRow | undefined;
    requireRule(row, 'ROOM_NOT_FOUND', 'Party not found.', 404);
    return row;
  }
  roomByCode(code: string): RoomRow {
    const row = this.db.prepare('SELECT id FROM rooms WHERE code=?').get(code.toUpperCase()) as
      { id: string } | undefined;
    requireRule(row, 'ROOM_NOT_FOUND', 'Check your party code and try again.', 404);
    return this.room(row.id);
  }
  players(roomId: string): PlayerRow[] {
    return this.db
      .prepare('SELECT * FROM players WHERE room_id=? ORDER BY created_at,id')
      .all(roomId) as unknown as PlayerRow[];
  }
  player(id: string): PlayerRow {
    const row = this.db.prepare('SELECT * FROM players WHERE id=?').get(id) as unknown as
      PlayerRow | undefined;
    requireRule(row, 'PLAYER_NOT_FOUND', 'Player not found.', 404);
    return row;
  }
  bump(roomId: string): void {
    this.db.prepare('UPDATE rooms SET version=version+1 WHERE id=?').run(roomId);
  }
  once<T>(scope: string, requestId: string, payload: unknown, run: () => T): T {
    const fingerprint = hash(JSON.stringify(payload));
    const saved = this.db
      .prepare('SELECT fingerprint,result FROM operations WHERE scope=? AND request_id=?')
      .get(scope, requestId) as { fingerprint: string; result: string } | undefined;
    if (saved) {
      requireRule(
        saved.fingerprint === fingerprint,
        'REQUEST_CONFLICT',
        'This request ID was already used for a different action.',
        409,
      );
      return JSON.parse(saved.result) as T;
    }
    const result = run();
    this.db
      .prepare('INSERT INTO operations(scope,request_id,fingerprint,result) VALUES(?,?,?,?)')
      .run(scope, requestId, fingerprint, JSON.stringify(result));
    return result;
  }
  createRoom(
    config: GameConfig,
    mode: 'party' | 'rehearsal',
    now: number,
  ): { id: string; code: string; displayToken: string } {
    const id = randomUUID();
    let code: string;
    do {
      code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    } while (this.db.prepare('SELECT 1 FROM rooms WHERE code=?').get(code));
    const displayToken = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO rooms VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        code,
        mode,
        JSON.stringify(config),
        configHash(config),
        'lobby',
        0,
        'open',
        null,
        null,
        1,
        hash(displayToken),
        now,
      );
    return { id, code, displayToken };
  }
  session(
    role: 'host' | 'player',
    now: number,
    credentialHash: string | null = null,
    playerId: string | null = null,
    roomId: string | null = null,
  ): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)')
      .run(hash(token), role, roomId, playerId, credentialHash, now + 7 * 86_400_000);
    return token;
  }
  authenticate(
    token: string | undefined,
    role: 'host' | 'player',
    now: number,
    hostCredentialHash: string,
  ): Session | null {
    if (!token) return null;
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>? AND role=?')
      .get(hash(token), now, role) as
      | {
          token_hash: string;
          room_id: string | null;
          player_id: string | null;
          credential_hash: string | null;
        }
      | undefined;
    if (!row || (role === 'host' && row.credential_hash !== hostCredentialHash)) return null;
    return { role, playerId: row.player_id, roomId: row.room_id, tokenHash: row.token_hash };
  }
  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
  }
  displayAuthorized(roomId: string, token: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM rooms WHERE id=? AND display_token_hash=?')
      .get(roomId, hash(token));
  }
  join(
    room: RoomRow,
    profile: Profile,
    joinKey: string,
    now: number,
  ): { playerId: string; token: string } {
    return this.transaction(() => {
      const keyHash = hash(joinKey);
      const fingerprint = hash(JSON.stringify({ roomId: room.id, ...profile }));
      const saved = this.db.prepare('SELECT * FROM joins WHERE key_hash=?').get(keyHash) as
        { fingerprint: string; player_id: string } | undefined;
      let playerId: string;
      if (saved) {
        requireRule(
          saved.fingerprint === fingerprint,
          'REQUEST_CONFLICT',
          'This join request already has a different profile.',
          409,
        );
        playerId = saved.player_id;
      } else {
        const current = this.room(room.id);
        requireRule(
          current.phase === 'lobby',
          'LOBBY_CLOSED',
          'This party has already started. Ask the host for help.',
        );
        const config = JSON.parse(current.config) as GameConfig;
        requireRule(
          this.players(room.id).length < config.party.max_players,
          'PARTY_FULL',
          'This party is full.',
        );
        requireRule(
          !this.db
            .prepare('SELECT 1 FROM players WHERE room_id=? AND name=? COLLATE NOCASE')
            .get(room.id, profile.name),
          'NAME_TAKEN',
          'That name is already at this party. Try another.',
          409,
        );
        playerId = randomUUID();
        this.db
          .prepare(
            'INSERT INTO players(id,room_id,name,email,phone,emoji,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(playerId, room.id, profile.name, profile.email, profile.phone, profile.emoji, now);
        this.adjust(
          room.id,
          playerId,
          'starting-grant',
          'Starting tokens',
          { spendable: config.party.initial_tokens, locked: 0, reserved: 0 },
          now,
        );
        this.db
          .prepare('INSERT INTO joins VALUES(?,?,?,?)')
          .run(keyHash, room.id, playerId, fingerprint);
        this.bump(room.id);
      }
      return { playerId, token: this.session('player', now, null, playerId, room.id) };
    });
  }
  /** Call inside the same transaction as the game action. Unique keys make ledger effects idempotent. */
  adjust(
    roomId: string,
    playerId: string,
    operationKey: string,
    reason: string,
    delta: Accounts,
    now: number,
  ): Accounts {
    const player = this.player(playerId);
    requireRule(
      player.room_id === roomId,
      'FORBIDDEN',
      'Player belongs to a different party.',
      403,
    );
    for (const value of Object.values(delta))
      requireRule(
        Number.isSafeInteger(value),
        'INVALID_AMOUNT',
        'Token changes must be safe whole numbers.',
      );
    const previous = this.db
      .prepare('SELECT * FROM ledger WHERE player_id=? AND operation_key=?')
      .get(playerId, operationKey) as
      { spendable: number; locked: number; reserved: number; reason: string } | undefined;
    if (previous) {
      requireRule(
        previous.spendable === delta.spendable &&
          previous.locked === delta.locked &&
          previous.reserved === delta.reserved &&
          previous.reason === reason,
        'REQUEST_CONFLICT',
        'Ledger operation was already used differently.',
        409,
      );
      return { spendable: player.spendable, locked: player.locked, reserved: player.reserved };
    }
    const next = {
      spendable: player.spendable + delta.spendable,
      locked: player.locked + delta.locked,
      reserved: player.reserved + delta.reserved,
    };
    requireRule(
      Object.values(next).every((n) => Number.isSafeInteger(n) && n >= 0),
      'INSUFFICIENT_FUNDS',
      'Not enough available tokens.',
    );
    this.db
      .prepare('UPDATE players SET spendable=?,locked=?,reserved=? WHERE id=?')
      .run(next.spendable, next.locked, next.reserved, playerId);
    this.db
      .prepare(
        'INSERT INTO ledger(room_id,player_id,operation_key,reason,spendable,locked,reserved,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        roomId,
        playerId,
        operationKey,
        reason,
        delta.spendable,
        delta.locked,
        delta.reserved,
        now,
      );
    return next;
  }
  close(): void {
    this.db.close();
  }
}
