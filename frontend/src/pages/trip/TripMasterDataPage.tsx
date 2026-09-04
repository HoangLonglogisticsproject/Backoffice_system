import { useState } from 'react';
import { Archive, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlateInput } from '@/components/ui/plate-input';
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
import { useTripCatalogue } from '@/hooks/trip';
import {
  archiveTripCustomer,
  archiveTripVehicle,
  createTripCustomer,
  createTripVehicle,
  updateTripCustomer,
  updateTripVehicle,
} from '@/api/tripCatalogue';
import { isApiError } from '@/utils/errors';
import { stripPlate } from '@/utils/format';
import { cn } from '@/utils/cn';
import type { TranslationKey } from '@/types/translate';

/**
 * The two catalogues behind the dispatch board.
 *
 * ★ THIS SCREEN IS THE ONLY PLACE A MISSPELT PLATE CAN BE FIXED, which is why
 * it is not optional. The trip form can ADD to a catalogue — anybody may — but
 * correcting `50H4426` to `50H44266` afterwards changes what past trips appear
 * to say, so it is `trip.write` and it needs somewhere to happen.
 *
 * Two tabs rather than two routes: they are the same operations over two lists
 * of the same shape, and a reader who has understood one has understood both.
 */

type Tab = 'vehicles' | 'customers';

/**
 * One catalogue row, flattened to the shape the two lists share.
 *
 * `label` is the plate or the name; nothing else on the row differs, which is
 * what lets the table below be written once for both tabs.
 */
type CatalogueRowData = { id: string; label: string; note: string | null; status: string };

export default function TripMasterDataPage() {
  const { t } = useLanguage();
  const { can } = useSession();

  const [tab, setTab] = useState<Tab>('vehicles');
  const [includeArchived, setIncludeArchived] = useState(false);

  /**
   * ★ THE TWO DIALOGS BELONG TO THE PAGE, NOT TO THE ROW, AND THAT IS NOT
   * TIDINESS. Rendered from inside `CatalogueRow` they were siblings of the
   * `<tr>`, so an open dialog put a `<div>` directly inside `<tbody>` — invalid
   * HTML, which React reports as a hydration error. It also mounted two
   * `Modal`s per row, each with its own focus trap and keydown listener, on a
   * screen that can only ever have one dialog open.
   *
   * The selected row IS the open state: `null` means no dialog.
   */
  const [editing, setEditing] = useState<CatalogueRowData | null>(null);
  const [archiving, setArchiving] = useState<CatalogueRowData | null>(null);

  const canManage = can('trip.write');
  const canAdd = can('trip.create');

  // Both lists, from one hook — this is the screen that passes `includeArchived`,
  // because it is the only one where a retired row is something to look at
  // rather than something to be offered.
  const catalogue = useTripCatalogue(includeArchived);

  // Only the tab on screen reports its state: the two reads are independent, so
  // a vehicle list that failed must not put an error over a customer list that
  // loaded.
  const resource = tab === 'vehicles' ? catalogue.vehicles : catalogue.customers;

  // One shape for both lists, so the table below is written once. `label` is the
  // plate or the name; nothing else on the row differs.
  const rows: CatalogueRowData[] =
    tab === 'vehicles'
      ? catalogue.vehicles.items.map((row) => ({ ...row, label: row.plate }))
      : catalogue.customers.items.map((row) => ({ ...row, label: row.name }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <h1 className="text-xl font-bold text-gray-900">{t('tripMasterData')}</h1>
        {canAdd && (
          <CreateButton tab={tab} onCreated={catalogue.reload} />
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-2">
          <TabButton active={tab === 'vehicles'} onClick={() => setTab('vehicles')} label="vehicles" />
          <TabButton
            active={tab === 'customers'}
            onClick={() => setTab('customers')}
            label="customers"
          />

          <label className="ml-auto flex items-center gap-2 px-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            {t('showArchived')}
          </label>
        </div>

        <Table>
          <TableHeader className="bg-gray-50/50">
            <TableRow>
              <TableHead className="font-semibold text-gray-600">
                {t(tab === 'vehicles' ? 'colVehicle' : 'colCustomer')}
              </TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colNote')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
              {canManage && (
                <TableHead className="font-semibold text-gray-600">{t('colActions')}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <CatalogueRow
                key={row.id}
                row={row}
                canManage={canManage}
                onEdit={() => setEditing(row)}
                onArchive={() => setArchiving(row)}
              />
            ))}
          </TableBody>
        </Table>

        {!resource.loading && rows.length === 0 && !resource.error && (
          <p className="px-6 py-10 text-center text-sm text-gray-500">
            {t(tab === 'vehicles' ? 'emptyVehicles' : 'emptyCustomers')}
          </p>
        )}
        {resource.forbidden && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
          </div>
        )}
        {resource.error && !resource.forbidden && (
          <p className="px-6 py-10 text-center text-sm text-red-600">{t('loadFailed')}</p>
        )}
      </div>

      {/* Mounted only while open, so the form seeds from the row each time it
          is reopened rather than showing an abandoned edit. */}
      {editing && (
        <CatalogueFormModal
          isOpen
          tab={tab}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={catalogue.reload}
        />
      )}

      {archiving && (
        <ArchiveDialog
          isOpen
          tab={tab}
          row={archiving}
          onClose={() => setArchiving(null)}
          onArchived={catalogue.reload}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: Readonly<{ active: boolean; onClick: () => void; label: TranslationKey }>) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50',
      )}
    >
      {t(label)}
    </button>
  );
}

