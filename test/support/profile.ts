import type { LocationProfile } from '../../src/domain/location/location-profile';
import type { ResolvedLocation } from '../../src/domain/location/resolved-location';
import type { LocationProfileService } from '../../src/modules/geo/location-profile.service';

/**
 * The profile, or a failure that stops the test rather than a `Result` every
 * case has to unwrap.
 *
 * Profiling can be refused since `08-add-data-persistence` — a place we have
 * never seen cannot be profiled with nowhere to keep the evidence. Almost every
 * test is about what a *successful* profile says, so the refusal is asserted
 * where it is the subject and thrown everywhere else.
 */
export async function profiled(
  service: LocationProfileService,
  location: ResolvedLocation,
): Promise<LocationProfile> {
  const result = await service.profileFor(location);

  if (!result.ok) {
    throw new Error(`profiling ${location.id} was refused: ${result.error.code}`);
  }

  return result.value;
}
