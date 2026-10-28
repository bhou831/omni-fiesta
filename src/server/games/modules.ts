import { connectionCheck, type PhaseModule } from '../core/phases.js';
import { investments, investmentReview } from './investments.js';
import { costume } from './costume.js';
import { trivia } from './trivia.js';
import { createSlotsModule } from './slots.js';
import { createPowerballModule } from './powerball.js';
import { somebodyCalling } from './somebody-calling.js';

export function partyModules(): PhaseModule[] {
  return [
    connectionCheck,
    investments,
    costume,
    trivia,
    createSlotsModule(),
    createPowerballModule(),
    investmentReview,
    somebodyCalling,
  ];
}
