import { connectionCheck, type PhaseModule } from '../core/phases.js';
import { investments, investmentReview } from './investments.js';
import { costume, costumeReveal } from './costume.js';
import { triviaScoreboard } from './trivia-scoreboard.js';
import { trivia } from './trivia.js';
import { createSlotsModule } from './slots.js';
import { createPowerballModule } from './powerball.js';
import { somebodyCalling } from './somebody-calling.js';

/** Shared registration for the normal application and disposable fixture harness. */
export function createPartyModules(): PhaseModule[] {
  return [
    connectionCheck,
    investments,
    costume,
    trivia,
    triviaScoreboard,
    createSlotsModule(),
    createPowerballModule(),
    investmentReview,
    somebodyCalling,
    costumeReveal,
  ];
}
