import type { ReactNode } from 'react';
import { Archive, Pencil, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TranslationKey } from '@/types/translate';
import type { TripBoardRow } from '@/types/tripBoard';
import { formatPlate } from '@/utils/format';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { TripCostCell } from './TripCostCell';
import { Prose, Unset } from './TripCells';

/**
 * Lịch sử chuyến's table: what happened, one row per trip.
 *
 * ★ ONE ROW PER TRIP, THE CREW LISTED IN ONE CELL — not spanned per lorry as on
 * the board, where each pair is still being worked (ADR-0004: 0..N assignments,
 * none flattened into the trip). ★ NO STATUS COLUMN: every row is `finished`.
 * Actions and permissions are the board's: accounting still prices a finished
 * trip, and the cost dialog is the trip's detail.
 */
export function TripHistoryTable({
  rows,
  firstRowNumber,
  onEdit,
  onArchive,
  onCost,
}: Readonly<{
  rows: readonly TripBoardRow[];
  firstRowNumber: number;
  onEdit: (trip: TripBoardRow) => void;
  onArchive: (trip: TripBoardRow) => void;
  onCost: (tripId: string) => void;
}>) {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const mayPrice = can('trip.price.read');
  const canViewCost = can('cost.read');
  const canManage = can('trip.write');
  const mayEdit = canManage || can('trip.price.write');
  const hasActions = mayEdit || canViewCost;

  const head = (key: TranslationKey, right = false) => (
    <TableHead className={`${right ? 'text-right ' : ''}font-semibold text-gray-600`}>{t(key)}</TableHead>
  );
  const at = (iso: string | null) => (iso ? formatDateTime(iso, language) : <Unset />);

  return (
    <Table stickyScrollbar>
      <TableHeader className="bg-gray-50/50">
        <TableRow>
          {head('colIndex')}
          {head('colPickupAt')}
          {head('colDeliveryAt')}
          {head('colVehicle')}
          {head('colDriver')}
          {head('colCustomer')}
          {head('colCargo')}
          {head('colPickup')}
          {head('colDelivery')}
          {canViewCost && head('tripCost', true)}
          {mayPrice && head('colSellPrice', true)}
          {mayPrice && head('colPurchasePrice', true)}
          {head('colCreatedBy')}
          {hasActions && head('colActions')}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((trip, index) => (
          <TableRow key={trip.id} className="align-top transition-colors hover:bg-blue-50/30">
            <TableCell className="text-center font-medium text-gray-500">{firstRowNumber + index}</TableCell>
            <TableCell className="whitespace-nowrap font-medium text-gray-900">{at(trip.pickupAt)}</TableCell>
            <TableCell className="whitespace-nowrap font-medium text-gray-900">{at(trip.deliveryAt)}</TableCell>
            <TableCell>
              <Lines value={platesOf(trip)} strong />
            </TableCell>
            <TableCell>
              <Lines value={driversOf(trip)} />
            </TableCell>
            <TableCell className="text-gray-900">{trip.customer?.name ?? <Unset />}</TableCell>
            <TableCell>
              <Prose value={trip.cargoInfo} />
            </TableCell>
            <TableCell>
              <Prose value={placeOf(trip.pickupAddress, trip.pickupContact)} />
            </TableCell>
            <TableCell>
              <Prose value={placeOf(trip.deliveryAddress, trip.deliveryContact)} />
            </TableCell>
            {canViewCost && (
              <TableCell className="text-right">
                <TripCostCell summary={trip.costSummary} onOpen={() => onCost(trip.id)} />
              </TableCell>
            )}
            {mayPrice && <MoneyCell value={trip.sellPrice} strong />}
            {mayPrice && <MoneyCell value={trip.purchasePrice} />}
            <TableCell className="whitespace-nowrap text-gray-600">{trip.createdByUser.displayName}</TableCell>
            {hasActions && (
              <TableCell>
                <div className="flex items-center gap-1">
                  {mayEdit && (
                    <IconButton label={t('edit')} onClick={() => onEdit(trip)} icon={<Pencil className="h-3.5 w-3.5" />} />
                  )}
                  {canManage && (
                    <IconButton label={t('archive')} onClick={() => onArchive(trip)} icon={<Archive className="h-3.5 w-3.5" />} />
                  )}
                  {canViewCost && (
                    <IconButton label={t('tripCost')} onClick={() => onCost(trip.id)} icon={<Wallet className="h-3.5 w-3.5" />} />
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Every lorry of the run, one per line. */
const platesOf = (trip: TripBoardRow): string | null =>
  trip.assignments.map((turn) => (turn.vehicle ? formatPlate(turn.vehicle.plate) : '')).filter(Boolean).join('\n') ||
  null;

/** Every driver once — the same person on two lorries is one name. */
const driversOf = (trip: TripBoardRow): string | null =>
  [...new Set(trip.assignments.map((turn) => turn.driver.displayName))].join('\n') || null;

/** Where, and who to ask there. The time has its own column here. */
const placeOf = (address: string | null, contact: string | null): string | null =>
  [address, contact].filter(Boolean).join('\n') || null;

/** One name per line, never broken inside one — a plate split at its hyphen reads as two lorries. */
function Lines({ value, strong = false }: Readonly<{ value: string | null; strong?: boolean }>) {
  if (!value) return <Unset />;
  return <span className={`block whitespace-pre ${strong ? 'font-medium text-gray-900' : 'text-gray-900'}`}>{value}</span>;
}

/** A price, formatted as text — never parsed (see the board's price cells). */
function MoneyCell({ value, strong = false }: Readonly<{ value: string | null; strong?: boolean }>) {
  const tone = strong ? 'font-medium text-gray-900' : 'text-gray-600';
  return (
    <TableCell className={`whitespace-nowrap text-right tabular-nums ${tone}`}>
      {value ? formatMoney(value) : <Unset />}
    </TableCell>
  );
}

function IconButton({ label, onClick, icon }: Readonly<{ label: string; onClick: () => void; icon: ReactNode }>) {
  return (
    <Button variant="outline" size="sm" className="h-8 gap-1 px-2 text-gray-600" onClick={onClick}>
      {icon}
      <span className="sr-only">{label}</span>
    </Button>
  );
}
