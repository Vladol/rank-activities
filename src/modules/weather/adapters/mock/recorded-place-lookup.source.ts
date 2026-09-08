import type { Result } from '../../../../domain/shared/result';
import type { WeatherError } from '../../ports/contracts';
import type {
  PlaceCandidate,
  PlaceLookupPort,
  PlaceQuery,
} from '../../ports/place-lookup.port';
import { parsePlaceLookupResponse } from '../open-meteo/geocoding/schema';
import type { FixtureRegistry } from './fixture-registry';
import { replayRecordedBody } from './recorded-response';
import type { RecordedSourceOptions } from './recorded-series.source';

/**
 * Place lookup served from recorded geocoding responses.
 *
 * Lookup is its own seam rather than a fourth capability, so it gets its own
 * recorded source (design.md, Decision 8 of `01-add-weather-source-contract`).
 * The recorded miss is the interesting case: it answers 200 with no `results`
 * key at all, which the contract's schema reads as an empty result rather than
 * a failure (stage-three.md, section 6).
 */
export class RecordedPlaceLookupSource implements PlaceLookupPort {
  readonly sourceId = 'recorded-lookup';

  private readonly log: (line: string) => void;

  constructor(
    private readonly registry: FixtureRegistry,
    options: RecordedSourceOptions = {},
  ) {
    this.log = options.log ?? (() => undefined);
  }

  lookup(query: PlaceQuery): Promise<Result<readonly PlaceCandidate[], WeatherError>> {
    const resolved = this.registry.resolveLookup(query.name);

    if (!resolved.ok) {
      return Promise.resolve(resolved);
    }

    const replayed = replayRecordedBody(resolved.value, { log: this.log });

    return Promise.resolve(
      replayed.ok ? parsePlaceLookupResponse(replayed.value) : replayed,
    );
  }
}
