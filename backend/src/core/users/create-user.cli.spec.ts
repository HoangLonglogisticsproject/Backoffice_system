import { readHiddenLine } from './create-user.cli';

/**
 * The raw-mode password reader.
 *
 * Raw mode hands this function every byte the terminal produces, including the
 * ANSI escape sequences that arrow and function keys send. Filtering those byte
 * by byte is not enough: dropping the ESC and keeping the rest is how pressing
 * Up arrow silently puts `[A` into someone's password.
 */
describe('readHiddenLine', () => {
  // Built from codes: a literal control character in a source file is invisible
  // in review and gets rewritten by tooling.
  const ESC = String.fromCharCode(27);
  const CTRL_C = String.fromCharCode(3);
  const CTRL_D = String.fromCharCode(4);
  const DEL = String.fromCharCode(127);

  let listener: ((chunk: string) => void) | undefined;
  let written: string[];
  let rawMode: boolean;

  const stdin = process.stdin as unknown as Record<string, unknown>;
  const original: Record<string, unknown> = {};

  beforeEach(() => {
    written = [];
    rawMode = false;
    listener = undefined;

    for (const key of ['setRawMode', 'resume', 'pause', 'setEncoding', 'on', 'off']) {
      original[key] = stdin[key];
    }

    stdin['setRawMode'] = (value: boolean) => {
      rawMode = value;
      return stdin;
    };
    stdin['resume'] = () => stdin;
    stdin['pause'] = () => stdin;
    stdin['setEncoding'] = () => stdin;
    stdin['on'] = (event: string, handler: (chunk: string) => void) => {
      if (event === 'data') listener = handler;
      return stdin;
    };
    stdin['off'] = () => stdin;

    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) stdin[key] = value;
    jest.restoreAllMocks();
  });

  /** Feeds the reader the given chunks and resolves with what it collected. */
  const type = async (...chunks: string[]): Promise<string> => {
    const line = readHiddenLine();
    for (const chunk of chunks) listener?.(chunk);
    return line;
  };

  describe('ANSI escape sequences', () => {
    it('swallows an arrow key whole, rather than leaking its tail', async () => {
      // The reported bug: ESC is below the printable floor so it was dropped,
      // but `[` and `A` are printable and went straight into the password.
      await expect(type(`a${ESC}[Ab\r`)).resolves.toBe('ab');
    });

    it('swallows every arrow direction', async () => {
      await expect(type(`x${ESC}[A${ESC}[B${ESC}[C${ESC}[Dy\r`)).resolves.toBe('xy');
    });

    it('swallows a parameterised sequence such as Delete or Home', async () => {
      // `ESC [ 3 ~` — the digits are parameter bytes and only `~` terminates it.
      await expect(type(`a${ESC}[3~${ESC}[1~b\r`)).resolves.toBe('ab');
    });

    it('swallows a multi-parameter sequence', async () => {
      await expect(type(`a${ESC}[1;5Cb\r`)).resolves.toBe('ab');
    });

    it('swallows an SS3 function key', async () => {
      // F1 is `ESC O P`.
      await expect(type(`a${ESC}OPb\r`)).resolves.toBe('ab');
    });

    it('handles a sequence SPLIT across two data events', async () => {
      // A terminal may deliver these in separate reads, which is why the parser
      // state outlives a single chunk.
      await expect(type(`a${ESC}`, '[A', 'b\r')).resolves.toBe('ab');
    });

    it('handles a sequence split between introducer and final byte', async () => {
      await expect(type(`a${ESC}[`, '3', '~b\r')).resolves.toBe('ab');
    });

    it('does NOT eat an ordinary character after a bare Escape keypress', async () => {
      // Escape on its own is not an introducer. Discarding the next character
      // would lose something the user actually typed — the same class of silent
      // corruption as leaking `[A` in.
      await expect(type(`a${ESC}b\r`)).resolves.toBe('ab');
    });

    it('still recognises a sequence after a DOUBLE Escape', async () => {
      // The trap when the parser is extracted: on seeing a non-introducer after
      // ESC, it must fall through to the ESC check rather than returning. The
      // second ESC here re-enters escaped mode, so the arrow is swallowed. Get
      // this wrong and the result is "a[Ab" — the original bug, restored.
      await expect(type(`a${ESC}${ESC}[Ab\r`)).resolves.toBe('ab');
    });

    it('keeps an ordinary character after a double Escape', async () => {
      await expect(type(`a${ESC}${ESC}cb\r`)).resolves.toBe('acb');
    });
  });

  describe('the behaviour that must not change', () => {
    it('collects printable characters', async () => {
      await expect(type('hunter2 is not a good one\r')).resolves.toBe(
        'hunter2 is not a good one',
      );
    });

    it('finishes on carriage return, line feed or Ctrl-D', async () => {
      await expect(type('a\r')).resolves.toBe('a');
      await expect(type('b\n')).resolves.toBe('b');
      await expect(type(`c${CTRL_D}`)).resolves.toBe('c');
    });

    it('erases on DEL and on backspace', async () => {
      await expect(type(`abc${DEL}\r`)).resolves.toBe('ab');
      await expect(type('abc\b\r')).resolves.toBe('ab');
    });

    it('rejects on Ctrl-C', async () => {
      await expect(type(`abc${CTRL_C}`)).rejects.toThrow('Cancelled.');
    });

    it('keeps unicode intact, including astral characters', async () => {
      await expect(type('café中\u{1F600}\r')).resolves.toBe('café中\u{1F600}');
    });

    it('never echoes what was typed', async () => {
      await type('secret passphrase\r');

      // The whole point of raw mode. Only the closing newline is written.
      expect(written.join('')).toBe('\n');
    });

    it('restores the terminal when the line ends', async () => {
      await type('a\r');
      expect(rawMode).toBe(false);
    });

    it('restores the terminal on Ctrl-C too, or the shell is left unusable', async () => {
      await expect(type(CTRL_C)).rejects.toThrow();
      expect(rawMode).toBe(false);
    });
  });
});
