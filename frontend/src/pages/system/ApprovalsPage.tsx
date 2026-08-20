import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
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
import { formatDateTime } from '@/lib/format/datetime';
import { useCursorPages } from '@/lib/api/useCursorPages';
import type { Page, PageRequest } from '@/lib/type/pagination';
import {
  approveMembershipRequest,
  fetchPendingMembershipRequests,
  rejectMembershipRequest,
} from '@/lib/api/membership-request.repository';
import {
  approveAccountInvitation,
  fetchPendingAccountInvitations,
  rejectAccountInvitation,
  type ApprovedInvitation,
} from '@/lib/api/account-invitation.repository';
import { isApiError } from '@/lib/http/apiError';
import type { AccountInvitationWithUser, MembershipChangeRequestWithUsers } from '@/lib/type/approval';

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
  const [tab, setTab] = useState<'requests' | 'invitations'>('requests');

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">{t('approvalsTitle')}</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {(
            [
              ['requests', t('tabMembershipRequests')],
              ['invitations', t('tabInvitations')],
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

        {tab === 'requests' ? <MembershipRequestQueue /> : <InvitationQueue />}
      </div>
    </div>
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
  emptyKey: 'emptyRequests' | 'emptyInvitations';
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
  emptyKey: 'emptyRequests' | 'emptyInvitations';
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

        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-500">{t('usernameLabel')}</span>
          <p className="font-mono text-sm text-gray-900">{result.username}</p>
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
