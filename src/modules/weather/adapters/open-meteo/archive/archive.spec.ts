import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { mapForecastResponse } from '../forecast/mapper';
import { archiveVariables } from './variables';
import { mapArchiveResponse } from './mapper';
import { parseArchiveResponse } from './schema';

const SAMPLES = join(process.cwd(), 'docs/investigation/open-meteo/samples');

function sample(name: string): string {
  return readFileSync(join(SAMPLES, `${name}.json`), 'utf8');
}

const CONTEXT = { sourceId: 'open-meteo-archive', fetchedAt: '2026-09-08T09:00:00Z' };

function parsedJanuary() {
  const variables = archiveVariables(['snowfall', 'temperature_2m_max', 'temperature_2m_min']);

  if (!variables.ok) {
    throw new Error(variables.error.message);
  }

  const parsed = parseArchiveResponse(sample('archive-chamonix-jan'), {
    hourly: [],
    daily: variables.value.daily,
  });

  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }

  return parsed.value;
}

describe('the archive triple', () => {
  it('asks for the same vendor variables the forecast host uses', () => {
    const archive = archiveVariables(['snowfall', 'temperature_2m_max']);

    expect(archive.ok).toBe(true);

    if (!archive.ok) {
      return;
    }

    // ERA5 answers under the same names; only the host and the horizon differ.
    expect(archive.value.daily).toEqual(['snowfall_sum', 'temperature_2m_max']);
  });

  it('maps a January response exactly as the forecast host would', () => {
    const response = parsedJanuary();

    const asArchive = mapArchiveResponse(response, CONTEXT);
    const asForecast = mapForecastResponse(response, CONTEXT);

    expect(asArchive.ok && asForecast.ok).toBe(true);

    if (!asArchive.ok || !asForecast.ok) {
      return;
    }

    // Same envelope, same mapper, same numbers: the archive is a horizon, not
    // a different kind of answer.
    expect(asArchive.value.daily).toEqual(asForecast.value.daily);
    expect(asArchive.value.hourly).toEqual(asForecast.value.hourly);
  });

  it('records the archive capability in the provenance, not the forecast one', () => {
    const mappedSeries = mapArchiveResponse(parsedJanuary(), CONTEXT);

    expect(mappedSeries.ok && mappedSeries.value.provenance[0]?.capability).toBe('archive');
  });
});
