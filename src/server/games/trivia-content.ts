/** Server-only bank loading. Event answers stay outside the public client bundle. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9-]{1,80}$/);
// The source and compiled module both live three directories below the project root.
const projectFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const publicAssetExists = (path: string) =>
  existsSync(projectFile(`public${path}`)) || existsSync(projectFile(`dist/client${path}`));
const locationSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    city: z.string().trim().min(1).max(120),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    panoId: z.string().trim().min(1).max(256),
    heading: z.number().finite().min(0).max(360).default(0),
    pitch: z.number().finite().min(-90).max(90).default(0),
    zoom: z.number().finite().min(0).max(5).default(1),
  })
  .strict();
const clueSchema = z
  .object({
    id,
    categoryId: id,
    value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: z.enum(['text', 'music', 'adventure', 'location']),
    adventureVariant: z
      .enum([
        'charades-simple',
        'yes-no-simple',
        'charades-complex',
        'yes-no-hard',
        'photo-recreation',
      ])
      .optional(),
    referenceImage: z.string().trim().min(1).max(2000).optional(),
    questionImage: z
      .string()
      .regex(/^\/trivia\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/)
      .optional(),
    questionVideo: z
      .string()
      .regex(/^\/trivia\/[a-z0-9-]+\.mp4$/)
      .optional(),
    referenceImages: z
      .tuple([
        z.string().regex(/^\/adventure\/[a-z0-9-]+\.png$/),
        z.string().regex(/^\/adventure\/[a-z0-9-]+\.png$/),
      ])
      .refine(([first, second]) => first !== second, 'Use two distinct images.')
      .optional(),
    publicPrompt: z.string().trim().min(1).max(2000),
    hostAnswer: z.string().trim().min(1).max(2000).optional(),
    hostNotes: z.string().trim().min(1).max(2000).optional(),
    unavailableReason: z.string().trim().min(1).max(1000).optional(),
    musicCandidates: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    musicAudio: z
      .object({
        file: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,63}\.wav$/)
          .optional(),
        url: z.string().url().optional(),
        clipStartSeconds: z.number().finite().min(0).max(3600),
        clipEndSeconds: z.number().finite().gt(0).max(3600),
      })
      .strict()
      .refine((a) => !!a.file !== !!a.url, 'Choose one local file or preview URL.')
      .optional(),
    musicTrack: z
      .object({
        trackId: z.number().int().positive(),
        title: z.string().trim().min(1).max(200),
        artist: z.string().trim().min(1).max(200),
        album: z.string().trim().min(1).max(200),
        storeUrl: z.string().url(),
      })
      .strict()
      .optional(),
    location: locationSchema.optional(),
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
    adventureQuestionBank: z
      .object({
        charades: z.array(z.string().trim().min(1).max(100)).min(1),
        yesOrNo: z.array(z.string().trim().min(1).max(500)).min(1),
      })
      .optional(),
    adventureRules: z
      .object({
        charadesSimple: z.array(z.string().trim().min(1).max(1000)).min(1),
        yesOrNoSimple: z.array(z.string().trim().min(1).max(1000)).min(1),
        charadesComplex: z.array(z.string().trim().min(1).max(1000)).min(1),
        yesOrNoHard: z.array(z.string().trim().min(1).max(1000)).min(1),
        photoRecreation: z.array(z.string().trim().min(1).max(1000)).min(1),
      })
      .optional(),
    photoScoringPrompt: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();
export type TriviaClue = z.infer<typeof clueSchema>;
export type TriviaContent = z.infer<typeof bankSchema>;
export function missingPhotoScoringPrompt(content: TriviaContent): boolean {
  return (
    content.mode === 'event' &&
    content.cells.some(
      (cell) => cell.adventureVariant === 'photo-recreation' && !cell.unavailableReason,
    ) &&
    !content.photoScoringPrompt?.trim()
  );
}
export const DEMO_TRIVIA_BANK = projectFile('config/trivia-demo.json');

export function isApprovedApplePreviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'audio-ssl.itunes.apple.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/itunes-assets\/AudioPreview(?:\d+)?(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

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
    bank.cells.some(
      (c) =>
        !categories.has(c.categoryId) ||
        (!c.unavailableReason && !c.hostAnswer && !c.adventureVariant),
    )
  )
    throw new Error('Invalid trivia question bank grid or missing answer.');
  if (
    bank.mode === 'event' &&
    bank.cells.some((c) => c.kind === 'adventure' && !c.unavailableReason) &&
    (!bank.adventureQuestionBank?.charades.length ||
      !bank.adventureQuestionBank.yesOrNo.length ||
      !bank.adventureRules)
  )
    throw new Error('Event trivia bank is missing adventure questions.');
  if (
    bank.cells.some(
      (c) =>
        c.adventureVariant === 'photo-recreation' &&
        !c.unavailableReason &&
        (bank.mode === 'event' ? !c.referenceImages : !c.referenceImages && !c.referenceImage),
    )
  )
    throw new Error('Photo recreation requires a reference image.');
  if (
    bank.mode === 'event' &&
    bank.cells.some(
      (c) =>
        c.adventureVariant === 'photo-recreation' &&
        !c.unavailableReason &&
        c.referenceImages?.some((image) => !publicAssetExists(image)),
    )
  )
    throw new Error('Photo recreation reference image is missing.');
  if (bank.cells.some((c) => c.questionImage && !publicAssetExists(c.questionImage)))
    throw new Error('Trivia question image is missing.');
  if (bank.cells.some((c) => c.questionVideo && !publicAssetExists(c.questionVideo)))
    throw new Error('Trivia question video is missing.');
  if (
    bank.cells.some(
      (c) => c.musicAudio && c.musicAudio.clipEndSeconds <= c.musicAudio.clipStartSeconds,
    )
  )
    throw new Error('Music clip bounds are invalid.');
  if (bank.cells.some((c) => c.musicAudio?.url && !isApprovedApplePreviewUrl(c.musicAudio.url)))
    throw new Error('Music preview URL is not an approved iTunes preview.');
  if (
    bank.cells.some(
      (c) => c.musicTrack && !/^https:\/\/music\.apple\.com\//.test(c.musicTrack.storeUrl),
    )
  )
    throw new Error('Music store link is not an Apple Music URL.');
  if (
    bank.cells.some(
      (c) =>
        c.musicAudio?.url &&
        (!c.musicTrack ||
          c.musicAudio.clipStartSeconds !== 0 ||
          c.musicAudio.clipEndSeconds !== 30),
    )
  )
    throw new Error('Apple previews must use the complete 30 second preview.');
  if (
    bank.cells.some(
      (c) => c.kind === 'music' && !c.unavailableReason && (!c.musicAudio || !c.hostAnswer),
    )
  )
    throw new Error('Prepared music cells require audio and a host answer.');
  if (
    bank.cells.some(
      (c) => c.kind === 'location' && !c.unavailableReason && (!c.location || !c.hostAnswer),
    )
  )
    throw new Error('Prepared location cells require a complete scene and host answer.');
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
  return projectFile('config/trivia-event.json');
}
export function triviaContentForMode(values: number[], demo: boolean): TriviaContent {
  const content = createTriviaContent(values, demo ? DEMO_TRIVIA_BANK : eventTriviaBankFile());
  if (content.mode !== (demo ? 'demo' : 'event'))
    throw new Error('Selected trivia bank has the wrong mode.');
  return content;
}
