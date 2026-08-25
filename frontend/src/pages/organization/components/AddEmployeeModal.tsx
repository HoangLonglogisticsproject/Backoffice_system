import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useMyDepartments } from '@/hooks/useMyDepartments';
import { createUser } from '@/api/users';
import { fetchDepartments } from '@/api/department';
import { assignDepartmentHead } from '@/api/department-head';
import { requestAccountInvitation } from '@/api/account-invitation';
import { isApiError } from '@/utils/errors';
import { COMPANY_EMAIL_DOMAIN, toCompanyEmail } from '@/utils/validation/companyEmail';
import type { Department } from '@/types/organization';

export type AddEmployeeOutcome = 'created' | 'requested';

interface AddEmployeeModalProps {
  isOpen: boolean;
  /**
   * The department from the ROUTE, when the screen has one.
   *
   * Omitted means the screen has no department in scope — the approvals area —
   * and the form asks for it. It is never invented: the picker is filled from
   * whichever endpoint the caller is actually allowed to read.
   */
  departmentId?: string;
  onClose: () => void;
  /**
   * What happened, and to which ADDRESS.
   *
   * The full address rather than the local part the form asked for:
   * `POST /auth/login` takes the whole thing as `subject`, so a screen that
   * confirms the outcome has to be able to show what the person will type.
   */
  onCreated: (outcome: AddEmployeeOutcome, email: string) => void;
}

/**
 * Adding somebody to a department — TWO DIFFERENT WORKFLOWS BEHIND ONE BUTTON.
 *
 * ★ THE TWO PATHS ARE NOT THE SAME FORM, and forcing them into one would
 * misrepresent both:
 *
 *   GLOBAL  `POST /users` creates the account outright. It needs a name, an
 *           email, the department and a temporary password, because the
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
 * ★ THE DEPARTMENT PICKER USES A DIFFERENT ENDPOINT PER ROLE, because only one
 * of them answers 200. `GET /departments` is checked WITHOUT a route scope, so
 * only a global caller passes it; a head reads the single department
 * `GET /authorization/me` already named. That asymmetry is also the scope rule
 * the product asks for — a head is offered exactly the unit they lead, and
 * cannot pick another, because there is no other in their session to pick.
 *
 * ★ CHỨC VỤ IS NOT A FIELD ON `POST /users`, so it is not sent as one. Two of
 * the three role keys are storable at all — MEMBER is the ABSENCE of an
 * assignment, never a row — and the storable one is written by
 * `POST /departments/:id/head`. Choosing "Trưởng phòng" therefore means one
 * extra call after the account exists, which is the only way the backend
 * records it.
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
  const needsDepartmentChoice = departmentId === undefined;

  const [displayName, setDisplayName] = useState('');
  // The LOCAL PART. `email` is built from it at submit, and only there.
  const [localPart, setLocalPart] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);
  const [chosenDepartment, setChosenDepartment] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'DEPARTMENT_HEAD'>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDisplayName('');
    setLocalPart('');
    setInitialPassword('');
    setRevealPassword(false);
    setChosenDepartment('');
    setRole('MEMBER');
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // ⚠ DOUBLE SUBMIT. The button is disabled while busy, but Enter in a text
    // field submits the form directly and never touches it. Creating an account
    // twice is not an idempotent mistake — the second call answers 409 having
    // already charged somebody a duplicate address.
    if (busy) return;
    setError(null);

    // Before anything is sent, because the address this form builds is the one
    // thing it CAN check without asking. The server checks it again regardless.
    const email = toCompanyEmail(localPart);
    if (email === null) {
      setError(t('invalidCompanyEmail'));
      return;
    }

    const department = departmentId ?? chosenDepartment;
    if (!department) {
      setError(t('selectDepartment'));
      return;
    }

    setBusy(true);

    try {
      if (isGlobal) {
        const created = await createUser({
          displayName,
          email,
          initialPassword,
          departmentId: department,
        });

        // ★ A SECOND CALL, AND IT IS NOT IN THE SAME TRANSACTION. The backend
        // has no route that creates an account and appoints a head at once, and
        // inventing one is a backend change. So the failure is reported for what
        // it is: the account EXISTS, the appointment did not happen, and the
        // administrator can retry it from the department screen. Swallowing it
        // would leave somebody believing they had made a head.
        //
        // ponytail: no rollback — deleting a just-created account to undo a
        // failed appointment is worse than telling the truth about both.
        if (role === 'DEPARTMENT_HEAD') {
          try {
            await assignDepartmentHead(department, created.id);
          } catch (assignError) {
            const detail = isApiError(assignError) ? assignError.message : t('createFailed');
            setError(`${t('roleAssignFailed')} ${detail}`);
            // `finally` still clears `busy`. The form is deliberately NOT reset
            // and NOT closed: the account exists, so the message has to stay on
            // screen long enough to be read.
            return;
          }
        }
      } else {
        await requestAccountInvitation(department, email);
      }
      // ★ ONLY HERE. Nothing is reset and nothing is closed on a failure — the
      // form keeps what was typed so a 409 on the address does not cost
      // somebody the whole form.
      reset();
      onCreated(isGlobal ? 'created' : 'requested', email);
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
            <div className="relative">
              <Input
                id="employee-password"
                type={revealPassword ? 'text' : 'password'}
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
                className="pr-10"
                required
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setRevealPassword((shown) => !shown)}
                // The label says what the button DOES next, which is what a
                // screen reader user needs; the icon shows the same thing.
                aria-label={revealPassword ? t('hidePassword') : t('showPassword')}
                aria-pressed={revealPassword}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500"
              >
                {revealPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-gray-500">{t('initialPasswordHint')}</p>
          </div>
        )}

        {needsDepartmentChoice && (
          <DepartmentPicker isGlobal={isGlobal} value={chosenDepartment} onChange={setChosenDepartment} />
        )}

        {isGlobal && (
          <div className="space-y-2">
            <label htmlFor="employee-role" className="text-sm font-medium text-gray-700">
              {t('roleLabel')}
            </label>
            <select
              id="employee-role"
              value={role}
              onChange={(event) =>
                setRole(event.target.value === 'DEPARTMENT_HEAD' ? 'DEPARTMENT_HEAD' : 'MEMBER')
              }
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              required
            >
              {/* SUPERADMIN is deliberately absent: it is a GLOBAL assignment
                  with no department, and no endpoint in this deployment grants
                  it over HTTP. The bootstrap CLI is the only way. */}
              <option value="MEMBER">{t('roleMember')}</option>
              <option value="DEPARTMENT_HEAD">{t('roleDepartmentHead')}</option>
            </select>
            {role === 'DEPARTMENT_HEAD' && <p className="text-xs text-gray-500">{t('roleHint')}</p>}
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

