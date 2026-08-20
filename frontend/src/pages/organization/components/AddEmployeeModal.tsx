import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/lib/session/SessionProvider';
import { createUser } from '@/lib/api/users.repository';
import { requestAccountInvitation } from '@/lib/api/account-invitation.repository';
import { isApiError } from '@/lib/http/apiError';

interface AddEmployeeModalProps {
  isOpen: boolean;
  departmentId: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Adding somebody to a department — TWO DIFFERENT WORKFLOWS BEHIND ONE BUTTON.
 *
 * ★ THE TWO PATHS ARE NOT THE SAME FORM, and forcing them into one would
 * misrepresent both:
 *
 *   GLOBAL  `POST /users` creates the account outright. It needs a name, an
 *           email, the department and an initial password, because the
 *           administrator is the one issuing the credential.
 *
 *   HEAD    `POST /departments/:id/account-invitations` takes AN EMAIL AND
 *           NOTHING ELSE. A head proposes a colleague; they do not name them,
 *           do not choose a password, and do not create anything. An
 *           administrator approves, and the server issues the credential.
 *
 * Which form appears is a render hint from `can('user.write')`. The server
 * enforces the real rule and will refuse either call regardless of what this
 * component drew (§13).
 *
 * Phú's mock had employee code and job title fields. The backend stores
 * neither, so they are not here: a field that silently discards what somebody
 * typed is worse than a field that does not exist.
 */
export function AddEmployeeModal({
  isOpen,
  departmentId,
  onClose,
  onCreated,
}: Readonly<AddEmployeeModalProps>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const isGlobal = can('user.write');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDisplayName('');
    setEmail('');
    setInitialPassword('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (isGlobal) {
        await createUser({ displayName, email, initialPassword, departmentId });
      } else {
        await requestAccountInvitation(departmentId, email);
      }
      reset();
      onCreated();
      onClose();
    } catch (caught) {
      // The server's message is the honest one — it knows about domain
      // allowlists, duplicate addresses and password policy, and this form
      // does not.
      setError(isApiError(caught) ? caught.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'add-employee-form';

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={isGlobal ? t('addNewEmployee') : t('requestAccountTitle')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busy ? t('creating') : isGlobal ? t('saveEmployee') : t('submitRequest')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {!isGlobal && <p className="text-sm text-gray-500">{t('requestAccountBody')}</p>}

        {isGlobal && (
          <div className="space-y-2">
            <label htmlFor="employee-name" className="text-sm font-medium text-gray-700">
              {t('fullNameLabel')}
            </label>
            <Input
              id="employee-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t('fullNamePlaceholder')}
              required
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="employee-email" className="text-sm font-medium text-gray-700">
            {t('emailLabel')}
          </label>
          <Input
            id="employee-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="email@hoanglong.com"
            required
          />
        </div>

        {isGlobal && (
          <div className="space-y-2">
            <label htmlFor="employee-password" className="text-sm font-medium text-gray-700">
              {t('initialPasswordLabel')}
            </label>
            <Input
              id="employee-password"
              type="password"
              value={initialPassword}
              onChange={(event) => setInitialPassword(event.target.value)}
              required
            />
            <p className="text-xs text-gray-500">{t('initialPasswordHint')}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
