import { useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart2,
  Briefcase,
  Building,
  CheckSquare,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useMyDepartments } from '@/hooks/useMyDepartments';

/**
 * The application shell.
 *
 * The visual design is Phú's. Everything it *says* is real: the user comes from
 * the session, sign-out ends the real session, and the department list is the
 * one this account may actually reach. The static "Admin User" avatar and the
 * six hard-coded departments the mock carried are gone — a menu that offers a
 * department the server will 403 is worse than no menu.
 *
 * ⚠ NAVIGATION IS NOT AUTHORIZATION. Hiding a link is a convenience for the
 * person using the app; the server re-decides every request regardless. Nothing
 * here may become the thing that grants access (§13).
 */

const VNFlag = () => (
  <svg viewBox="0 0 30 20" className="h-3.5 w-5 rounded-sm" aria-hidden="true">
    <rect width="30" height="20" fill="#da251d" />
    <polygon
      fill="#ff0"
      points="15,4 16.76,9.42 22.46,9.42 17.85,12.76 19.61,18.18 15,14.84 10.39,18.18 12.15,12.76 7.54,9.42 13.24,9.42"
    />
  </svg>
);

const USFlag = () => (
  <svg viewBox="0 0 30 20" className="h-3.5 w-5 rounded-sm" aria-hidden="true">
    <rect width="30" height="20" fill="#bd3d44" />
    <g fill="#fff">
      <rect width="30" height="1.54" y="1.54" />
      <rect width="30" height="1.54" y="4.62" />
      <rect width="30" height="1.54" y="7.69" />
      <rect width="30" height="1.54" y="10.77" />
      <rect width="30" height="1.54" y="13.85" />
      <rect width="30" height="1.54" y="16.92" />
    </g>
    <rect width="12" height="10.77" fill="#192f5d" />
  </svg>
);

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  isSidebarOpen: boolean;
  /** Renders the row as present but unavailable — see `PlaceholderPage`. */
  unavailable?: boolean;
}

function NavItem({ to, icon: Icon, label, isSidebarOpen, unavailable }: Readonly<NavItemProps>) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
  const { t } = useLanguage();

  return (
    <Link to={to} className="w-full block mb-1" title={!isSidebarOpen ? label : undefined}>
      <Button
        variant={isActive ? 'secondary' : 'ghost'}
        className={clsx(
          'w-full justify-start transition-all text-sm font-medium',
          !isSidebarOpen && 'justify-center px-2',
          isActive ? 'font-semibold text-blue-700 bg-blue-50/50' : 'text-gray-600 hover:text-gray-900',
        )}
      >
        <Icon
          className={clsx(
            'h-5 w-5 shrink-0',
            isSidebarOpen && 'mr-3',
            isActive ? 'text-blue-600' : 'text-gray-500',
          )}
        />
        {isSidebarOpen && (
          <div className="flex items-center justify-between flex-1 gap-2">
            <span className="truncate">{label}</span>
            {unavailable && (
              <span className="text-[10px] font-normal text-gray-400 shrink-0">
                {t('comingSoon')}
              </span>
            )}
          </div>
        )}
      </Button>
    </Link>
  );
}

