import type { ReactNode } from 'react';
import { Archive, Pencil, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import type { TranslationKey } from '@/types/translate';
import type { TripBoardRow } from '@/types/tripBoard';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { TripCostCell } from './TripCostCell';
import { Leg, Prose, Unset } from './TripCells';

/**
 * Lịch sử chuyến's table: what happened, one row per trip.
 *
 * ★ IT SCANS LIKE LỊCH XE: # · Ngày lấy hàng · Xe · Tài xế · Khách hàng · Hàng
 * hoá · Điểm lấy hàng · Điểm giao hàng · Chi phí chuyến · Giá cước bán · Giá
 * cước mua · Người tạo — each exact time INSIDE its place's cell (the board's
 * own `Leg`), never a column of its own.
 *
 * ★ ONE ROW PER TRIP, THE CREW LISTED IN ONE CELL — not spanned per lorry as on
 * the board, where each pair is still being worked (ADR-0004: 0..N assignments,
 * none flattened into the trip). ★ NO STATUS AND NO PHÂN CÔNG COLUMN: every row
 * is "Đã xác nhận", and no pair here is still being worked. Actions and
 * permissions are the board's: accounting still prices a finished trip, and the
 * cost dialog is the trip's detail. "Tải booking PNG" is on every row — a read,
 * for everyone who can see the list — so the actions column always shows.
 */
export function TripHistoryTable({
  rows,
  firstRowNumber,
  onEdit,
  onArchive,
  onCost,
  onExport,
}: Readonly<{
  rows: readonly TripBoardRow[];
  firstRowNumber: number;
  onEdit: (trip: TripBoardRow) => void;
  onArchive: (trip: TripBoardRow) => void;
  onCost: (tripId: string) => void;
  onExport: (tripId: string) => void;
}>) {
  const { t, language } = useLanguage();
  const { can } = useSession();
  const mayPrice = can('trip.price.read');
  const canViewCost = can('cost.read');
  const canManage = can('trip.write');
  const mayEdit = canManage || can('trip.price.write');

  const head = (key: TranslationKey, right = false) => (
    <TableHead className={`${right ? 'text-right ' : ''}font-semibold text-gray-600`}>{t(key)}</TableHead>
  );
  return (
    <Table stickyScrollbar>
      <TableHeader className="bg-gray-50/50">
        <TableRow>
          {head('colIndex')}
          {head('colPickupDate')}
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
          {head('colActions')}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((trip, index) => (
          <TableRow key={trip.id} className="align-top transition-colors hover:bg-blue-50/30">
            <TableCell className="text-center font-medium text-gray-500">{firstRowNumber + index}</TableCell>
            <TableCell className="whitespace-nowrap text-gray-900">{formatCalendarDay(trip.scheduledOn, language)}</TableCell>
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
              <Leg address={trip.pickupAddress} contact={trip.pickupContact} at={trip.pickupAt} />
            </TableCell>
            <TableCell>
              <Leg address={trip.deliveryAddress} contact={trip.deliveryContact} at={trip.deliveryAt} />
            </TableCell>
            {canViewCost && (
              <TableCell className="text-right">
                <TripCostCell summary={trip.costSummary} onOpen={() => onCost(trip.id)} />
              </TableCell>
            )}
            {mayPrice && <MoneyCell value={trip.sellPrice} strong />}
            {mayPrice && <MoneyCell value={trip.purchasePrice} />}
            <TableCell className="whitespace-nowrap text-gray-600">{trip.createdByUser.displayName}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="sm" className="h-8 text-gray-700" onClick={() => onExport(trip.id)}>
                  {t('bookingExportAction')}
                </Button>
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
