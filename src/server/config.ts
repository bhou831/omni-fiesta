import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { z } from 'zod';

const tokens = z.number().int().nonnegative().max(1_000_000_000);
const duration = z.number().int().positive().max(86_400);
const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), 'Research links require HTTPS');
const probability = z.number().min(0).max(1);
export const gameConfigSchema = z
  .object({
    version: z.literal(1),
    party: z
      .object({ max_players: z.number().int().min(1).max(100), initial_tokens: tokens })
      .strict(),
    timers: z
      .object({
        investment_selection_seconds: duration,
        costume_voting_seconds: duration,
        slots_seconds: duration,
        powerball_betting_seconds: duration,
      })
      .strict(),
    investments: z
      .object({
        max_investment_tokens: tokens,
        return_multiplier: z.number().positive().max(1000),
        loss_limit: z.literal('invested_amount'),
        payout_rounding: z.literal('floor'),
        quote_currency: z.literal('usd'),
        market_data: z
          .object({
            provider: z.literal('coingecko'),
            api_tier: z.literal('demo'),
            opening_endpoint: z.literal('/coins/markets'),
            closing_endpoint: z.literal('/coins/markets'),
            max_snapshot_age_seconds: duration,
            max_asset_timestamp_spread_seconds: duration,
          })
          .strict(),
        assets: z
          .array(
            z
              .object({
                symbol: z.string().min(1).max(12),
                name: z.string().min(1).max(60),
                provider_id: z.string().min(1).max(80),
                category: z.string().min(1).max(60),
                description: z.string().min(1).max(600),
                research_links: z
                  .array(z.object({ label: z.string().min(1), url: httpsUrl }).strict())
                  .min(1),
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict(),
    costume: z
      .object({
        allow_self_vote: z.boolean(),
        ranking_method: z.literal('distinct_vote_totals'),
        tie_award_policy: z.literal('full_prize_per_player'),
        prizes_per_player: z
          .array(z.object({ place: z.number().int().positive(), tokens }).strict())
          .length(3),
        last_place_penalty_pool_tokens: tokens,
        last_place_tie_policy: z.literal('split_penalty_pool'),
        last_place_penalty_split_rounding: z.literal('floor'),
        penalize_prize_winners: z.literal(false),
        penalty_limit: z.literal('spendable_balance'),
        no_votes_policy: z.literal('no_awards_or_penalties'),
      })
      .strict(),
    trivia: z
      .object({
        answer_seconds: duration.optional(),
        attempt_limit: z.number().int().min(1).max(100).optional(),
        limited_attempt_limit: z.number().int().min(1).max(100).optional(),
        adventure: z
          .object({
            charades_simple_seconds: duration,
            charades_simple_target: z.number().int().positive(),
            yes_no_simple_seconds: duration,
            charades_complex_seconds: duration,
            charades_complex_target: z.number().int().positive(),
            yes_no_hard_seconds: duration,
            photo_recreation_seconds: duration,
            // Old saved rooms may still carry this setting; judging no longer reads it.
            photo_success_score: z.number().int().min(0).max(100).optional(),
          })
          .strict()
          .optional(),
        // Absent in saved pre-board rooms: preserve their numbered-question flow.
        board_values: z
          .array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
          .length(5)
          .refine(
            (values) => values.every((v, i) => i === 0 || v > values[i - 1]),
            'Board values must increase',
          )
          .optional(),
        default_team_count: z.number().int().min(1).max(100),
        award_scope: z.literal('each_team_member'),
        buzzer_policy: z.literal('first_server_accepted'),
        exclude_incorrect_teams_for_question: z.boolean(),
      })
      .strict(),
    slots: z
      .object({
        cost_per_spin_tokens: tokens.refine((n) => n > 0),
        max_spins_per_player: z.number().int().min(1).max(100),
        draw_mode: z.literal('independent'),
        outcomes: z.array(z.object({ gross_payout_tokens: tokens, probability }).strict()).min(1),
      })
      .strict(),
    powerball: z
      .object({
        colors: z
          .array(z.object({ color: z.enum(['red', 'blue']), probability }).strict())
          .length(2),
        payout_method: z.literal('proportional_losing_pool'),
        no_winning_bettors_policy: z.literal('refund_all'),
        rounding_method: z.literal('largest_remainder'),
      })
      .strict(),
    somebody_calling: z
      .object({
        entry_cost_tokens: z.literal(0),
        winner_award_tokens: tokens,
        selection_visibility: z.literal('host_only_until_reveal'),
      })
      .strict(),
    leaderboard: z
      .object({
        show_all_players: z.literal(true),
        equal_balances_share_rank: z.literal(true),
        public_visibility: z.literal('host_reveal'),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (c.investments.max_investment_tokens > c.party.initial_tokens)
      fail('Investment cap exceeds initial tokens');
    if (
      new Set(c.investments.assets.map((a) => a.provider_id)).size !== c.investments.assets.length
    )
      fail('Asset IDs must be unique');
    if (new Set(c.investments.assets.map((a) => a.symbol)).size !== c.investments.assets.length)
      fail('Asset symbols must be unique');
    if (
      c.costume.prizes_per_player
        .map((p) => p.place)
        .sort()
        .join(',') !== '1,2,3'
    )
      fail('Costume prizes must define places 1, 2, and 3 exactly once');
    for (const [name, outcomes] of [
      ['slots', c.slots.outcomes],
      ['powerball', c.powerball.colors],
    ] as const) {
      if (Math.abs(outcomes.reduce((sum, o) => sum + o.probability, 0) - 1) > 1e-9)
        fail(`${name} probabilities must total 1`);
    }
    if (new Set(c.powerball.colors.map((c) => c.color)).size !== 2)
      fail('Powerball must have red and blue');
  });
export type GameConfig = z.infer<typeof gameConfigSchema>;
export function loadConfig(
  path = process.env.GAME_CONFIG_PATH ?? './config/game.yaml',
): GameConfig {
  return gameConfigSchema.parse(parse(readFileSync(path, 'utf8')));
}
export function configHash(config: GameConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
