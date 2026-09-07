import { describe, expect, it } from 'vitest';

import {
  WEATHER_ERROR_CODES,
  type WeatherErrorCode,
  domainError,
  isWeatherErrorCode,
} from './domain-error';

describe('weather error codes', () => {
  it('covers exactly the fault kinds of design.md Decision 4', () => {
    expect([...WEATHER_ERROR_CODES]).toEqual([
      'TRANSPORT_FAILURE',
      'TIMEOUT',
      'UNEXPECTED_STATUS',
      'UNEXPECTED_CONTENT_TYPE',
      'MALFORMED_BODY',
      'SCHEMA_MISMATCH',
    ]);
  });

  it('keeps every code distinct', () => {
    expect(new Set(WEATHER_ERROR_CODES).size).toBe(WEATHER_ERROR_CODES.length);
  });

  it('recognises a known code and rejects an unknown one', () => {
    expect(isWeatherErrorCode('TIMEOUT')).toBe(true);
    expect(isWeatherErrorCode('timeout')).toBe(false);
    expect(isWeatherErrorCode('SOMETHING_ELSE')).toBe(false);
  });
});

describe('domainError', () => {
  it('carries the code and our own message', () => {
    const error = domainError('TIMEOUT', 'the forecast source did not answer in time');

    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toBe('the forecast source did not answer in time');
  });

  it('carries structured context we authored, and omits it when absent', () => {
    const withContext = domainError('SCHEMA_MISMATCH', 'unexpected unit', {
      metric: 'temperature_2m',
      expected: '°C',
      received: '°F',
    });

    expect(withContext.context).toEqual({
      metric: 'temperature_2m',
      expected: '°C',
      received: '°F',
    });
    expect(domainError('TIMEOUT', 'no answer').context).toBeUndefined();
  });

  it('is a plain value rather than an Error, so it cannot be thrown by accident', () => {
    expect(domainError('TIMEOUT', 'no answer')).not.toBeInstanceOf(Error);
  });

  it('narrows to the code that was passed', () => {
    const error = domainError('MALFORMED_BODY', 'empty body');
    const code: WeatherErrorCode = error.code;

    expect(code).toBe('MALFORMED_BODY');
  });
});
