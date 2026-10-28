import { randomUUID } from 'node:crypto';
import {
  PARTY_STAGES,
  STAGE_LABELS,
  type Command,
  type CommandResult,
  type RoomSnapshot,
  type Stage,
} from '../../shared/contracts.js';
import { type GameConfig } from '../config.js';
import { Store, type RoomRow, type Session } from './store.js';
import { requireRule } from './errors.js';
import { connectionCheck, type PhaseModule } from './phases.js';

export type Viewer =
  | { role: 'host' | 'display'; roomId: string }
  | { role: 'player'; roomId: string; playerId: string };
export class Engine {
  readonly serverInstance = randomUUID();
  private sequence = 0;
  private connections = new Map<string, number>();
  readonly modules: Map<Stage, PhaseModule>;
  constructor(
    readonly store: Store,
    readonly now: () => number = Date.now,
    modules: PhaseModule[] = [connectionCheck],
  ) {
    this.modules = new Map(modules.map((m) => [m.id, m]));
  }
  context(room: RoomRow) {
    return {
      store: this.store,
      room,
      config: JSON.parse(room.config) as GameConfig,
      now: this.now(),
    };
  }
  nextStage(room: RoomRow): Stage | null {
    const sequence: readonly Stage[] =
      room.mode === 'rehearsal' ? ['lobby', 'connection-check', 'finish'] : PARTY_STAGES;
    return sequence[sequence.indexOf(room.phase) + 1] ?? null;
  }
  advanceBlocker(room: RoomRow): string | null {
    const next = this.nextStage(room);
    if (!next) return 'This rehearsal is complete.';
    if (room.phase === 'lobby' && this.store.players(room.id).length === 0)
      return 'Wait for at least one player to join.';
    if (room.phase !== 'lobby' && room.status !== 'closed')
      return 'Close this round before advancing.';
    if (next !== 'finish' && !this.modules.has(next))
      return `${STAGE_LABELS[next]} is not implemented yet.`;
    return null;
  }
  expire(roomId: string): boolean {
    return this.store.transaction(() => {
      const room = this.store.room(roomId);
      if (room.status !== 'open' || room.deadline_at === null || this.now() < room.deadline_at)
        return false;
      this.modules.get(room.phase)?.close?.(this.context(room));
      this.store.db
        .prepare("UPDATE rooms SET status='closed',version=version+1 WHERE id=?")
        .run(roomId);
      return true;
    });
  }
  expireAll(): string[] {
    const due = this.store.db
      .prepare(
        "SELECT id FROM rooms WHERE status='open' AND deadline_at IS NOT NULL AND deadline_at<=?",
      )
      .all(this.now()) as { id: string }[];
    return due.filter((room) => this.expire(room.id)).map((room) => room.id);
  }
  execute(session: Session, roomId: string, command: Command): CommandResult {
    requireRule(
      session.role === 'host' || session.roomId === roomId,
      'FORBIDDEN',
      'This session belongs to another party.',
      403,
    );
    // Persist deadline closure before the command transaction, even if its action is rejected.
    this.expire(roomId);
    return this.store.transaction(() =>
      this.store.once(
        `${session.role}:${session.playerId ?? 'host'}`,
        command.requestId,
        { roomId, ...command },
        () => {
          const room = this.store.room(roomId);
          requireRule(
            command.phaseInstance === room.phase_instance,
            'STALE_PHASE',
            'The round changed. Your screen has been refreshed.',
            409,
          );
          let result: Record<string, unknown> = {};
          if (command.type === 'player.ready') {
            requireRule(
              session.role === 'player' && session.playerId,
              'FORBIDDEN',
              'Only players can mark themselves ready.',
              403,
            );
            requireRule(room.phase === 'lobby', 'LOBBY_CLOSED', 'The party has already started.');
            requireRule(
              typeof command.payload?.ready === 'boolean',
              'INVALID_ACTION',
              'Choose ready or not ready.',
            );
            this.store.db
              .prepare('UPDATE players SET ready=? WHERE id=? AND room_id=?')
              .run(Number(command.payload.ready), session.playerId, roomId);
            result = { ready: command.payload.ready };
          } else if (command.type === 'phase.advance') {
            requireRule(session.role === 'host', 'FORBIDDEN', 'Only the host can advance.', 403);
            const blocker = this.advanceBlocker(room);
            requireRule(!blocker, 'CANNOT_ADVANCE', blocker ?? 'Cannot advance.');
            this.modules.get(room.phase)?.assertCanAdvance?.(this.context(room));
            const next = this.nextStage(room)!;
            const module = this.modules.get(next);
            const duration = module?.durationSeconds(JSON.parse(room.config) as GameConfig) ?? null;
            const now = this.now();
            this.store.db
              .prepare(
                "UPDATE rooms SET phase=?,phase_instance=phase_instance+1,status='open',opened_at=?,deadline_at=? WHERE id=?",
              )
              .run(next, now, duration === null ? null : now + duration * 1000, roomId);
            module?.open?.(this.context(this.store.room(roomId)));
            result = { phase: next };
          } else if (command.type === 'phase.close') {
            requireRule(
              session.role === 'host',
              'FORBIDDEN',
              'Only the host can close the round.',
              403,
            );
            requireRule(
              room.phase !== 'lobby' && room.phase !== 'finish',
              'INVALID_PHASE',
              'There is no active round to close.',
            );
            if (room.status === 'open') this.modules.get(room.phase)?.close?.(this.context(room));
            this.store.db.prepare("UPDATE rooms SET status='closed' WHERE id=?").run(roomId);
            result = { closed: true };
          } else {
            requireRule(
              session.role === 'player' && session.playerId,
              'FORBIDDEN',
              'Only players can submit an action.',
              403,
            );
            requireRule(
              room.status === 'open' &&
                (room.deadline_at === null || this.now() < room.deadline_at),
              'ROUND_CLOSED',
              'Time’s up. Wait for the host.',
            );
            const module = this.modules.get(room.phase);
            requireRule(module, 'INVALID_PHASE', 'There is no player action in this stage.');
            result = module.action(
              this.context(room),
              session.playerId,
              command.payload?.action ?? '',
              command.payload?.data ?? {},
            );
          }
          this.store.bump(roomId);
          return { result, version: this.store.room(roomId).version };
        },
      ),
    );
  }
  presence(playerId: string, change: 1 | -1): void {
    const next = Math.max(0, (this.connections.get(playerId) ?? 0) + change);
    if (next) this.connections.set(playerId, next);
    else this.connections.delete(playerId);
  }
  snapshot(viewer: Viewer): RoomSnapshot {
    return this.snapshots([viewer])[0];
  }
  /** Read shared state once per broadcast, then project separately for each authorized viewer. */
  snapshots(viewers: Viewer[]): RoomSnapshot[] {
    if (!viewers.length) return [];
    const roomId = viewers[0].roomId;
    requireRule(
      viewers.every((viewer) => viewer.roomId === roomId),
      'INVALID_BROADCAST',
      'Broadcast viewers must belong to one party.',
    );
    this.expire(roomId);
    const room = this.store.room(roomId);
    const rows = this.store.players(room.id);
    const checked = new Set(
      (
        this.store.db
          .prepare('SELECT player_id FROM check_ins WHERE room_id=? AND phase_instance=?')
          .all(room.id, room.phase_instance) as { player_id: string }[]
      ).map((p) => p.player_id),
    );
    const players = rows.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      ready: !!p.ready,
      connected: this.connections.has(p.id),
      checkedIn: checked.has(p.id),
    }));
    const blocker = this.advanceBlocker(room);
    const base: RoomSnapshot = {
      serverInstance: this.serverInstance,
      snapshotSequence: ++this.sequence,
      serverTime: this.now(),
      room: {
        id: room.id,
        code: room.code,
        mode: room.mode,
        version: room.version,
        phase: room.phase,
        phaseInstance: room.phase_instance,
        status: room.status,
        openedAt: room.opened_at,
        deadlineAt: room.deadline_at,
        title: STAGE_LABELS[room.phase],
        configHash: room.config_hash,
        canAdvance: blocker === null,
        advanceBlocker: blocker,
      },
      players,
    };
    const hostState = viewers.some((viewer) => viewer.role === 'host')
      ? {
          players: rows.map((p, i) => ({
            ...players[i],
            email: p.email,
            phone: p.phone,
            accounts: { spendable: p.spendable, locked: p.locked, reserved: p.reserved },
          })),
          ledger: this.store.db
            .prepare(
              'SELECT id,player_id AS playerId,reason,spendable,locked,reserved,created_at AS createdAt FROM ledger WHERE room_id=? ORDER BY id DESC LIMIT 100',
            )
            .all(room.id) as unknown as NonNullable<RoomSnapshot['host']>['ledger'],
        }
      : undefined;
    return viewers.map((viewer) => {
      const snapshot: RoomSnapshot = { ...base };
      if (viewer.role === 'player') {
        const p = rows.find((p) => p.id === viewer.playerId);
        requireRule(p, 'FORBIDDEN', 'Player belongs to a different party.', 403);
        snapshot.self = {
          id: p.id,
          accounts: { spendable: p.spendable, locked: p.locked, reserved: p.reserved },
          ready: !!p.ready,
          checkedIn: checked.has(p.id),
        };
      }
      if (viewer.role === 'host') snapshot.host = hostState;
      return snapshot;
    });
  }
}
