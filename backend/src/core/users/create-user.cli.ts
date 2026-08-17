/**
 * Bootstrap the first user: `npm run user:create -- --email a@b.c --name "A B"`
 *
 * A CLI rather than an endpoint, and rather than a seed in a migration:
 *
 *   not an endpoint  creating users over HTTP needs an answer to "who may do
 *                    this", and that is authorization — a later phase. An open
 *                    endpoint now would be the hole this phase exists to avoid.
 *
 *   not a migration  a user is data, not schema. Seeding one bakes a known
 *                    account into every deployment of this foundation, which
 *                    is how a shared default password ends up in production.
 *
 * The password is read from a prompt or the BOOTSTRAP_PASSWORD variable, never
 * from an argument: argv is visible in `ps` and lands in shell history.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { UserService } from './user.service';

interface Args {
  email?: string;
  name?: string;
}


/**
 * Keystrokes raw mode makes this reader responsible for, by character code.
 *
 * Codes rather than literals on purpose: a raw control character embedded in
 * source is invisible in review and gets mangled by anything that rewrites the
 * file — which is exactly how a terminal reader quietly stops handling Ctrl-C.
 */
const KEY = {
  interrupt: 3, // Ctrl-C
  endOfTransmission: 4, // Ctrl-D
  backspace: 8,
  lineFeed: 10,
  carriageReturn: 13,
  escape: 27, // introduces an ANSI sequence — see CSI_FINAL
  delete: 127, // what most terminals actually send for Backspace
  firstPrintable: 32,
} as const;

/**
 * A CSI sequence (`ESC [ … final`) ends at its FINAL byte, 0x40–0x7E. The bytes
 * before it are parameters and intermediates and carry no terminator, which is
 * why the whole sequence has to be consumed as one unit rather than filtered
 * byte by byte.
 */
const CSI_FINAL = { min: 0x40, max: 0x7e } as const;

/** Where a reader is inside an ANSI escape sequence. */
type EscapeMode = 'normal' | 'escaped' | 'csi' | 'ss3';

/**
 * The escape-sequence state machine, and nothing else.
 *
 * Pure on purpose: given the current mode and one character, it answers two
 * questions — what the mode becomes, and whether this character belonged to a
 * sequence and must therefore be discarded. It never touches the collected
 * value, the terminal, or the promise, so the caller can stay a plain loop over
 * keys rather than a loop that is also a parser.
 *
 * `consumed: false` means "this is an ordinary character, deal with it".
 */
function stepEscape(
  mode: EscapeMode,
  char: string,
  key: number,
): { mode: EscapeMode; consumed: boolean } {
  if (mode === 'csi') {
    // Parameters and intermediates carry no terminator; only a final byte ends
    // the sequence. Everything up to it is swallowed.
    if (key >= CSI_FINAL.min && key <= CSI_FINAL.max) return { mode: 'normal', consumed: true };
    return { mode: 'csi', consumed: true };
  }

  // SS3 (`ESC O …`, the function keys) is exactly one byte long.
  if (mode === 'ss3') return { mode: 'normal', consumed: true };

  if (mode === 'escaped') {
    if (char === '[') return { mode: 'csi', consumed: true };
    if (char === 'O') return { mode: 'ss3', consumed: true };

    // DELIBERATELY NO RETURN HERE. The character is not an introducer, so the
    // ESC before it was a bare Escape keypress — but this character may itself
    // be another ESC, and returning now would drop it. `ESC ESC [ A` has to
    // stay a consumed arrow key; returning early turns it back into "[A" in
    // the password, which is the exact bug this parser exists to prevent.
  }

  if (key === KEY.escape) return { mode: 'escaped', consumed: true };

  return { mode: 'normal', consumed: false };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = argv[i + 1];
    if (argv[i] === '--name') args.name = argv[i + 1];
  }
  return args;
}

/**
 * Reads a line from a terminal WITHOUT echoing it.
 *
 * Raw mode is the whole mechanism: the terminal stops drawing keystrokes and
 * delivers them here instead, so the password never appears on screen, never
 * survives in scrollback, and is not readable over someone's shoulder.
 *
 * Raw mode also disables the terminal's own line editing and signal handling,
 * which is why backspace and Ctrl-C are handled explicitly below. Without that,
 * a typo would be uncorrectable and Ctrl-C would leave the operator's shell
 * stuck in raw mode after this process exited.
 */
export function readHiddenLine(): Promise<string> {
  const stdin = process.stdin;

  return new Promise((resolve, reject) => {
    let value = '';

    /**
     * Held across data events, not per chunk: a terminal is free to split
     * `ESC [ A` over two reads, and a parser that reset at the chunk boundary
     * would leak the tail of a split sequence into the password.
     */
    let mode: EscapeMode = 'normal';

    const restore = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        // `for…of` walks a string by CODE POINT, so `char` can be a surrogate
        // pair. charCodeAt would report only its leading half; codePointAt
        // reports the character. Both agree on every key handled below — those
        // are all under 128 — so this changes nothing except being right about
        // what `char` is. Never undefined: the loop only yields non-empty
        // characters.
        const key = char.codePointAt(0)!;

        // Escape-sequence handling lives in stepEscape, so what remains below
        // is only line editing. A character that belonged to a sequence — an
        // arrow key, a function key — is discarded here and never reaches it.
        const step = stepEscape(mode, char, key);
        mode = step.mode;
        if (step.consumed) continue;

        if (key === KEY.lineFeed || key === KEY.carriageReturn || key === KEY.endOfTransmission) {
          restore();
          process.stdout.write('\n');
          resolve(value);
          return;
        }

        if (key === KEY.interrupt) {
          // Restore BEFORE rejecting, or the shell is left in raw mode.
          restore();
          process.stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }

        if (key === KEY.delete || key === KEY.backspace) {
          value = value.slice(0, -1);
          continue;
        }

        // Printable characters only, so an arrow key does not silently become
        // part of the password.
        if (key >= KEY.firstPrintable) value += char;
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env['BOOTSTRAP_PASSWORD'];
  if (fromEnv) return fromEnv;

  // Piped or redirected input has no terminal to echo to and no raw mode to
  // set. Reading a plain line there is both correct and already invisible.
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      process.stdin.once('data', (data: Buffer) => resolve(data.toString().trim()));
    });
  }

  process.stdout.write('Password: ');
  return (await readHiddenLine()).trim();
}

async function main(): Promise<void> {
  const { email, name } = parseArgs(process.argv.slice(2));

  if (!email || !name) {
    console.error('Usage: npm run user:create -- --email <email> --name "<display name>"');
    console.error('Password is read from BOOTSTRAP_PASSWORD, or prompted for.');
    process.exit(1);
  }

  const password = await readPassword();
  if (password.length < 12) {
    // Not a policy engine — one floor, applied where the first account is made.
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const user = await app.get(UserService).createWithPassword({
      displayName: name,
      subject: email,
      password,
    });
    console.log(`Created user ${user.id} (${user.displayName}).`);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

// Only when this file IS the command being run. Without the guard, importing it
// — which the spec for the reader above has to do — would boot Nest and try to
// create a user as a side effect of loading a module.
if (require.main === module) {
  void main();
}
