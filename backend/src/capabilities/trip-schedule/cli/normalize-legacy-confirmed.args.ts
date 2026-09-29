/**
 * The normalization CLI's arguments, apart from the CLI so they are testable
 * without booting the application.
 *
 *   (nothing)                          dry run
 *   --apply --by <email> --ids <id,…>  close exactly those ids, if still eligible
 *
 * ★ NO "ALL CONFIRMED" SWITCH. Applying names every id — the ELIGIBLE ones a
 * person read in the dry run — so nothing broader than what was approved can
 * ever be written.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NormalizationArgs =
  | { mode: 'dry-run' }
  | { mode: 'apply'; by: string; ids: string[] }
  | { mode: 'invalid'; reason: string };

export function parseNormalizationArgs(argv: readonly string[]): NormalizationArgs {
  if (!argv.includes('--apply')) return { mode: 'dry-run' };

  const valueOf = (flag: string): string[] => {
    const at = argv.indexOf(flag);
    if (at < 0) return [];
    const values: string[] = [];
    for (const token of argv.slice(at + 1)) {
      if (token.startsWith('--')) break;
      values.push(...token.split(',').filter(Boolean));
    }
    return values;
  };

  const [by] = valueOf('--by');
  const ids = valueOf('--ids');
  if (!by) return { mode: 'invalid', reason: '--apply needs --by <email> of the person applying it.' };
  if (ids.length === 0) return { mode: 'invalid', reason: '--apply needs --ids <id,…>: the ELIGIBLE ids from the dry run.' };
  const malformed = ids.filter((id) => !UUID.test(id));
  if (malformed.length > 0) return { mode: 'invalid', reason: `Not trip ids: ${malformed.join(', ')}` };
  return { mode: 'apply', by, ids };
}
