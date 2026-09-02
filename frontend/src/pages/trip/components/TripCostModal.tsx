import { useState } from 'react';
import { Plus } from 'lucide-react';
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
import { useTripCost } from '@/hooks/trip';
import {
  createOutsourceHire,
  createTripCost,
  voidOutsourceHire,
  voidTripCost,
} from '@/api/tripCost';
import { isApiError } from '@/utils/errors';
import { formatMoney } from '@/utils/format/money';
import { formatDateTime } from '@/utils/format/datetime';
import { cn } from '@/utils/cn';
import {
  TRIP_COST_CATEGORIES,
  type OutsourceHire,
  type TripCost,
  type TripCostCategory,
} from '@/types/tripCost';
import type { TranslationKey } from '@/types/translate';

/**
 * The CHI PHÍ block of the workbook, for one trip.
 *
 * ★ A DIALOG OFF THE BOARD ROW, NOT A COLUMN ON THE BOARD. Two reasons, and
 * neither is layout. The board is already twelve columns read at a glance, and
 * — far more importantly — it is read by EVERYBODY. Money is not: putting an
 * amount in the list would hand the company's cost base to every signed-in
 * account, which is the one thing the separate `cost.*` permissions exist to
 * prevent.
 *
 * ★ NOTHING IS EDITED HERE, ONLY ADDED AND WITHDRAWN. A financial record is
 * immutable: a wrong figure is voided, with a reason, and a new one recorded.
 * There is no edit control because there is no edit endpoint — the server
 * offers no PATCH, PUT or DELETE on these resources at all.
 *
 * ⚠ EVERY CONTROL HERE IS A COURTESY, NEVER A BOUNDARY. The server re-decides
 * each request; hiding a button only avoids offering something that would be
 * refused.
 */

const CATEGORY_LABEL: Record<TripCostCategory, TranslationKey> = {
  fuel: 'costFuel',
  toll: 'costToll',
  warehouse: 'costWarehouse',
  loading: 'costLoading',
  overtime: 'costOvertime',
};