function CatalogueRow({
  row,
  canManage,
  onEdit,
  onArchive,
}: Readonly<{
  row: CatalogueRowData;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
}>) {
  const { t } = useLanguage();

  const archived = row.status !== 'active';

  return (
    <TableRow className={cn('transition-colors hover:bg-blue-50/30', archived && 'opacity-60')}>
      <TableCell className="font-medium text-gray-900">{row.label}</TableCell>
      <TableCell className="text-gray-600">{row.note ?? '—'}</TableCell>
      <TableCell>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset',
            archived
              ? 'bg-gray-50 text-gray-600 ring-gray-500/10'
              : 'bg-green-50 text-green-700 ring-green-600/20',
          )}
        >
          {t(archived ? 'statusArchived' : 'statusActive')}
        </span>
      </TableCell>
      {canManage && (
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-gray-600"
              onClick={onEdit}
              // An archived row is refused edits by the server (409); the
              // button is hidden rather than left to produce that error.
              disabled={archived}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="sr-only">{t('edit')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-gray-600"
              onClick={onArchive}
              disabled={archived}
            >
              <Archive className="h-3.5 w-3.5" />
              <span className="sr-only">{t('archive')}</span>
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function CreateButton({ tab, onCreated }: Readonly<{ tab: Tab; onCreated: () => void }>) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
      >
        <Plus className="h-4 w-4" />
        {t(tab === 'vehicles' ? 'addVehicle' : 'addCustomer')}
      </Button>
      <CatalogueFormModal
        isOpen={open}
        tab={tab}
        editing={null}
        onClose={() => setOpen(false)}
        onSaved={onCreated}
      />
    </>
  );
}

/**
 * Add or rename one catalogue row.
 *
 * The 409 the server answers for a duplicate is worth showing verbatim: it
 * names the spelling ALREADY in the catalogue, which is the one piece of
 * information that tells somebody their truck is there under `51D.65233` and
 * they were about to add `51D 65233` beside it.
 */
function CatalogueFormModal({
  isOpen,
  tab,
  editing,
  onClose,
  onSaved,
}: Readonly<{
  isOpen: boolean;
  tab: Tab;
  editing: { id: string; label: string; note: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const { t } = useLanguage();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded from the row each time the dialog opens, so reopening after a cancel
  // shows the stored values rather than the abandoned edit.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = isOpen ? (editing?.id ?? 'new') : null;
  if (key !== seededFor) {
    setSeededFor(key);
    // ★ THE VEHICLE FIELD'S STATE IS ALWAYS THE PLAIN PLATE, including when it
    // is seeded from a row stored in one of the workbook's older spellings.
    // `PlateInput` formats it for the screen; keeping the state plain is what
    // makes "what is on screen" and "what would be sent" the same value.
    setLabel(tab === 'vehicles' ? stripPlate(editing?.label) : (editing?.label ?? ''));
    setNote(editing?.note ?? '');
    setError(null);
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const trimmedNote = note.trim() === '' ? null : note.trim();

    try {
      if (tab === 'vehicles') {
        // ★ THE PLAIN PLATE IS WHAT TRAVELS. `PlateInput` already keeps `label`
        // in that form; stripping again here is the payload saying so at the
        // one place a reader looks for it, and costs nothing — it is idempotent.
        const plate = stripPlate(label);
        await (editing
          ? updateTripVehicle(editing.id, { plate, note: trimmedNote })
          : createTripVehicle({ plate, note: trimmedNote }));
      } else {
        await (editing
          ? updateTripCustomer(editing.id, { name: label, note: trimmedNote })
          : createTripCustomer({ name: label, note: trimmedNote }));
      }
      onSaved();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'catalogue-form';
  const isVehicle = tab === 'vehicles';

  // The one dialog both adds and renames, so the title has to say which. It
  // said "add" in both, over a form pre-filled with an existing plate.
  //
  // Declared and assigned rather than nested in the JSX: two levels of ternary
  // inside an attribute is read by nobody, and the same shape is spelled this
  // way in `ApprovalsPage`.
  let titleKey: TranslationKey;
  if (editing) {
    titleKey = isVehicle ? 'editVehicle' : 'editCustomer';
  } else {
    titleKey = isVehicle ? 'addVehicle' : 'addCustomer';
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(titleKey)}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="catalogue-label" className="text-sm font-medium text-gray-700">
            {t(isVehicle ? 'plateLabel' : 'customerNameLabel')}
          </label>
          {/*
            ★ TWO CONTROLS, BECAUSE A PLATE AND A COMPANY NAME ARE NOT THE SAME
            KIND OF TEXT. A plate has ONE correct spelling — the database says so
            by matching on `plate_key` — so the field shows it and sends it. A
            customer name is prose somebody chose; normalising it would be
            inventing a rule the business never stated.
          */}
          {isVehicle ? (
            <PlateInput
              id="catalogue-label"
              value={label}
              onChange={setLabel}
              placeholder={t('platePlaceholder')}
              required
            />
          ) : (
            <Input
              id="catalogue-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t('customerNamePlaceholder')}
              required
            />
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="catalogue-note" className="text-sm font-medium text-gray-700">
            {t('noteOptional')}
          </label>
          <Input
            id="catalogue-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
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

/**
 * Confirming that a truck or a customer is retired.
 *
 * The body states the thing people get wrong about it: past trips keep showing
 * this plate. Archiving is not a correction and not a delete — it only stops
 * the row being offered for new trips.
 */
function ArchiveDialog({
  isOpen,
  tab,
  row,
  onClose,
  onArchived,
}: Readonly<{
  isOpen: boolean;
  tab: Tab;
  row: { id: string; label: string };
  onClose: () => void;
  onArchived: () => void;
}>) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await (tab === 'vehicles' ? archiveTripVehicle(row.id) : archiveTripCustomer(row.id));
      onArchived();
      onClose();
    } catch (error_) {
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('archive')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy}>
            {busy ? t('saving') : t('archive')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          {t(tab === 'vehicles' ? 'confirmArchiveVehicleBody' : 'confirmArchiveCustomerBody')}
        </p>
        <p className="text-sm font-medium text-gray-900">{row.label}</p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
