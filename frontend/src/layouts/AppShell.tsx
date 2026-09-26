import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { isNavActive } from './navActive';

/**
 * The Backoffice's shell: a top bar, a sidebar of navigation, and the page.
 *
 * ★ A DESK APPLICATION'S FRAME. The Driver Portal is a phone in one hand and
 * has its own shell (`DriverLayout`, DL-114); what the two share is the design
 * tokens and the rule that lights a destination (`isNavActive`). The chrome
 * lives here once; what goes in the sidebar — the navigation MODEL — is the
 * layout's own.
 *
 * ★ DESKTOP AND PHONE ARE THE SAME SIDEBAR IN TWO STATES. From `md` up it is a
 * column beside the page that the menu button collapses to icons. Below `md`
 * it is a drawer the menu button slides in over the page, closed again by the
 * scrim or by choosing a destination. No second navigation is drawn for the
 * phone, so nothing can be offered on one that is missing from the other.
 *
 * ⚠ NAVIGATION IS NOT AUTHORIZATION. Hiding a link is a convenience for the
 * person using the app; the server re-decides every request regardless. Nothing
 * here may become the thing that grants access (§13).
 */

interface SidebarState {
  /** Labels are drawn: the desktop column is wide, or the drawer is out. */
  expanded: boolean;
  /** Choosing a destination puts the drawer away. */
  closeDrawer: () => void;
}

const SidebarContext = createContext<SidebarState>({ expanded: true, closeDrawer: () => {} });

export const useSidebar = () => useContext(SidebarContext);

/**
 * Initials from whatever the server calls this person.
 *
 * `null` is a real answer, not a missing one: `username` is the local part of a
 * login email, and an account with no local subject has none. `?` marks the
 * absence — it is not a stand-in identity, and nothing here invents a name.
 */
export const initialsOf = (name: string | null): string =>
  (name ?? '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

/** Wider than a phone: the sidebar is a column, and the menu button collapses it. */
const isDesktop = (): boolean =>
  typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)').matches : true;

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  /** Renders the row as present but unavailable — see `PlaceholderPage`. */
  unavailable?: boolean;
}

export function NavItem({
  to,
  icon: Icon,
  label,
  unavailable,
}: Readonly<NavItemProps>) {
  const { pathname } = useLocation();
  const { expanded, closeDrawer } = useSidebar();
  const { t } = useLanguage();

  const isActive = isNavActive(pathname, { to });

  return (
    <Link
      to={to}
      className="w-full block mb-1"
      title={!expanded ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
      onClick={closeDrawer}
    >
      <Button
        variant={isActive ? 'secondary' : 'ghost'}
        className={clsx(
          'w-full justify-start transition-all text-sm font-medium',
          !expanded && 'justify-center px-2',
          isActive ? 'font-semibold text-blue-700 bg-blue-50/50' : 'text-gray-600 hover:text-gray-900',
        )}
      >
        <Icon
          className={clsx('h-5 w-5 shrink-0', expanded && 'mr-3', isActive ? 'text-blue-600' : 'text-gray-500')}
        />
        {expanded && (
          <div className="flex items-center justify-between flex-1 gap-2">
            <span className="truncate">{label}</span>
            {unavailable && (
              <span className="text-[10px] font-normal text-gray-400 shrink-0">{t('comingSoon')}</span>
            )}
          </div>
        )}
      </Button>
    </Link>
  );
}

export function SidebarSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const { expanded } = useSidebar();
  return (
    <div className="mb-6">
      <div className={clsx('px-3 mb-2 flex items-center', !expanded && 'justify-center')}>
        {expanded ? (
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
        ) : (
          <div className="h-px w-8 bg-gray-200 my-2" />
        )}
      </div>
      {children}
    </div>
  );
}

interface AppShellProps {
  /** The product's name, in the top bar. */
  brand: string;
  /** The top bar's right side: language, account, sign-out. */
  headerActions?: ReactNode;
  /** The navigation itself: `SidebarSection`s of `NavItem`s. */
  navigation: ReactNode;
}

export function AppShell({
  brand,
  headerActions,
  navigation,
}: Readonly<AppShellProps>) {
  const { t } = useLanguage();
  // The desktop column: wide or icons. The phone drawer: out or away.
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const toggle = () => {
    if (isDesktop()) setIsSidebarOpen((open) => !open);
    else setIsDrawerOpen((open) => !open);
  };
  // Stable across renders: the setter never changes, so neither does this.
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  // ★ ONE OBJECT PER STATE, NOT PER RENDER. A fresh literal here would
  // re-render every NavItem and SidebarSection on every keystroke in the page
  // beneath, for a value that had not changed. It depends on exactly what it
  // reads: the two open flags, and the (stable) close function.
  const sidebar = useMemo<SidebarState>(
    () => ({ expanded: isDrawerOpen || isSidebarOpen, closeDrawer }),
    [isDrawerOpen, isSidebarOpen, closeDrawer],
  );

  return (
    <SidebarContext.Provider value={sidebar}>
      <div className="min-h-screen flex flex-col bg-gray-50 font-sans text-gray-800">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={t('toggleNavigation')}
              aria-controls="app-navigation"
              aria-expanded={isDrawerOpen || isSidebarOpen}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="hidden text-xl font-extrabold text-blue-600 sm:block">{brand}</h1>
          </div>

          <div className="flex items-center gap-4">{headerActions}</div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* The scrim: the phone's way of putting the drawer away. */}
          {isDrawerOpen ? (
            <button
              type="button"
              aria-label={t('closeNavigation')}
              className="fixed inset-0 z-20 bg-black/40 md:hidden"
              onClick={closeDrawer}
            />
          ) : null}

          <aside
            id="app-navigation"
            data-state={isDrawerOpen ? 'open' : 'closed'}
            className={clsx(
              'bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out',
              // A drawer below `md`: fixed under the top bar, slid in or out.
              'fixed top-16 bottom-0 left-0 z-30 w-64 md:static md:z-auto md:translate-x-0',
              isDrawerOpen ? 'translate-x-0' : '-translate-x-full',
              isSidebarOpen ? 'md:w-64' : 'md:w-16',
            )}
          >
            <nav className="flex-1 overflow-y-auto py-4 custom-scrollbar">{navigation}</nav>
          </aside>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
