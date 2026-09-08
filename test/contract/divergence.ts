/**
 * What the live contract test says when the API stops matching the adapter.
 *
 * The message is the whole point of the test: a scheduled run that fails with
 * "expected true to be false" tells the person reading it nothing, and the
 * thing they need to know is which field moved and that the fixtures — not the
 * production code — are what went stale
 * (spec `open-meteo-source`, "A vendor change is reported as a fixture
 * problem").
 *
 * It lives in its own module so the default suite can check the wording
 * without making a call.
 */
export function divergence(field: string, detail: string): string {
  return (
    `The live Open-Meteo response no longer matches the adapter's schema: ${field} — ${detail}. ` +
    'The recorded fixtures and the mapper need updating: re-record with ' +
    '`node scripts/record-fixture.ts <name> "<url>"`, then check ' +
    'open-meteo.schema.ts and open-meteo.mapper.ts.'
  );
}