export function TripCostModal({
  tripId,
  onClose,
}: Readonly<{ tripId: string | null; onClose: () => void }>) {
  const { t } = useLanguage();
  const { can } = useSession();

  const [includeVoided, setIncludeVoided] = useState(false);
  const [adding, setAdding] = useState<'cost' | 'hire' | null>(null);
  const [voiding, setVoiding] = useState<{ kind: 'cost' | 'hire'; id: string } | null>(null);

  const money = useTripCost(tripId, includeVoided);

  const canAdd = can('cost.create');
  const canVoid = can('cost.void');

  const close = () => {
    setAdding(null);
    setVoiding(null);
    setIncludeVoided(false);
    onClose();
  };

  return (
    <>
      <Modal isOpen={tripId !== null} onClose={close} title={t('tripCost')}>
        <div className="space-y-6">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeVoided}
              onChange={(event) => setIncludeVoided(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            {t('showVoided')}
          </label>

          {money.forbidden && (
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
              <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
            </div>
          )}

          {money.error && !money.forbidden && (
            <p role="alert" className="py-6 text-center text-sm text-red-600">
              {money.error.message}
            </p>
          )}

          {!money.error && (
            <>
              {/* ---------------------------------------------- own vehicle ---- */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">{t('costOwnVehicle')}</h3>
                  {canAdd && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      onClick={() => setAdding('cost')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('addCost')}
                    </Button>
                  )}
                </div>

                {money.costs?.items.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">{t('emptyCosts')}</p>
                ) : (
                  <Table>
                    <TableHeader className="bg-gray-50/50">
                      <TableRow>
                        <TableHead>{t('colCategory')}</TableHead>
                        <TableHead className="text-right">{t('colAmount')}</TableHead>
                        <TableHead>{t('colNote')}</TableHead>
                        {canVoid && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(money.costs?.items ?? []).map((line) => (
                        <RecordRow
                          key={line.id}
                          label={t(CATEGORY_LABEL[line.category])}
                          amount={line.amount}
                          note={line.note}
                          record={line}
                          canVoid={canVoid}
                          onVoid={() => setVoiding({ kind: 'cost', id: line.id })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>

              {/* ------------------------------------------------ outsourced ---- */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">{t('costOutsource')}</h3>
                  {canAdd && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      onClick={() => setAdding('hire')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t('addHire')}
                    </Button>
                  )}
                </div>

                {money.hires?.items.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">{t('emptyHires')}</p>
                ) : (
                  <Table>
                    <TableHeader className="bg-gray-50/50">
                      <TableRow>
                        <TableHead>{t('colCarrier')}</TableHead>
                        <TableHead className="text-right">{t('colAmount')}</TableHead>
                        <TableHead>{t('colDocumentRef')}</TableHead>
                        {canVoid && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(money.hires?.items ?? []).map((hire) => (
                        <RecordRow
                          key={hire.id}
                          label={hire.carrierName}
                          amount={hire.agreedAmount}
                          // Recorded, never computed: this only says what the
                          // agreed figure MEANS.
                          suffix={hire.amountIncludesVat ? t('vatIncludedShort') : null}
                          note={hire.documentRef}
                          record={hire}
                          canVoid={canVoid}
                          onVoid={() => setVoiding({ kind: 'hire', id: hire.id })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>

              {/* ---------------------------------------------------- totals ---- */}
              {money.totals && (
                <section className="space-y-1 rounded-lg bg-gray-50 p-4">
                  <Total label={t('totalOwnVehicle')} value={money.totals.costs} />
                  <Total label={t('totalOutsource')} value={money.totals.hires} />
                  {/*
                    ★ THE SERVER ADDED THESE. `costs + hires` here would either
                    concatenate two decimal strings or push them through a float.
                  */}
                  <Total label={t('totalTripCost')} value={money.totals.combined} strong />
                </section>
              )}
            </>
          )}
        </div>
      </Modal>

      {tripId && adding && (
        <AddRecordModal
          kind={adding}
          tripId={tripId}
          onClose={() => setAdding(null)}
          onSaved={money.reload}
        />
      )}

      {tripId && voiding && (
        <VoidRecordModal
          kind={voiding.kind}
          tripId={tripId}
          recordId={voiding.id}
          onClose={() => setVoiding(null)}
          onVoided={money.reload}
        />
      )}
    </>
  );
}

/** One financial record, live or withdrawn. */
function RecordRow({
  label,
  amount,
  note,
  suffix = null,
  record,
  canVoid,
  onVoid,
}: Readonly<{
  label: string;
  amount: string;
  note: string | null;
  suffix?: string | null;
  record: TripCost | OutsourceHire;
  canVoid: boolean;
  onVoid: () => void;
}>) {
  const { t, language } = useLanguage();
  const voided = record.voidedAt !== null;

  return (
    <TableRow className={cn(voided && 'opacity-60')}>
      <TableCell className="font-medium text-gray-900">
        {label}
        {voided && (
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {t('statusVoided')}
          </span>
        )}
        {/*
          ★ WHO WROTE THIS FIGURE, AND WHEN — shown on EVERY record, voided ones
          included. A withdrawn line is kept precisely so it stays answerable,
          and a line whose author disappeared when it was voided would defeat
          that. The name comes from the server; a UUID would say nothing.
        */}
        <p className="mt-0.5 text-xs font-normal text-gray-500">
          {record.createdByUser.displayName} · {formatDateTime(record.createdAt, language)}
        </p>
        {/* Why it was withdrawn, kept beside it — the whole point of voiding. */}
        {voided && record.voidReason && (
          <p className="mt-0.5 text-xs text-gray-500">{record.voidReason}</p>
        )}
      </TableCell>
      <TableCell className={cn('text-right tabular-nums', voided && 'line-through')}>
        {formatMoney(amount)}
        {suffix && <span className="ml-1 text-xs text-gray-500">{suffix}</span>}
      </TableCell>
      <TableCell className="text-gray-600">{note ?? '—'}</TableCell>
      {canVoid && (
        <TableCell>
          {/* A voided record cannot be voided again — the server answers 409. */}
          {!voided && (
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={onVoid}>
              {t('voidRecord')}
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function Total({
  label,
  value,
  strong = false,
}: Readonly<{ label: string; value: string; strong?: boolean }>) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn('text-gray-600', strong && 'font-semibold text-gray-900')}>{label}</span>
      <span className={cn('tabular-nums text-gray-900', strong && 'text-base font-bold')}>
        {formatMoney(value)}
      </span>
    </div>
  );
}

/**
 * Recording a cost line or a hire.
 *
 * ★ THE AMOUNT IS SENT AS THE STRING IT WAS TYPED. Never `Number(...)`: JSON
 * numbers are float64, and the server refuses one outright for that reason. It
 * also refuses a third decimal place, which `NUMERIC(14,2)` would round rather
 * than reject — so the server's message is the honest one to show.
 */
function AddRecordModal({
  kind,
  tripId,
  onClose,
  onSaved,
}: Readonly<{
  kind: 'cost' | 'hire';
  tripId: string;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const { t } = useLanguage();
  const [category, setCategory] = useState<TripCostCategory>('fuel');
  const [carrierName, setCarrierName] = useState('');
  const [amount, setAmount] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [includesVat, setIncludesVat] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blank = (value: string) => (value.trim() === '' ? null : value.trim());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (kind === 'cost') {
        await createTripCost(tripId, { category, amount, note: blank(note) });
      } else {
        await createOutsourceHire(tripId, {
          carrierName,
          agreedAmount: amount,
          amountIncludesVat: includesVat,
          documentRef: blank(documentRef),
          note: blank(note),
        });
      }
      onSaved();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'trip-cost-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(kind === 'cost' ? 'addCost' : 'addHire')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {kind === 'cost' ? (
          <div className="space-y-2">
            <label htmlFor="cost-category" className="text-sm font-medium text-gray-700">
              {t('fieldCategory')}
            </label>
            <select
              id="cost-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as TripCostCategory)}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {TRIP_COST_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(CATEGORY_LABEL[value])}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="hire-carrier" className="text-sm font-medium text-gray-700">
              {t('fieldCarrier')}
            </label>
            <Input
              id="hire-carrier"
              value={carrierName}
              onChange={(event) => setCarrierName(event.target.value)}
              required
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="cost-amount" className="text-sm font-medium text-gray-700">
            {t(kind === 'cost' ? 'fieldAmount' : 'fieldAgreedAmount')}
          </label>
          <Input
            id="cost-amount"
            // `inputMode` rather than `type="number"`: a number input hands back
            // a value the browser has already coerced, and money must reach the
            // server as the digits somebody typed.
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="1500000"
            required
          />
          <p className="text-xs text-gray-500">{t('amountHint')}</p>
        </div>

        {kind === 'hire' && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={includesVat}
                onChange={(event) => setIncludesVat(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              {t('vatIncluded')}
            </label>

            <div className="space-y-2">
              <label htmlFor="hire-document" className="text-sm font-medium text-gray-700">
                {t('fieldDocumentRef')}
              </label>
              <Input
                id="hire-document"
                value={documentRef}
                onChange={(event) => setDocumentRef(event.target.value)}
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <label htmlFor="cost-note" className="text-sm font-medium text-gray-700">
            {t('noteOptional')}
          </label>
          <Input id="cost-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

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
 * Withdrawing a record.
 *
 * The reason is required by the server and by this form: a withdrawal with no
 * reason is the record somebody comes back to months later and cannot explain.
 * The copy says what voiding is NOT, because people read it as a delete.
 */
function VoidRecordModal({
  kind,
  tripId,
  recordId,
  onClose,
  onVoided,
}: Readonly<{
  kind: 'cost' | 'hire';
  tripId: string;
  recordId: string;
  onClose: () => void;
  onVoided: () => void;
}>) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await (kind === 'cost'
        ? voidTripCost(tripId, recordId, reason)
        : voidOutsourceHire(tripId, recordId, reason));
      onVoided();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'trip-cost-void-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('voidRecord')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? t('saving') : t('voidRecord')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={confirm} className="space-y-4">
        <p className="text-sm text-gray-600">{t('confirmVoidBody')}</p>

        <div className="space-y-2">
          <label htmlFor="void-reason" className="text-sm font-medium text-gray-700">
            {t('voidReason')}
          </label>
          <Input
            id="void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
