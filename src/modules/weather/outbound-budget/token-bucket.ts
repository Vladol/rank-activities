/**
 * A bucket that refills continuously rather than emptying on a schedule.
 *
 * A fixed window would let a whole limit be spent in its last second and the
 * next whole limit in the following one — twice the intended rate across the
 * boundary. Refilling at `limit / window` gives the sustained rate the limit
 * actually means, and the capacity is the burst it tolerates: for the daily
 * limit that is ten thousand a day, about seven a minute, and up to ten
 * thousand at once after a long quiet spell (ADR 0006).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number,
  ) {
    this.tokens = limit;
    this.lastRefill = now();
  }

  /**
   * Takes the units or takes none. A partial consumption would let a retry
   * proceed on a budget that could not pay for it.
   */
  tryConsume(units = 1): boolean {
    this.refill();

    if (this.tokens < units) {
      return false;
    }

    this.tokens -= units;

    return true;
  }

  get remaining(): number {
    this.refill();

    return Math.floor(this.tokens);
  }

  private refill(): void {
    const at = this.now();
    const elapsed = at - this.lastRefill;

    if (elapsed <= 0) {
      return;
    }

    this.lastRefill = at;
    this.tokens = Math.min(this.limit, this.tokens + (elapsed * this.limit) / this.windowMs);
  }
}
