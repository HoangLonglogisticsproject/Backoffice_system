import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useMyDepartments } from '@/hooks/useMyDepartments';
import { createUser } from '@/api/users';
import { createDriver, requestDriver } from '@/api/driverAccounts';
import { fetchDepartments } from '@/api/department';
import { assignDepartmentHead } from '@/api/department-head';
import { requestAccountInvitation } from '@/api/account-invitation';
import { isApiError } from '@/utils/errors';
import { COMPANY_EMAIL_DOMAIN, toCompanyEmail } from '@/utils/validation/companyEmail';
import type { Department } from '@/types/organization';

export type AddEmployeeOutcome = 'created' | 'requested';

/**
 * An account that EXISTS but has not been appointed head yet.
 *
 * ⚠ THIS IS THE PARTIAL SUCCESS, HELD RATHER THAN LOST. `POST /users` and
 * `POST /departments/:id/head` are two calls and the backend has no route that
 * does both — a confirmed contract, not an oversight. So when the first
 * succeeds and the second fails, the account is real and its id is the only
 * thing that can finish the job.
 *
 * Dropping it was the actual bug: the form still held an address that now has
 * an account, so the obvious retry — press the button again — sent a second
 * `POST /users` that could only ever answer 409, and the appointment became
 * unreachable from this screen entirely.
 *
 * ⚠ NO PASSWORD HERE, and nothing in this object is ever written to a URL, to
 * `localStorage` or to `sessionStorage`. It lives for as long as the dialog is
 * open and no longer.
 */
/** Which of the two kinds of account this form is producing. */
type AccountType = 'employee' | 'driver';

/**
 * One of the two account kinds, as a button rather than a dropdown.
 *
 * `aria-pressed` rather than a radio group: two large targets, and a screen
 * reader still hears which one is chosen.
 */
function AccountTypeChoice({
  label,
  selected,
  onSelect,
}: Readonly<{ label: string; selected: boolean; onSelect: () => void }>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={
        selected
          ? 'h-9 w-full rounded-lg border border-blue-600 bg-blue-600 text-sm font-medium text-white'
          : 'h-9 w-full rounded-lg border border-input bg-transparent text-sm text-gray-700 hover:bg-gray-50'
      }
    >
      {label}
    </button>
  );
}

