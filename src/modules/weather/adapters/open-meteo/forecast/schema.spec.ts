import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseForecastResponse } from './schema';
import { forecastVariables } from './variables';

/**
 * Read from the stage-three evidence rather than from the fixture set: these
 * are the responses the live API was actually observed to give, imperial units
 * included, and the imperial one is deliberately not a fixture — it is the
 * silent-corruption case, and nothing may ever serve it
 * (stage-three.md, section 2.4).
 */
const SAMPLES = join(process.cwd(), 'docs/investigation/open-meteo/samples');

function sample(name: string): string {
  return readFileSync(join(SAMPLES, `${name}.json`), 'utf8');
}

function asked(...metrics: Parameters<typeof forecastVariables>[0]) {
  const variables = forecastVariables(metrics);

  if (!variables.ok) {
    throw new Error(`the test asked for a metric the map does not name: ${variables.error.message}`);
  }

  return variables.value;
}

/**
 * The stage-three samples were recorded with hand-built URLs that asked for
 * the hourly channel only, so the request the check is made against has to be
 * the one that produced them — a response is only ever wrong relative to what
 * was asked.
 */
function askedHourly(...metrics: Parameters<typeof forecastVariables>[0]) {
  return { hourly: asked(...metrics).hourly, daily: [] };
}

describe('the forecast schema against what the live API answered', () => {
  it('accepts the full Lisbon response', () => {
    const parsed = parseForecastResponse(
      sample('forecast-lisbon-full'),
      askedHourly('temperature_2m', 'precipitation', 'wind_speed_10m'),
    );

    expect(parsed.ok).toBe(true);
  });

  it('accepts a response carrying only the three variables that were asked for', () => {
    const parsed = parseForecastResponse(
      sample('forecast-minimal-3vars'),
      askedHourly('temperature_2m', 'precipitation', 'wind_speed_10m'),
    );

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(Object.keys(parsed.value.hourly_units ?? {})).toContain('temperature_2m');
  });

  it('leaves a variable that did not come back to the source to notice', () => {
    const parsed = parseForecastResponse(
      sample('forecast-minimal-3vars'),
      askedHourly('temperature_2m', 'snow_depth'),
    );

    // The schema decides shape and units. Whether the caller got the metric it
    // asked for is a question about metrics across both axes, and the source
    // answers it — `open-meteo.source.spec.ts`, "fails when the response omits
    // a metric that was asked for".
    expect(parsed.ok).toBe(true);
  });
});

describe('the forecast schema refuses units it did not ask for', () => {
  it('rejects the imperial response outright', () => {
    const parsed = parseForecastResponse(
      sample('forecast-units-imperial'),
      askedHourly('temperature_2m', 'precipitation', 'wind_speed_10m'),
    );

    expect(parsed.ok).toBe(false);
  });

  it('names the variable and both units', () => {
    const parsed = parseForecastResponse(
      sample('forecast-units-imperial'),
      askedHourly('temperature_2m'),
    );

    expect(parsed.ok).toBe(false);

    if (parsed.ok) {
      return;
    }

    const reported = JSON.stringify(parsed.error);

    expect(reported).toContain('temperature_2m');
    // What arrived and what was expected: `72.0` is a plausible temperature in
    // either scale, so only the declared unit can tell them apart.
    expect(reported).toContain('°F');
    expect(reported).toContain('°C');
  });

  it('takes the decision from the declared unit alone, never from the values', () => {
    const body = JSON.parse(sample('forecast-units-imperial')) as {
      hourly: Record<string, unknown>;
    };
    // Values that are unremarkable in Celsius, still declared in Fahrenheit.
    body.hourly.temperature_2m = (body.hourly.temperature_2m as number[]).map(() => 18.4);

    const parsed = parseForecastResponse(JSON.stringify(body), askedHourly('temperature_2m'));

    expect(parsed.ok).toBe(false);
  });
});
