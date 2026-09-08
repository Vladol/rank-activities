/**
 * How long a value stays fresh, and how old it may get before it stops being
 * an answer at all. Both are configuration: a lifetime written into the code
 * is a lifetime nobody can change without a deploy (spec, "the lifetimes are
 * configuration rather than values embedded in code").
 */
export interface Lifetime {
  /** The source's own refresh interval, in seconds. Freshness ends on its boundary. */
  readonly ttlSeconds: number;
  /**
   * The greatest age at which the value is still worth serving as stale, in
   * seconds, counted from when it was obtained. Past it there is no answer to
   * give and the request is a miss.
   */
  readonly maxStaleSeconds: number;
}

/**
 * The end of the interval the moment falls in, not an hour after the question.
 *
 * The source refreshes on its own boundary; expiring an hour after whoever
 * asked first would leave every entry an average of half an interval behind
 * and would scatter expiry across the clock instead of following the thing it
 * tracks (spec, "A lifetime ends on the boundary, not an hour after the
 * question").
 */
export function freshUntil(now: number, ttlSeconds: number): number {
  const interval = ttlSeconds * 1_000;

  return Math.floor(now / interval) * interval + interval;
}

/** The age past which a value is not served at all, counted from when it arrived. */
export function expiresAt(obtainedAt: number, lifetime: Lifetime): number {
  return obtainedAt + lifetime.maxStaleSeconds * 1_000;
}
