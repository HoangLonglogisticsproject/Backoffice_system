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
import { CursorPagination } from '@/components/ui/pagination';
import { MembershipStatusBadge } from '@/components/common/EmployeeRosterTable';
import { StatusPill } from '@/components/common/StatusPill';
import { TripStatusBadge } from '@/pages/trip/components/TripStatusBadge';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useCursorPages } from '@/hooks/useCursorPages';
import { useSessionResource } from '@/hooks/useSessionResource';
import { formatCalendarDay, formatDate } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
import { fetchEmployeeDetail } from '@/api/membership';
import { fetchDriverTrips, type DriverTripHistoryRow } from '@/api/tripAssignment';
import { disableUser } from '@/api/users';
import { setDriverStatus } from '@/api/driverAccounts';
import { isApiError } from '@/utils/errors';
import type { AccountStatus, EmployeeDetail, EmployeeRole } from '@/types/organization';
import type { TranslationKey } from '@/types/translate';

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

  /**
   * Which confirmation is open, if any.
   *
   * ★ A DIRECTION, NOT A BOOLEAN. Exactly one of the two is ever offered — the
   * account is live or it is not — so a pair of booleans would carry a state
   * ("confirming both") that the screen has no way to draw.
   */
  const [confirming, setConfirming] = useState<'disable' | 'enable' | null>(null);
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
  const changeStatus = async (direction: 'disable' | 'enable') => {
    if (!userId || busy) return;
    setBusy(true);
    setFailure(null);

    try {
      await ACCOUNT_STATUS_ACTIONS[direction].run(userId);
      setConfirming(null);
      // ★ RE-READ, never patch the object on screen. Disabling also ended a
      // membership and revoked roles, and enabling deliberately restores
      // neither; only the server knows what the account looks like afterwards.
      setRefresh((n) => n + 1);
    } catch (error_) {
      // The server's words when it has them — it knows about the last-SuperAdmin
      // rule, about an account already in the state asked for, and about
      // re-enabling being a driver-only operation. This screen knows none of it.
      const failed = ACCOUNT_STATUS_ACTIONS[direction].failed;
      setFailure(isApiError(error_) ? error_.message : t(failed));
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
  /**
   * ★ READ FROM THE SERVER, NEVER INFERRED FROM AN EMPTY `memberships`.
   *
   * "No periods" is also what an offboarded employee looks like, and what a head
   * sees when the person has moved to a unit they do not lead. Guessing from the
   * absence would put "Tài xế" on the wrong page in both cases.
   */
  const isDriver = employee.accountType === 'driver';

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
            {/* ★ SAYS WHICH KIND OF ACCOUNT THIS IS, because the two pages below
                differ entirely and a reader should know why before scrolling. */}
            <p className="text-sm text-gray-500">
              {isDriver ? t('driverAccountLabel') : t('sectionIdentity')}
            </p>
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
                <AccountStatusPill status={employee.accountStatus} />
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

            ★ AND RE-ENABLING IS OFFERED FOR A DRIVER ONLY. Restoring an EMPLOYEE
            asks which department they return to — a business workflow that still
            does not exist — so the button stays absent there rather than
            promising one. A driver belongs to no unit by design, so the question
            has no subject and the server accepts the operation.
          */}
          {isGlobal && employee.accountStatus === 'active' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming('disable')}
              className="border-red-200 text-red-700 hover:bg-red-50"
            >
              {t('disableAccount')}
            </Button>
          )}
          {isGlobal && isDriver && employee.accountStatus === 'disabled' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming('enable')}
              className="border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              {t('enableAccount')}
            </Button>
          )}
        </div>

        {failure && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {failure}
          </p>
        )}
      </section>

      <AccountStatusDialog
        direction={confirming}
        displayName={employee.user.displayName}
        busy={busy}
        onConfirm={() => void changeStatus(confirming ?? 'disable')}
        onClose={() => setConfirming(null)}
      />

      {/*
        -------------------------------- 3'. A DRIVER, instead of the two below --

        ★ THE PAGE SPLITS HERE, AND IT IS NOT A COSMETIC CHOICE. "Phòng ban hiện
        tại" and "Lịch sử phòng ban" are both permanently empty for a driver, and
        two blank tables with nothing beside them read as a record that failed to
        load. A sentence saying the absence is correct, and the work they HAVE
        been given, is the honest version of the same page.
      */}
      {isDriver && (
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">{t('sectionCurrentDepartment')}</h2>
          <p className="mt-3 text-sm text-gray-500">{t('driverNoDepartment')}</p>
        </section>
      )}

      {isDriver && <DriverTrips userId={employee.user.id} />}

      {/* -------------------------------------- 3. Phòng ban hiện tại -- */}
      {!isDriver && (
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
      )}

      {/* -------------------------------------- 4. Lịch sử phòng ban -- */}
      {!isDriver && (
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
      )}
    </div>
  );
}

