import { escapeLikePattern } from './trip-schedule.repository';

/**
 * What a dispatcher types into the customer box, and what `LIKE` then sees.
 *
 * ★ THE ONE THING THIS HAS TO GET RIGHT: a character the user typed means that
 * character. `LIKE` reads `%` as "anything" and `_` as "any one character", so
 * without escaping, the box silently does the opposite of what it says — `%`
 * would match EVERY customer, which is the least obvious way for a filter to
 * fail. There is no query here and no database: the escaping is a pure string
 * rule and is tested as one.
 *
 * ⚠ THE SEARCH VALUE IS A BOUND PARAMETER, NOT PART OF THE SQL — see
 * `customerSql`. So this is about correctness of MATCHING, never about
 * injection; nothing a user types is concatenated into a statement.
 */
describe('escapeLikePattern', () => {
  it('leaves an ordinary name alone', () => {
    expect(escapeLikePattern('VIỄN ĐẠT')).toBe('VIỄN ĐẠT');
    expect(escapeLikePattern('Công ty TNHH 3SC')).toBe('Công ty TNHH 3SC');
  });

  it('★ makes a typed per cent sign mean a per cent sign', () => {
    // Unescaped, `%` matches every customer in the range — a filter that widens
    // instead of narrowing, and says nothing about having done so.
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('★ makes a typed underscore mean an underscore', () => {
    expect(escapeLikePattern('KHO_3SC')).toBe('KHO\\_3SC');
  });

  it('★ escapes the backslash FIRST, or the other escapes undo themselves', () => {
    // `\%` escaped in the wrong order becomes `\\%` — a literal backslash
    // followed by the wildcard, which is the bug this ordering exists to avoid.
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });

  it('handles the empty string without inventing anything', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});
