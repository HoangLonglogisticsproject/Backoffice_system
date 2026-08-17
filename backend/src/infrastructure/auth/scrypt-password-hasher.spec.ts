import { ScryptPasswordHasher } from './scrypt-password-hasher';

/**
 * Password storage is the one place in this phase where a mistake is silent
 * and permanent: nobody notices plaintext until the dump appears.
 */
describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();
  const password = 'correct horse battery staple';

  // scrypt at N=2^16 is ~100ms by design, and these tests hash repeatedly.
  jest.setTimeout(30_000);

  it('never stores the plaintext anywhere in the digest', async () => {
    const digest = await hasher.hash(password);

    expect(digest).not.toContain(password);
    expect(digest.toLowerCase()).not.toContain('battery');
    expect(Buffer.from(digest, 'utf8').includes(Buffer.from(password))).toBe(false);
  });

  it('records its own parameters so raising the cost does not invalidate old hashes', async () => {
    const digest = await hasher.hash(password);
    const [algorithm, n, r, p] = digest.split('$');

    expect(algorithm).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(65_536);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('salts, so the same password twice gives two different digests', async () => {
    const [a, b] = await Promise.all([hasher.hash(password), hasher.hash(password)]);

    expect(a).not.toEqual(b);
    // …and both still verify.
    await expect(hasher.verify(password, a)).resolves.toBe(true);
    await expect(hasher.verify(password, b)).resolves.toBe(true);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const digest = await hasher.hash(password);

    await expect(hasher.verify(password, digest)).resolves.toBe(true);
    await expect(hasher.verify('wrong password', digest)).resolves.toBe(false);
    await expect(hasher.verify(password + ' ', digest)).resolves.toBe(false);
  });

  it('returns false rather than throwing on a corrupt digest', async () => {
    // One bad row must be a failed login, not a 500 that confirms it exists.
    for (const bad of ['', 'garbage', 'scrypt$only$four$parts', 'bcrypt$1$2$3$4$5']) {
      await expect(hasher.verify(password, bad)).resolves.toBe(false);
    }
  });

  it('normalises unicode, so the same typed password verifies from any keyboard', async () => {
    // U+00E9 vs U+0065 U+0301 — identical on screen, different bytes.
    const digest = await hasher.hash('caf\u00e9');
    await expect(hasher.verify('cafe\u0301', digest)).resolves.toBe(true);
  });

  it('fakeVerify costs about as much as a real verification', async () => {
    const digest = await hasher.hash(password);

    // Best-of-N, not a single sample. Scheduler noise on a shared CI box can
    // only ever ADD time, so the fastest run of each is the least contaminated
    // measurement available — comparing single samples is what makes timing
    // tests flaky.
    const fastest = async (work: () => Promise<unknown>): Promise<number> => {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        const start = process.hrtime.bigint();
        await work();
        best = Math.min(best, Number(process.hrtime.bigint() - start));
      }
      return best;
    };

    const real = await fastest(() => hasher.verify('wrong', digest));
    const fake = await fastest(() => hasher.fakeVerify());

    // Order of magnitude, not a stopwatch. What must not happen is fakeVerify
    // returning immediately — that would make an unknown subject answer
    // visibly faster than a wrong password.
    expect(fake).toBeGreaterThan(real * 0.25);
    expect(fake).toBeLessThan(real * 4);
  });

  describe('rejecting unverifiable digests before doing any work', () => {
    // The parameters come out of the database and size scrypt's memory. A row
    // claiming an absurd N must be refused, not attempted.
    const unverifiable = [
      ['N far above any real cost', 'scrypt$1073741824$8$1$c2FsdA==$aGFzaA=='],
      ['N not a power of two', 'scrypt$65535$8$1$c2FsdA==$aGFzaA=='],
      ['N of zero', 'scrypt$0$8$1$c2FsdA==$aGFzaA=='],
      ['negative r', 'scrypt$65536$-8$1$c2FsdA==$aGFzaA=='],
      ['absurd r', 'scrypt$65536$4096$1$c2FsdA==$aGFzaA=='],
      ['p of zero', 'scrypt$65536$8$0$c2FsdA==$aGFzaA=='],
      ['non-numeric parameters', 'scrypt$abc$def$ghi$c2FsdA==$aGFzaA=='],
      ['empty salt', 'scrypt$65536$8$1$$aGFzaA=='],
      ['empty hash', 'scrypt$65536$8$1$c2FsdA==$'],
    ] as const;

    it.each(unverifiable)('refuses %s', async (_label, digest) => {
      const start = process.hrtime.bigint();
      await expect(hasher.verify(password, digest)).resolves.toBe(false);

      // Returned without deriving anything: a rejected digest must not cost the
      // ~100 ms a real verification does, or it becomes its own amplifier.
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      expect(elapsedMs).toBeLessThan(50);
    });
  });
});
