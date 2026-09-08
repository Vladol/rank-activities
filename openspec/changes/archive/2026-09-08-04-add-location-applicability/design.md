## Context

Stage 3 established the two facts that shape this design: a marine request over land
answers 200 with an all-null grid, indistinguishable from an outage, and the geocoder
already returns elevation, time zone and population, so the elevation endpoint is not
needed for the city path. `01-add-weather-source-contract` provides the marine and archive
ports and the place-lookup port; `03-add-activity-declaration-model` provides the registry of
applicability rules that declarations reference; `02-add-mock-weather-provider` provides the
recorded responses this change's tests run against. Persistent storage arrives with
`08-add-data-persistence`, and this change is not finished before it: see the risk below.

## Goals / Non-Goals

**Goals:**

- Never claim geography on evidence that could be an outage.
- Decide applicability before the weather call, so it also shrinks the request.
- Keep the evidence and the decision separable, so a decision can be recomputed when the
  rules change.

**Non-Goals:**

- A coastline dataset, PostGIS, or reverse geocoding.
- Treating a location as a region.
- Scoring, hard constraints and the response contract.

## Decisions

### Decision 1: Coastal applicability by a two-phase probe

One all-null marine response makes a location a candidate; a second, on a different day,
confirms. Until confirmation the activity is reported as missing data.

**Alternative rejected: a static coastline dataset (Natural Earth).** Deterministic,
offline, and immune to outages — the option flow.md §2.3 originally preferred. It needs a
geographic index and possibly PostGIS for one boolean, and it answers a different question
than the one that matters: model coverage, not distance to water. Lake Geneva shows the
difference, and the probe gets it right for free. Kept as the documented fallback if the
probe proves fragile.

**Alternative rejected: trusting a single probe.** One call instead of two and no state to
keep. It converts any wave-model outage into a permanent, confident lie about a place —
the exact failure the three-state contract exists to prevent.

**Alternative rejected: reporting an unconfirmed candidate as inapplicable, with a
confidence flag.** More informative on paper. Clients render inapplicable as "not possible
here", and a flag they may ignore does not make that honest.

### Decision 2: Snow season from the archive, heuristic only as a marked fallback

Cold-month snowfall from the climate archive decides. The elevation heuristic is used only
when the archive is unreachable, and the profile says so.

**Alternative rejected: elevation, or elevation plus latitude.** One cheap number, no
extra call. Quito at 2 850 m on the equator and Tromsø at sea level are both wrong under
it, and both are ordinary cities.

**Alternative rejected: inferring the cold month from the sign of the latitude.** Correct
for nearly everywhere and still an assumption layered on top of the data. Probing both
candidate months and taking the larger snowfall costs one extra call once per location and
assumes nothing.

### Decision 3: Identity derived from rounded coordinates

The location identity is a deterministic function of coordinates rounded to the grid
precision.

**Alternative rejected: a database-generated identifier.** Natural for a relational store,
and it makes identity depend on insertion order and on the store existing — while stage 6
is when the store arrives and identity is needed now.

**Alternative rejected: the source's own place identifier.** Stable while the source is
stable, and it ties our identity to a vendor, which is the coupling the port structure
exists to avoid. It is kept in the profile as an attribute.

### Decision 4: The profile stores evidence, not just conclusions

The profile records what was observed and which rules version interpreted it.

**Alternative rejected: storing only the booleans.** Smaller and sufficient until the
first threshold change, at which point every profile has to be rebuilt from scratch
because nothing recorded what it was based on.

### Decision 5: Profile store behind a port, in memory until stage 6

The service depends on a profile store interface; the first implementation is in-process.

**Alternative rejected: bringing PostgreSQL forward into this change.** It would make the
probe state durable immediately. It also pulls migrations, a container and a connection
into a change about applicability, and stage 6 is where the storage decisions belong.

## Risks / Trade-offs

- **In-memory profiles are lost on restart → an unconfirmed probe restarts its two-phase
  cycle.** The cost was first written as "an extra missing-data answer and one extra probe",
  which understates it: confirmation requires a probe on a *different day*, so a process that
  restarts more often than daily never reaches the second day with the first probe still
  recorded, and the confirmation has no reachable terminal state. Surfing at an inland
  location would stay missing-data indefinitely instead of settling on inapplicable.
  `08-add-data-persistence` is therefore a prerequisite for this change's two-phase
  requirement, not a later improvement to it.
- **The two-phase probe delays a correct "inapplicable" by a day.** Mitigation: the
  interim answer is missing data marked retryable, which is honest, and the probe is
  ~700 bytes.
- **Cold-month probing of both hemispheres doubles the archive calls for a new location.**
  Bounded: twice, once in a location's lifetime, ~1.2 KB each.
- **Rounded-coordinate identity merges genuinely distinct nearby places.** Accepted: the
  source's own grid is coarser than the rounding, so the merged places would receive
  identical weather data anyway.

## Open Questions

- Whether a confirmed no-coastline decision should ever expire. Coastlines do not move,
  but wave-model coverage can change; a long expiry is cheap insurance and can be added
  without changing a requirement.
- Whether the second probe should be scheduled in the background rather than awaiting the
  location's next request. Background confirmation shortens the missing-data window and
  needs a scheduler, which the service does not yet have.
