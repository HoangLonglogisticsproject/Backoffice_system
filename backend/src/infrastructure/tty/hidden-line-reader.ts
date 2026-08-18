import { Injectable } from '@nestjs/common';
import type { SecretReader } from '../../common/types/secret-reader.port';

/**
 * Reading a secret from a terminal, without echoing it.
 *
 * PLATFORM INFRASTRUCTURE, not business logic. It knows about raw mode, ANSI
 * escape sequences and control bytes — concerns of the runtime a process
 * happens to be attached to, shared by any CLI this deployment ever grows. It
 * lived inside `core/users/cli` for a while and made that file four times its
 * real size, which is what a technical concern does when it is filed under the
 * business context that first needed it.
 *
 * Depends on nothing in `core/`. The dependency runs one way: a CLI in core may
 * call this; this must never reach back.
 */

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

/**
 * The `SecretReader` port, satisfied by a real terminal.
 *
 * Piped or redirected input has no terminal to echo to and no raw mode to set;
 * reading a plain line there is both correct and already invisible, which is
 * why the branch exists rather than failing.
 */
@Injectable()
export class TtySecretReader implements SecretReader {
  async readSecret(prompt: string): Promise<string> {
    if (!process.stdin.isTTY) {
      return new Promise((resolve) => {
        process.stdin.once('data', (data: Buffer) => resolve(data.toString().trim()));
      });
    }

    process.stdout.write(prompt);
    return (await readHiddenLine()).trim();
  }
}
