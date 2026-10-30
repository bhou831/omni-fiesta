/** Server-only bank loading. Real event questions belong in an ignored local file. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9-]{1,80}$/);
const clueSchema = z
  .object({
    id,
    categoryId: id,
    value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(['text', 'music', 'adventure', 'location']),
    publicPrompt: z.string().trim().min(1).max(2000),
    hostAnswer: z.string().trim().min(1).max(2000).optional(),
    hostNotes: z.string().trim().min(1).max(2000).optional(),
    unavailableReason: z.string().trim().min(1).max(1000).optional(),
    musicCandidates: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  })
  .strict();
const bankSchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(100),
    mode: z.enum(['demo', 'event']),
    categories: z
      .array(z.object({ id, name: z.string().trim().min(1).max(80) }).strict())
      .length(5),
    cells: z.array(clueSchema).length(25),
  })
  .strict();
export type TriviaClue = z.infer<typeof clueSchema>;
export type TriviaContent = z.infer<typeof bankSchema>;
export const DEMO_TRIVIA_BANK = resolve('config/trivia-demo.json');

export function validateTriviaContent(content: unknown): asserts content is TriviaContent {
  const parsed = bankSchema.safeParse(content);
  // Do not print schema issues or input: they may contain private event answers.
  if (!parsed.success) throw new Error('Invalid trivia question bank structure.');
  const bank = parsed.data;
  const ids = new Set(bank.cells.map((c) => c.id));
  const categories = new Set(bank.categories.map((c) => c.id));
  const values = [...new Set(bank.cells.map((c) => c.value))].sort((a, b) => a - b);
  if (
    categories.size !== 5 ||
    ids.size !== 25 ||
    values.length !== 5 ||
    bank.categories.some((category) =>
      values.some(
        (value) =>
          bank.cells.filter((c) => c.categoryId === category.id && c.value === value).length !== 1,
      ),
    ) ||
    bank.cells.some((c) => !categories.has(c.categoryId) || (!c.unavailableReason && !c.hostAnswer))
  )
    throw new Error('Invalid trivia question bank grid or missing answer.');
}

/** Values come from saved room config; JSON values establish the five tier positions. */
export function createTriviaContent(
  values: number[],
  bankFile = process.env.TRIVIA_BANK_FILE ?? DEMO_TRIVIA_BANK,
): TriviaContent {
  if (
    values.length !== 5 ||
    values.some((v, i) => !Number.isSafeInteger(v) || v <= 0 || (i > 0 && v <= values[i - 1]))
  )
    throw new Error('Trivia requires five increasing positive values.');
  let bank: unknown;
  try {
    bank = JSON.parse(readFileSync(bankFile, 'utf8'));
  } catch {
    throw new Error('Could not read trivia question bank. Check TRIVIA_BANK_FILE and JSON format.');
  }
  validateTriviaContent(bank);
  const tiers = [...new Set(bank.cells.map((c) => c.value))].sort((a, b) => a - b);
  return {
    ...bank,
    cells: bank.cells.map((c) => ({ ...c, value: values[tiers.indexOf(c.value)] })),
  };
}

/** Trusted server configuration only; the client never supplies a filesystem path. */
export function eventTriviaBankFile(): string {
  if (process.env.TRIVIA_EVENT_BANK_FILE) return process.env.TRIVIA_EVENT_BANK_FILE;
  if (process.env.TRIVIA_BANK_FILE && resolve(process.env.TRIVIA_BANK_FILE) !== DEMO_TRIVIA_BANK)
    return process.env.TRIVIA_BANK_FILE;
  return resolve('private/trivia-event.json');
}
export function triviaContentForMode(values: number[], demo: boolean): TriviaContent {
  const content = createTriviaContent(values, demo ? DEMO_TRIVIA_BANK : eventTriviaBankFile());
  if (content.mode !== (demo ? 'demo' : 'event'))
    throw new Error('Selected trivia bank has the wrong mode.');
  return content;
}
