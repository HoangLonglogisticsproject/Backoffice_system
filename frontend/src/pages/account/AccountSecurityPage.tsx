import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, History, Key, Lock, MonitorSmartphone, Shield } from 'lucide-react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { changePassword } from '@/lib/api/auth.repository';
import { useSession } from '@/lib/session/SessionProvider';
import { isApiError } from '@/lib/http/apiError';

/**
 * Account security.
 *
 * Phú's five-tab layout is kept whole. Exactly one tab is wired, because
 * exactly one has an endpoint:
 *
 *   Change password   REAL      `POST /auth/password`
 *   Two-factor        FUTURE    no endpoint
 *   Sessions          FUTURE    no endpoint
 *   Login history     FUTURE    no endpoint
 *   Devices           FUTURE    no endpoint
 *
 * ★ THE FOUR UNBUILT TABS SHOW AN HONEST EMPTY STATE, NOT A MOCK. A fake list
 * of devices or a toggle that pretends to arm 2FA is worse than a blank panel:
 * on a SECURITY screen it tells somebody they are protected when they are not.
 * The structure survives so the feature has somewhere to land; the reassurance
 * does not.
 */

type TabId = 'password' | '2fa' | 'sessions' | 'history' | 'devices';

interface Tab {
  id: TabId;
  labelKey: 'changePassword' | 'twoFactorAuth' | 'sessions' | 'loginHistory' | 'devices';
  icon: LucideIcon;
  /** False until an endpoint exists behind it. */
  available: boolean;
}

const TABS: Tab[] = [
  { id: 'password', labelKey: 'changePassword', icon: Lock, available: true },
  { id: '2fa', labelKey: 'twoFactorAuth', icon: Shield, available: false },
  { id: 'sessions', labelKey: 'sessions', icon: Key, available: false },
  { id: 'history', labelKey: 'loginHistory', icon: History, available: false },
  { id: 'devices', labelKey: 'devices', icon: MonitorSmartphone, available: false },
];

export default function AccountSecurityPage() {
  const [activeTab, setActiveTab] = useState<TabId>('password');
  const { t } = useLanguage();

  const active = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  return (
    <div className="flex flex-col md:flex-row gap-6 max-w-6xl mx-auto">
      <nav className="w-full md:w-64 shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-fit flex flex-col py-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors w-full text-left',
                isActive
                  ? 'bg-blue-50 text-blue-600 border-l-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50 border-l-2 border-transparent',
              )}
            >
              <Icon className={clsx('h-4 w-4', isActive ? 'text-blue-600' : 'text-gray-400')} />
              <span className="flex-1">{t(tab.labelKey)}</span>
              {!tab.available && (
                <span className="text-[10px] text-gray-400">{t('comingSoon')}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8">
        {active.id === 'password' ? (
          <ChangePasswordForm />
        ) : (
          <UnavailableFeature title={t(active.labelKey)} />
        )}
      </div>
    </div>
  );
}

/**
 * The one real form here.
 *
 * ⚠ A SUCCESSFUL CHANGE ENDS EVERY SESSION, INCLUDING THIS ONE (§1). That is
 * the point of it — a stolen cookie must not survive the password that replaced
 * it. So the only correct thing to do afterwards is send the user to login;
 * staying put would leave the app holding a cookie the server has already
 * destroyed, and every subsequent request would 401.
 */
function ChangePasswordForm() {
  const { t } = useLanguage();
  const { signOut } = useSession();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const clear = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setVisible({});
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mismatch) return;

    setBusy(true);
    setError(null);

    try {
      await changePassword(currentPassword, newPassword);
      // The server has already invalidated everything. Clearing local state and
      // leaving is the only consistent next step.
      await signOut();
      navigate('/login', { replace: true });
    } catch (error_) {
      // The server owns the password policy and the "current password wrong"
      // answer. Repeating either rule here would eventually contradict it.
      setError(isApiError(error_) ? error_.message : t('loadFailed'));
      setBusy(false);
    }
  };

  const field = (
    id: string,
    labelKey: 'currentPasswordLabel' | 'newPasswordLabel' | 'confirmPasswordLabel',
    placeholderKey: 'currentPasswordPlaceholder' | 'newPasswordPlaceholder' | 'confirmPasswordPlaceholder',
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {t(labelKey)}
      </label>
      <div className="relative">
        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <Input
          id={id}
          type={visible[id] ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t(placeholderKey)}
          className="pl-10 pr-10"
          required
        />
        <button
          type="button"
          className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
          onClick={() => setVisible((state) => ({ ...state, [id]: !state[id] }))}
          // Its OWN name, not the field's: sharing one makes both elements
          // match the same lookup and leaves the toggle unnameable.
          aria-label={visible[id] ? t('hidePassword') : t('showPassword')}
        >
          {visible[id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t('changePassword')}</h1>
        <p className="text-sm text-gray-500">{t('updatePasswordDesc')}</p>
      </div>

      <form className="space-y-6" onSubmit={submit}>
        {field('current-password', 'currentPasswordLabel', 'currentPasswordPlaceholder', currentPassword, setCurrentPassword)}
        {field('new-password', 'newPasswordLabel', 'newPasswordPlaceholder', newPassword, setNewPassword)}
        {field('confirm-password', 'confirmPasswordLabel', 'confirmPasswordPlaceholder', confirmPassword, setConfirmPassword)}

        {mismatch && (
          <p role="alert" className="text-sm text-red-600">
            {t('passwordMismatch')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="pt-6 border-t border-gray-100 flex justify-end gap-3">
          {/* Clears the form rather than navigating: this screen is reached
              from the avatar menu and has nowhere obvious to go back to, and a
              button that does nothing at all is worse than either. */}
          <Button
            variant="outline"
            type="button"
            onClick={clear}
            className="w-24 border-gray-200"
            disabled={busy}
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={busy || mismatch}
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            <Lock className="h-4 w-4" />
            {t('updatePasswordBtn')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function UnavailableFeature({ title }: Readonly<{ title: string }>) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 text-sm text-gray-500 max-w-sm">{t('notAvailableYet')}</p>
      <span className="mt-4 inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
        {t('comingSoon')}
      </span>
    </div>
  );
}
