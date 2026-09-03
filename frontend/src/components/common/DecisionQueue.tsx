import { useState } from 'react';
import type { ReactNode } from 'react';
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
import { useCursorPages, type CursorPages } from '@/hooks/useCursorPages';
import { isApiError } from '@/utils/errors';
import type { Page, PageRequest } from '@/types/pagination';
import type { DecisionStatus } from '@/types/approval';
import { StatusPill } from './StatusPill';

/**
 * The request / approval workflow's shared shell — the table of things
 * waiting for a decision, the two buttons per row, the confirmation step,
 * the four states (loading, forbidden, error, empty) and the cursor controls.
 *
 * Lifted out of the approvals screen so that every queue in the Backoffice
 * — membership requests, account invitations, driver account requests — is
 * the same table with the same buttons, rather than three near copies that
 * drift. What stays OUT is everything that differs per queue: the endpoint,
 * the row type, the columns, the cell mapping, and what approving does.
 */

/** Which "nothing here" sentence a list shows when it comes back empty. */
export type EmptyStateKey =
  | 'emptyRequests'
  | 'emptyInvitations'
  | 'emptyRoster'
  | 'driverRequestQueueEmpty'
  | 'driverRequestMineEmpty'
  | 'driverListEmpty';

/**
 * An endpoint that returns the whole list at once, as ONE page. For queues
 * bounded by a fleet or a pending count, where the server does not paginate
 * and the shell should not pretend it does.
 */
export const singlePage = <T,>(items: T[]): Page<T> => ({ items, nextCursor: null, hasMore: false });

/** The row-level action buttons, as the approvals screen draws them. */
export const ROW_ACTION = {
  primary: 'bg-blue-600 hover:bg-blue-700 h-8',
  danger: 'h-8 text-red-600 border-gray-200 hover:bg-red-50',
  neutral: 'h-8',
} as const;

/** The three decision states, said in words rather than left as a raw enum. */
export function DecisionStatusBadge({ status }: Readonly<{ status: DecisionStatus }>) {
  const { t } = useLanguage();
  const tone = { pending: 'amber', approved: 'green', rejected: 'gray' } as const;
  const label = { pending: t('statusPending'), approved: t('statusApproved'), rejected: t('statusRejected') };
  return <StatusPill tone={tone[status]}>{label[status]}</StatusPill>;
}

/** Shared shell: the states every list has to be able to say. */
export function QueueStates({
  loading,
  forbidden,
  error,
  empty,
  emptyKey,
  showLoading = false,
  onRetry,
}: Readonly<{
  loading: boolean;
  forbidden: boolean;
  error: boolean;
  empty: boolean;
  emptyKey: EmptyStateKey;
  /** Say "loading" in the body. Off where the pagination bar already says it. */
  showLoading?: boolean;
  /** Offer a retry under the failure, for lists with no pagination bar to retry from. */
  onRetry?: () => void;
}>) {
  const { t } = useLanguage();

  if (loading) {
    return showLoading ? <p className="px-6 py-10 text-center text-sm text-gray-500">{t('loading')}</p> : null;
  }
  if (forbidden) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
        <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 text-center">
        <p role="alert" className="text-sm text-red-600">
          {t('loadFailed')}
        </p>
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-3 h-8" onClick={onRetry}>
            {t('retry')}
          </Button>
        ) : null}
      </div>
    );
  }
  if (empty) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t(emptyKey)}</p>;
  }
  return null;
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
export function ReadOnlyQueue<T extends { id: string }>({
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
  return <QueueTable page={page} headers={headers} renderCells={renderCells} emptyKey={emptyKey} />;
}

/**
 * The table itself, with its four states and its cursor controls — what a
 * read-only list and a decision queue have in common, which is everything
 * except the trailing actions column. That column arrives as a heading and
 * a cell renderer, so the shell never has to know what the actions are.
 */
function QueueTable<T extends { id: string }>({
  page,
  headers,
  renderCells,
  emptyKey,
  actions,
}: Readonly<{
  page: CursorPages<T>;
  headers: string[];
  renderCells: (row: T) => ReactNode;
  emptyKey: EmptyStateKey;
  actions?: { header: string; render: (row: T) => ReactNode };
}>) {
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
              {actions ? (
                <TableHead className="text-right font-semibold text-gray-600 pr-6">{actions.header}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              <TableRow key={row.id} className="hover:bg-blue-50/30">
                {renderCells(row)}
                {actions ? <TableCell className="text-right pr-4">{actions.render(row)}</TableCell> : null}
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
  /**
   * A rejection must carry a reason. Where the server refuses a blank one —
   * a driver request keeps its reason by a CHECK constraint — the dialog
   * says so and does not offer the round trip.
   */
  reasonRequired?: boolean;
}

/**
 * The parts of a decision queue that are the same whatever is being decided.
 */
export function DecisionQueue<T extends { id: string }>({
  read,
  headers,
  renderCells,
  emptyKey,
  onApprove,
  onReject,
  reasonRequired = false,
}: Readonly<DecisionQueueProps<T>>) {
  const { t } = useLanguage();
  // Bumped after a decision so the queue re-reads: the row just acted on is no
  // longer pending, and leaving it on screen would invite a second click.
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<{ row: T; decision: 'approve' | 'reject' } | null>(null);

  const page = useCursorPages<T>(read, [refresh]);

  return (
    <>
      <QueueTable
        page={page}
        headers={headers}
        renderCells={renderCells}
        emptyKey={emptyKey}
        actions={{
          header: t('colActions'),
          render: (row) => (
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" className={ROW_ACTION.primary} onClick={() => setPending({ row, decision: 'approve' })}>
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={ROW_ACTION.danger}
                onClick={() => setPending({ row, decision: 'reject' })}
              >
                {t('reject')}
              </Button>
            </div>
          ),
        }}
      />

      <ConfirmDecision
        open={pending !== null}
        decision={pending?.decision ?? 'approve'}
        reasonRequired={reasonRequired}
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

export function ConfirmDecision({
  open,
  decision,
  reasonRequired = false,
  onClose,
  onConfirm,
}: Readonly<{
  open: boolean;
  decision: 'approve' | 'reject';
  reasonRequired?: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}>) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rejecting = decision === 'reject';
  const reasonMissing = rejecting && reasonRequired && reason.trim() === '';
  const reasonSuffix = reasonRequired ? ' *' : ` (${t('reasonOptional')})`;

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (reasonMissing) return;
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
      title={rejecting ? t('confirmRejectTitle') : t('confirmApproveTitle')}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            onClick={confirm}
            disabled={busy || reasonMissing}
            className={rejecting ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
          >
            {rejecting ? t('reject') : t('approve')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {rejecting ? t('confirmRejectBody') : t('confirmApproveBody')}
        </p>

        {rejecting && (
          <div className="space-y-2">
            <label htmlFor="decision-reason" className="text-sm font-medium text-gray-700">
              {`${t('reasonLabel')}${reasonSuffix}`}
            </label>
            <input
              id="decision-reason"
              value={reason}
              required={reasonRequired}
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
