import { createHash } from 'node:crypto';

import { type Coordinates, roundToGrid } from '../../domain/shared/coordinates';
import type { MetricCode } from '../../domain/weather/metric';
import type { Capability } from '../../domain/weather/metric';
import { MAPPER_VERSION } from '../../modules/weather/adapters/open-meteo/open-meteo.mapper';
import type { Horizon } from '../../modules/weather/ports/contracts';

/**
 * Every cache key in the service is built here and nowhere else.
 *
 * One origin is not tidiness: a key assembled in two places drifts in one of
 * them, and the symptom is a hit rate that halves without a single failing
 * test (stage-six.md, section 4.6). A test asserts that no other file composes
 * one.
 */

declare const cacheKeyBrand: unique symbol;

/**
 * A key, and proof of where it came from.
 *
 * `CachePort` accepts nothing else, and the brand is only applied in this
 * file, so "keys are assembled only by the key builder" is checked by the
 * compiler rather than by a reviewer's memory. The one way around it is an
 * explicit `as CacheKey`, which a test greps for.
 */
export type CacheKey = string & { readonly [cacheKeyBrand]: 'CacheKey' };

/**
 * The namespace. Raising `MAPPER_VERSION` makes every warm entry unreachable,
 * which is the only defence against the quietest failure in the system: after
 * a canonical unit changes, a warm entry serves values off by 3.6× while the
 * tests, which take the fresh path, all pass (design.md, Decision 5).
 */
const PREFIX = `v${MAPPER_VERSION}`;

/**
 * A user-supplied name becomes a cache key, so its length is bounded before it
 * becomes one (stage-six.md, section 5.4).
 */
export const MAX_PLACE_NAME_LENGTH = 120;

export interface SeriesKeyInput {
  readonly capability: Capability;
  readonly location: Coordinates;
  readonly metrics: readonly MetricCode[];
  readonly horizon: Horizon;
  readonly timezone: string;
}

/**
 * The key for one capability's series at one place.
 *
 * **The requested number of days is deliberately absent.** A three-day and a
 * seven-day request for one city are the same data, and keying by the horizon
 * produced two misses and two outbound calls for it. The maximum horizon is
 * fetched instead and the answer is sliced locally (design.md, Decision 2).
 *
 * An explicit date window is a different question rather than a shorter one,
 * so it does appear; so does `pastDays`, which moves the axis origin and
 * therefore cannot be sliced away. The timezone appears because it decides
 * where the days fall: a series put on `auto` is not the answer to a request
 * that named a zone.
 */
export function seriesKey(input: SeriesKeyInput): CacheKey {
  return [
    PREFIX,
    input.capability,
    gridKey(input.location),
    metricsKey(input.metrics),
    input.timezone,
    horizonKey(input.horizon),
  ].join(':') as CacheKey;
}

/**
 * The key for a place lookup, positive or negative alike: a name that resolved
 * to nothing is remembered under the same key it would have resolved under.
 */
export function placeKey(query: {
  readonly name: string;
  readonly language?: string;
}): CacheKey {
  return [PREFIX, 'place', query.language ?? 'default', normalisePlaceName(query.name)].join(
    ':',
  ) as CacheKey;
}

/**
 * The identity of a point, as a pure function of its coordinates.
 *
 * A function rather than a method on `Coordinates`: a method does not survive
 * serialisation, and the object comes back structurally similar and
 * functionally dead, failing at the call rather than at the read
 * (stage-six.md, section 4.7).
 */
export function gridKey(location: Coordinates): string {
  return `${roundToGrid(location.latitude)},${roundToGrid(location.longitude)}`;
}

/**
 * Case, surrounding and repeated whitespace, and unicode composition folded
 * away, so that "  LISBOA " and "Lisboa" are one entry rather than three.
 * Composition matters on its own: the same city typed on two keyboards differs
 * only in whether an accent is one code point or two.
 */
export function normalisePlaceName(name: string): string {
  const folded = name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();

  if (folded.length <= MAX_PLACE_NAME_LENGTH) {
    return folded;
  }

  // Truncation alone would make two names that share a long prefix into one
  // entry, and the second would be answered with the first one's coordinates.
  // The prefix stays for readability in a log; the digest keeps them apart.
  return `${folded.slice(0, MAX_PLACE_NAME_LENGTH - 13)}#${digest(folded)}`;
}

/**
 * The metric set, order-independent and short. A sorted list of twenty names
 * is a long key and an invitation to build it two different ways; a hash of
 * one is neither. The count stays in front so a key remains readable in a log.
 */
function metricsKey(metrics: readonly MetricCode[]): string {
  const unique = [...new Set(metrics)].toSorted();

  return `${unique.length}-${digest(unique.join(','))}`;
}

function digest(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

/**
 * A rolling horizon contributes nothing, because the maximum is always fetched
 * and the answer sliced locally — *except* when history is prepended. Days of
 * history move the origin of the axis, so neither the widening nor the slicing
 * applies, and the length has to be part of the key or two different questions
 * would share one answer.
 */
function horizonKey(horizon: Horizon): string {
  if (horizon.kind === 'window') {
    return `w${horizon.startDate}_${horizon.endDate}`;
  }

  return horizon.pastDays === undefined || horizon.pastDays === 0
    ? 'f'
    : `f${horizon.forecastDays}-p${horizon.pastDays}`;
}
