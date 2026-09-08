import { createHash } from 'node:crypto';

/**
 * UUID version 5: a name and a namespace hashed into an identifier, per
 * RFC 4122, section 4.3.
 *
 * It is here rather than in a dependency because it is fifteen lines and
 * because what the schema needs from it is exactly the property a random
 * identifier lacks: the same name yields the same identifier in every process,
 * on every machine, before anything is written (design.md, Decision 3).
 */
export function uuidv5(name: string, namespace: string): string {
  const digest = createHash('sha1')
    .update(Buffer.concat([bytesOf(namespace), Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);

  // Version 5 in the high nibble of octet 6, RFC 4122 variant in octet 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bytesOf(uuid: string): Buffer {
  const hex = uuid.replaceAll('-', '');

  if (hex.length !== 32 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`A UUID namespace must be a UUID; got "${uuid}".`);
  }

  return Buffer.from(hex, 'hex');
}

/**
 * The namespaces this service hashes under. They are constants and never
 * regenerated: changing one re-identifies every row that was ever written under
 * it, which is the one thing a computed identity exists to prevent.
 */
export const NAMESPACE = {
  /** Names are the grid key: '38.72,-9.14'. */
  location: '2a0b6f43-8c1e-5a7f-9d24-1f0c6b5a4e31',
  /** Names are 'code@version': 'ski@1'. */
  rules: '7d4c1a92-53b6-5e08-a1f7-0c9b2d38e6a4',
} as const;
