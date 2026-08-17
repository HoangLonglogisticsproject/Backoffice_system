/**
 * Maps an accent name to the two custom properties every tinted surface reads,
 * so no component ever branches on a colour name.
 *
 * Takes a plain string on purpose: the ui-kit stays dependency-free, and
 * callers keep their own typing (e.g. Department.accent).
 */
export function accentVars(accent: string | undefined): Record<string, string> {
  const name = accent || 'slate';
  return { '--accent': `var(--c-${name})`, '--accent-soft': `var(--c-${name}-soft)` };
}
