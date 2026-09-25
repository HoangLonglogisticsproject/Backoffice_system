import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useNotificationStream, useNotifications } from '@/hooks/notifications';
import { cn } from '@/utils/cn';
import logo from '@/assets/img/LOGO.png';
import { isNavActive } from './navActive';
import { DRIVER_NAVIGATION, type DriverDestination } from './driverNavigation';

/**
 * The Driver Portal's shell: a phone-first web page, not the Backoffice.
 *
 * ★ ITS OWN SHELL, NOT `AppShell` (DL-114). A driver opens this on a phone in
 * a browser, holding it in one hand. The Backoffice's sidebar-and-drawer is a
 * desk layout folded onto a phone; this is a top bar that says whose portal
 * it is, and the driver's three destinations where a thumb reaches them.
 *
 * ★ ONE NAVIGATION, DRAWN ONCE. The `<nav>` is a bar fixed to the bottom of a
 * phone and, from `md` up, a row inside the top bar — the same element moved
 * by CSS, so a desk and a phone can never show different menus.
 *
 * ★ WHAT IS NOT HERE IS THE POINT. `MainLayout` lists departments, approvals
 * and dispatch — every one somewhere a driver has no business and the server
 * would refuse. This draws `DRIVER_NAVIGATION` and nothing else.
 *
 * ⚠ NOTHING HERE IS AUTHORIZATION. `RequireSession` decides which shell a
 * session belongs to; the server re-decides every request regardless.
 *
 * ⚠ NO `transform`, `filter` OR `backdrop-filter` ON THE HEADER. Any of them
 * makes the header the containing block of the fixed bottom bar inside it,
 * and the bar would ride up with the header instead of sitting on the screen.
 */
export default function DriverLayout() {
  const { t } = useLanguage();
  const { state, signOut } = useSession();
  // Display only, and nullable because the server says so. On a phone shared
  // between drivers, whose session this is must be on the screen.
  const username = state?.status === 'ready' ? state.authorization.username : null;
  const navigate = useNavigate();

  // ★ THE LIVE CHANNEL IS OPEN EXACTLY WHILE THE PORTAL IS. Mounted here, it
  // lives as long as the shell and closes with it — a sign-out unmounts the
  // shell, so no stream outlives the session that opened it. What it hears
  // triggers refetches; the badge is read from the API like everything.
  useNotificationStream();
  const unread = useNotifications().data?.unreadCount ?? 0;

  const leave = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div data-shell="driver" className="min-h-dvh bg-muted/50 text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <img src={logo} alt="" className="size-8 shrink-0 object-contain" />
            <p className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold">{t('companyName')}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {username ? `${t('driverPortal')} · ${username}` : t('driverPortal')}
              </span>
            </p>
          </div>

          <nav
            aria-label={t('driverPortal')}
            className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:static md:border-0 md:bg-transparent md:pb-0"
          >
            <ul className="mx-auto grid max-w-2xl grid-cols-3 md:flex md:gap-1">
              {DRIVER_NAVIGATION.map((destination) => (
                <li key={destination.key}>
                  <DriverNavLink
                    destination={destination}
                    unread={destination.key === 'notifications' ? unread : 0}
                  />
                </li>
              ))}
            </ul>
          </nav>

          <Button
            variant="ghost"
            size="icon-lg"
            className="-mr-2 size-11 shrink-0 text-muted-foreground"
            aria-label={t('logout')}
            title={t('logout')}
            onClick={leave}
          >
            <LogOut />
          </Button>
        </div>
      </header>

      {/* Bottom padding clears the fixed bar on a phone, plus the device's own
          home-indicator inset; from `md` the bar is in the header instead. */}
      <main className="mx-auto w-full max-w-2xl px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * One destination: a tall tab on a phone, a row item on a desk.
 *
 * ★ LIT BY THE SAME RULE AS THE BACKOFFICE SIDEBAR (`isNavActive`), so a
 * trip's detail keeps "Lịch làm việc" lit — the same place, one level down.
 */
function DriverNavLink({ destination, unread }: Readonly<{ destination: DriverDestination; unread: number }>) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const active = isNavActive(pathname, destination);
  const Icon = destination.icon;

  return (
    <Link
      to={destination.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
        'md:min-h-11 md:flex-row md:gap-2 md:rounded-lg md:px-3 md:text-sm',
        active ? 'text-blue-700 md:bg-blue-50' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="relative">
        <Icon className="size-5 md:size-4" aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="unread-badge"
            aria-hidden
            className="absolute -top-1.5 -right-2.5 flex md:-right-1.5 h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate">{t(destination.label)}</span>
      {/* Spaces as their own text nodes: element text is trimmed when an
          accessible name is built. */}
      {unread > 0 ? (
        <>
          {' '}
          <span className="sr-only">{`(${unread} ${t('driverUnread')})`}</span>
        </>
      ) : null}
    </Link>
  );
}
