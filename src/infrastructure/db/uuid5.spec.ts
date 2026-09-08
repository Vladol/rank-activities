import { describe, expect, it } from 'vitest';

import { NAMESPACE, uuidv5 } from './uuid5';

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidv5', () => {
  it('reproduces the RFC 4122 vector, which is what proves it is version 5 and not something like it', () => {
    expect(uuidv5('www.example.com', DNS_NAMESPACE)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('answers the same identifier every time it is asked', () => {
    expect(uuidv5('38.72,-9.14', NAMESPACE.location)).toBe(uuidv5('38.72,-9.14', NAMESPACE.location));
  });

  it('separates the namespaces, so a location and a rule never collide', () => {
    expect(uuidv5('ski@1', NAMESPACE.location)).not.toBe(uuidv5('ski@1', NAMESPACE.rules));
  });

  it('stamps the version and the variant the format requires', () => {
    const [, , third, fourth] = uuidv5('38.72,-9.14', NAMESPACE.location).split('-');

    expect(third?.startsWith('5')).toBe(true);
    expect(['8', '9', 'a', 'b']).toContain(fourth?.[0]);
  });

  it('refuses a namespace that is not a UUID rather than hashing the text of one', () => {
    expect(() => uuidv5('x', 'not-a-uuid')).toThrow(/must be a UUID/);
  });
});
