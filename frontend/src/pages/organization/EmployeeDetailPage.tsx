import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useSessionResource } from '@/hooks/useSessionResource';
import { formatDate } from '@/utils/format/datetime';
import { fetchEmployeeDetail } from '@/api/membership';
import { disableUser } from '@/api/users';
import { isApiError } from '@/utils/errors';
import type { EmployeeDetail, EmployeeRole, MembershipStatus } from '@/types/organization';

/**
 * ONE EMPLOYEE — identity, account state, and employment history. READ ONLY.
 *
 * ★ KEYED BY THE PERSON, NOT BY A MEMBERSHIP. `users.id` survives every
 * lifecycle event, which is what lets several employment periods render as ONE
 * employee. Keying by a membership would scope this page to a single period and
 * make "Lịch sử phòng ban" impossible to show.
 *
 * ★ NOTHING HERE DECIDES ANYTHING. No Disable, no Edit, no Transfer, no Rehire.
 * The server refused or allowed this read before the page ran; the page renders
 * what came back and offers no action on it.
 *
 * ⚠ THE HISTORY A HEAD SEES IS PARTIAL, AND THE HEADING SAYS SO. The server
 * narrows the periods to the units that caller leads, so a filtered list can
 * never even name a unit they have no authority over — but a filtered list
 * presented as a complete history would be a lie the server cannot correct.
 * Hence two different headings, chosen from the SESSION rather than guessed from
 * the data: an employee who genuinely worked in one unit and a head who may see
 * only one of three look identical in the response.
 */
