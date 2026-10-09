import { Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageFallback } from '@/components/common/PageFallback';
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
 * a browser, holding it in one hand — a bar of tabs under the thumb, and a top
 * strip that says whose portal it is. The Backoffice's collapsible sidebar and
 * drawer are a desk layout folded onto a phone, and none of it is here.
 *
 * ★ ONE NAVIGATION, DRAWN ONCE. The `<nav>` is the SAME ELEMENT at both
 * widths: a bar fixed to the bottom of a phone, and from `md` up a column down
 * the left of a desk. Moved by CSS, never rendered twice — a desk and a phone
 * cannot show different menus, because there is only one menu.
 *
 * ★ THE DESK IS A COLUMN, NOT A STRIP (this change). Four destinations squeezed
 * into a 56px band between the logo and a sign-out button wasted the whole
 * width of a monitor. The column carries the same four, with the brand above
 * them and sign-out at the foot, and the page beside it gets a readable
 * `max-w-4xl` instead of a phone's `max-w-2xl`.
 *
 * ⚠ TWO PIECES OF CHROME ARE DRAWN TWICE, AND ONLY TWO: the identity strip and
 * the sign-out control. A phone puts them across the top; a desk puts them at
 * the head and foot of the column — opposite ends of the layout, which no
 * amount of CSS folds into one element. Each is hidden at the width it does not
 * belong to. THE MENU IS NOT AMONG THEM, and that is the invariant that
 * matters: a test counts the `<nav>`s.
 *
 * ⚠ NOTHING HERE IS AUTHORIZATION. `RequireSession` decides which shell a
 * session belongs to; the server re-decides every request regardless.
 *
 * ⚠ NO `transform`, `filter` OR `backdrop-filter` ON THE HEADER OR THE
 * NAVIGATION'S WRAPPER. Any of them makes that element the containing block of
 * the fixed bottom bar, and the bar would ride up the page instead of sitting
 * on the screen.
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
    <div data-shell="driver" className="min-h-dvh bg-muted/50 text-foreground md:flex">
      {/* The phone's top strip. A desk reads the same facts down the column. */}
      <header className="sticky top-0 z-20 border-b border-border bg-background md:hidden">
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

      {/*
       * The navigation's wrapper — a bar on a phone, a column on a desk. The
       * `fixed` positioning is undone piece by piece at `md` (`inset-x-auto`,
       * `bottom-auto`) rather than by a second element, so the `<nav>` inside
       * stays the one the phone drew.
       */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]',
          'md:sticky md:inset-x-auto md:top-0 md:bottom-auto md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col',
          'md:border-t-0 md:border-r md:border-sidebar-border md:bg-sidebar md:pb-0 md:text-sidebar-foreground',
        )}
      >
        {/* The brand, at the head of the column. The phone has it up top. */}
        <div className="hidden h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4 md:flex">
          {/* The mark is drawn for a light background; the tile keeps it legible
              against the navy rather than leaving it to sit in its own dark box. */}
          <img src={logo} alt="" className="size-9 shrink-0 rounded-lg bg-white/95 object-contain p-1" />
          <p className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold">{t('companyName')}</span>
            <span className="block truncate text-xs text-sidebar-foreground/60">{t('driverPortal')}</span>
          </p>
        </div>

        <nav aria-label={t('driverPortal')} className="md:flex-1 md:overflow-y-auto md:p-3">
          <ul className="mx-auto grid max-w-2xl grid-cols-5 md:mx-0 md:flex md:max-w-none md:flex-col md:gap-1">
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

        {/* The foot of the column: who is signed in, and the way out. */}
        <div className="hidden shrink-0 border-t border-sidebar-border p-3 md:block">
          {username ? (
            <p className="truncate px-3 pb-2 text-xs text-sidebar-foreground/60">{username}</p>
          ) : null}
          <button
            type="button"
            onClick={leave}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/75 outline-none hover:bg-white/5 hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring/50 focus-visible:ring-inset"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t('logout')}</span>
          </button>
        </div>
      </div>

      {/*
       * Bottom padding clears the fixed bar on a phone, plus the device's own
       * home-indicator inset; on a desk the bar is a column beside this.
       *
       * ⚠ THE WIDTH IS CAPPED ON THE INNER DIV, NOT ON `<main>`. `<main>` is a
       * flex ITEM here, and `mx-auto` on a flex item makes the browser hand the
       * free space to the margins INSTEAD of to `flex-grow` — the item would
       * settle at its `flex-basis` of 0 and the page would render empty. So
       * `<main>` grows, and the column inside it is what centres.
       */}
      <main className="w-full px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:min-w-0 md:flex-1 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-2xl md:max-w-4xl">
          {/* Same boundary, same reason as the Backoffice shell: the portal's
              tab bar is how a driver knows where they are, so it must not
              disappear while the next screen's chunk is on its way. */}
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

/**
 * One destination: a tall tab on a phone, a full-width row on a desk.
 *
 * ★ LIT BY THE SAME RULE AS THE BACKOFFICE SIDEBAR (`isNavActive`), so a
 * trip's detail keeps "Lịch làm việc" lit — the same place, one level down.
 *
 * ★ ONE BADGE ELEMENT, MOVED BY `display: contents`. A phone wants the count
 * ON the bell; the column wants it at the end of the row. Rather than render
 * two and hide one — which would give the page two nodes claiming to be THE
 * unread badge, and break the test that looks one up — the `relative` wrapper
 * becomes `contents` at `md`, dissolving itself so the icon and the badge
 * become flex children of the row, and `order-last`/`ml-auto` send the badge
 * to the far end.
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
        'md:min-h-11 md:w-full md:flex-row md:justify-start md:gap-3 md:rounded-lg md:px-3 md:text-sm md:focus-visible:ring-sidebar-ring/50',
        active
          ? 'text-blue-700 md:bg-sidebar-accent md:text-sidebar-accent-foreground'
          : 'text-muted-foreground hover:text-foreground md:text-sidebar-foreground/75 md:hover:bg-white/5 md:hover:text-sidebar-foreground',
      )}
    >
      <span className="relative md:contents">
        <Icon className="size-5 md:size-4 md:shrink-0" aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="unread-badge"
            aria-hidden
            className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white md:static md:order-last md:ml-auto"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </span>
      {/* Five destinations on a phone: a label wraps to two short lines rather than losing its end. */}
      <span className="line-clamp-2 max-w-full text-center leading-tight md:line-clamp-none md:truncate md:text-left">{t(destination.label)}</span>
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
