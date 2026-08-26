import type { SecretReader } from '../../../common/types/secret-reader.port';
import { parseArgs, readPassword, bootstrapInput } from './create-user.cli';

/**
 * The CLI is orchestration, and these are the two decisions it still makes on
 * its own. The terminal handling it used to carry now lives in
 * `infrastructure/tty` behind the `SecretReader` port, and is tested there.
 */
describe('create-user CLI', () => {
  describe('parseArgs', () => {
    it('reads the two flags it knows', () => {
      expect(parseArgs(['--email', 'a@example.com', '--name', 'A Person'])).toEqual({
        email: 'a@example.com',
        name: 'A Person',
      });
    });

    it('does not care about flag order', () => {
      expect(parseArgs(['--name', 'A Person', '--email', 'a@example.com'])).toEqual({
        email: 'a@example.com',
        name: 'A Person',
      });
    });

    it('leaves a missing flag undefined rather than guessing', () => {
      // `main` refuses on undefined and prints usage. Defaulting to an empty
      // string here would create an account with a blank name instead.
      expect(parseArgs(['--email', 'a@example.com'])).toEqual({ email: 'a@example.com' });
      expect(parseArgs([])).toEqual({});
    });

    it('ignores flags it does not know', () => {
      expect(parseArgs(['--role', 'SUPERADMIN', '--email', 'a@example.com'])).toEqual({
        email: 'a@example.com',
      });
    });

    /**
     * The ONLY path to GLOBAL authority in the whole system — no endpoint grants
     * it. A deployment whose first account misses this flag can log in and do
     * nothing, so the flag has to be read exactly, and absent has to mean no.
     */
    it('reads --superadmin as a switch', () => {
      expect(parseArgs(['--email', 'a@example.com', '--name', 'A', '--superadmin'])).toEqual({
        email: 'a@example.com',
        name: 'A',
        superadmin: true,
      });
    });

    it('leaves superadmin undefined when the flag is absent — never a default yes', () => {
      expect(parseArgs(['--email', 'a@example.com', '--name', 'A']).superadmin).toBeUndefined();
    });

    it('does not read a value after the switch', () => {
      // `--superadmin false` must not create a non-admin by accident, and must
      // not swallow the next flag either.
      expect(parseArgs(['--superadmin', '--email', 'a@example.com'])).toEqual({
        email: 'a@example.com',
        superadmin: true,
      });
    });
  });

  describe('readPassword', () => {
    const reader = (value: string): SecretReader => ({
      readSecret: jest.fn().mockResolvedValue(value),
    });

    // The environment is READ IN `main` and passed in, so this function stays
    // pure — which is why this spec needs no `process.env` of its own, and why
    // `B6` has no exception to grant for it.
    it('prefers the environment, so an unattended run needs no terminal', async () => {
      const source = reader('from the prompt');

      await expect(readPassword(source, 'from the environment')).resolves.toBe(
        'from the environment',
      );
      expect(source.readSecret).not.toHaveBeenCalled();
    });

    it('falls back to the port, and never to argv', async () => {
      const source = reader('from the prompt');

      await expect(readPassword(source, undefined)).resolves.toBe('from the prompt');
      // A password on the command line is visible in `ps` and kept in shell
      // history, which is why `parseArgs` has no flag for it at all.
      expect(parseArgs(['--password', 'secret'])).toEqual({});
    });

    it('treats an empty environment variable as absent', async () => {
      const source = reader('from the prompt');

      await expect(readPassword(source, '')).resolves.toBe('from the prompt');
    });
  });

  // ------------------------------------------------ the bootstrap contract --

  describe('★ what the CLI asks the service for', () => {
    /**
     * The service DEFAULTS `mustChangeSecret` to true, and this asserts that the
     * CLI says it anyway. Two different things worth locking:
     *
     *   the default   protects a caller that forgets
     *   this line     protects the account that owns the deployment, whose rule
     *                 should be readable at the call site rather than inherited
     *
     * Delete `mustChangeSecret: true` from the CLI and the default keeps the
     * behaviour identical — so nothing else in the suite would notice. This is
     * the test that does.
     */
    it('★ bootstraps with mustChangeSecret: true, explicitly', () => {
      const input = bootstrapInput({
        displayName: 'Tong Giam Doc',
        subject: 'boss@hoanglonglti.com',
        password: 'a bootstrap passphrase',
      });

      expect(input.mustChangeSecret).toBe(true);
    });

    it('passes the operator’s values through untouched', () => {
      const input = bootstrapInput({
        displayName: 'Tong Giam Doc',
        subject: 'boss@hoanglonglti.com',
        password: 'a bootstrap passphrase',
      });

      expect(input).toEqual({
        displayName: 'Tong Giam Doc',
        subject: 'boss@hoanglonglti.com',
        password: 'a bootstrap passphrase',
        mustChangeSecret: true,
      });
    });
  });
});
