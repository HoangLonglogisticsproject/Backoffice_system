import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
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
import {
  fetchDriver,
  fetchDrivers,
  setDriverStatus,
  type DriverAccount,
  type DriverAccountStatus,
} from '@/api/driverAccounts';
import { formatDateTime } from '@/utils/format/datetime';
import { isApiError } from '@/utils/errors';
import { AddEmployeeModal } from '@/pages/organization/components/AddEmployeeModal';
import { PageHeader } from '@/components/common/PageHeader';
import { SuccessNotice } from '@/components/common/SuccessNotice';
import { StatusPill } from '@/components/common/StatusPill';
import { QueueStates, ROW_ACTION } from '@/components/common/DecisionQueue';

/**
 * Driver Management — the accounts, not the trips.
 *
 * ★ ACCOUNT ADMINISTRATION ONLY. This screen creates driver accounts, shows
 * what an account is, and turns it off and on. It does not put anybody on a
 * trip and does not take anybody off one: that is dispatch, done on the trip
 * board by the people who dispatch. Disabling here changes ONE thing — whether
 * the person can sign in — and the confirmation says so in as many words.
 *
 * ★ THE SAME SCREEN THE REST OF THE BACKOFFICE IS MADE OF. The header card,
 * the white table card, the status pill, the row actions and the "created"
 * notice are the approvals screen's; the create dialog is the one the
 * approvals screen opens, started on "driver". Nothing here is drawn twice.
 *
 * ★ GLOBAL ONLY. Every route behind this page is `user.write`, the
 * deployment-wide key, and the sidebar draws the entry for that key alone.
 */
export const DRIVERS_QUERY_KEY = ['driver-accounts'] as const;

function DriverStatusPill({ status }: Readonly<{ status: DriverAccountStatus }>) {
  const { t } = useLanguage();
  return status === 'active' ? (
    <StatusPill tone="green">{t('driverStatusActive')}</StatusPill>
  ) : (
    <StatusPill tone="gray">{t('driverStatusDisabled')}</StatusPill>
  );
}