function SidebarSection({
  title,
  isSidebarOpen,
  children,
}: Readonly<{ title: string; isSidebarOpen: boolean; children: ReactNode }>) {
  return (
    <div className="mb-6">
      <div className={clsx('px-3 mb-2 flex items-center', !isSidebarOpen && 'justify-center')}>
        {isSidebarOpen ? (
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            {title}
          </span>
        ) : (
          <div className="h-px w-8 bg-gray-200 my-2" />
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Initials from whatever the server calls this person.
 *
 * `null` is a real answer, not a missing one: `username` is the local part of a
 * login email, and an account with no local subject has none. `?` marks the
 * absence — it is not a stand-in identity, and nothing here invents a name.
 */
const initialsOf = (name: string | null): string =>
  (name ?? '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

export default function MainLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { language, setLanguage, t } = useLanguage();
  const { state, signOut } = useSession();
  const { departments } = useMyDepartments();
  const navigate = useNavigate();

  // `RequireSession` guarantees a ready session above this component, so the
  // non-ready branch is defensive rather than a state a user can actually see.
  // The `null` inside a ready session is NOT defensive — the server returns it
  // for an account with no local subject, and it has to render as an absence.
  const username = state?.status === 'ready' ? state.authorization.username : null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 font-sans text-gray-800">
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label={t('toggleNavigation')}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-extrabold text-blue-600 hidden sm:block">
            {t('backofficeSystem')}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <Select value={language} onValueChange={(value) => setLanguage(value as 'vi' | 'en')}>
            <SelectTrigger
              aria-label={t('languageLabel')}
              className="w-[85px] h-9 bg-gray-50/50 border-gray-200 px-2.5"
            >
              <span className="flex items-center gap-2">
                {language === 'vi' ? <VNFlag /> : <USFlag />}
                {language === 'vi' ? 'VN' : 'US'}
              </span>
            </SelectTrigger>
            <SelectContent className="min-w-[85px] w-[85px]">
              <SelectItem value="vi" className="pl-2 pr-6">
                <span className="flex items-center gap-2">
                  <VNFlag /> VN
                </span>
              </SelectItem>
              <SelectItem value="en" className="pl-2 pr-6">
                <span className="flex items-center gap-2">
                  <USFlag /> US
                </span>
              </SelectItem>
            </SelectContent>
          </Select>

          <Link
            to="/account/security"
            className="flex items-center gap-3 hover:bg-gray-50 p-1.5 rounded-lg transition-colors"
          >
            <Avatar className="h-8 w-8 hover:ring-2 hover:ring-blue-100 transition-all">
              <AvatarFallback className="bg-blue-100 text-blue-700 font-bold text-xs">
                {initialsOf(username)}
              </AvatarFallback>
            </Avatar>
            {/* No name to show is shown as no name. Anything else here would
                be an identity the server did not give. */}
            {username && (
              <span className="text-sm font-medium hidden sm:block">{username}</span>
            )}
          </Link>

          <div className="h-6 w-px bg-gray-200 hidden sm:block" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-200"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('logout')}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={clsx(
            'bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out',
            isSidebarOpen ? 'w-64' : 'w-16',
          )}
        >
          <nav className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            <SidebarSection title={t('common')} isSidebarOpen={isSidebarOpen}>
              <NavItem
                to="/organization/dashboard"
                icon={LayoutDashboard}
                label={t('overview')}
                isSidebarOpen={isSidebarOpen}
              />
              <NavItem
                to="/worklist/my-work"
                icon={Briefcase}
                label={t('myWork')}
                isSidebarOpen={isSidebarOpen}
              />
              <NavItem
                to="/organization/departments"
                icon={Building}
                label={t('departments')}
                isSidebarOpen={isSidebarOpen}
              />
            </SidebarSection>

            {/* Real departments, from `departmentIds` on the session. A user who
                belongs to none simply has no section — better than offering a
                destination the server will refuse. */}
            {departments.length > 0 && (
              <SidebarSection title={t('departmentsSection')} isSidebarOpen={isSidebarOpen}>
                {departments.map((department) => (
                  <NavItem
                    key={department.id}
                    to={`/organization/department/${department.id}/members`}
                    icon={Users}
                    label={department.name}
                    isSidebarOpen={isSidebarOpen}
                  />
                ))}
              </SidebarSection>
            )}

            <SidebarSection title={t('system')} isSidebarOpen={isSidebarOpen}>
              <NavItem
                to="/system/approvals"
                icon={CheckSquare}
                label={t('approvals')}
                isSidebarOpen={isSidebarOpen}
              />
              <NavItem
                to="/system/requests"
                icon={Inbox}
                label={t('requests')}
                isSidebarOpen={isSidebarOpen}
                unavailable
              />
              <NavItem
                to="/system/documents"
                icon={FileText}
                label={t('documents')}
                isSidebarOpen={isSidebarOpen}
                unavailable
              />
              <NavItem
                to="/system/reports"
                icon={BarChart2}
                label={t('reports')}
                isSidebarOpen={isSidebarOpen}
                unavailable
              />
              <NavItem
                to="/system/ai-coordinator"
                icon={Sparkles}
                label={t('aiCoordinator')}
                isSidebarOpen={isSidebarOpen}
                unavailable
              />
              <NavItem
                to="/system/settings"
                icon={Settings}
                label={t('settings')}
                isSidebarOpen={isSidebarOpen}
                unavailable
              />
            </SidebarSection>
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
