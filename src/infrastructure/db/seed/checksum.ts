import { createHash } from 'node:crypto';

/**
 * A stable digest of a value's content, whatever order its keys arrived in.
 *
 * `JSON.stringify` preserves insertion order, so the same declaration read from
 * two files that differ only in key order would hash differently and turn an
 * idempotent republication into a failed deploy. Sorting the keys first is what
 * makes the checksum a statement about content.
 */
export function checksumOf(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalise(nested)]),
  );
}

/**
 * Where two versions of the same content disagree, as paths.
 *
 * A failed publication that says only "the checksum differs" leaves the
 * operator to diff two JSONB blobs by hand at deploy time; naming the paths is
 * what turns the refusal into something actionable
 * (spec, "Rewriting a published version fails the deploy").
 */
export function differencesBetween(stored: unknown, incoming: unknown, at = ''): readonly string[] {
  if (canonicalJson(stored) === canonicalJson(incoming)) {
    return [];
  }

  if (!isPlainObject(stored) || !isPlainObject(incoming)) {
    return [`${at || '(root)'}: stored ${brief(stored)}, publishing ${brief(incoming)}`];
  }

  return [...new Set([...Object.keys(stored), ...Object.keys(incoming)])]
    .toSorted()
    .flatMap((key) => differencesBetween(stored[key], incoming[key], at === '' ? key : `${at}.${key}`));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BRIEF_LENGTH = 80;

function brief(value: unknown): string {
  if (value === undefined) {
    return 'nothing';
  }

  const text = canonicalJson(value);

  return text.length <= BRIEF_LENGTH ? text : `${text.slice(0, BRIEF_LENGTH)}…`;
}
