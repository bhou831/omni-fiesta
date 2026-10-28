import type { Stage } from '../../shared/contracts.js';
import type { GameConfig } from '../config.js';
import type { Store, RoomRow } from './store.js';
import { requireRule } from './errors.js';

export interface PhaseContext {
  store: Store;
  room: RoomRow;
  config: GameConfig;
  now: number;
}
/** All module callbacks execute inside the core transaction. Prepare external data separately. */
export interface PhaseModule {
  id: Stage;
  durationSeconds(config: GameConfig): number | null;
  open?(context: PhaseContext): void;
  action(
    context: PhaseContext,
    playerId: string,
    action: string,
    data: Record<string, unknown>,
  ): Record<string, unknown>;
  close?(context: PhaseContext): void;
  assertCanAdvance?(context: PhaseContext): void;
}

export const connectionCheck: PhaseModule = {
  id: 'connection-check',
  // Reuses the picking clock to exercise the real timer core; this is not a party game.
  durationSeconds: (config) => config.timers.investment_selection_seconds,
  action: ({ store, room, now }, playerId, action) => {
    requireRule(action === 'check-in', 'UNKNOWN_ACTION', 'That action is not part of sound check.');
    store.db
      .prepare('INSERT OR IGNORE INTO check_ins VALUES(?,?,?,?)')
      .run(room.id, room.phase_instance, playerId, now);
    return { checkedIn: true };
  },
};
