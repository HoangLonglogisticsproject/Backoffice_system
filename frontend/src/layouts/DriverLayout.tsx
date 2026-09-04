import { Link, useNavigate } from 'react-router-dom';
import { Bell, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useNotificationStream, useNotifications } from '@/hooks/notifications';
import { AppShell, NavItem, SidebarSection, initialsOf, useSidebar } from './AppShell';
import { DRIVER_NAVIGATION } from './driverNavigation';

/**
 * The Driver Portal's shell: the platform's `AppShell` with the driver's own
 * navigation model.
 *
 * ★ THE SAME SHELL AS THE BACKOFFICE, NOT A PAGE WITH A TOP BAR. A driver is
 * using one of the company's applications, and it looks like one: the sidebar
 * with the product's name and their own name, the destinations they may go
 * to, sign-out where a hand expects it. On a phone the sidebar is the drawer
 * the shell already knows how to be.
 *
 * ★ WHAT IS NOT IN THE SIDEBAR IS THE POINT. `MainLayout` lists departments,
 * approvals and dispatch — every one of them somewhere a driver has no
 * business and the server would refuse. This draws `DRIVER_NAVIGATION` and
 * nothing else.
 *
 * ⚠ NOTHING HERE IS AUTHORIZATION. `RequireSession` decides which SHELL a
 * session state belongs to; the server re-decides every request regardless.
 */
export default function DriverLayout() {
  const { t } = useLanguage();
  const { state, signOut } = useSession();
  // Display only, and nullable because the server says so — an account with no
  // local subject has no username to show.
  const username = state?.status === 'ready' ? state.authorization.username : null;
  const navigate = useNavigate();

  // ★ THE LIVE CHANNEL IS OPEN EXACTLY WHILE THE PORTAL IS. Mounted here, it
  // lives as long as the shell and closes with it — a sign-out unmounts the
  // shell, so no stream outlives the session that opened it. What it hears
  // triggers refetches; the badges are read from the API like everything.
  useNotificationStream();
  const unread = useNotifications().data?.unreadCount ?? 0;

  const leave = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <AppShell
      brand={t('driverPortal')}
      brandOnMobile
      headerActions={
        <>
          <Button
            variant="ghost"
            size="icon-lg"
            className="relative"
            aria-label={
              unread > 0 ? `${t('driverNotifications')} (${unread} ${t('driverUnread')})` : t('driverNotifications')
            }
            render={<Link to="/driver/notifications" />}
          >
            <Bell />
            {unread > 0 ? <UnreadBadge count={unread} testId="unread-badge" /> : null}
          </Button>
          {/* The one account function a driver has: their password. */}
          <Link
            to="/driver/account/security"
            aria-label={t('changePassword')}
            className="flex items-center gap-3 hover:bg-gray-50 p-1.5 rounded-lg transition-colors"
          >
            <Avatar className="h-8 w-8 hover:ring-2 hover:ring-blue-100 transition-all">
              <AvatarFallback className="bg-blue-100 text-blue-700 font-bold text-xs">
                {initialsOf(username)}
              </AvatarFallback>
            </Avatar>
          </Link>
        </>
      }
      sidebarHeader={<SidebarIdentity username={username} />}
      navigation={
        <SidebarSection title={t('driverNavSection')}>
          {DRIVER_NAVIGATION.map((destination) => (
            <NavItem
              key={destination.key}
              to={destination.to}
              icon={destination.icon}
              label={t(destination.label)}
              exact={destination.exact}
              activePaths={destination.activePaths}
              badge={destination.key === 'notifications' && unread > 0 ? <UnreadBadge count={unread} /> : undefined}
            />
          ))}
        </SidebarSection>
      }
      sidebarFooter={<SidebarSignOut onSignOut={leave} />}
      // A readable column on a desk, the whole width on a phone.
      contentClassName="mx-auto w-full max-w-5xl"
    />
  );
}

/** Who is signed in, at the top of the sidebar. The name, never the id. */
function SidebarIdentity({ username }: Readonly<{ username: string | null }>) {
  const { t } = useLanguage();
  const { expanded } = useSidebar();
  return (
    <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-4">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarFallback className="bg-blue-100 text-blue-700 font-bold text-xs">{initialsOf(username)}</AvatarFallback>
      </Avatar>
      {expanded ? (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{t('driverPortal')}</p>
          <p className="truncate text-xs text-gray-500">{username ?? ''}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Sign-out, pinned under the navigation where a thumb finds it. */
function SidebarSignOut({ onSignOut }: Readonly<{ onSignOut: () => void }>) {
  const { t } = useLanguage();
  const { expanded } = useSidebar();
  return (
    <div className="border-t border-gray-200 p-3">
      <Button
        variant="outline"
        onClick={onSignOut}
        aria-label={t('logout')}
        className={
          expanded
            ? 'w-full justify-start gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-200'
            : 'w-full justify-center px-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-200'
        }
      >
        <LogOut className="h-4 w-4" />
        {expanded ? t('logout') : null}
      </Button>
    </div>
  );
}

/** How many are unread, as the shell's small red count. */
function UnreadBadge({ count, testId }: Readonly<{ count: number; testId?: string }>) {
  return (
    <span
      data-testid={testId}
      className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
