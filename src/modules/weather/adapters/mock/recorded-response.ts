import { domainError } from '../../../../domain/shared/domain-error';
import { type Result, err, ok } from '../../../../domain/shared/result';
import type { WeatherError } from '../../ports/contracts';
import { parseJsonBody } from '../open-meteo/open-meteo.schema';
import type { ResolvedFixture } from './fixture-registry';

/**
 * What a caller does with the bytes a recording replays.
 *
 * The recorded sources replay the status, the content type and the body
 * exactly as they arrived, so the same checks a live client would make run
 * against the same bytes. The order matters and is the one the live path will
 * use: a body that is not the media type we expect cannot be interpreted at
 * all, so the content type is read before the status
 * (design.md, "Error handling").
 *
 * Every failure maps onto a code the source contract already defines. None is
 * invented here (tasks.md, 1.3):
 *
 * | Recording | Code |
 * |---|---|
 * | 403 with an nginx HTML page | `UNEXPECTED_CONTENT_TYPE` |
 * | 400 with a JSON error envelope | `UNEXPECTED_STATUS` |
 * | 200 with zero bytes | `MALFORMED_BODY` |
 * | 200 that parses but is not the envelope | `SCHEMA_MISMATCH` |
 */
export interface ReplayOptions {
  /** Where the source's own error text goes. It never reaches the caller. */
  readonly log: (line: string) => void;
}

export function replayRecordedBody(
  resolved: ResolvedFixture,
  options: ReplayOptions,
): Result<unknown, WeatherError> {
  const { entry, body } = resolved;

  if (!entry.contentType.includes('json')) {
    options.log(`${entry.name}: HTTP ${entry.status} ${entry.contentType} — ${preview(body)}`);

    return err(
      domainError('UNEXPECTED_CONTENT_TYPE', 'the source answered with a body we cannot read', {
        fixture: entry.name,
        status: entry.status,
        contentType: entry.contentType,
      }),
    );
  }

  if (entry.status !== 200) {
    // The reason is logged and goes no further: stage 3 recorded one that was
    // factually wrong and one that leaked an internal type name.
    options.log(`${entry.name}: HTTP ${entry.status} — ${preview(body)}`);

    return err(
      domainError('UNEXPECTED_STATUS', 'the source refused the request', {
        fixture: entry.name,
        status: entry.status,
      }),
    );
  }

  const parsed = parseJsonBody(body);

  if (!parsed.ok) {
    options.log(`${entry.name}: HTTP ${entry.status} with ${body.length} bytes of body`);

    return err({ ...parsed.error, context: { ...parsed.error.context, fixture: entry.name } });
  }

  return ok(parsed.value);
}

function preview(body: string): string {
  return body.length === 0 ? '(empty body)' : body.slice(0, 200).replace(/\s+/g, ' ').trim();
}
