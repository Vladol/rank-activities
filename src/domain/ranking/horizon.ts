import { type DomainError, domainError } from '../shared/domain-error';
import { type Result, err, ok } from '../shared/result';

/**
 * The range of horizons this service answers for, and the one it uses when the
 * client names none. Both come from configuration rather than from a constant
 * here: the ceiling is a product decision (FR-04 of
 * docs/development-flow/stage-two.md), not a property of the arithmetic.
 */
export interface HorizonLimits {
  readonly defaultDays: number;
  readonly maxDays: number;
}

export type HorizonError = DomainError<'HORIZON_TOO_LARGE'>;

/**
 * Decides how many days to answer for, locally and before anything leaves the
 * process (design.md, Decision 5).
 *
 * The alternative — letting the source refuse — was rejected on evidence:
 * asking Open-Meteo for 30 forecast days answers `"Allowed range 0 to 16.
 * Given 16."`, which is factually wrong (stage-three.md, section 2.3). An
 * error mapped from that text would inherit its wrongness, and the rejected
 * request would still have cost a round trip.
 *
 * An over-long horizon is refused rather than shortened. Answering four days
 * to a request for ten is a different answer given silently.
 */
export function resolveHorizon(
  requested: number | undefined,
  limits: HorizonLimits,
): Result<number, HorizonError> {
  const days = requested ?? limits.defaultDays;

  if (!Number.isInteger(days) || days < 1) {
    return err(
      domainError('HORIZON_TOO_LARGE', 'a horizon is a whole number of days, at least one', {
        requested: days,
        allowed: limits.maxDays,
        unit: 'days',
      }),
    );
  }

  if (days > limits.maxDays) {
    return err(
      domainError(
        'HORIZON_TOO_LARGE',
        `a horizon of ${days} days exceeds the ${limits.maxDays} this service answers for`,
        { requested: days, allowed: limits.maxDays, unit: 'days' },
      ),
    );
  }

  return ok(days);
}
