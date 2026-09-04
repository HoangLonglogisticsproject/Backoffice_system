import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Modal } from '@/components/ui/modal';
import { CursorPagination } from '@/components/ui/pagination';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDateTime } from '@/utils/format/datetime';
import { useCursorPages } from '@/hooks/useCursorPages';
import type { Page, PageRequest } from '@/types/pagination';
import {
  approveMembershipRequest,
  fetchDepartmentMembershipRequests,
  fetchPendingMembershipRequests,
  rejectMembershipRequest,
} from '@/api/membership-request';
import {
  approveAccountInvitation,
  fetchDepartmentAccountInvitations,
  fetchPendingAccountInvitations,
  rejectAccountInvitation,
  type ApprovedInvitation,
} from '@/api/account-invitation';
import { useSession } from '@/contexts/SessionProvider';
import {
  AddEmployeeModal,
  type AddEmployeeOutcome,
} from '@/pages/organization/components/AddEmployeeModal';
import { isApiError } from '@/utils/errors';
import type {
  AccountInvitationWithUser,
  DecisionStatus,
  MembershipChangeRequestWithUsers,
} from '@/types/approval';
import type { AccountStatus, EmployeeRosterRow, MembershipStatus } from '@/types/organization';
import { fetchEmployeeRoster } from '@/api/membership';
import { fetchDriverAccounts, type DriverAccountRow } from '@/api/driverAccounts';
import { disableUser, enableDriverAccount } from '@/api/users';
import type { TranslationKey } from '@/types/translate';
import { EmployeeRosterTable } from '@/components/common/EmployeeRosterTable';
import { DriverAccountsTable } from '@/components/common/DriverAccountsTable';

/**
 * Which "nothing here" sentence a queue shows when it comes back empty.
 *
 * One alias rather than the same union written at each of the three components
 * that pass it down: three copies drift, and the one that drifts is the one
 * nobody reads.
 */
type EmptyStateKey = 'emptyRequests' | 'emptyInvitations' | 'emptyRoster' | 'emptyDrivers';

/**
 * The global decision queues.
 *
 * ★ GLOBAL ONLY, AND A HEAD GETS 403 — including for requests they raised
 * themselves. A head proposes; only an administrator decides. That is the whole
 * shape of the workflow, and the 403 is rendered as a normal answer rather than
 * treated as a fault.
 *
 * Both queues are keyset-paginated, so the controls are next/previous/page size
 * and there are no page numbers — see `CursorPagination`.
 *
 * Every row shows NAMES, from the identity projection the list endpoints carry
 * (ADR-0001). The UUIDs are still underneath as the references the app uses;
 * they are simply not what a person is asked to read.
 */
