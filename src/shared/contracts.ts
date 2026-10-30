export const EMOJIS = [
  '🗿',
  '🦦',
  '🦞',
  '🤓',
  '🧘‍♀️',
  '😂',
  '🉑',
  '🥐',
  '🥦',
  '🪷',
  '🗽',
  '💀',
  '🥹',
  '👾',
  '🧑‍🚀',
  '👩‍🦱',
  '👀',
  '💅',
  '👻',
  '🥷',
  '👺',
  '🐸',
  '🧚‍♂️',
  '🦹‍♂️',
] as const;
export const PARTY_STAGES = [
  'lobby',
  'investments',
  'costume',
  'trivia',
  'slots',
  'powerball',
  'investment-review',
  'somebody-calling',
  'costume-reveal',
  'finish',
] as const;
export type Stage = (typeof PARTY_STAGES)[number] | 'connection-check';
export type Role = 'host' | 'player' | 'display';
export const STAGE_LABELS: Record<Stage, string> = {
  lobby: 'The gathering',
  investments: '2 minute quantitative researcher',
  costume: 'Best dressed',
  trivia: 'Jeopardy · 团队抢答',
  slots: 'Tonight I am Venetian',
  powerball: 'Powerball red or blue',
  'investment-review': 'The closing bell',
  'somebody-calling': 'Somebody’s calling',
  'costume-reveal': 'Best dressed: the winners',
  finish: 'That’s a wrap',
  'connection-check': 'Sound check',
};
export interface Profile {
  name: string;
  email?: string;
  phone: string;
  emoji: string;
}
export interface Accounts {
  spendable: number;
  locked: number;
  reserved: number;
}
export interface PublicPlayer {
  id: string;
  name: string;
  emoji: string;
  ready: boolean;
  connected: boolean;
  checkedIn: boolean;
}
export interface LedgerEntry {
  id: number;
  playerId: string;
  reason: string;
  spendable: number;
  locked: number;
  reserved: number;
  createdAt: number;
}
export interface RoomSnapshot {
  serverInstance: string;
  snapshotSequence: number;
  serverTime: number;
  room: {
    id: string;
    code: string;
    mode: 'party' | 'rehearsal';
    version: number;
    phase: Stage;
    phaseInstance: number;
    status: 'pending' | 'open' | 'closed';
    openedAt: number | null;
    deadlineAt: number | null;
    title: string;
    configHash: string;
    marketSource: 'live' | 'fixture';
    canAdvance: boolean;
    advanceBlocker: string | null;
  };
  players: PublicPlayer[];
  /** Public viewers see only the places announced so far; the host always sees everyone. */
  ranking?: { rank: number; playerId: string; name: string; emoji: string; tokens: number }[];
  /** Announcements made so far, out of `rankingSteps`. The last step shows the full ranking. */
  rankingStep?: number;
  rankingSteps?: number;
  self?: { id: string; accounts: Accounts; ready: boolean; checkedIn: boolean };
  investments?: {
    opening: import('../server/games/market.js').MarketSnapshot | null;
    closing: import('../server/games/market.js').MarketSnapshot | null;
    /** Closing prices were unavailable, so the host returned every stake in full. */
    refunded: boolean;
    assets: import('../server/config.js').GameConfig['investments']['assets'];
    cap: number;
    multiplier: number;
    positions: {
      player_id: string;
      asset_id: string;
      principal: number;
      payout: number | null;
    }[];
  };
  costume?: import('../server/games/costume.js').CostumeProjection & { allowSelfVote: boolean };
  costumeReveal?: import('../server/games/costume.js').CostumeRevealProjection;
  trivia?: import('../server/games/trivia.js').TriviaProjection;
  slots?:
    | { role: 'player'; data: import('../server/games/slots.js').SlotsPlayerState }
    | { role: 'host'; data: import('../server/games/slots.js').SlotsHostState }
    | { role: 'display'; data: import('../server/games/slots.js').SlotsDisplayState };
  powerball?: import('../server/games/powerball.js').PowerballProjection;
  calling?:
    | { role: 'host'; data: import('../server/games/somebody-calling.js').CallingHostState }
    | { role: 'public'; data: import('../server/games/somebody-calling.js').CallingPublicState };
  host?: {
    players: (PublicPlayer & { email: string; phone: string; accounts: Accounts })[];
    ledger: LedgerEntry[];
    investments: {
      player_id: string;
      asset_id: string;
      principal: number;
      payout: number | null;
    }[];
  };
}
export interface Command {
  requestId: string;
  phaseInstance: number;
  type:
    | 'player.ready'
    | 'phase.advance'
    | 'phase.start'
    | 'phase.close'
    | 'phase.action'
    | 'phase.host';
  payload?: { ready?: boolean; action?: string; data?: Record<string, unknown> };
}
export interface CommandResult {
  version: number;
  result: Record<string, unknown>;
}

export type CommandSender = (
  type: Command['type'],
  payload?: Command['payload'],
) => Promise<CommandResult | void>;
