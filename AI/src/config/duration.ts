import { z } from 'zod';

/**
 * A duration, written the way an operator writes one: `2h`, `30m`, `45s`,
 * `90ms`. Parsed once at boot into milliseconds, so nothing downstream ever
 * multiplies by 3600 again.
 *
 * ★ NO BARE NUMBERS. `SCAN_INTERVAL=300` is ambiguous in a way that has
 * shipped outages: seconds or milliseconds is a factor of a thousand, and the
 * wrong guess is either a hot loop or a scan every five days. A unit is
 * required, always.
 */
const PATTERN = /^(\d+)(ms|s|m|h)$/;

const MULTIPLIER: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

/** Milliseconds, or `null` when the text is not a duration. */
export function parseDuration(text: string): number | null {
  const match = PATTERN.exec(text.trim());
  if (!match) return null;

  const [, amount, unit] = match as unknown as [string, string, keyof typeof MULTIPLIER];
  const multiplier = MULTIPLIER[unit];
  if (multiplier === undefined) return null;

  const value = Number(amount) * multiplier;
  return Number.isSafeInteger(value) ? value : null;
}

/** A zod schema for a duration variable, yielding milliseconds. */
export const duration = (name: string) =>
  z.string().transform((text, ctx) => {
    const milliseconds = parseDuration(text);
    if (milliseconds === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${name} must be a duration with a unit, such as 2h, 30m, 45s or 500ms — got "${text}"`,
      });
      return z.NEVER;
    }
    return milliseconds;
  });

/** For log lines and evidence, where seconds read better than milliseconds. */
export const toSeconds = (milliseconds: number): number => Math.round(milliseconds / 1_000);
