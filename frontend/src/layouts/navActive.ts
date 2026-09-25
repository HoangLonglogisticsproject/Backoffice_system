/**
 * Whether `pathname` is at a navigation destination. The one rule every shell's
 * menu lights its rows by, so a sidebar row and a bottom tab never disagree.
 *
 * `exact` keeps a home route like `/driver` from lighting under
 * `/driver/notifications`; `activePaths` are further prefixes that count as the
 * destination — a detail page under its list.
 */
export const isNavActive = (
  pathname: string,
  { to, exact = false, activePaths = [] }: Readonly<{ to: string; exact?: boolean; activePaths?: readonly string[] }>,
): boolean => {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (exact ? pathname === to : under(to)) || activePaths.some(under);
};
