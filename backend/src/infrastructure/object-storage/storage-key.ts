/**
 * The only key shape either adapter accepts: lowercase words separated by `/`.
 * No `..`, no leading slash, no dot — so a key can become neither a path
 * outside the storage root nor a different URL than the one it names.
 */
const STORAGE_KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

export function assertStorageKey(key: string): void {
  if (!STORAGE_KEY.test(key)) throw new Error('Refused an unsafe object storage key.');
}