export default function ApprovalsPage() {
  const { t } = useLanguage();
  const { state, can } = useSession();
  // ★ THE LAST TWO TABS ARE NOT QUEUES. `roster` answers "who works here" and
  // `drivers` answers "who holds a driver account"; the first two answer "what
  // is waiting for a decision". They share a screen because an administrator
  // does all of it, never because they are the same kind of thing.
  //
  // ★ AND `drivers` IS NOT A FILTER ON `roster`. That list is one row per
  // MEMBERSHIP; a driver has none, so no filter over it could ever produce one.
  // They are two different questions over two different sets of rows.
  const [tab, setTab] = useState<'requests' | 'invitations' | 'roster' | 'drivers'>('requests');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [notice, setNotice] = useState<{ outcome: AddEmployeeOutcome; email: string } | null>(null);
  // Bumped after a create or a request so the head's own queue re-reads and the
  // row appears — without a full reload, which would throw away the session
  // context and the language choice with it.
  const [refresh, setRefresh] = useState(0);

  // ★ TWO DIFFERENT QUESTIONS, AND ONLY ONE OF THEM IS A PERMISSION.
  //
  // Creating an account outright needs `user.write`, which is GLOBAL-only, so
  // `can()` answers it exactly. Raising an invitation is guarded RELATIONALLY —
  // `HeadOfRouteDepartmentGuard` asks "do you lead this unit", and there is no
  // permission key for that, so `can()` cannot answer it at all. The closest the
  // session can say is role plus membership, and it is exact in practice: a head
  // must be an active member of the unit they lead (invariant #6) and may hold
  // only one active membership, so `departmentIds` IS the unit they head.
  //
  // ⚠ STILL ONLY A RENDER HINT (§13). The server re-decides every request and
  // answers 403 regardless of what was drawn here.
  const isGlobal = can('user.write');
  const authorization = state?.status === 'ready' ? state.authorization : null;
  const headDepartmentId =
    authorization?.role === 'DEPARTMENT_HEAD' ? authorization.departmentIds[0] : undefined;
  // A MEMBER matches neither, and so is offered nothing — which is also what
  // every endpoint behind these buttons would tell them.
  const canAddSomeone = isGlobal || headDepartmentId !== undefined;

  /*
    THE SAME TWO TABS FOR EVERYONE, reading whichever endpoint the caller is
    allowed to read. A head has no access to the two GLOBAL queues — those
    answer 403, including for requests they raised themselves — but the
    DEPARTMENT-scoped versions of both are open to them. Pointing a head at
    the global queue would render "not permitted" on the one screen that is
    supposed to show them their own pending request.

    Read top to bottom instead of nested inside one expression. Precedence is
    unchanged: the roster tab still wins over everything, and a caller who is
    not global and leads nothing still falls to the global queue, which is the
    only thing that can answer them.
  */
  let body: ReactNode;
  if (tab === 'roster') {
    body = <EmployeeRoster refresh={refresh} />;
  } else if (tab === 'drivers') {
    body = <DriverAccounts refresh={refresh} />;
  } else if (isGlobal || !headDepartmentId) {
    body = <GlobalQueue tab={tab} />;
  } else {
    body = <DepartmentQueue tab={tab} departmentId={headDepartmentId} refresh={refresh} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t('approvalsTitle')}</h1>
          {!isGlobal && headDepartmentId && (
            <p className="mt-1 text-sm text-gray-500">{t('myDepartmentQueues')}</p>
          )}
        </div>

        {/* ★ ONE BUTTON, AND ITS WORDING IS THE WORKFLOW. A global administrator
            creates the account; a head proposes one. Same dialog, because the
            dialog already knows the difference — see `AddEmployeeModal`. */}
        {canAddSomeone && (
          <Button
            onClick={() => setIsAddOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            <Plus className="h-4 w-4" />
            {isGlobal ? t('addEmployee') : t('requestAccountTitle')}
          </Button>
        )}
      </div>

      {/*
        ★ `<output>`, NOT a div wearing `role="status"`. The element carries that
        role implicitly and is the HTML for exactly this — the result of an
        action the user just took. The ARIA attribute was re-declaring in a
        second place what the tag already says, which is the version that goes
        stale. Assistive technology sees the same polite live region either way;
        `flex` overrides the inline default so the layout is unchanged.
      */}
      {notice && (
        <output className="flex w-full items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50 px-5 py-3 text-sm text-green-800">
          <span>
            {notice.outcome === 'created' ? t('employeeCreated') : t('requestSubmitted')}{' '}
            {/* The address they will sign in with, not the local part that was
                typed — see `onCreated`. */}
            <code className="font-mono">{notice.email}</code>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            {t('dismiss')}
          </Button>
        </output>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {(
            [
              ['requests', t('tabMembershipRequests')],
              ['invitations', t('tabInvitations')],
              // ★ GLOBAL ONLY. `GET /memberships` is authorized without a
              // department, which only a global caller survives — a head asking
              // for it gets 403, so offering them the tab would be a guaranteed
              // refusal. Their roster is their own department's screen.
              //
              // ★ AND SO IS THE DRIVER TAB, for a different reason at the same
              // tier: `GET /driver-accounts` is `user.write`, the key that
              // CREATES an account. A head may propose a driver and see what
              // came of their own proposal; who holds a driver account
              // deployment-wide is account administration.
              ...(isGlobal
                ? ([
                    ['roster', t('tabEmployeeRoster')],
                    ['drivers', t('tabDriverAccounts')],
                  ] as const)
                : []),
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={clsx(
                'px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                tab === id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {body}
      </div>

      <AddEmployeeModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onCreated={(outcome, email) => {
          setNotice({ outcome, email });
          setRefresh((n) => n + 1);
        }}
      />
    </div>
  );
}

/** The decision queues. GLOBAL only — a head gets 403 and it is rendered as one. */
/**
 * THE DEPLOYMENT-WIDE EMPLOYEE ROSTER — every unit, read only.
 *
 * ★ IT IS NOT AN APPROVAL QUEUE, and the difference is the reason it earns its
 * own tab rather than a filter on one of the others. The queues hold things
 * waiting for a decision and offer Approve and Reject; this holds people and
 * offers nothing. Nothing here is decided, edited, disabled or transferred.
 *
 * ★ ONE SERVER-SIDE QUERY, NOT A FAN-OUT. `GET /memberships` is a single keyset
 * page over a join. Listing departments and fetching each unit's members would
 * be N+1, would leave every unit with its own cursor so the merged list could
 * not be ordered or paginated, and would put a scope decision in the browser.
 *
 * ★ THE FILTER IS SERVER-SIDE. `membershipStatus` reaches the query, so "Đã
 * nghỉ việc" reads ended memberships out of the database rather than hiding
 * rows the server already sent — which would page wrongly and lie about counts.
 */
function EmployeeRoster({ refresh }: Readonly<{ refresh: number }>) {
  const { t } = useLanguage();
  // Active first: "who works here now" is the question this screen is usually
  // asked. `undefined` is the "Tất cả" case — no filter rather than a magic value.
  const [status, setStatus] = useState<MembershipStatus | undefined>('active');

  const page = useCursorPages<EmployeeRosterRow>(
    (request) => fetchEmployeeRoster(request, status),
    [status, refresh],
  );

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/50 px-6 py-3">
        <label htmlFor="roster-status" className="text-sm font-medium text-gray-600">
          {t('filterMembershipStatus')}
        </label>
        {/*
          ponytail: a native <select>. Three fixed options, no state of its own,
          and the keyboard and screen-reader behaviour is the platform's.
        */}
        <select
          id="roster-status"
          value={status ?? 'all'}
          onChange={(event) =>
            setStatus(
              event.target.value === 'all' ? undefined : (event.target.value as MembershipStatus),
            )
          }
          className="h-8 rounded-lg border border-input bg-white px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="active">{t('statusActive')}</option>
          <option value="ended">{t('statusInactive')}</option>
          <option value="all">{t('filterAllStatuses')}</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        {/* ★ THE DEPARTMENT COLUMN IS WHAT MAKES THIS THE GLOBAL VIEW. Without
            it the rows would be ambiguous across units. */}
        <EmployeeRosterTable rows={page.items} showDepartment />

        <QueueStates
          loading={page.loading}
          forbidden={page.forbidden}
          error={Boolean(page.error) && !page.forbidden}
          empty={page.items.length === 0}
          emptyKey="emptyRoster"
        />
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
    </>
  );
}

/**
 * THE DRIVER ROSTER — every driver account, and the one control over it.
 *
 * ★ IT EXISTS BECAUSE A DRIVER ACCOUNT WAS INVISIBLE. The tab above reads
 * `GET /memberships`, which is a list of MEMBERSHIPS; a driver has none, by
 * design, so no filter over that list could ever produce one. The only other
 * place a driver appeared was the assignment dropdown — live accounts only, and
 * a different question. Somebody who had just created an account had no screen
 * that could confirm it.
 *
 * ★ THE FILTER IS SERVER-SIDE, like the roster's. `status` reaches the query, so
 * "Đã vô hiệu hóa" reads disabled accounts out of the database rather than
 * hiding rows the server already sent — which would page wrongly and make
 * `hasMore` describe a different list.
 *
 * ★ AND THE ONE ACTION RE-READS RATHER THAN PATCHING THE ROW. Disabling also
 * ends memberships and revokes roles; a client that edited the status field on
 * screen would be showing a half-applied truth. The whole list is fetched again,
 * for the same reason `EmployeeDetailPage` gives.
 */
function DriverAccounts({ refresh }: Readonly<{ refresh: number }>) {
  const { t } = useLanguage();
  // Live accounts first: "who can drive for us now" is what this is usually
  // asked. `undefined` is "Tất cả" — no filter, rather than a magic value.
  const [status, setStatus] = useState<AccountStatus | undefined>('active');
  // Bumped after a disable, so the row's new status comes from the server.
  const [reread, setReread] = useState(0);
  /**
   * Which account is being acted on, and in which direction.
   *
   * ★ ONE PIECE OF STATE, NOT TWO. Two independent `useState`s could both hold a
   * row, and the page would then be asking to disable and enable at once — a
   * state the interface has no way to render and no reason to allow.
   */
  const [acting, setActing] = useState<{
    row: DriverAccountRow;
    action: 'disable' | 'enable';
  } | null>(null);

  const page = useCursorPages<DriverAccountRow>(
    (request) => fetchDriverAccounts(request, status),
    [status, refresh, reread],
  );

  return (
    <>
      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/50 px-6 py-3">
        <label htmlFor="driver-status" className="text-sm font-medium text-gray-600">
          {t('filterAccountStatus')}
        </label>
        <select
          id="driver-status"
          value={status ?? 'all'}
          onChange={(event) =>
            setStatus(
              event.target.value === 'all' ? undefined : (event.target.value as AccountStatus),
            )
          }
          className="h-8 rounded-lg border border-input bg-white px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="active">{t('accountActive')}</option>
          <option value="disabled">{t('accountDisabled')}</option>
          <option value="all">{t('filterAllStatuses')}</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <DriverAccountsTable
          rows={page.items}
          onDisable={(row) => setActing({ row, action: 'disable' })}
          onEnable={(row) => setActing({ row, action: 'enable' })}
        />

        <QueueStates
          loading={page.loading}
          forbidden={page.forbidden}
          error={Boolean(page.error) && !page.forbidden}
          empty={page.items.length === 0}
          emptyKey="emptyDrivers"
        />
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

      <DriverStatusDialog
        acting={acting}
        onClose={() => setActing(null)}
        onChanged={() => setReread((n) => n + 1)}
      />
    </>
  );
}

/**
 * What each direction says and does. Written out once, per action.
 *
 * ★ ONE DIALOG FOR TWO OPERATIONS, BUT NOT ONE MESSAGE. The shell is identical —
 * confirm, in-flight, the server's refusal, re-read — and duplicating it would
 * be ~60 lines whose error path drifts. What must NOT be shared is the copy: a
 * disable and an enable do different things, and a dialog that hedged between
 * them would be the one screen where somebody cannot tell which they clicked.
 *
 * ★ THE `enable` LINES INCLUDE WHAT DOES *NOT* HAPPEN. Sessions revoked at
 * disable stay revoked, and somebody expecting "undo" should read that before
 * they press the button rather than discover it from a support call.
 */
const DRIVER_STATUS_ACTIONS = {
  disable: {
    title: 'disableAccountTitle',
    confirm: 'disableAccountConfirm',
    busy: 'disabling',
    failed: 'disableFailed',
    effects: ['disableEffectLogin', 'disableEffectKeepsData', 'disableEffectAccess'],
    submitClass: 'bg-red-600 text-white hover:bg-red-700',
    run: disableUser,
  },
  enable: {
    title: 'enableAccountTitle',
    confirm: 'enableAccountConfirm',
    busy: 'enabling',
    failed: 'enableFailed',
    effects: ['enableEffectLogin', 'enableEffectDispatch', 'enableEffectNoSessions'],
    submitClass: 'bg-blue-600 text-white hover:bg-blue-700',
    run: enableDriverAccount,
  },
} as const satisfies Record<
  'disable' | 'enable',
  {
    title: TranslationKey;
    confirm: TranslationKey;
    busy: TranslationKey;
    failed: TranslationKey;
    effects: readonly TranslationKey[];
    submitClass: string;
    run: (userId: string) => Promise<void>;
  }
>;

/**
 * Confirming a change of account status, in either direction.
 *
 * ⚠ THE SERVER'S OWN SENTENCE WINS ON A REFUSAL. Enabling is refused for an
 * account that is not a driver and for one that is already active, and both
 * messages say something this screen does not know — replacing them with a
 * generic "could not" would throw away the only useful part.
 */
function DriverStatusDialog({
  acting,
  onClose,
  onChanged,
}: Readonly<{
  acting: { row: DriverAccountRow; action: 'disable' | 'enable' } | null;
  onClose: () => void;
  onChanged: () => void;
}>) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Reset per row AND per direction: reopening must not carry the last error.
  const openFor = acting && `${acting.action}:${acting.row.user.id}`;
  const [shownFor, setShownFor] = useState(openFor);
  if (shownFor !== openFor) {
    setShownFor(openFor);
    setFailure(null);
  }

  // Closed: nothing to draw, and no action to look up. Safe to unmount rather
  // than render a closed `Modal` — its focus trap and body-scroll lock are
  // undone by an effect CLEANUP, which React runs on unmount just the same.
  if (!acting) return null;

  const { row, action } = acting;
  const spec = DRIVER_STATUS_ACTIONS[action];

  const confirm = async () => {
    setBusy(true);
    setFailure(null);

    try {
      await spec.run(row.user.id);
      onChanged();
      onClose();
    } catch (error) {
      setFailure(isApiError(error) ? error.message : t(spec.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(spec.title)}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={spec.submitClass}
          >
            {busy ? t(spec.busy) : t(spec.confirm)}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-600">
        <p className="font-medium text-gray-900">
          {row.username ? `${row.user.displayName} · ${row.username}` : row.user.displayName}
        </p>
        <ul className="list-inside list-disc space-y-1">
          {spec.effects.map((effect) => (
            <li key={effect}>{t(effect)}</li>
          ))}
        </ul>
        {failure && (
          <p role="alert" className="text-sm text-red-600">
            {failure}
          </p>
        )}
      </div>
    </Modal>
  );
}

function GlobalQueue({ tab }: Readonly<{ tab: 'requests' | 'invitations' }>) {
  return tab === 'requests' ? <MembershipRequestQueue /> : <InvitationQueue />;
}

/**
 * What a head sees for their own unit: the same two lists, READ ONLY.
 *
 * No Approve and no Reject, and not because the buttons are hidden — a head
 * cannot decide anything, including their own request. Deciding needs a
 * global-only permission AND the database refuses `decided_by = requested_by`.
 * Drawing the buttons would offer two actions whose only outcome is a 403.
 *
 * These lists are HISTORY, not just what is pending, so the status is a column
 * rather than an assumption.
 */
function DepartmentQueue({
  tab,
  departmentId,
  refresh,
}: Readonly<{ tab: 'requests' | 'invitations'; departmentId: string; refresh: number }>) {
  const { t, language } = useLanguage();

  if (tab === 'requests') {
    return (
      <ReadOnlyQueue<MembershipChangeRequestWithUsers>
        // ★ KEYED BY TAB, AND IT IS NOT COSMETIC. Both branches render the same
        // component type at the same position, so without a key React keeps the
        // instance and only swaps the props — and `useCursorPages` re-reads on
        // its DEPS, which did not change. The second tab drew its own headers
        // over the first tab's rows. Remounting also drops the cursor stack,
        // which is right: a cursor from one list means nothing to the other.
        key="requests"
        read={(page) => fetchDepartmentMembershipRequests(departmentId, page)}
        refresh={refresh}
        headers={[t('colTarget'), t('colAction'), t('colRequestedAt'), t('colStatus')]}
        emptyKey="emptyRequests"
        renderCells={(row) => (
          <>
            <TableCell className="font-medium text-gray-900">{row.targetUser.displayName}</TableCell>
            <TableCell className="text-gray-600">{row.action}</TableCell>
            <TableCell className="text-gray-600">
              {formatDateTime(row.requestedAt, language)}
            </TableCell>
            <TableCell>
              <DecisionStatusBadge status={row.status} />
            </TableCell>
          </>
        )}
      />
    );
  }

  return (
    <ReadOnlyQueue<AccountInvitationWithUser>
      key="invitations"
      read={(page) => fetchDepartmentAccountInvitations(departmentId, page)}
      refresh={refresh}
      headers={[t('colEmail'), t('colRequestedBy'), t('colRequestedAt'), t('colStatus')]}
      emptyKey="emptyInvitations"
      renderCells={(row) => (
        <>
          <TableCell className="font-medium text-gray-900">{row.email}</TableCell>
          <TableCell className="text-gray-600">{row.requestedByUser.displayName}</TableCell>
          <TableCell className="text-gray-600">
            {formatDateTime(row.requestedAt, language)}
          </TableCell>
          <TableCell>
            <DecisionStatusBadge status={row.status} />
          </TableCell>
        </>
      )}
    />
  );
}

/** The three decision states, said in words rather than left as a raw enum. */
function DecisionStatusBadge({ status }: Readonly<{ status: DecisionStatus }>) {
  const { t } = useLanguage();
  const styles: Record<DecisionStatus, string> = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    approved: 'bg-green-50 text-green-700 ring-green-600/20',
    rejected: 'bg-gray-50 text-gray-600 ring-gray-500/10',
  };
  const labels: Record<DecisionStatus, string> = {
    pending: t('statusPending'),
    approved: t('statusApproved'),
    rejected: t('statusRejected'),
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

/**
 * A paged list with no decisions on it.
 *
 * Shares the four states and the cursor controls with `DecisionQueue` and
 * deliberately nothing else — the confirmation step, the two buttons and the
 * refresh-after-decision all exist only because a decision can be made, and a
 * `readOnly` flag threaded through that component would have to disable every
 * one of them at a different point.
 */
function ReadOnlyQueue<T extends { id: string }>({
  read,
  refresh,
  headers,
  renderCells,
  emptyKey,
}: Readonly<{
  read: (page: PageRequest) => Promise<Page<T>>;
  refresh: number;
  headers: string[];
  renderCells: (row: T) => ReactNode;
  emptyKey: EmptyStateKey;
}>) {
  const page = useCursorPages<T>(read, [refresh]);

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-gray-50/50">
            <TableRow>
              {headers.map((heading) => (
                <TableHead key={heading} className="font-semibold text-gray-600">
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              <TableRow key={row.id} className="hover:bg-blue-50/30">
                {renderCells(row)}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <QueueStates
          loading={page.loading}
          forbidden={page.forbidden}
          error={Boolean(page.error) && !page.forbidden}
          empty={page.items.length === 0}
          emptyKey={emptyKey}
        />
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
    </>
  );
}

/** Shared shell: the states every queue has to be able to say. */
function QueueStates({
  loading,
  forbidden,
  error,
  empty,
  emptyKey,
}: Readonly<{
  loading: boolean;
  forbidden: boolean;
  error: boolean;
  empty: boolean;
  emptyKey: EmptyStateKey;
}>) {
  const { t } = useLanguage();

  if (loading) return null;
  if (forbidden) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
        <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
      </div>
    );
  }
  if (error) {
    return <p className="px-6 py-10 text-center text-sm text-red-600">{t('loadFailed')}</p>;
  }
  if (empty) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t(emptyKey)}</p>;
  }
  return null;
}

/**
 * The parts of a decision queue that are the same whatever is being decided.
 *
 * Both queues are a table of pending things, two buttons per row, a confirmation
 * step, the same four states (loading, forbidden, error, empty) and the same
 * cursor controls. Written out twice, that was ~150 duplicated lines — and the
 * real cost is not the lines: two copies drift, and the one that drifts is
 * usually the error path nobody looks at.
 *
 * What stays OUT of here is everything that differs per queue: the endpoint, the
 * row type, the columns, the cell mapping, and what approving actually does.
 * Those arrive as a handful of props rather than as flags, so this component
 * never has to know which queue it is drawing.
 */
interface DecisionQueueProps<T> {
  /** The endpoint. Paged by the shared cursor hook. */
  read: (page: PageRequest) => Promise<Page<T>>;
  /** Column headings, already translated. The actions column is added here. */
  headers: string[];
  /** The leading cells for one row — everything except the actions column. */
  renderCells: (row: T) => ReactNode;
  emptyKey: EmptyStateKey;
  onApprove: (row: T) => Promise<void>;
  onReject: (row: T, reason?: string) => Promise<void>;
}

function DecisionQueue<T extends { id: string }>({
  read,
  headers,
  renderCells,
  emptyKey,
  onApprove,
  onReject,
}: Readonly<DecisionQueueProps<T>>) {
  const { t } = useLanguage();
  // Bumped after a decision so the queue re-reads: the row just acted on is no
  // longer pending, and leaving it on screen would invite a second click.
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<{ row: T; decision: 'approve' | 'reject' } | null>(null);

  const page = useCursorPages<T>(read, [refresh]);

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-gray-50/50">
            <TableRow>
              {headers.map((heading) => (
                <TableHead key={heading} className="font-semibold text-gray-600">
                  {heading}
                </TableHead>
              ))}
              <TableHead className="text-right font-semibold text-gray-600 pr-6">
                {t('colActions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              <TableRow key={row.id} className="hover:bg-blue-50/30">
                {renderCells(row)}
                <TableCell className="text-right pr-4">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 h-8"
                      onClick={() => setPending({ row, decision: 'approve' })}
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-red-600 border-gray-200 hover:bg-red-50"
                      onClick={() => setPending({ row, decision: 'reject' })}
                    >
                      {t('reject')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <QueueStates
          loading={page.loading}
          forbidden={page.forbidden}
          error={Boolean(page.error) && !page.forbidden}
          empty={page.items.length === 0}
          emptyKey={emptyKey}
        />
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

      <ConfirmDecision
        open={pending !== null}
        decision={pending?.decision ?? 'approve'}
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          if (pending.decision === 'approve') {
            await onApprove(pending.row);
          } else {
            await onReject(pending.row, reason);
          }
          setPending(null);
          setRefresh((n) => n + 1);
        }}
      />
    </>
  );
}

function MembershipRequestQueue() {
  const { t, language } = useLanguage();

  return (
    <DecisionQueue<MembershipChangeRequestWithUsers>
      read={fetchPendingMembershipRequests}
      headers={[t('colTarget'), t('colRequestedBy'), t('colAction'), t('colRequestedAt')]}
      emptyKey="emptyRequests"
      renderCells={(row) => (
        <>
          {/* Names, not UUIDs — projected by the server inside the same
              authorized read. */}
          <TableCell className="font-medium text-gray-900">{row.targetUser.displayName}</TableCell>
          <TableCell className="text-gray-600">{row.requestedByUser.displayName}</TableCell>
          <TableCell className="text-gray-600">{row.action}</TableCell>
          <TableCell className="text-gray-600">{formatDateTime(row.requestedAt, language)}</TableCell>
        </>
      )}
      onApprove={async (row) => {
        await approveMembershipRequest(row.id);
      }}
      onReject={async (row, reason) => {
        await rejectMembershipRequest(row.id, reason);
      }}
    />
  );
}

function InvitationQueue() {
  const { t, language } = useLanguage();
  // Held HERE rather than in the shell: only this queue produces a credential,
  // and the shell has no business knowing that approving can return a secret.
  const [approved, setApproved] = useState<ApprovedInvitation | null>(null);

  return (
    <>
      <DecisionQueue<AccountInvitationWithUser>
        read={fetchPendingAccountInvitations}
        headers={[t('colEmail'), t('colRequestedBy'), t('colRequestedAt')]}
        emptyKey="emptyInvitations"
        renderCells={(row) => (
          <>
            {/* The invited ADDRESS. It is the subject of the invitation, not a
                display name — there is no user behind it yet. */}
            <TableCell className="font-medium text-gray-900">{row.email}</TableCell>
            <TableCell className="text-gray-600">{row.requestedByUser.displayName}</TableCell>
            <TableCell className="text-gray-600">{formatDateTime(row.requestedAt, language)}</TableCell>
          </>
        )}
        onApprove={async (row) => {
          // Approving CREATES the account, and the response is the only place
          // the temporary password will ever appear.
          setApproved(await approveAccountInvitation(row.id));
        }}
        onReject={async (row, reason) => {
          await rejectAccountInvitation(row.id, reason);
        }}
      />

      <TemporaryPasswordDialog result={approved} onClose={() => setApproved(null)} />
    </>
  );
}

function ConfirmDecision({
  open,
  decision,
  onClose,
  onConfirm,
}: Readonly<{
  open: boolean;
  decision: 'approve' | 'reject';
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}>) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim() || undefined);
      setReason('');
    } catch (error_) {
      // 409 here is the ordinary race: somebody else decided it first. The
      // server's own words say so better than a guess would.
      setError(isApiError(error_) ? error_.message : t('loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={decision === 'approve' ? t('confirmApproveTitle') : t('confirmRejectTitle')}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            onClick={confirm}
            disabled={busy}
            className={
              decision === 'approve' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'
            }
          >
            {decision === 'approve' ? t('approve') : t('reject')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {decision === 'approve' ? t('confirmApproveBody') : t('confirmRejectBody')}
        </p>

        {decision === 'reject' && (
          <div className="space-y-2">
            <label htmlFor="decision-reason" className="text-sm font-medium text-gray-700">
              {`${t('reasonLabel')} (${t('reasonOptional')})`}
            </label>
            <input
              id="decision-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * The one-time secret.
 *
 * ⚠ THIS VALUE CANNOT BE READ BACK. There is no email adapter in this
 * deployment, so this dialog is the only channel that will ever carry it to the
 * person it belongs to. It is never stored in plaintext, never logged, and no
 * endpoint can produce it again — which is why the dialog says so plainly
 * rather than letting somebody close it assuming they can look it up later.
 */
function TemporaryPasswordDialog({
  result,
  onClose,
}: Readonly<{ result: ApprovedInvitation | null; onClose: () => void }>) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  // ★ RESET WHEN THE CREDENTIAL CHANGES. Without this, approving a second
  // invitation opens a dialog already reading "Copied" — for a value nobody has
  // copied. On a secret that cannot be recovered, that is the worst possible
  // thing to be wrong about.
  const shownFor = useRef<string | null>(null);
  if (result && shownFor.current !== result.temporaryPassword) {
    shownFor.current = result.temporaryPassword;
    if (copied) setCopied(false);
    if (copyFailed) setCopyFailed(false);
  }
  if (!result) {
    if (shownFor.current !== null) shownFor.current = null;
  }

  if (!result) return null;

  const copy = async () => {
    // `navigator.clipboard` is absent outside a secure context, and `writeText`
    // rejects when permission is refused. Either way the value is NOT on the
    // clipboard, and saying "Copied" would send somebody away believing they
    // have a credential they cannot get back.
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('temporaryPasswordTitle')}
      footer={
        <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700">
          {t('done')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('temporaryPasswordBody')}</p>

        {/*
          ★ THE FULL ADDRESS, NOT THE LOCAL PART. This used to read
          "Tên đăng nhập: nuna", and `nuna` is not what anybody signs in with —
          `POST /auth/login` takes the whole address as `subject`. An approver
          reading that label out loud sent people to a login that could only
          fail. `result.username` is the DISPLAY projection and is still in the
          response; it just has no business on the one screen whose entire job
          is handing over working credentials.
        */}
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500">{t('loginEmailLabel')}</span>
          <p className="font-mono text-sm text-gray-900">{result.invitation.email}</p>
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500">{t('temporaryPasswordTitle')}</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-gray-100 px-3 py-2 font-mono text-sm text-gray-900 break-all">
              {result.temporaryPassword}
            </code>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
          {copyFailed && (
            <p role="alert" className="text-sm text-red-600">
              {t('copyFailed')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
