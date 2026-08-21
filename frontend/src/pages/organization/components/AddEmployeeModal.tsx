import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { createUser } from '@/api/users';
import { requestAccountInvitation } from '@/api/account-invitation';
import { isApiError } from '@/utils/errors';
import { COMPANY_EMAIL_DOMAIN, toCompanyEmail } from '@/utils/validation/companyEmail';

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
 *
 * ★ THE EMAIL FIELD TAKES A LOCAL PART, NOT AN ADDRESS. Every employee account
 * is `<local-part>@hoanglonglti.com`, so the domain is drawn beside the input
 * instead of being typed into it — one company, one domain, nothing to choose.
 * A pasted full company address is unwrapped rather than refused; see
 * `lib/companyEmail`. The server enforces the domain either way (§13), so this
 * is a shorter field and an earlier error, never the rule itself.
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
  // The LOCAL PART. `email` is built from it at submit, and only there.
  const [localPart, setLocalPart] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDisplayName('');
    setLocalPart('');
    setInitialPassword('');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    // Before anything is sent, because the address this form builds is the one
    // thing it CAN check without asking. The server checks it again regardless.
    const email = toCompanyEmail(localPart);
    if (email === null) {
      setError(t('invalidCompanyEmail'));
      return;
    }

    setBusy(true);

    try {
      if (isGlobal) {
        await createUser({ displayName, email, initialPassword, departmentId });
      } else {
        await requestAccountInvitation(departmentId, email);
      }
      reset();
      onCreated();
      onClose();
    } catch (error_) {
      // The server's message is the honest one — it knows about domain
      // allowlists, duplicate addresses and password policy, and this form
      // does not.
      setError(isApiError(error_) ? error_.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'add-employee-form';

  // Three states, read top to bottom instead of nested inside one expression.
  // Same values and same precedence: `busy` still wins over the workflow, and
  // the workflow still decides between creating and requesting.
  let submitLabel: string;
  if (busy) {
    submitLabel = t('creating');
  } else if (isGlobal) {
    submitLabel = t('saveEmployee');
  } else {
    submitLabel = t('submitRequest');
  }

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
            {submitLabel}
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
          {/*
            One control to the eye, two elements to the DOM: the label points at
            the input, so `getByLabelText` and a screen reader both land on the
            part that is actually editable, and the ring is drawn on the wrapper
            so focusing the input still lights the whole thing.
          */}
          <div className="flex items-stretch rounded-lg border border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Input
              id="employee-email"
              value={localPart}
              onChange={(event) => setLocalPart(event.target.value)}
              placeholder={t('emailLocalPartPlaceholder')}
              // Not `type="email"`: this is a local part, and the browser would
              // refuse to submit `uyen` as an address.
              autoComplete="off"
              aria-describedby="employee-email-domain"
              className="rounded-r-none border-0 focus-visible:ring-0"
              required
            />
            <span
              id="employee-email-domain"
              // Rendered, never an input — there is no second domain to pick, so
              // offering one would be a field whose only legal value is fixed.
              className="flex items-center rounded-r-lg border-l border-input bg-gray-50 px-2.5 text-sm text-gray-500 whitespace-nowrap"
            >
              @{COMPANY_EMAIL_DOMAIN}
            </span>
          </div>
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
              // The TEMPORARY floor (8), not the permanent one (12) an employee
              // chooses for themselves — requiring 12 here would reject values
              // the server accepts. This reports early; the server still
              // decides, and still answers 422.
              minLength={8}
              // Stops a password manager offering the ADMINISTRATOR's own saved
              // credential for somebody else's new account.
              autoComplete="new-password"
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