export default function DriverManagementPage() {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const queryClient = useQueryClient();

  // ★ THE SERVER DECIDES; THIS ONLY AVOIDS DRAWING — OR ASKING FOR — A SCREEN
  // IT WOULD REFUSE. The read is not even attempted for a caller without the key.
  const allowed = can('user.write');
  const drivers = useQuery({ queryKey: DRIVERS_QUERY_KEY, queryFn: fetchDrivers, enabled: allowed });

  const [creating, setCreating] = useState(false);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [detailOf, setDetailOf] = useState<string | null>(null);
  /** The status change awaiting confirmation. */
  const [changing, setChanging] = useState<{ driver: DriverAccount; to: DriverAccountStatus } | null>(null);

  if (!allowed) return <Navigate to="/403" replace />;

  const reload = () => queryClient.invalidateQueries({ queryKey: DRIVERS_QUERY_KEY });
  const rows = drivers.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('driverManagement')}
        subtitle={t('driverManagementIntro')}
        actions={
          <div className="flex gap-2">
            <Link to="/organization/driver-requests">
              <Button variant="outline" className="gap-2">
                <ClipboardList className="h-4 w-4" />
                {t('driverRequestQueue')}
              </Button>
            </Link>
            <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
              <Plus className="h-4 w-4" />
              {t('addDriver')}
            </Button>
          </div>
        }
      />

      {createdEmail && (
        <SuccessNotice onDismiss={() => setCreatedEmail(null)}>
          {t('driverCreated')} <code className="font-mono">{createdEmail}</code>
        </SuccessNotice>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="w-[50px] text-center font-semibold text-gray-600">{t('colIndex')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colDriver')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colUsername')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colCreatedAt')}</TableHead>
                <TableHead className="text-right font-semibold text-gray-600 pr-6">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((driver, index) => (
                <TableRow key={driver.id} className="hover:bg-blue-50/30">
                  <TableCell className="text-center text-gray-500 font-medium">{index + 1}</TableCell>
                  <TableCell className="font-medium text-gray-900">{driver.displayName}</TableCell>
                  <TableCell className="text-gray-600">{driver.username ?? '—'}</TableCell>
                  <TableCell>
                    <DriverStatusPill status={driver.status} />
                  </TableCell>
                  <TableCell className="text-gray-600">{formatDateTime(driver.createdAt, language)}</TableCell>
                  <TableCell className="text-right pr-4">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" className={ROW_ACTION.neutral} onClick={() => setDetailOf(driver.id)}>
                        {t('viewDetail')}
                      </Button>
                      <StatusButton driver={driver} onChoose={(to) => setChanging({ driver, to })} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <QueueStates
            loading={drivers.isPending}
            showLoading
            forbidden={false}
            error={drivers.isError}
            empty={rows.length === 0}
            emptyKey="driverListEmpty"
            onRetry={() => void drivers.refetch()}
          />
        </div>
      </div>

      {/* ★ THE SAME DIALOG THE APPROVALS SCREEN OPENS, started on "driver". It
          already knows that a driver has no department and calls the existing
          create endpoint; the notice above is the approvals screen's too. */}
      <AddEmployeeModal
        isOpen={creating}
        initialAccountType="driver"
        onClose={() => setCreating(false)}
        onCreated={(_outcome, email) => {
          setCreatedEmail(email);
          void reload();
        }}
      />

      {detailOf ? (
        <DriverDetailModal
          driverId={detailOf}
          onClose={() => setDetailOf(null)}
          onChangeStatus={(driver, to) => setChanging({ driver, to })}
        />
      ) : null}

      {changing ? (
        <StatusConfirmModal
          driver={changing.driver}
          to={changing.to}
          onClose={() => setChanging(null)}
          onChanged={async () => {
            setChanging(null);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** "Vô hiệu hóa" on an active account, "Kích hoạt lại" on a disabled one — the queue's two row actions. */
function StatusButton({
  driver,
  onChoose,
}: Readonly<{ driver: DriverAccount; onChoose: (to: DriverAccountStatus) => void }>) {
  const { t } = useLanguage();
  return driver.status === 'active' ? (
    <Button size="sm" variant="outline" className={ROW_ACTION.danger} onClick={() => onChoose('disabled')}>
      {t('disableDriver')}
    </Button>
  ) : (
    <Button size="sm" className={ROW_ACTION.primary} onClick={() => onChoose('active')}>
      {t('enableDriver')}
    </Button>
  );
}

/**
 * One driver, read afresh from the server so the panel shows what IS, not
 * what the list held a minute ago. Six fields; there is nothing else to show.
 */
function DriverDetailModal({
  driverId,
  onClose,
  onChangeStatus,
}: Readonly<{
  driverId: string;
  onClose: () => void;
  onChangeStatus: (driver: DriverAccount, to: DriverAccountStatus) => void;
}>) {
  const { t, language } = useLanguage();
  const driver = useQuery({
    queryKey: [...DRIVERS_QUERY_KEY, driverId],
    queryFn: () => fetchDriver(driverId),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('driverDetail')}
      footer={
        <>
          {driver.data ? (
            <StatusButton driver={driver.data} onChoose={(to) => onChangeStatus(driver.data, to)} />
          ) : null}
          <Button variant="outline" type="button" onClick={onClose}>
            {t('close')}
          </Button>
        </>
      }
    >
      {driver.isPending ? <p className="text-sm text-gray-500">{t('loading')}</p> : null}
      {driver.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {t('loadFailed')}
        </p>
      ) : null}
      {driver.data ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">{t('colDriver')}</dt>
          <dd className="font-medium text-gray-900">{driver.data.displayName}</dd>
          <dt className="text-gray-500">{t('colUsername')}</dt>
          <dd className="font-mono text-gray-900">{driver.data.username ?? '—'}</dd>
          <dt className="text-gray-500">{t('colAccountType')}</dt>
          <dd className="text-gray-900">{t('accountTypeDriver')}</dd>
          <dt className="text-gray-500">{t('colStatus')}</dt>
          <dd>
            <DriverStatusPill status={driver.data.status} />
          </dd>
          <dt className="text-gray-500">{t('colCreatedAt')}</dt>
          <dd className="text-gray-900">{formatDateTime(driver.data.createdAt, language)}</dd>
        </dl>
      ) : null}
    </Modal>
  );
}

/**
 * The explicit second act, in both directions — the employee detail screen's
 * disable dialog, with the driver's own sentences.
 *
 * ★ THE DISABLE WARNING IS THE POINT OF THIS DIALOG. It says what happens
 * (no sign-in) and — louder — what does NOT happen: the driver's current and
 * future trip assignments stay exactly as they are, and a trip that still
 * needs somebody is re-assigned by Operations through the assignment flow.
 * The server does the same: one status column, no assignment touched.
 */
function StatusConfirmModal({
  driver,
  to,
  onClose,
  onChanged,
}: Readonly<{
  driver: DriverAccount;
  to: DriverAccountStatus;
  onClose: () => void;
  onChanged: () => Promise<void>;
}>) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabling = to === 'disabled';
  const confirmLabel = t(disabling ? 'disableDriverConfirm' : 'enableDriverConfirm');

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setDriverStatus(driver.id, to);
      await onChanged();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(disabling ? 'disableDriverTitle' : 'enableDriverTitle')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={disabling ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}
          >
            {busy ? t('saving') : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">{driver.displayName}</p>
        {disabling ? (
          <>
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              {t('disableDriverWarning')}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t('disableDriverEffectLogin')}</li>
              <li>{t('disableDriverEffectAssignments')}</li>
              <li>{t('disableDriverEffectHistory')}</li>
            </ul>
          </>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            <li>{t('enableDriverEffectLogin')}</li>
            <li>{t('enableDriverEffectNoAssignment')}</li>
          </ul>
        )}
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
