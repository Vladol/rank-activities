/**
 * The reason codes of docs/development-flow/stage-two.md, section 5, declared
 * once (stage-four.md, section 4.1). The GraphQL enum, the reference table seed
 * and the translation keys are all derived from this object, so adding a reason
 * cannot leave one of the three behind.
 *
 * A provider's own `reason` field never becomes one of these: it goes to the
 * log. The live API has already been caught writing something factually wrong
 * in that field (stage-three.md, section 6).
 */
export const REASON = {
  // NotApplicable — a property of the place.
  NO_COASTLINE_NEARBY: { kind: 'not_applicable', i18n: 'reason.no_coastline_nearby' },
  NO_SNOW_SEASON: { kind: 'not_applicable', i18n: 'reason.no_snow_season' },
  // Hard constraint — a property of the weather, giving Ranked(0, ...).
  NO_SNOW_COVER: { kind: 'constraint', i18n: 'reason.no_snow_cover' },
  FLAT_SEA: { kind: 'constraint', i18n: 'reason.flat_sea' },
  DANGEROUS_SURF: { kind: 'constraint', i18n: 'reason.dangerous_surf' },
  NO_DAYLIGHT: { kind: 'constraint', i18n: 'reason.no_daylight' },
  SEVERE_WEATHER: { kind: 'constraint', i18n: 'reason.severe_weather' },
  // NoData — we cannot answer honestly.
  PROVIDER_UNAVAILABLE: { kind: 'no_data', i18n: 'reason.provider_unavailable', retryable: true },
  /**
   * Our own outbound budget is spent, not the source's patience. The request
   * is answered rather than queued: a queue would turn an exhausted quota into
   * a rising p95, which is an outage disguised as slowness (ADR 0006).
   */
  PROVIDER_BUSY: { kind: 'no_data', i18n: 'reason.provider_busy', retryable: true },
  MARINE_UNAVAILABLE: { kind: 'no_data', i18n: 'reason.marine_unavailable', retryable: true },
  /**
   * The store that keeps what is known about places could not be reached, and
   * this place is not one we already knew. It is deliberately distinct from
   * `LOCATION_NOT_FOUND`: the place exists and was resolved, and what is missing
   * is our own record of it (`data-persistence`, "A new location is refused with
   * a reason").
   */
  PROFILE_UNAVAILABLE: { kind: 'no_data', i18n: 'reason.profile_unavailable', retryable: true },
  TOO_MANY_GAPS: { kind: 'no_data', i18n: 'reason.too_many_gaps', retryable: false },
  MISSING_REQUIRED_METRIC: {
    kind: 'no_data',
    i18n: 'reason.missing_required_metric',
    retryable: false,
  },
  // Faults in the request itself.
  LOCATION_NOT_FOUND: { kind: 'request', i18n: 'reason.location_not_found' },
  HORIZON_TOO_LARGE: { kind: 'request', i18n: 'reason.horizon_too_large' },
  INVALID_COORDINATES: { kind: 'request', i18n: 'reason.invalid_coordinates' },
  /**
   * A location that is neither a name nor a point, or that is both. It is
   * deliberately not `LOCATION_NOT_FOUND`: nothing was looked for, because
   * nothing legible was asked about (`graphql-api`, "One query takes one
   * location and a bounded horizon").
   */
  INVALID_LOCATION_INPUT: { kind: 'request', i18n: 'reason.invalid_location_input' },
  /**
   * The client asked faster than the inbound limit allows. It is a fault in the
   * stream of requests rather than in this one, and it is refused before any
   * outbound call: the limit exists as much to protect the source's quota as our
   * own capacity (stage-six.md, section 5.4).
   */
  RATE_LIMITED: { kind: 'request', i18n: 'reason.rate_limited' },
  /**
   * The query itself was refused: it does not parse, it does not match the
   * schema, or it nests deeper than the endpoint allows. It never reaches a
   * resolver, so nothing was asked of the world (`graphql-api`, "The endpoint
   * is bounded against abuse").
   */
  INVALID_QUERY: { kind: 'request', i18n: 'reason.invalid_query' },
  /**
   * Our own fault, and the only code that says nothing about the request. It
   * carries no detail on purpose: what happened is in the log record the trace
   * identifier points at, and a type name or a message in the response would be
   * the leak `graphql-api` exists to prevent.
   */
  INTERNAL_ERROR: { kind: 'internal', i18n: 'reason.internal_error' },
} as const satisfies Record<string, { kind: ReasonKind; i18n: string; retryable?: boolean }>;

export const REASON_KINDS = [
  'not_applicable',
  'constraint',
  'no_data',
  'request',
  'internal',
] as const;

export type ReasonKind = (typeof REASON_KINDS)[number];

export type ReasonCode = keyof typeof REASON;

export function isReasonCode(value: string): value is ReasonCode {
  return Object.hasOwn(REASON, value);
}

/**
 * Whether asking again may help. It is a property of the reason rather than of
 * the moment: a source that is down may answer next time, and a day with too
 * many holes will have the same holes tomorrow. Declared once here, so a
 * result cannot claim one thing and the registry another.
 */
export function isRetryable(code: ReasonCode): boolean {
  const entry = REASON[code] as { readonly retryable?: boolean };

  return entry.retryable ?? false;
}

export function reasonsOfKind(kind: ReasonKind): ReasonCode[] {
  return (Object.keys(REASON) as ReasonCode[]).filter((code) => REASON[code].kind === kind);
}
