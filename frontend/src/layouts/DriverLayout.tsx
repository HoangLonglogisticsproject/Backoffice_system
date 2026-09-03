import { Link, Outlet, useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';

/**
 * The Driver Portal's shell.
 *
 * ★ ITS OWN LAYOUT, NOT `MainLayout`, AND THE REASON IS NOT DECORATION.
 * `MainLayout` is a backoffice shell: a sidebar of departments, approvals,
 * employees and dispatch. Every one of those links leads somewhere a driver has
 * no business and the server would refuse. A menu that offers what the server
 * will 403 is worse than no menu at all.
 *
 * ★ AND IT IS BUILT FOR A PHONE HELD IN ONE HAND, OUTDOORS. One column, no
 * sidebar, no table, large targets. A driver reads this between a lorry cab and
 * a loading bay, often in sunlight and often in a hurry — so the screen carries
 * as few words as it can and puts the next action where a thumb already is.
 *
 * ⚠ NOTHING HERE IS AUTHORIZATION. `RequireSession` decides which SCREEN a
 * session state belongs to; the server re-decides every request regardless, and
 * a 403 coming back is the design working.
 */
export default function DriverLayout() {
  const { t } = useLanguage();
  const { state, signOut } = useSession();
  // Display only, and nullable because the server says so — an account with no
  // local subject has no username to show.
  const username = state?.status === 'ready' ? state.authorization.username : null;
  const navigate = useNavigate();

  const leave = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      {/*
        Sticky because the only navigation a driver needs is "back to my
        trips", and on a long trip detail that would otherwise scroll away.
      */}
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <Truck className="size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{t('driverPortal')}</p>
            {/* The name, never the id. */}
            <p className="truncate text-xs text-muted-foreground">{username ?? ''}</p>
          </div>
          {/* The one account function a driver has. Everything else on the
              Backoffice's security screen is unbuilt there too. */}
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t('changePassword')}
            render={<Link to="/driver/account/security" />}
          >
            <KeyRound />
          </Button>
          <Button variant="ghost" size="icon-lg" onClick={leave} aria-label={t('logout')}>
            <LogOut />
          </Button>
        </div>
      </header>

      {/*
        `max-w-3xl` rather than a full-width fluid layout: on a tablet or a
        desk monitor a single column of 40em stays readable, where a stretched
        one turns every field into a line the eye has to track across.
      */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-24">
        <Outlet />
      </main>
    </div>
  );
}
