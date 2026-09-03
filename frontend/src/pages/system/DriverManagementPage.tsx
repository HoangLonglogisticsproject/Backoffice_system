import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  createDriver,
  fetchDriver,
  fetchDrivers,
  setDriverStatus,
  type DriverAccount,
  type DriverAccountStatus,
  type ProvisionedDriver,
} from '@/api/driverAccounts';
import { formatDateTime } from '@/utils/format/datetime';
import { isApiError } from '@/utils/errors';

/**
 * Driver Management — the accounts, not the trips.
 *
 * ★ ACCOUNT ADMINISTRATION ONLY. This screen creates driver accounts, shows
 * what an account is, and turns it off and on. It does not put anybody on a
 * trip and does not take anybody off one: that is dispatch, done on the trip
 * board by the people who dispatch. Disabling here changes ONE thing — whether
 * the person can sign in — and the confirmation says so in as many words.
 *
 * ★ GLOBAL ONLY. Every route behind this page is `user.write`, the
 * deployment-wide key, and the sidebar draws the entry for that key alone.
 * A head proposes a driver through the request queue; they do not manage one.
 *
 * ★ WHAT IS SHOWN IS ALL THERE IS. Six fields come from the server and six are
 * shown. No password ever reaches this screen after creation, and the one the
 * administrator typed is not echoed back.
 */
export const DRIVERS_QUERY_KEY = ['driver-accounts'] as const;

const STATUS_VARIANT: Record<DriverAccountStatus, 'default' | 'destructive'> = {
  active: 'default',
  disabled: 'destructive',
};
const STATUS_LABEL = { active: 'driverStatusActive', disabled: 'driverStatusDisabled' } as const;

export default function DriverManagementPage() {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const queryClient = useQueryClient();

  // ★ THE SERVER DECIDES; THIS ONLY AVOIDS DRAWING — OR ASKING FOR — A SCREEN
  // IT WOULD REFUSE. The read is not even attempted for a caller without the key.
  const allowed = can('user.write');
  const drivers = useQuery({ queryKey: DRIVERS_QUERY_KEY, queryFn: fetchDrivers, enabled: allowed });

  const [creating, setCreating] = useState(false);
  const [detailOf, setDetailOf] = useState<string | null>(null);
  /** The status change awaiting confirmation. */
  const [changing, setChanging] = useState<{ driver: DriverAccount; to: DriverAccountStatus } | null>(null);

  if (!allowed) return <Navigate to="/403" replace />;

  const reload = () => queryClient.invalidateQueries({ queryKey: DRIVERS_QUERY_KEY });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('driverManagement')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('driverManagementIntro')}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/organization/driver-requests">
            <Button variant="outline" type="button" className="gap-1">
              <ClipboardList className="size-4" />
              {t('driverRequestQueue')}
            </Button>
          </Link>
          <Button type="button" className="gap-1 bg-blue-600 hover:bg-blue-700" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('addDriver')}
          </Button>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
        {drivers.isPending ? (
          <p className="py-10 text-center text-sm text-gray-500">{t('loading')}</p>
        ) : null}

        {drivers.isError ? (
          <div className="space-y-2 py-10 text-center">
            <p role="alert" className="text-sm text-red-600">
              {t('driverListFailed')}
            </p>
            <Button variant="outline" type="button" onClick={() => void drivers.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : null}

        {drivers.isSuccess && drivers.data.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">{t('driverListEmpty')}</p>
        ) : null}

        {drivers.isSuccess && drivers.data.length > 0 ? (
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="w-[50px] text-center font-semibold text-gray-600">{t('colIndex')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colDriver')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colUsername')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colCreatedAt')}</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">{t('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.data.map((driver, index) => (
                <TableRow key={driver.id} className="transition-colors hover:bg-blue-50/30">
                  <TableCell className="text-center font-medium text-gray-500">{index + 1}</TableCell>
                  <TableCell className="font-medium text-gray-900">{driver.displayName}</TableCell>
                  <TableCell className="text-gray-600">{driver.username ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[driver.status]}>{t(STATUS_LABEL[driver.status])}</Badge>
                  </TableCell>
                  <TableCell className="text-gray-600">{formatDateTime(driver.createdAt, language)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" type="button" onClick={() => setDetailOf(driver.id)}>
                        {t('viewDetail')}
                      </Button>
                      <StatusButton driver={driver} onChoose={(to) => setChanging({ driver, to })} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>

      {creating ? (
        <CreateDriverModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await reload();
          }}
        />
      ) : null}

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

/** "Vô hiệu hóa" on an active account, "Kích hoạt lại" on a disabled one. */
function StatusButton({
  driver,
  onChoose,
}: Readonly<{ driver: DriverAccount; onChoose: (to: DriverAccountStatus) => void }>) {
  const { t } = useLanguage();
  return driver.status === 'active' ? (
    <Button variant="outline" size="sm" type="button" className="text-red-700" onClick={() => onChoose('disabled')}>
      {t('disableDriver')}
    </Button>
  ) : (
    <Button variant="outline" size="sm" type="button" className="text-green-700" onClick={() => onChoose('active')}>
      {t('enableDriver')}
    </Button>
  );
}

/**
 * A new driver, created outright — the same three fields the API has always
 * taken. On success the server's answer (the derived sign-in name) is shown;
 * the password the administrator typed is not repeated back.
 */
function CreateDriverModal({
  onClose,
  onCreated,
}: Readonly<{ onClose: () => void; onCreated: () => Promise<void> }>) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProvisionedDriver | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const driver = await createDriver({ displayName: displayName.trim(), email: email.trim(), initialPassword });
      setCreated(driver);
      // The typed secret has done its job; nothing keeps it.
      setInitialPassword('');
      await onCreated();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'create-driver-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('addDriver')}
      footer={
        created ? (
          <Button type="button" onClick={onClose}>
            {t('close')}
          </Button>
        ) : (
          <>
            <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
              {t('cancel')}
            </Button>
            <Button type="submit" form={formId} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
              {busy ? t('saving') : t('createDriverSubmit')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-900">{t('driverCreated')}</p>
          <p className="mt-1 text-green-800">
            {created.displayName} — <span className="font-mono">{created.username}</span>
          </p>
          <p className="mt-2 text-xs text-green-800">{t('driverCreatedNote')}</p>
        </div>
      ) : (
        <form id={formId} onSubmit={submit} className="space-y-4">
          <p className="text-xs text-gray-500">{t('driverNoDepartmentNote')}</p>
          <Field id="driver-name" label={t('fullNameLabel')} value={displayName} onChange={setDisplayName} required />
          <Field id="driver-email" label={t('emailLabel')} value={email} onChange={setEmail} type="email" required />
          <Field
            id="driver-password"
            label={t('initialPasswordLabel')}
            value={initialPassword}
            onChange={setInitialPassword}
            type="password"
            required
            hint={t('initialPasswordHint')}
          />
          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  hint,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
}>) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoComplete="off"
      />
      {hint ? <p className="text-xs text-gray-500">{hint}</p> : null}
    </div>
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
          {t('driverListFailed')}
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
            <Badge variant={STATUS_VARIANT[driver.data.status]}>{t(STATUS_LABEL[driver.data.status])}</Badge>
          </dd>
          <dt className="text-gray-500">{t('colCreatedAt')}</dt>
          <dd className="text-gray-900">{formatDateTime(driver.data.createdAt, language)}</dd>
        </dl>
      ) : null}
    </Modal>
  );
}

/**
 * The explicit second act, in both directions.
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
            className={disabling ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-green-600 text-white hover:bg-green-700'}
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
