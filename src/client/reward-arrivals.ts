import type { RoomSnapshot } from '../shared/contracts.js';

/** A reconnect/focus snapshot is a baseline, never a replay of an old reward. */
export class RewardArrivals {
  private baseline = false;
  private lastReward = 0;
  private sequence = -1;
  private server = '';
  reset() {
    this.baseline = false;
  }
  accept(next: RoomSnapshot, visible: boolean) {
    if (this.server === next.serverInstance && this.sequence >= next.snapshotSequence)
      return { accepted: false, cue: null };
    if (this.server !== next.serverInstance) this.baseline = false;
    this.server = next.serverInstance;
    this.sequence = next.snapshotSequence;
    const reward = next.self?.rewardCue;
    const cue = this.baseline && reward && reward.id > this.lastReward && visible ? reward : null;
    this.lastReward = reward?.id ?? 0;
    this.baseline = true;
    return { accepted: true, cue };
  }
}