export default function EmployeeDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { t, language } = useLanguage();
  const { can } = useSession();
  // `user.write` is global-only, so it answers "is this a deployment-wide
  // administrator" exactly — which is the same thing that decides whether the
  // server filtered the history.
  const isGlobal = can('user.write');

  // Bumped after a disable so the page RE-READS. The new account status must
  // come from the server, never from a local edit to what is on screen: the
  // lifecycle also ends a membership and revokes roles, and a frontend that
  // patched one field would show a half-applied truth.
  const [refresh, setRefresh] = useState(0);

  const read = useCallback(
    () =>
      userId
        ? fetchEmployeeDetail(userId)
        : // Rejecting is the honest answer: a request to `/users/undefined/...`
          // would dress a routing bug up as a missing employee.
          Promise.reject(new Error('No user on the route.')),
    [userId],
  );
  const resource = useSessionResource<EmployeeDetail>(read, [userId, refresh]);

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Hand the whole operation to the server and re-read the result.
   *
   * ⚠ NOTHING IS DECIDED HERE. The last-SuperAdmin rule, the order of the five
   * writes, and whether this caller may act at all are the backend's, and this
   * only shows what it answered. Re-implementing any of that would put a second
   * copy of a business rule in the browser, where it cannot be enforced.
   */
  const disable = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setFailure(null);

    try {
      await disableUser(userId);
      setConfirming(false);
      // ★ RE-READ, never patch the object on screen. The lifecycle also ended a
      // membership and revoked roles; only the server knows the whole outcome.
      setRefresh((n) => n + 1);
    } catch (error_) {
      // The server's words when it has them — it knows about the last-SuperAdmin
      // rule and about an account already disabled, and this screen does not.
      setFailure(isApiError(error_) ? error_.message : t('disableFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!userId) return null;

  if (resource.loading) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t('loading')}</p>;
  }

  // Two refusals with two different meanings, and neither is an error to report
  // as a failure: a head reaching somebody who has moved units is refused BY
  // DESIGN, and an unknown id is simply absent.
  if (resource.forbidden) {
    return (
      <p role="alert" className="px-6 py-10 text-center text-sm text-gray-600">
        {t('employeeForbidden')}
      </p>
    );
  }
  if (resource.notFound) {
    return (
      <p role="alert" className="px-6 py-10 text-center text-sm text-gray-600">
        {t('employeeNotFound')}
      </p>
    );
  }
  if (resource.error || !resource.data) {
    return (
      <p role="alert" className="px-6 py-10 text-center text-sm text-red-600">
        {t('loadFailed')}
      </p>
    );
  }

  const employee = resource.data;
  // ★ CURRENT MEANS `membershipStatus === 'active'` — never the newest row, the
  // largest id, or whatever the query returned last. The database allows at most
  // one active membership per person, so this finds one or none.
  const current = employee.memberships.find((row) => row.membershipStatus === 'active');
  const history = employee.memberships;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------- 1. Thông tin nhân viên -- */}
      <section className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h1 className="sr-only">{t('employeeDetailTitle')}</h1>
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12 ring-1 ring-gray-100">
            <AvatarFallback className="bg-blue-100 text-blue-700 text-sm font-semibold">
              {employee.user.displayName.trim().charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{employee.user.displayName}</h2>
            <p className="text-sm text-gray-500">{t('sectionIdentity')}</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------- 2. Tài khoản Backoffice -- */}
      <section className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{t('sectionAccount')}</h2>
            <dl className="mt-3 flex items-center gap-3">
              {/* ★ LABELLED "Trạng thái tài khoản", never "Trạng thái nhân viên".
                  This is `users.status` — whether the account may operate — and
                  it is a different question from whether they still work in a
                  unit. */}
              <dt className="text-sm text-gray-500">{t('accountStatusLabel')}</dt>
              <dd>
                <AccountStatusBadge status={employee.accountStatus} />
              </dd>
            </dl>
          </div>

          {/*
            ★ THE ACTION BELONGS TO THE ACCOUNT SECTION, and only here. Disabling
            changes what somebody may ACCESS; it is not a fact about the unit
            they sit in, so putting it beside "Phòng ban hiện tại" or the history
            would file an access operation under organizational data.

            ★ SHOWN ONLY WHEN THE ACCOUNT IS STILL ACTIVE, and only to a caller
            holding `user.write` — which is global-only, so this is the SUPERADMIN.
            ⚠ HIDING IS NOT AUTHORIZATION (§13). `PATCH /users/:userId/status`
            re-decides on its own and answers 403 to anybody else, whatever was
            drawn here.

            No re-enable button when the account is already disabled: restoring
            somebody asks which department they return to, which is a business
            workflow that does not exist yet. An inert button would promise one.
          */}
          {isGlobal && employee.accountStatus === 'active' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(true)}
              className="border-red-200 text-red-700 hover:bg-red-50"
            >
              {t('disableAccount')}
            </Button>
          )}
        </div>

        {failure && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {failure}
          </p>
        )}
      </section>

      {/*
        ★ AN EXPLICIT SECOND ACT. The dialog states what actually happens — no
        login, nothing deleted, history kept — because the word "disable" alone
        does not tell somebody whether they are about to lose the employee's
        record. The wording deliberately never says "xóa": nothing is deleted.
      */}
      <Modal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        title={t('disableAccountTitle')}
        footer={
          <>
            <Button variant="outline" type="button" onClick={() => setConfirming(false)} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              onClick={disable}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {busy ? t('disabling') : t('disableAccountConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">{employee.user.displayName}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('disableEffectLogin')}</li>
            <li>{t('disableEffectKeepsData')}</li>
            <li>{t('disableEffectKeepsHistory')}</li>
            <li>{t('disableEffectAccess')}</li>
          </ul>
        </div>
      </Modal>

      {/* -------------------------------------- 3. Phòng ban hiện tại -- */}
      <section className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">{t('sectionCurrentDepartment')}</h2>
        {current ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label={t('colDepartment')}>{current.department.name}</Field>
            <Field label={t('colPosition')}>
              <PositionLabel role={current.role} />
            </Field>
            {/* ★ "Trạng thái làm việc" — the MEMBERSHIP's status, beside the
                account's above and deliberately worded apart from it. */}
            <Field label={t('workStatusLabel')}>
              <MembershipStatusBadge status={current.membershipStatus} />
            </Field>
            <Field label={t('colJoinedAt')}>{formatDate(current.joinedAt, language)}</Field>
          </dl>
        ) : (
          // Offboarded, or a global administrator who sits above units. An
          // absence, said as one.
          <p className="mt-3 text-sm text-gray-500">{t('noCurrentDepartment')}</p>
        )}
      </section>

      {/* -------------------------------------- 4. Lịch sử phòng ban -- */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            {isGlobal ? t('historyTitle') : t('historyTitleScoped')}
          </h2>
          {!isGlobal && <p className="mt-1 text-xs text-gray-500">{t('historyScopedNote')}</p>}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="font-semibold text-gray-600">{t('colDepartment')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colPosition')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colJoinedAt')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colEndedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((period) => (
                // Keyed by the MEMBERSHIP: one person holds several of these
                // rows, and keying by `user.id` would collapse them into one.
                <TableRow key={period.id} className="hover:bg-blue-50/30">
                  <TableCell className="font-medium text-gray-900">
                    {period.department.name}
                  </TableCell>
                  <TableCell className="text-gray-600">
                    <PositionLabel role={period.role} />
                  </TableCell>
                  <TableCell>
                    <MembershipStatusBadge status={period.membershipStatus} />
                  </TableCell>
                  <TableCell className="text-gray-600">
                    {formatDate(period.joinedAt, language)}
                  </TableCell>
                  <TableCell className="text-gray-600">
                    {/* An open period has no end. An em dash says that; a blank
                        cell reads like missing data. */}
                    {period.endedAt ? formatDate(period.endedAt, language) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {history.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-gray-500">{t('noHistory')}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

/**
 * The position, named from the role the SERVER derived.
 *
 * `MEMBER` arrives because no active DEPARTMENT_HEAD assignment was found for
 * that membership — it is not stored, and nothing here should try to work it out
 * from a department, a date or an account state.
 */
function PositionLabel({ role }: Readonly<{ role: EmployeeRole }>) {
  const { t } = useLanguage();
  return <>{role === 'DEPARTMENT_HEAD' ? t('roleDepartmentHead') : t('roleMember')}</>;
}

/** `department_memberships.status` — still in this unit, or no longer. */
function MembershipStatusBadge({ status }: Readonly<{ status: MembershipStatus }>) {
  const { t } = useLanguage();
  const styles =
    status === 'active'
      ? 'bg-green-50 text-green-700 ring-green-600/20'
      : 'bg-gray-50 text-gray-600 ring-gray-500/10';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {status === 'active' ? t('statusActive') : t('statusInactive')}
    </span>
  );
}

/**
 * `users.status` — may this account operate.
 *
 * ⚠ Deliberately a DIFFERENT component from the membership badge, with different
 * words. One shared badge would be one edit away from showing "Đang làm việc"
 * for an account state, which is the confusion this whole separation exists to
 * prevent.
 */
function AccountStatusBadge({ status }: Readonly<{ status: EmployeeDetail['accountStatus'] }>) {
  const { t } = useLanguage();
  const styles =
    status === 'active'
      ? 'bg-blue-50 text-blue-700 ring-blue-600/20'
      : 'bg-red-50 text-red-700 ring-red-600/20';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {status === 'active' ? t('accountActive') : t('accountDisabled')}
    </span>
  );
}
