/**
 * One outbound call per key, however many callers want it.
 *
 * It deduplicates **misses**: when a popular location's entry expires, the
 * first caller goes out and the rest wait on that promise rather than
 * reproducing it (stage-four.md, section 5.4). Failure is shared too — every
 * waiter receives the same typed result, and nobody retries on its own.
 *
 * Per process, and deliberately so: with a handful of instances, N
 * simultaneous misses cost less than a distributed lock that has to be
 * released when its holder dies (design.md, Decision 10).
 */
export class SingleFlight<T> {
  private readonly running = new Map<string, Promise<T>>();

  constructor(private readonly onJoin: () => void = () => undefined) {}

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.running.get(key);

    if (existing !== undefined) {
      this.onJoin();

      return existing;
    }

    // Started before it is recorded, and recorded before it is awaited: a
    // synchronous throw inside `work` must not leave the key held forever.
    const started = (async () => work())().finally(() => {
      this.running.delete(key);
    });

    this.running.set(key, started);

    return started;
  }

  /** How many calls are in flight. Used by the tests and by the log line. */
  get inFlight(): number {
    return this.running.size;
  }
}
