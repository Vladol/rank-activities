import type { HorizonLimits } from '../../src/domain/ranking/horizon';
import type { Capability } from '../../src/domain/weather/metric';
import { SeedActivityCatalogue } from '../../src/modules/activities/seed-catalogue';
import { InMemoryLocationProfileStore } from '../../src/modules/geo/adapters/in-memory-profile.store';
import { LocationProfileService } from '../../src/modules/geo/location-profile.service';
import { LocationResolverService } from '../../src/modules/geo/location-resolver.service';
import { MarineProbeService } from '../../src/modules/geo/marine-probe.service';
import { SnowSeasonService } from '../../src/modules/geo/snow-season.service';
import { RankingService } from '../../src/modules/ranking/ranking.service';
import { readScoringProfile } from '../../src/modules/scoring/scoring-profile.service';
import { recordedPlaceLookupSource } from '../../src/modules/weather/adapters/mock/recorded-sources';
import { MetricPlannerService } from '../../src/modules/weather/metric-planner.service';
import type { PlaceLookupPort } from '../../src/modules/weather/ports/place-lookup.port';
import type { SeriesPort } from '../../src/modules/weather/ports/series.port';
import { SourceRouterService } from '../../src/modules/weather/source-router.service';
import { type RecordingSeriesPort, recordingPort } from './fake-series-port';

const DAY_MS = 86_400_000;

export interface RankingHarness {
  readonly service: RankingService;
  readonly forecast: SeriesPort<'forecast'>;
  readonly marine: SeriesPort<'marine'>;
  readonly archive: SeriesPort<'archive'>;
  readonly lookup: PlaceLookupPort;
  /** Requests every recording port was given, in the order they arrived. */
  readonly requests: () => readonly { capability: Capability; metrics: readonly string[] }[];
  /** Moves the profile clock on, which is what a two-phase probe needs. */
  readonly nextDay: () => void;
}

export interface HarnessOptions {
  readonly limits?: HorizonLimits;
  readonly forecast?: SeriesPort<'forecast'>;
  readonly marine?: SeriesPort<'marine'>;
  readonly archive?: SeriesPort<'archive'>;
  readonly lookup?: PlaceLookupPort;
  readonly now?: number;
}

/**
 * The use case wired to the recorded sources — the real catalogue, the real
 * profile, the real declarations. A case that passed against a catalogue
 * written in the test would say nothing about the one that ships.
 *
 * Every port is swappable, because the failure cases are exactly the ones a
 * recording cannot produce: a host that is down is not something anybody
 * recorded.
 */
export function rankingHarness(options: HarnessOptions = {}): RankingHarness {
  const forecast = options.forecast ?? recordingPort('forecast');
  const marine = options.marine ?? recordingPort('marine');
  const archive = options.archive ?? recordingPort('archive');
  const lookup = options.lookup ?? recordedPlaceLookupSource();
  const catalogue = SeedActivityCatalogue.load();

  let clock = options.now ?? Date.now();

  const profiles = new LocationProfileService(
    new InMemoryLocationProfileStore(),
    new MarineProbeService(marine),
    new SnowSeasonService(archive),
    catalogue,
    { now: () => clock },
  );

  const service = new RankingService(
    new LocationResolverService(lookup),
    profiles,
    catalogue,
    new MetricPlannerService(),
    new SourceRouterService([forecast, marine, archive]),
    readScoringProfile(),
    options.limits ?? { defaultDays: 7, maxDays: 7 },
  );

  return {
    service,
    forecast,
    marine,
    archive,
    lookup,
    requests: () =>
      [forecast, marine, archive]
        .flatMap((port) => requestsOf(port))
        .map((request) => ({ capability: request.capability, metrics: request.metrics })),
    nextDay: () => {
      clock += DAY_MS;
    },
  };
}

function requestsOf(port: SeriesPort) {
  return (port as Partial<RecordingSeriesPort<Capability>>).requests ?? [];
}

/**
 * Profiles a place over consecutive days until the two-phase marine probe has
 * settled, then answers. Without this an inland location is `undecided` rather
 * than `NotApplicable`, which is the probe working as designed rather than a
 * failure to arrange.
 */
export async function rankSettled(
  harness: RankingHarness,
  request: Parameters<RankingService['rank']>[0],
  days = 2,
) {
  let answer = await harness.service.rank(request);

  for (let day = 1; day < days; day += 1) {
    harness.nextDay();
    answer = await harness.service.rank(request);
  }

  return answer;
}