/**
 * What each direction of an account-status change SAYS and DOES.
 *
 * ★ A TABLE RATHER THAN A CHAIN OF TERNARIES, and the reason is not tidiness:
 * the two directions differ in six places — the call, the failure sentence, the
 * title, the confirm label, the in-flight label, and the list of what actually
 * happens. Spelled as conditions those six drift apart one edit at a time;
 * spelled as a row they cannot.
 *
 * ★ THE TWO EFFECT LISTS ARE NOT MIRROR IMAGES. Disabling promises the record
 * survives; enabling has to say what does NOT come back — the sessions it
 * revoked stay revoked — because somebody expecting "undo" should read that
 * before they press the button rather than afterwards from a support call.
 */
const ACCOUNT_STATUS_ACTIONS = {
  disable: {
    run: (userId: string) => disableUser(userId),
    failed: 'disableFailed',
    title: 'disableAccountTitle',
    confirm: 'disableAccountConfirm',
    inFlight: 'disabling',
    submitClass: 'bg-red-600 hover:bg-red-700 text-white',
    effects: [
      'disableEffectLogin',
      'disableEffectKeepsData',
      'disableEffectKeepsHistory',
      'disableEffectAccess',
    ],
  },
  enable: {
    // ★ THE DRIVER RESOURCE, NOT `/users/:id/status`. Re-enabling is a
    // driver-only operation, so it lives on the route that already means "a
    // driver"; the core route takes `disabled` and nothing else.
    run: async (userId: string) => {
      await setDriverStatus(userId, 'active');
    },
    failed: 'enableFailed',
    title: 'enableAccountTitle',
    confirm: 'enableAccountConfirm',
    inFlight: 'enabling',
    submitClass: 'bg-blue-600 hover:bg-blue-700 text-white',
    effects: ['enableEffectLogin', 'enableEffectDispatch', 'enableEffectNoSessions'],
  },
} as const satisfies Record<
  'disable' | 'enable',
  {
    run: (userId: string) => Promise<unknown>;
    failed: TranslationKey;
    title: TranslationKey;
    confirm: TranslationKey;
    inFlight: TranslationKey;
    submitClass: string;
    effects: readonly TranslationKey[];
  }
>;

/**
 * Confirming a change of account status, in either direction.
 *
 * ★ AN EXPLICIT SECOND ACT. The dialog states what actually happens — no login,
 * nothing deleted, history kept — because the word "disable" alone does not tell
 * somebody whether they are about to lose the employee's record. The wording
 * deliberately never says "xóa": nothing is deleted.
 *
 * Presentational: the page owns the request and the re-read, this owns only what
 * is drawn. `direction` is `null` when the dialog is shut.
 */
function AccountStatusDialog({
  direction,
  displayName,
  busy,
  onConfirm,
  onClose,
}: Readonly<{
  direction: 'disable' | 'enable' | null;
  displayName: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}>) {
  const { t } = useLanguage();
  // Closed: nothing to draw, and no row to look up. Safe to unmount rather than
  // render a closed `Modal` — its focus trap and body-scroll lock are undone by
  // an effect CLEANUP, which React runs on unmount just the same.
  if (direction === null) return null;

  const action = ACCOUNT_STATUS_ACTIONS[direction];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(action.title)}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy} className={action.submitClass}>
            {busy ? t(action.inFlight) : t(action.confirm)}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">{displayName}</p>
        <ul className="list-disc space-y-1 pl-5">
          {action.effects.map((effect) => (
            <li key={effect}>{t(effect)}</li>
          ))}
        </ul>
      </div>
    </Modal>
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

