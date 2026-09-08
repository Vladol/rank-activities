import type { Result } from '../../../../../domain/shared/result';
import type { WeatherError } from '../../../ports/contracts';
import type {
  PlaceCandidate,
  PlaceLookupPort,
  PlaceQuery,
} from '../../../ports/place-lookup.port';
import { OpenMeteoHttp, type OpenMeteoHttpOptions } from '../open-meteo.http';
import { parsePlaceLookupResponse } from './schema';

/**
 * The geocoding host. It is a fourth host with the same envelope discipline
 * as the three series ones, and place lookup is its own seam rather than a
 * fourth capability (design.md, Decision 8 of `01-add-weather-source-contract`).
 */
export const GEOCODING_ORIGIN = 'https://geocoding-api.open-meteo.com';

/** How many candidates to ask for when the caller does not say. */
const DEFAULT_COUNT = 10;

/**
 * The lookup URL for a query.
 *
 * `URLSearchParams` does the percent-encoding, and it has to: a name sent as
 * raw UTF-8 came back as an HTML error page rather than as JSON
 * (samples/error-geocoding-unencoded-utf8.html).
 *
 * No ranking parameter is sent. Every candidate crosses the port and
 * `location-applicability` chooses; an adapter that narrowed the list here
 * would be taking that decision instead.
 */
export function geocodingUrl(query: PlaceQuery, origin: string = GEOCODING_ORIGIN): string {
  const parameters = new URLSearchParams({
    name: query.name,
    count: String(query.count ?? DEFAULT_COUNT),
    format: 'json',
  });

  if (query.language !== undefined) {
    parameters.set('language', query.language);
  }

  return `${origin}/v1/search?${parameters.toString()}`;
}

/**
 * Place lookup against the live geocoding host.
 *
 * It is its own seam rather than a fourth capability, so it gets its own
 * source and its own token — but the same transport and the same rule about
 * the vendor's error text: it is logged and never returned.
 */
export interface OpenMeteoPlaceLookupOptions extends OpenMeteoHttpOptions {
  /** Overridden only by the tests, which point it at a local server. */
  readonly origin?: string;
}

export class OpenMeteoPlaceLookup implements PlaceLookupPort {
  readonly sourceId = 'open-meteo-lookup';

  private readonly http: OpenMeteoHttp;
  private readonly origin: string;

  constructor(options: OpenMeteoPlaceLookupOptions = {}) {
    this.http = new OpenMeteoHttp(options);
    this.origin = options.origin ?? GEOCODING_ORIGIN;
  }

  async lookup(query: PlaceQuery): Promise<Result<readonly PlaceCandidate[], WeatherError>> {
    const answered = await this.http.get(geocodingUrl(query, this.origin));

    return answered.ok ? parsePlaceLookupResponse(bodyOf(answered.value.body)) : answered;
  }

  close(): Promise<void> {
    return this.http.close();
  }
}

/**
 * The body as JSON, or `undefined`. A body that is not JSON has already been
 * refused by the transport, so the failure here is the schema's to report.
 */
function bodyOf(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
