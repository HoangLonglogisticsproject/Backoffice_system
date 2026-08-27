import { describe, expect, it } from 'vitest';
import { assertCredentialSafeBaseUrl } from './integration-credentials';

/**
 * The guard on where this suite is willing to post a SuperAdmin password.
 *
 * ⚠ `API_BASE_URL` is an environment variable, so the dangerous case is not a
 * typo — it is somebody pointing the suite at staging "just to check something"
 * and leaving it pointed there. The rule is about the WIRE, not about the word
 * "localhost": plaintext is fine where there is no network to carry it, and
 * HTTPS is fine anywhere because the transport protects the credential.
 */
describe('assertCredentialSafeBaseUrl', () => {
  describe('plain HTTP is confined to this machine', () => {
    it.each([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      // No port, and a trailing path — still loopback.
      'http://localhost',
    ])('allows %s', (url) => {
      expect(assertCredentialSafeBaseUrl(url)).toBe(url);
    });

    it.each([
      'http://api.staging.internal:3000',
      'http://192.168.1.50:3000',
      'http://backoffice.hoanglonglti.com',
      // ⚠ Looks local, is not: a hostname that merely CONTAINS "localhost".
      'http://localhost.evil.example.com',
    ])('refuses %s before any credential is sent', (url) => {
      expect(() => assertCredentialSafeBaseUrl(url)).toThrow(/not this machine/);
    });
  });

  describe('HTTPS is allowed anywhere', () => {
    it.each([
      'https://api.staging.internal',
      'https://backoffice.hoanglonglti.com',
      'https://localhost:3000',
    ])('allows %s', (url) => {
      expect(assertCredentialSafeBaseUrl(url)).toBe(url);
    });
  });

  describe('anything it cannot verify, it refuses', () => {
    it.each(['not-a-url', '', '//localhost:3000'])('refuses the unparseable %s', (url) => {
      expect(() => assertCredentialSafeBaseUrl(url)).toThrow(/not a valid URL/);
    });

    /**
     * ★ `localhost:3000` PARSES — as scheme `localhost:`, not as a host. It is
     * the likeliest typo of the documented value, and it is caught here rather
     * than by the parser, which is why both branches have to refuse.
     */
    it.each(['ftp://localhost/api', 'localhost:3000'])(
      'refuses %s, whose scheme is neither http nor https',
      (url) => {
        expect(() => assertCredentialSafeBaseUrl(url)).toThrow(/neither http nor https/);
      },
    );
  });
});
