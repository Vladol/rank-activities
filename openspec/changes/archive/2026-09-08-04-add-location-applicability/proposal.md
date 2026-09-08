## Why

Surfing in Prague is impossible because of geography, not because of today's waves. A
service that cannot tell those apart answers "surfing: 0" and teaches the user something
false. Stage 2 (`docs/development-flow/stage-two.md` §4) made this the central functional
question of the project; stage 3 then found that the data source cannot answer it
directly.

What the live API actually does (`docs/development-flow/stage-three.md` §5):

- A marine request for an inland point returns **HTTP 200 with a full time grid and every
  value null** — identical for Prague, for Lake Geneva, and for a wave-model outage. The
  probe works, but a single probe cannot distinguish geography from a ten-minute failure.
- **Elevation is not evidence of snow.** Quito sits at 2 850 m on the equator and never
  sees snow; Tromsø sits at sea level and has snow for half the year. Only climate data
  answers this, and the archive provides it: 96.5 cm of January snowfall in Chamonix
  against 0.0 cm in Lisbon.
- The **geocoder already returns elevation, timezone, population and administrative
  divisions**, so resolving a city needs one call, not two.

Deciding applicability is also what keeps the service cheap and fast: an activity ruled
out before the weather call removes its metrics from the request, and for an inland city
removes an entire outbound call.

## What Changes

- **Location resolution** from a city name or from raw coordinates, returning coordinates,
  timezone, elevation and administrative context in one lookup.
- **Ambiguity is resolved and disclosed.** The most populous candidate is chosen, and the
  answer states which one, so "Moscow" never silently means the wrong country.
- **A stable identity per location**, derived from its rounded coordinates, so the same
  city yields the same identifier across requests without a storage round-trip.
- **A location profile** computed once and reused: which activities are possible here, on
  what evidence, under which rules version.
- **A two-phase marine probe.** One all-null probe makes a location a *candidate* for "no
  coastline"; confirmation requires a second all-null probe on a different day. Until
  confirmed, surfing is reported as missing data rather than as impossible — an
  understatement is acceptable, a confident falsehood is not.
- **Snow-season evidence from the climate archive**, evaluated for the cold month of the
  location's own hemisphere, with an elevation heuristic used only as a flagged fallback
  when the archive is unavailable.
- **Applicability is decided before any weather request** and narrows the metric set that
  the request carries.

**Out of scope, deliberately:**

- Persisting profiles in PostgreSQL. Storage is `08-add-data-persistence`; until then the
  profile store sits behind a port with an in-memory implementation. **The two-phase probe
  requirement below cannot be satisfied by that implementation** — see the risk in design.md —
  so `08` is a prerequisite for completing this change, not an optional follow-up.
- A static coastline dataset. It is the deterministic alternative to the probe and is kept
  as a documented fallback, not built now.
- Treating a location as a region ("mountains two hours away"). Stage 2 §11 keeps a
  location a point; the elevation parameter found in stage 3 is noted as the cheaper future
  path.
- Scoring and ranking, which belong to `scoring-engine` and `activity-ranking`.

## Capabilities

### New Capabilities

- `location-applicability`: turning a user's location input into a resolved, stably
  identified place, and deciding which activities are possible there at all — evidence
  gathering, the two-phase marine probe, snow-season classification, profile reuse and
  versioning, and the effect on what weather data is requested.

### Modified Capabilities

None.

## Impact

| Area | Effect |
|---|---|
| `src/modules/geo/` | Location resolver, profile service, applicability rules; consumes the place-lookup port |
| `src/domain/activity/applicability.ts` | Applicability rule registry the declarations reference |
| `src/domain/shared/coordinates.ts` | Rounding and stable identity |
| `openspec/changes/01-add-weather-source-contract` | Prerequisite: archive and marine capability ports, place-lookup port |
| `openspec/changes/02-add-mock-weather-provider` | Prerequisite: the recorded fixtures this change's tests run against |
| `openspec/changes/03-add-activity-declaration-model` | Prerequisite: declarations name applicability rules |
| Dependencies | None added |
