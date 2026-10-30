/** Validate without printing questions, answers, links or candidate song names. */
import { loadConfig } from '../src/server/config.js';
import { createTriviaContent } from '../src/server/games/trivia-content.js';
const values = loadConfig().trivia.board_values;
if (!values) throw new Error('Board values are not configured.');
const content = createTriviaContent(values);
console.log(`Trivia bank: ${content.label} (${content.mode})`);
console.log(`Version: ${content.version}`);
console.log(`Ready: ${content.cells.filter((cell) => !cell.unavailableReason).length}/25 cells`);
console.log(
  `Retained music candidates: ${content.cells.flatMap((cell) => cell.musicCandidates ?? []).length}`,
);
console.log('New rooms freeze this bank when trivia opens. Existing boards do not change.');
