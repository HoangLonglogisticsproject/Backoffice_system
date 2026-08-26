import { parseArgs } from './promote-user.cli';

/**
 * The recovery hatch: moving GLOBAL authority onto an account somebody can sign
 * in as. Argument parsing is the only decision this CLI makes on its own — the
 * transfer itself is `AuthorizationService.bootstrapTransferSuperAdmin`, and
 * the security specs cover what that does.
 */
describe('promote-user CLI', () => {
  describe('parseArgs', () => {
    it('reads the one flag it knows', () => {
      expect(parseArgs(['--email', 'admin@example.com'])).toEqual({
        email: 'admin@example.com',
      });
    });

    it('leaves it undefined rather than guessing', () => {
      // `main` prints usage and exits on undefined. Defaulting to anything here
      // would mean promoting an account nobody named.
      expect(parseArgs([])).toEqual({});
    });

    it('ignores flags it does not know', () => {
      // Notably `--superadmin`: this command grants nothing else, and silently
      // accepting the flag from the sibling CLI would suggest otherwise.
      expect(parseArgs(['--superadmin', '--email', 'a@example.com', '--name', 'A'])).toEqual({
        email: 'a@example.com',
      });
    });

    it('takes no password, because it changes no credential', () => {
      expect(parseArgs(['--password', 'secret'])).toEqual({});
    });
  });
});
