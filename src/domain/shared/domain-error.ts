/**
 * A failure as a plain value, never an `Error` and never thrown
 * (design.md, Decision 4 of `01-add-weather-source-contract`).
 *
 * `message` and `context` are ours. A source's own error text is logged by the
 * adapter and never copied in here: stage 3 recorded one message that was
 * factually wrong and one that leaked an internal type name
 * (docs/development-flow/stage-three.md, section 6).
 */
export interface DomainError<Code extends string = string> {
  readonly code: Code;
  readonly message: string;
  readonly context?: ErrorContext;
}

/** Structured facts we authored: a metric name, an expected unit, a capability. */
export type ErrorContext = Readonly<Record<string, string | number | boolean>>;

/**
 * The fixed set of fault kinds every source maps onto, so a failure reads the
 * same whichever source produced it.
 */
export const WEATHER_ERROR_CODES = [
  /** The call never completed: DNS, connection reset, socket error. */
  'TRANSPORT_FAILURE',
  /** No answer within the configured per-attempt budget. */
  'TIMEOUT',
  /** An HTTP status the contract does not accept. */
  'UNEXPECTED_STATUS',
  /** A body that is not the media type the contract expects — HTML from nginx, say. */
  'UNEXPECTED_CONTENT_TYPE',
  /** The body is the right media type but does not parse: an empty 200, truncated JSON. */
  'MALFORMED_BODY',
  /** The body parses but does not match the schema, units included. */
  'SCHEMA_MISMATCH',
] as const;

export type WeatherErrorCode = (typeof WEATHER_ERROR_CODES)[number];

export function isWeatherErrorCode(value: string): value is WeatherErrorCode {
  return (WEATHER_ERROR_CODES as readonly string[]).includes(value);
}

export function domainError<Code extends string>(
  code: Code,
  message: string,
  context?: ErrorContext,
): DomainError<Code> {
  return context === undefined ? { code, message } : { code, message, context };
}
