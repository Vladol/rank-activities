/**
 * The one thing every registry in this service shares: a code is unique, and a
 * second entry claiming it is a startup failure rather than a silent overwrite.
 *
 * Registries are the extension mechanism of stage-five.md, section 13: a new
 * curve, a new aggregation or a new derived metric is an element added to an
 * array, and the engine does not change.
 */
export interface RegistryEntry {
  readonly code: string;
}

export function indexByCode<E extends RegistryEntry>(
  kind: string,
  entries: readonly E[],
): ReadonlyMap<string, E> {
  const index = new Map<string, E>();

  for (const entry of entries) {
    if (index.has(entry.code)) {
      throw new Error(`Duplicate ${kind} code "${entry.code}": a code identifies exactly one entry.`);
    }

    index.set(entry.code, entry);
  }

  return index;
}
