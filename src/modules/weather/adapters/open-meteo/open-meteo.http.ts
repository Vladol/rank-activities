import { Agent, type Dispatcher, fetch } from 'undici';

import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { WeatherError } from '../../ports/contracts';

/** Live p95 is 136 ms (stage-three.md, section 7.1); two seconds is already generous. */
const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 1_000;

/**
 * The one place in the service that opens a socket.
 *
 * It decides what it is holding before it parses it: status, content type and
 * emptiness are examined first, so an nginx error page and a zero-byte 200
 * become typed failures instead of a `SyntaxError` thrown past the schema
 * (design.md, Decision 4). Nothing here throws for anything that happened on
 * the wire.
 */
export interface SourceResponse {
  readonly status: number;
  /** The decoded body, JSON text only: anything else failed classification. */
  readonly body: string;
  /** When the answer arrived, taken here and carried into the provenance. */
  readonly fetchedAt: string;
}

/** What an observer of the wire is handed: the raw exchange, before any parse. */
export interface ObservedResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly fetchedAt: string;
}

export interface OpenMeteoHttpOptions {
  /** Where the source's own error text goes; it is never returned to the caller. */
  readonly log?: (line: string) => void;
  /**
   * Called with every exchange whose body was read, on the serving path
   * itself. It is how the recording mode captures a fixture without becoming a
   * second implementation of the adapter (design.md, Decision 6): a body that
   * was classified out — an error page we cancelled unread — is not an
   * observation, because we never held it.
   */
  readonly observe?: (response: ObservedResponse) => void;
  readonly now?: () => number;
  /** Each bound applies to one attempt; a chain of attempts is `07`'s concern. */
  readonly connectTimeoutMs?: number;
  readonly headersTimeoutMs?: number;
  readonly bodyTimeoutMs?: number;
}

/**
 * The limit status, and the only thing we are willing to conclude from a
 * limited response. Its body shape was never captured, because capturing it
 * means violating the limit that protects the free tier (design.md,
 * Decision 5), so the status and `Retry-After` are the whole of the evidence.
 */
const RATE_LIMIT_STATUS = 429;

/**
 * Whether a failure is the source telling us to slow down. The contract has
 * six codes and no seventh for this, so the fact travels in the context and is
 * read through here rather than by everyone re-deriving it — `07` decides what
 * to do about it.
 */
export function isRateLimited(error: WeatherError): boolean {
  return error.context?.rateLimited === true;
}

export class OpenMeteoHttp {
  private readonly agent: Agent;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly observe: (response: ObservedResponse) => void;

  constructor(options: OpenMeteoHttpOptions = {}) {
    this.agent = new Agent({
      connect: { timeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS },
      headersTimeout: options.headersTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      bodyTimeout: options.bodyTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => Date.now());
    this.observe = options.observe ?? (() => undefined);
  }

  async get(url: string): Promise<Result<SourceResponse, WeatherError>> {
    const answered = await this.send(url);

    if (!answered.ok) {
      return answered;
    }

    const response = answered.value;

    // The limit is decided before the content type, and before anything is
    // read: what a limited response carries is an assumption we refused to
    // test at the source's expense.
    if (response.status === RATE_LIMIT_STATUS) {
      await response.body?.cancel();

      const retryAfterSeconds = secondsFrom(response.headers.get('retry-after'));
      this.log(
        `Open-Meteo answered ${RATE_LIMIT_STATUS} for ${url}` +
          (retryAfterSeconds === undefined ? '' : `, retry after ${retryAfterSeconds}s`),
      );

      return err(
        domainError('UNEXPECTED_STATUS', 'the source refused the request at its rate limit', {
          status: RATE_LIMIT_STATUS,
          rateLimited: true,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        }),
      );
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (!isJson(contentType)) {
      // Cancelled rather than read: an error page is not evidence, and reading
      // it is the step that turns a classified failure into a parse error.
      await response.body?.cancel();
      this.log(
        `Open-Meteo answered ${response.status} with content-type "${contentType}" for ${url}`,
      );

      return err(
        domainError('UNEXPECTED_CONTENT_TYPE', 'the source answered with a body that is not JSON', {
          status: response.status,
          contentType,
        }),
      );
    }

    const body = await response.text();
    const fetchedAt = new Date(this.now()).toISOString();

    this.observe({
      url,
      status: response.status,
      contentType,
      body,
      fetchedAt,
    });

    if (!isSuccess(response.status)) {
      // Read only to log. The status and the request we made decide the code;
      // the source's own `reason` has been recorded naming an internal Swift
      // type and stating a range that was factually wrong, so it is evidence
      // for an operator and never an answer for a caller.
      this.log(
        `Open-Meteo answered ${response.status} for ${url}: ${reasonIn(body) ?? body.slice(0, 200)}`,
      );

      return err(
        domainError('UNEXPECTED_STATUS', 'the source refused the request', {
          status: response.status,
        }),
      );
    }

    // A zero-byte 200 was observed live (stage-three.md, section 6). Caught
    // here it names itself; passed on it becomes a `SyntaxError` at position 0.
    if (body.length === 0) {
      this.log(`Open-Meteo answered ${response.status} with an empty body for ${url}`);

      return err(
        domainError('MALFORMED_BODY', 'the source answered with an empty body', {
          status: response.status,
          bytes: 0,
        }),
      );
    }

    return ok({ status: response.status, body, fetchedAt });
  }

  /**
   * The request itself. Everything that can happen on the wire is caught here
   * and returned: the contract says a port never throws for anything that
   * originated outside the process (`series.port.ts`).
   */
  private async send(url: string): Promise<Result<Response, WeatherError>> {
    try {
      return ok(await fetch(url, { dispatcher: this.agent as Dispatcher }));
    } catch (thrown) {
      const code = undiciCodeOf(thrown);
      this.log(`Open-Meteo did not answer ${url}: ${code ?? String(thrown)}`);

      return err(
        TIMEOUT_CODES.has(code ?? '')
          ? domainError('TIMEOUT', 'the source did not answer within the attempt budget', {
              cause: code ?? 'unknown',
            })
          : domainError('TRANSPORT_FAILURE', 'the call to the source never completed', {
              cause: code ?? 'unknown',
            }),
      );
    }
  }

  /** Closes the pool. A process that keeps the agent open keeps its sockets open. */
  async close(): Promise<void> {
    await this.agent.close();
  }
}

/**
 * The delay the source stated, in seconds, or nothing. The header also allows
 * an HTTP date; a value we cannot read as a number yields no delay rather than
 * a `NaN` that would be waited on.
 */
/**
 * `undici` reports a timeout as a `TypeError('fetch failed')` whose `cause`
 * carries the code. Reading the code rather than the message keeps the three
 * separate bounds — connect, headers, body — from collapsing into a string
 * comparison that a version bump would quietly break.
 */
const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function undiciCodeOf(thrown: unknown): string | undefined {
  const cause = thrown instanceof Error ? thrown.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;

  return typeof code === 'string' ? code : undefined;
}

function secondsFrom(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }

  const seconds = Number(header);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * The source's own explanation, for the log line. A body that does not carry
 * one is not an error here: the status already decided the failure.
 */
function reasonIn(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    const reason = (parsed as { reason?: unknown } | null)?.reason;

    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return undefined;
  }
}

function isJson(contentType: string): boolean {
  return contentType.split(';')[0]?.trim().endsWith('json') === true;
}