/**
 * The departments this caller may actually put somebody into.
 *
 * ★ TWO SOURCES, ONE PER ROLE, because only one of them answers 200 for each.
 * A global administrator reads the whole list; a head has no list endpoint at
 * all and reads the single department their session names. Asking the wrong one
 * is a guaranteed 403, not an empty menu.
 *
 * ★ THIS IS ALSO THE SCOPE RULE the product asks for. A head is offered exactly
 * the unit they lead — not because this filtered a global list down, but because
 * their session names one department and there is no second one to offer.
 *
 * A COMPONENT RATHER THAN A HOOK IN THE PARENT, so its two reads happen only
 * while the dialog is actually open. `Modal` renders nothing when closed, so
 * nothing here mounts — and the screens that pass a department from the route
 * never mount it at all.
 *
 * Archived departments are dropped: the server refuses to enroll into one, so
 * offering it would be a choice whose only outcome is a 409.
 */
function DepartmentPicker({
  isGlobal,
  value,
  onChange,
}: Readonly<{ isGlobal: boolean; value: string; onChange: (id: string) => void }>) {
  const { t } = useLanguage();
  const mine = useMyDepartments();
  const [all, setAll] = useState<Department[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isGlobal) return;

    let current = true;
    setFailed(false);

    fetchDepartments()
      .then((departments) => {
        if (current) setAll(departments);
      })
      .catch(() => {
        if (current) setFailed(true);
      });

    return () => {
      current = false;
    };
  }, [isGlobal]);

  const loading = isGlobal ? all === null && !failed : mine.loading;
  const departments = (isGlobal ? (all ?? []) : mine.departments).filter(
    (department) => department.status === 'active',
  );

  return (
    <div className="space-y-2">
      <label htmlFor="employee-department" className="text-sm font-medium text-gray-700">
        {t('departmentLabelRequired')}
      </label>
      {/*
        ponytail: a native <select>. It is form-associated, `required` works, the
        keyboard and screen-reader behaviour is the platform's, and it needs no
        state of its own. The styled `ui/select` exists but has never been wired
        to real data anywhere in this app; reach for it when a design calls for
        something a native list cannot draw.
      */}
      <select
        id="employee-department"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={loading || departments.length === 0}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        required
      >
        <option value="">{loading ? t('loading') : t('selectDepartment')}</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </select>
      {failed && <p className="text-xs text-red-600">{t('loadDepartmentsFailed')}</p>}
      {!loading && !failed && departments.length === 0 && (
        <p className="text-xs text-gray-500">{t('noDepartmentScope')}</p>
      )}
    </div>
  );
}
