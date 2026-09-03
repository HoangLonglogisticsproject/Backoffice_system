import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
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
 * ★ RECORDING SOMETHING HAPPENS IN PLACE, BENEATH THE LIST IT JOINS. The form
 * used to be a second dialog stacked on this one — two focus traps fighting for
 * the same keyboard, two body-scroll locks, and the list you were adding to
 * hidden behind the thing adding to it. Inline, the new line appears directly
 * under the rows it will sit among, and the running totals stay on screen while
 * the figure is typed.
 *
 * ★ NOTHING IS EDITED HERE, ONLY ADDED AND REMOVED. A financial record is
 * immutable: a wrong figure is removed and a new one recorded in its place.
 * There is no edit control because there is no edit endpoint — and the button
 * that says "Xóa" is not one either: the server offers no PATCH, PUT or DELETE
 * on these resources at all, so what it calls is a void, and the row lives on.
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
  const [deleting, setDeleting] = useState<{ kind: 'cost' | 'hire'; id: string } | null>(null);

  const money = useTripCost(tripId, includeVoided);

  const canAdd = can('cost.create');
  const canDelete = can('cost.void');

  const close = () => {
    setAdding(null);
    setDeleting(null);
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
                      // A toggle: the form appears below, so the same control
                      // that opened it is the obvious one to close it.
                      onClick={() => setAdding(adding === 'cost' ? null : 'cost')}
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
                        <TableHead className="w-full">{t('colCategory')}</TableHead>
                        <TableHead className="text-right">{t('colAmount')}</TableHead>
                        {canDelete && <TableHead className="w-px" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(money.costs?.items ?? []).map((line) => (
                        <RecordRow
                          key={line.id}
                          label={t(CATEGORY_LABEL[line.category])}
                          amount={line.amount}
                          record={line}
                          canDelete={canDelete}
                          onDelete={() => setDeleting({ kind: 'cost', id: line.id })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}

                {tripId && adding === 'cost' && (
                  <AddRecordForm
                    kind="cost"
                    tripId={tripId}
                    onClose={() => setAdding(null)}
                    onSaved={money.reload}
                  />
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
                      onClick={() => setAdding(adding === 'hire' ? null : 'hire')}
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
                        <TableHead className="w-full">{t('colCarrier')}</TableHead>
                        <TableHead className="text-right">{t('colAmount')}</TableHead>
                        <TableHead>{t('colDocumentRef')}</TableHead>
                        {canDelete && <TableHead className="w-px" />}
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
                          canDelete={canDelete}
                          onDelete={() => setDeleting({ kind: 'hire', id: hire.id })}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}

                {tripId && adding === 'hire' && (
                  <AddRecordForm
                    kind="hire"
                    tripId={tripId}
                    onClose={() => setAdding(null)}
                    onSaved={money.reload}
                  />
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

      {tripId && deleting && (
        <DeleteRecordModal
          kind={deleting.kind}
          tripId={tripId}
          recordId={deleting.id}
          onClose={() => setDeleting(null)}
          onDeleted={money.reload}
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
  canDelete,
  onDelete,
}: Readonly<{
  label: string;
  amount: string;
  note?: string | null;
  suffix?: string | null;
  record: TripCost | OutsourceHire;
  canDelete: boolean;
  onDelete: () => void;
}>) {
  const { t, language } = useLanguage();
  const deleted = record.voidedAt !== null;

  return (
    <TableRow className={cn(deleted && 'opacity-60')}>
      <TableCell className="font-medium text-gray-900">
        {label}
        {deleted && (
          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {t('statusVoided')}
          </span>
        )}
        {/*
          ★ WHO WROTE THIS FIGURE, AND WHEN — shown on EVERY record, deleted ones
          included. A withdrawn line is kept precisely so it stays answerable,
          and a line whose author disappeared when it was deleted would defeat
          that. The name comes from the server; a UUID would say nothing.
        */}
        <p className="mt-0.5 text-xs font-normal text-gray-500">
          {record.createdByUser.displayName} · {formatDateTime(record.createdAt, language)}
        </p>
        {/* Why it was withdrawn, kept beside it — the whole point of keeping it. */}
        {deleted && record.voidReason && (
          <p className="mt-0.5 text-xs text-gray-500">{record.voidReason}</p>
        )}
      </TableCell>
      <TableCell className={cn('text-right tabular-nums', deleted && 'line-through')}>
        {formatMoney(amount)}
        {suffix && <span className="ml-1 text-xs text-gray-500">{suffix}</span>}
      </TableCell>
      {/* Only the outsourced table carries a third column; trip costs go without. */}
      {note !== undefined && <TableCell className="text-gray-600">{note ?? '—'}</TableCell>}
      {canDelete && (
        <TableCell className="w-px text-right">
          {/* A deleted record cannot be deleted again — the server answers 409. */}
          {!deleted && (
            <Button variant="outline" size="sm" className="h-8 px-2" onClick={onDelete}>
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
 * Recording a cost line or a hire, in place beneath the list it joins.
 *
 * ★ THE AMOUNT IS SENT AS THE DIGITS THAT WERE TYPED, AS A STRING. `MoneyInput`
 * groups them with commas for reading and hands back the plain decimal, so
 * `amount` here is already the payload — nothing to strip, and no `Number(...)`
 * anywhere on the path. JSON numbers are float64 and the server refuses one
 * outright for that reason. It also refuses a third decimal place, which
 * `NUMERIC(14,2)` would round rather than reject — so the server's message is
 * the honest one to show.
 */
function AddRecordForm({
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

  return (
    <form
      onSubmit={submit}
      // Boxed off from the rows above it: this is a line being composed, not a
      // line that exists yet.
      className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/50 p-4"
    >
      <h4 className="text-sm font-semibold text-gray-900">
        {t(kind === 'cost' ? 'addCost' : 'addHire')}
      </h4>

      {kind === 'cost' ? (
        <div className="space-y-2">
          <label htmlFor="cost-category" className="text-sm font-medium text-gray-700">
            {t('fieldCategory')}
          </label>
          <select
            id="cost-category"
            // The first field of a form that just appeared: without this the
            // keyboard is still wherever the button left it.
            autoFocus
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
            autoFocus
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
        <MoneyInput
          id="cost-amount"
          value={amount}
          onChange={setAmount}
          placeholder="1,500,000"
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

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" type="button" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {busy ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Removing a record.
 *
 * ★ A CONFIRMATION, NOT A FORM. It asks one question and offers two answers,
 * because that is what removing a line is: nothing here is composed, so there
 * is nothing to fill in. The copy then says what this is NOT — the row is kept
 * and only stops counting — because the button says "Xóa" and people read
 * that as gone forever.
 */
function DeleteRecordModal({
  kind,
  tripId,
  recordId,
  onClose,
  onDeleted,
}: Readonly<{
  kind: 'cost' | 'hire';
  tripId: string;
  recordId: string;
  onClose: () => void;
  onDeleted: () => void;
}>) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What is being withdrawn, in the words of the section it came from. The two
  // lists sit one above the other in the same panel, so a dialog that said only
  // "record" would leave the reader to remember which button they pressed.
  const title = t(kind === 'cost' ? 'voidCostTitle' : 'voidHireTitle');

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await (kind === 'cost'
        ? voidTripCost(tripId, recordId)
        : voidOutsourceHire(tripId, recordId));
      onDeleted();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'trip-cost-delete-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? t('saving') : title}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={confirm} className="space-y-4">
        <p className="text-sm text-gray-600">
          {t(kind === 'cost' ? 'confirmVoidCostBody' : 'confirmVoidHireBody')}
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