/**
 * ★ THE DRIVER'S OWN SECTION, RENDERED INSTEAD OF THE TWO DEPARTMENT ONES.
 *
 * A driver belongs to no unit and never will, so "Phòng ban hiện tại" and "Lịch
 * sử phòng ban" are permanently empty for one — and two blank tables with no
 * sentence beside them read as a record that failed to load. What a driver
 * actually has is work: the trips they have been given.
 *
 * ★ ENDED TURNS ARE HERE TOO, and the assignment column says which is which. A
 * trip can be well under way while this driver's turn on it has already ended —
 * that is exactly what a replacement is — so the trip's status and the
 * assignment's are two columns rather than one.
 *
 * ⚠ AND IT CARRIES NO MONEY. The endpoint joins neither cost table, so there is
 * nothing here to leak whatever this page later grows.
 */
function DriverTrips({ userId }: Readonly<{ userId: string }>) {
  const { t, language } = useLanguage();
  const page = useCursorPages<DriverTripHistoryRow>(
    (request) => fetchDriverTrips(userId, request),
    [userId],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">{t('driverTripsTitle')}</h2>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-gray-50/50">
            <TableRow>
              <TableHead className="font-semibold text-gray-600">{t('colDate')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colVehicle')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colCustomer')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colAssignment')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              // Keyed by the ASSIGNMENT, not the trip: a driver can be put back
              // on a trip they were taken off, and keying by the trip would
              // collapse two real turns into one row.
              <TableRow key={row.id} className="hover:bg-blue-50/30">
                <TableCell className="whitespace-nowrap font-medium text-gray-900">
                  {formatCalendarDay(row.trip.scheduledOn, language)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-gray-600">
                  {formatPlate(row.trip.vehicle?.plate) || '—'}
                </TableCell>
                <TableCell className="text-gray-600">{row.trip.customer?.name ?? '—'}</TableCell>
                <TableCell>
                  <TripStatusBadge status={row.trip.status} />
                </TableCell>
                <TableCell className="text-gray-600">
                  {row.state === 'active' ? (
                    <span className="font-medium text-blue-700">{t('assignmentActive')}</span>
                  ) : (
                    <div className="text-sm">
                      <span className="text-gray-500">{t('assignmentEnded')}</span>
                      {/* The reason is required on every ended turn, and it is
                          the only thing that says why somebody came off. */}
                      {row.endReason && (
                        <span className="block whitespace-pre-line text-gray-500">
                          {row.endReason}
                        </span>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {!page.loading && page.items.length === 0 && !page.error && (
          <p className="px-6 py-10 text-center text-sm text-gray-500">{t('emptyDriverTrips')}</p>
        )}
        {page.error && (
          <p className="px-6 py-10 text-center text-sm text-red-600">{t('loadFailed')}</p>
        )}
      </div>

      <CursorPagination
        shown={page.items.length}
        hasMore={page.hasMore}
        canGoBack={page.canGoBack}
        onNext={page.next}
        onPrevious={page.previous}
        pageSize={page.pageSize}
        onPageSizeChange={page.setPageSize}
        isLoading={page.loading}
        className="border-t border-gray-100 bg-gray-50/30"
      />
    </section>
  );
}

/**
 * `users.status` — may this account operate.
 *
 * ⚠ DELIBERATELY NOT `MembershipStatusBadge`, and the words differ for a
 * reason. That badge says "Đang làm việc / Đã kết thúc" about a period in a
 * department; this says whether the ACCOUNT may sign in. One shared component
 * would be one edit away from showing a membership's vocabulary for an account
 * state — the confusion the two-status separation exists to prevent. The PILL
 * is shared (`StatusPill`); only the words and the tone are decided here.
 */
function AccountStatusPill({ status }: Readonly<{ status: AccountStatus }>) {
  const { t } = useLanguage();
  return (
    <StatusPill tone={status === 'active' ? 'green' : 'gray'}>
      {status === 'active' ? t('accountActive') : t('accountDisabled')}
    </StatusPill>
  );
}
