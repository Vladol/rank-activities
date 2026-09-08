import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { clamp01 } from '../../domain/shared/branded';
import type { ScoringProfile } from '../../domain/scoring/scoring-profile';

/**
 * The profile as data, beside the declarations and for the same reason: a
 * product that considers absent data a bad sign moves `neutralScore` from 0.5
 * to 0.2 and ships no TypeScript.
 *
 * Per-feature overrides are the later change. What ships now is the identity,
 * so that the pair (definitionVersion, profileVersion) already travels with
 * every result and adding overrides will not change the shape of an answer.
 */
export const scoringProfileSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  gapThreshold: z.number().min(0).max(1),
  neutralScore: z.number().min(0).max(1),
});

export function profileDir(): string {
  return join(process.cwd(), 'src/modules/scoring/seeds');
}

export function readScoringProfile(dir: string = profileDir()): ScoringProfile {
  const raw = JSON.parse(readFileSync(join(dir, 'default.profile.json'), 'utf8')) as unknown;
  const parsed = scoringProfileSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error(
      `The scoring profile is invalid and the service will not start: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  return {
    id: parsed.data.id,
    version: parsed.data.version,
    gapThreshold: clamp01(parsed.data.gapThreshold),
    neutralScore: clamp01(parsed.data.neutralScore),
  };
}
