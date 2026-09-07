import { Injectable } from '@nestjs/common';

import { domainError } from '../../domain/shared/domain-error';
import { type Result, err, ok } from '../../domain/shared/result';
import type { Capability } from '../../domain/weather/metric';
import type { SeriesRequest, WeatherError } from './ports/contracts';
import type { SeriesPort } from './ports/series.port';

/**
 * Which source answers for which capability. The interface allows a source per
 * metric; the first implementation is a table of at most three rows, and the
 * generality is exercised only when a second vendor appears
 * (design.md, "Risks / Trade-offs" of `01-add-weather-source-contract`).
 *
 * A capability nothing is bound to is an error, never a quiet substitution by
 * another source.
 */
@Injectable()
export class SourceRouterService {
  private readonly table: ReadonlyMap<Capability, SeriesPort>;

  constructor(ports: readonly SeriesPort[], expected?: readonly Capability[]) {
    const table = new Map<Capability, SeriesPort>();

    for (const port of ports) {
      if (expected !== undefined && !expected.includes(port.capability)) {
        throw new Error(
          `Source "${port.sourceId}" declares the ${port.capability} capability, which is not among the ones being bound.`,
        );
      }

      table.set(port.capability, port);
    }

    this.table = table;
  }

  portFor(capability: Capability): Result<SeriesPort, WeatherError> {
    const port = this.table.get(capability);

    return port === undefined
      ? err(
          domainError('CAPABILITY_NOT_BOUND', `no source is bound to the ${capability} capability`, {
            capability,
          }),
        )
      : ok(port);
  }

  /**
   * Refuses a request carrying a metric the bound source does not declare.
   * The alternative — dropping it and fetching the rest — returns a series
   * that silently answers a different question than the one asked.
   */
  checkSupported(request: SeriesRequest): Result<SeriesRequest, WeatherError> {
    const port = this.portFor(request.capability);

    if (!port.ok) {
      return port;
    }

    for (const metric of request.metrics) {
      if (!port.value.supports(metric)) {
        return err(
          domainError(
            'UNSUPPORTED_METRIC',
            `the source bound to ${request.capability} does not serve this metric`,
            { metric, capability: request.capability },
          ),
        );
      }
    }

    return ok(request);
  }

  /** Capability to source id, for the startup log. */
  boundSources(): Readonly<Partial<Record<Capability, string>>> {
    return Object.fromEntries(
      [...this.table].map(([capability, port]) => [capability, port.sourceId]),
    );
  }
}