interface PendingAppointment {
  /** From `POST /users`. What makes a retry an appointment and not a create. */
  userId: string;
  departmentId: string;
  /** Carried so the success path can still name the address to sign in with. */
  email: string;
}

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
  const mayProposeDriver = can('driver.account.request');

  /**
   * ★ WHAT KIND OF ACCOUNT IS BEING CREATED, ASKED FIRST.
   *
   * The two answers do not differ by a field or two — they are different
   * objects. An employee lands in a department and may be appointed its head; a
   * driver belongs to no unit at all and never will. Asking for a department
   * and then ignoring it, or offering a department called "Tài xế", would put
   * that difference somewhere a reader has to infer it.
   */
  const [accountType, setAccountType] = useState<AccountType>('employee');
  const creatingDriver = accountType === 'driver';

  // ★ A DRIVER HAS NO UNIT, so the picker is not merely hidden — it is not part
  // of the form at all, and nothing downstream reads a department for one.
  const needsDepartmentChoice = departmentId === undefined && !creatingDriver;

  const [displayName, setDisplayName] = useState('');
  // The LOCAL PART. `email` is built from it at submit, and only there.
  const [localPart, setLocalPart] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);
  const [chosenDepartment, setChosenDepartment] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'DEPARTMENT_HEAD'>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until `POST /users` has succeeded and the appointment after it has
  // not. While it is set, every submit is a retry — see `submit`.
  const [pending, setPending] = useState<PendingAppointment | null>(null);

  const reset = () => {
    setDisplayName('');
    setLocalPart('');
    setInitialPassword('');
    setRevealPassword(false);
    setChosenDepartment('');
    setRole('MEMBER');
    setError(null);
    setPending(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  /**
   * The server's words, or ours when it never answered.
   *
   * The server knows about domain allowlists, duplicate addresses and password
   * policy, and this form does not.
   */
  const messageOf = (failure: unknown) =>
    isApiError(failure) ? failure.message : t('createFailed');

  /** The success path, in the one place all three routes to it converge. */
  const finish = (outcome: AddEmployeeOutcome, email: string) => {
    reset();
    onCreated(outcome, email);
    onClose();
  };

  /**
   * The two values a submit needs, or the reason it cannot have them.
   *
   * Both checks are what this form CAN answer without asking. The server checks
   * the address again regardless, and the department id ends up in a URL path,
   * so neither is left to the browser having been the one to look.
   */
  const resolveTarget = (): { email: string; department: string } | { error: string } => {
    const email = toCompanyEmail(localPart);
    if (email === null) return { error: t('invalidCompanyEmail') };

    // ★ A DRIVER HAS NO DEPARTMENT TO RESOLVE. Returning an empty string here
    // would be a placeholder that later code could mistake for a real unit, so
    // the driver path returns the address and nothing else.
    if (creatingDriver) return { email, department: '' };

    const department = departmentId ?? chosenDepartment;
    if (!department) return { error: t('selectDepartment') };

    return { email, department };
  };

  /**
   * ★ THE ONLY PLACE `assignDepartmentHead` IS CALLED — first attempt and every
   * retry alike, so the two can never drift into doing different things.
   *
   * ponytail: no rollback. Deleting a just-created account to undo a failed
   * appointment is worse than telling the truth about both.
   */
  const appoint = async (target: PendingAppointment) => {
    setBusy(true);
    setError(null);

    try {
      await assignDepartmentHead(target.departmentId, target.userId);
      setPending(null);
      finish('created', target.email);
    } catch (error_) {
      // ⚠ THE ACCOUNT EXISTS. Holding the id is the whole fix: it is what makes
      // the next attempt an appointment rather than a duplicate create.
      setPending(target);
      setError(`${t('roleAssignFailed')} ${messageOf(error_)}`);
    } finally {
      setBusy(false);
    }
  };

  /** First attempt: create or propose, then appoint if a head was asked for. */
  const createEmployee = async () => {
    const target = resolveTarget();
    if ('error' in target) {
      setError(target.error);
      return;
    }

    setBusy(true);

    try {
      if (creatingDriver) {
        // ★ THE SAME CHOICE, TWO OUTCOMES, DECIDED BY WHAT THE CALLER HOLDS.
        // A global administrator creates the driver outright; a head can only
        // propose one. The server enforces both — this only avoids offering an
        // action that would be refused.
        if (isGlobal) {
          await createDriver({ displayName, email: target.email, initialPassword });
          finish('created', target.email);
        } else {
          await requestDriver({ displayName, email: target.email });
          finish('requested', target.email);
        }
        return;
      }

      if (!isGlobal) {
        await requestAccountInvitation(target.department, target.email);
        finish('requested', target.email);
        return;
      }

      const created = await createUser({
        displayName,
        email: target.email,
        initialPassword,
        departmentId: target.department,
      });

      if (role === 'DEPARTMENT_HEAD') {
        // Invariant #6: the appointment needs an ACTIVE MEMBERSHIP, which only
        // exists once provisioning has committed. The order is not a preference.
        await appoint({
          userId: created.id,
          departmentId: target.department,
          email: target.email,
        });
        return;
      }

      finish('created', target.email);
    } catch (error_) {
      // ★ NOTHING IS RESET AND NOTHING IS CLOSED. A 409 on the address must not
      // cost somebody the rest of the form.
      setError(messageOf(error_));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // ⚠ DOUBLE SUBMIT. The button is disabled while busy, but Enter in a text
    // field submits the form directly and never touches it. Creating an account
    // twice is not an idempotent mistake — the second call answers 409 having
    // already charged somebody a duplicate address.
    if (busy) return;

    // ★ A PENDING APPOINTMENT MAKES EVERY SUBMIT A RETRY, including the Enter
    // key. Routing here rather than only from the retry button is what
    // guarantees `createUser` cannot be reached a second time.
    if (pending) {
      await appoint(pending);
      return;
    }

    await createEmployee();
  };

  const formId = 'add-employee-form';

  // Read top to bottom instead of nested inside one expression. Precedence is
  // unchanged: `busy` still wins over everything, and a held appointment wins
  // over the workflow, because it is the only action left that can succeed.
  let submitLabel: string;
  if (busy) {
    submitLabel = t('creating');
  } else if (pending) {
    submitLabel = t('retryAppointment');
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
          {/* "Cancel" would be a lie once the account exists — there is
              nothing left to cancel, only something left to finish. */}
          <Button variant="outline" type="button" onClick={close} disabled={busy}>
            {pending ? t('closeLabel') : t('cancel')}
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
        {/*
          ★ LOCKED ONCE THE ACCOUNT EXISTS. The retry appoints the id that was
          captured, so a department changed here afterwards would be silently
          ignored — a control that looks like it still decides something, and
          does not, is worse than one that says it is finished.
        */}
        <fieldset disabled={pending !== null} className="space-y-4 m-0 min-w-0 border-0 p-0">

        {/* ★ ASKED FIRST, BECAUSE IT CHANGES WHAT THE REST OF THE FORM IS.
            Offered only to somebody who may actually produce a driver one way
            or the other — a member who holds neither key sees the employee form
            unchanged, exactly as before. */}
        {(isGlobal || mayProposeDriver) && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">{t('accountTypeLabel')}</p>
            <div className="grid grid-cols-2 gap-2">
              <AccountTypeChoice
                label={t('accountTypeEmployee')}
                selected={accountType === 'employee'}
                onSelect={() => setAccountType('employee')}
              />
              <AccountTypeChoice
                label={t('accountTypeDriver')}
                selected={creatingDriver}
                onSelect={() => setAccountType('driver')}
              />
            </div>
          </div>
        )}

        {/* ★ SAID PLAINLY RATHER THAN IMPLIED BY AN ABSENT FIELD. A form that
            simply drops the department picker leaves the reader to guess
            whether it was forgotten. */}
        {creatingDriver && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
            <p className="text-sm font-medium text-blue-900">{t('driverNoDepartmentNote')}</p>
            <p className="mt-1 text-xs text-blue-800">{t('driverNoDepartmentWhy')}</p>
            {!isGlobal && <p className="mt-1 text-xs text-blue-800">{t('driverProposeNote')}</p>}
          </div>
        )}

        {!isGlobal && !creatingDriver && (
          <p className="text-sm text-gray-500">{t('requestAccountBody')}</p>
        )}

        {(isGlobal || creatingDriver) && (
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

        </fieldset>

        {/* Outside the fieldset: it is the one thing that must stay readable
            while everything else is locked. */}
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
      {/*
        ★ WHY THE MENU IS EMPTY DEPENDS ON WHO IS ASKING, and saying the wrong
        one is not a wording nit — it sends the reader to fix the wrong thing.

        A head's menu is empty because of THEIR SCOPE: they lead no department,
        and the fix is an appointment. A SUPERADMIN has no scope at all — that
        is what global means — so `departmentIds` is empty for them BY DESIGN
        (`AuthorizationMeResponse`: "empty for a SuperAdmin, who sits above
        units"). Their menu can only be empty because the deployment has no
        ACTIVE department yet, and the fix is to create or unarchive one.

        Telling an administrator they "lead no department" reported a scope
        problem they cannot have, for an inventory problem they can fix.
      */}
      {!loading && !failed && departments.length === 0 && (
        <p className="text-xs text-gray-500">
          {isGlobal ? t('noActiveDepartments') : t('noDepartmentScope')}
        </p>
      )}
    </div>
  );
}
