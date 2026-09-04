import { useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableCell } from '@/components/ui/table';
import { CursorPagination } from '@/components/ui/pagination';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDateTime } from '@/utils/format/datetime';
import { useCursorPages } from '@/hooks/useCursorPages';
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
import type { AccountInvitationWithUser, MembershipChangeRequestWithUsers } from '@/types/approval';
import type { EmployeeRosterRow, MembershipStatus } from '@/types/organization';
import { fetchEmployeeRoster } from '@/api/membership';
import { EmployeeRosterTable } from '@/components/common/EmployeeRosterTable';
import {
  DecisionQueue,
  DecisionStatusBadge,
  QueueStates,
  ReadOnlyQueue,
} from '@/components/common/DecisionQueue';
import { PageHeader } from '@/components/common/PageHeader';
import { SuccessNotice } from '@/components/common/SuccessNotice';
import { TemporaryPasswordDialog } from '@/components/common/TemporaryPasswordDialog';

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
  // ★ THE THIRD TAB IS NOT A THIRD QUEUE. `roster` answers "who works here";
  // the other two answer "what is waiting for a decision". They share a screen
  // because an administrator does both, never because they are the same thing.
  const [tab, setTab] = useState<'requests' | 'invitations' | 'roster'>('requests');
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
  } else if (isGlobal || !headDepartmentId) {
    body = <GlobalQueue tab={tab} />;
  } else {
    body = <DepartmentQueue tab={tab} departmentId={headDepartmentId} refresh={refresh} />;
  }

  return (
    <div className="space-y-6">
      {/* ★ ONE BUTTON, AND ITS WORDING IS THE WORKFLOW. A global administrator
          creates the account; a head proposes one. Same dialog, because the
          dialog already knows the difference — see `AddEmployeeModal`. */}
      <PageHeader
        title={t('approvalsTitle')}
        subtitle={!isGlobal && headDepartmentId ? t('myDepartmentQueues') : undefined}
        actions={
          canAddSomeone ? (
            <Button
              onClick={() => setIsAddOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
            >
              <Plus className="h-4 w-4" />
              {isGlobal ? t('addEmployee') : t('requestAccountTitle')}
            </Button>
          ) : null
        }
      />

      {notice && (
        <SuccessNotice onDismiss={() => setNotice(null)}>
          {notice.outcome === 'created' ? t('employeeCreated') : t('requestSubmitted')}{' '}
          {/* The address they will sign in with, not the local part that was
              typed — see `onCreated`. */}
          <code className="font-mono">{notice.email}</code>
        </SuccessNotice>
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
              ...(isGlobal ? ([['roster', t('tabEmployeeRoster')]] as const) : []),
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

      <TemporaryPasswordDialog
        credential={
          approved
            ? { email: approved.invitation.email, temporaryPassword: approved.temporaryPassword }
            : null
        }
        onClose={() => setApproved(null)}
      />
    </>
  );
}
