import { Archive, Pencil } from 'lucide-react';
// `MapPin`, `StatusPill` and `isLocated` belong to the commented-out status
// column and "Thiết lập vị trí" button below; restore them together.
import { fullAddress } from '@/components/trip/locationAddress';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import type { TripLocationListing } from '@/types/trip';

/**
 * Every place in the deployment, as rows.
 *
 * ★ THE NAME IS THE LEFT COLUMN AND THE ADDRESS IS THE ONE BESIDE IT, because
 * that is how these are actually used: somebody knows the place as "Cảng Cát
 * Lái" and needs to see which address that resolves to.
 *
 * ★ AND THE ADDRESS IS THE WHOLE ADDRESS, not the street line with the province
 * in a column of its own. The two were stored apart because they are ENTERED
 * apart — one typed, three chosen from a list — but nobody reads an address in
 * pieces, and two columns showed the same place twice with neither copy
 * complete. `fullAddress` joins them in the order an envelope is written.
 */

export function LocationCatalogueTable({
  rows,
  canManage,
  onEdit,
  onArchive,
}: Readonly<{
  rows: TripLocationListing[];
  canManage: boolean;
  onEdit: (location: TripLocationListing) => void;
  onArchive: (location: TripLocationListing) => void;
}>) {
  const { t } = useLanguage();

  return (
    <Table>
      <TableHeader className="bg-gray-50/50">
        <TableRow>
          <TableHead className="font-semibold text-gray-600">{t('locationName')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('locationAddress')}</TableHead>
          {/* PAIRED WITH THE TWO COMMENTED CELLS BELOW. A header with no cell
              under it leaves a blank column and shifts every column after it,
              which is what put two empty gaps in the middle of this table. */}
          {/* <TableHead className="font-semibold text-gray-600">{t('locationOwner')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead> */}
          {canManage && <TableHead className="font-semibold text-gray-600">{t('colActions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((location) => {
          const archived = location.status !== 'active';

          return (
            <TableRow
              key={location.id}
              className={cn('transition-colors hover:bg-blue-50/30', archived && 'opacity-60')}
            >
              <TableCell className="font-medium text-gray-900">{location.name}</TableCell>
              <TableCell className="max-w-md whitespace-pre-wrap text-gray-600">
                {fullAddress(location)}
              </TableCell>
              {/* <TableCell className="text-gray-600">
                {location.customerName ?? (
                  <span className="text-gray-500 italic">{t('locationShared')}</span>
                )}
              </TableCell>
              <TableCell>
                <StatusPill tone={status.tone}>{t(status.label)}</StatusPill>
              </TableCell> */}
              {canManage && (
                <TableCell>
                  <div className="flex items-center gap-1">
                    {/* {!archived && !isLocated(location) ? (
                      // The obvious next action on a place no driver can be
                      // checked at: the same dialog the pencil opens, named
                      // for the job.
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 px-2 text-amber-700"
                        onClick={() => onEdit(location)}
                      >
                        <MapPin className="size-3.5" aria-hidden />
                        {t('setupLocation')}
                      </Button>
                    ) : null} */}
                    {!archived ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-gray-600"
                          onClick={() => onEdit(location)}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only">{t('edit')}</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-gray-600"
                          onClick={() => onArchive(location)}
                        >
                          <Archive className="size-3.5" />
                          <span className="sr-only">{t('archive')}</span>
                        </Button>
                      </>
                    ) : null}
                  </div>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
