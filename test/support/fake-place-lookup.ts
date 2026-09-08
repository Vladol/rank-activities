import type { Result } from '../../src/domain/shared/result';
import { err, ok } from '../../src/domain/shared/result';
import type { WeatherError } from '../../src/modules/weather/ports/contracts';
import type {
  PlaceCandidate,
  PlaceLookupPort,
  PlaceQuery,
} from '../../src/modules/weather/ports/place-lookup.port';

/**
 * A place-lookup port that answers from a script and counts what it was asked.
 *
 * The call count is the assertion for every "no outbound lookup is attempted"
 * scenario in spec `location-applicability`: a resolver that rejects the input
 * and then asks anyway would still return the right error.
 */
export class FakePlaceLookup implements PlaceLookupPort {
  readonly sourceId = 'fake-lookup';

  readonly queries: PlaceQuery[] = [];

  constructor(
    private readonly answer:
      | { readonly kind: 'candidates'; readonly candidates: readonly PlaceCandidate[] }
      | { readonly kind: 'failure'; readonly error: WeatherError },
  ) {}

  static returning(candidates: readonly PlaceCandidate[]): FakePlaceLookup {
    return new FakePlaceLookup({ kind: 'candidates', candidates });
  }

  static failing(error: WeatherError): FakePlaceLookup {
    return new FakePlaceLookup({ kind: 'failure', error });
  }

  lookup(query: PlaceQuery): Promise<Result<readonly PlaceCandidate[], WeatherError>> {
    this.queries.push(query);

    return Promise.resolve(
      this.answer.kind === 'candidates' ? ok(this.answer.candidates) : err(this.answer.error),
    );
  }
}

/**
 * A lookup whose answer depends on the name asked about, which is what the
 * negative cache is made of: one name resolves, another does not, and the
 * question is which of them reaches the source a second time.
 */
export function scriptedPlaceLookup(
  script: (query: PlaceQuery) => Result<readonly PlaceCandidate[], WeatherError>,
): PlaceLookupPort & { readonly queries: readonly PlaceQuery[] } {
  const queries: PlaceQuery[] = [];

  return {
    sourceId: 'scripted-lookup',
    queries,
    lookup: (query) => {
      queries.push(query);

      return Promise.resolve(script(query));
    },
  };
}

export function placeCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    sourcePlaceId: '1',
    name: 'Somewhere',
    latitude: 0,
    longitude: 0,
    elevationMetres: 0,
    timezone: 'UTC',
    ...overrides,
  };
}
