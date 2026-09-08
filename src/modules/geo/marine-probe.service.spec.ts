import { describe, expect, it } from 'vitest';

import { domainError } from '../../domain/shared/domain-error';
import { FailingSeriesPort, recordingMarinePort } from '../../../test/support/fake-series-port';
import { MarineProbeService } from './marine-probe.service';

const PRAGUE = { latitude: 50.0875, longitude: 14.4213 };
const GENEVA = { latitude: 46.2044, longitude: 6.1432 };
const LISBON = { latitude: 38.7167, longitude: -9.1333 };

function probeService(port = recordingMarinePort()) {
  return { service: new MarineProbeService(port), port };
}

describe('the marine probe', () => {
  it('asks for one variable over one day, and nothing else', async () => {
    const { service, port } = probeService();

    await service.probe(LISBON, 'auto');

    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]?.metrics).toEqual(['wave_height']);
    expect(port.requests[0]?.horizon).toEqual({ kind: 'forecast', forecastDays: 1 });
  });

  it('puts the probe on the location it is about', async () => {
    const { service, port } = probeService();

    await service.probe(PRAGUE, 'Europe/Prague');

    expect(port.requests[0]?.location).toEqual(PRAGUE);
    expect(port.requests[0]?.timezone).toBe('Europe/Prague');
  });

  it('reads a full grid with no values as uncovered', async () => {
    const { service } = probeService();

    expect(await service.probe(PRAGUE, 'auto')).toEqual({ kind: 'uncovered' });
  });

  it('reads a lake the wave model does not reach the same way as any other point', async () => {
    const { service } = probeService();

    expect(await service.probe(GENEVA, 'auto')).toEqual({ kind: 'uncovered' });
  });

  it('reads wave values as covered', async () => {
    const { service } = probeService();

    expect(await service.probe(LISBON, 'auto')).toEqual({ kind: 'covered' });
  });

  it('reads a source failure as a failure, never as uncovered', async () => {
    const service = new MarineProbeService(
      new FailingSeriesPort('marine', domainError('TIMEOUT', 'no answer within the budget')),
    );

    expect(await service.probe(LISBON, 'auto')).toEqual({ kind: 'failed' });
  });
});
