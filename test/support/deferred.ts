/**
 * A promise a test settles when it chooses to.
 *
 * `Promise.withResolvers` would say the same thing in one line, and is out of
 * reach until the compiler's `lib` moves to es2024 — which is not this change's
 * to move.
 */
export interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

const NOT_YET: () => void = () => undefined;

export function deferred(): Deferred {
  let settle = NOT_YET;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });

  return { promise, resolve: () => settle() };
}
