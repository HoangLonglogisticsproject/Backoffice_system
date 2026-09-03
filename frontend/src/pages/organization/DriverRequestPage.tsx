import { useState } from 'react';
import { TableCell } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { formatDateTime } from '@/utils/format/datetime';
import {
  approveDriverRequest,
  fetchMyDriverRequests,
  fetchPendingDriverRequests,
  rejectDriverRequest,
  type DriverAccountRequestWithUsers,
} from '@/api/driverAccounts';
import {
  DecisionQueue,
  DecisionStatusBadge,
  ReadOnlyQueue,
  singlePage,
} from '@/components/common/DecisionQueue';
import { PageHeader } from '@/components/common/PageHeader';
import {
  TemporaryPasswordDialog,
  type HandedOverCredential,
} from '@/components/common/TemporaryPasswordDialog';

/**
 * Driver account requests — the queue, and the decision.
 *
 * ★ THE SAME SHELL AS EVERY OTHER QUEUE. A driver request is one more thing
 * waiting for a global decision, so it is drawn by the same `DecisionQueue`
 * the membership requests and account invitations use: same table, same two
 * buttons, same confirmation, same one-time credential dialog. A head sees
 * their own proposals through the same `ReadOnlyQueue` a head sees their
 * department's invitations through — history, with the status as a column.
 *
 * ★ ONE PAGE, TWO AUDIENCES, AND THE DIFFERENCE IS NOT COSMETIC. A global
 * administrator sees everything still waiting and can decide it. A head sees
 * only what THEY proposed and can decide nothing — including their own, which
 * the server refuses outright. Which list is fetched follows from what the
 * caller holds; the server enforces both.
 */
export default function DriverRequestPage() {
  const { t } = useLanguage();
  const { can } = useSession();
  const mayDecide = can('user.write');

  return (
    <div className="space-y-6">
      <PageHeader title={mayDecide ? t('driverRequestQueue') : t('driverRequestMine')} />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {mayDecide ? <PendingDriverRequests /> : <MyDriverRequests />}
      </div>
    </div>
  );
}

/** The reviewer's queue. Approving creates the account and hands over its credential once. */
function PendingDriverRequests() {
  const { t, language } = useLanguage();
  // Held HERE rather than in the shell: only approving produces a credential,
  // and the shell has no business knowing that approving can return a secret.
  const [credential, setCredential] = useState<HandedOverCredential | null>(null);

  return (
    <>
      <DecisionQueue<DriverAccountRequestWithUsers>
        // ★ THE ENDPOINT RETURNS THE WHOLE PENDING LIST; it is one page.
        read={async () => singlePage(await fetchPendingDriverRequests())}
        headers={[t('colDriver'), t('colEmail'), t('colRequestedBy'), t('colRequestedAt')]}
        emptyKey="driverRequestQueueEmpty"
        // ★ A blank reason is unsendable: the server refuses it with a CHECK
        // the row cannot exist without, so the dialog does not offer the trip.
        reasonRequired
        renderCells={(row) => (
          <>
            <TableCell className="font-medium text-gray-900">{row.displayName}</TableCell>
            <TableCell className="text-gray-600">{row.email}</TableCell>
            <TableCell className="text-gray-600">{row.requester.displayName}</TableCell>
            <TableCell className="text-gray-600">{formatDateTime(row.requestedAt, language)}</TableCell>
          </>
        )}
        onApprove={async (row) => {
          // Approving CREATES the account, and the response is the only place
          // the temporary password will ever appear.
          const { driver } = await approveDriverRequest(row.id);
          if (driver.temporaryPassword) {
            setCredential({ email: row.email, temporaryPassword: driver.temporaryPassword });
          }
        }}
        onReject={async (row, reason) => {
          await rejectDriverRequest(row.id, reason ?? '');
        }}
      />

      <TemporaryPasswordDialog credential={credential} onClose={() => setCredential(null)} />
    </>
  );
}

/**
 * What this head proposed, and what came of it — including the rejection
 * reason, which is the only thing that tells them what to fix.
 */
function MyDriverRequests() {
  const { t, language } = useLanguage();

  return (
    <ReadOnlyQueue<DriverAccountRequestWithUsers>
      read={async () => singlePage(await fetchMyDriverRequests())}
      refresh={0}
      headers={[
        t('colDriver'),
        t('colEmail'),
        t('colRequestedAt'),
        t('colStatus'),
        t('driverRequestDecidedBy'),
        t('driverRequestRejectReason'),
      ]}
      emptyKey="driverRequestQueueEmpty"
      renderCells={(row) => (
        <>
          <TableCell className="font-medium text-gray-900">{row.displayName}</TableCell>
          <TableCell className="text-gray-600">{row.email}</TableCell>
          <TableCell className="text-gray-600">{formatDateTime(row.requestedAt, language)}</TableCell>
          <TableCell>
            <DecisionStatusBadge status={row.status} />
          </TableCell>
          <TableCell className="text-gray-600">{row.decider?.displayName ?? '—'}</TableCell>
          <TableCell className="text-gray-600">{row.decisionReason ?? '—'}</TableCell>
        </>
      )}
    />
  );
}
