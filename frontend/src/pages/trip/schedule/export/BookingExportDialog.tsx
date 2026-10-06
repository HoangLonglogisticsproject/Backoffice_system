import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBookingExport } from '@/api/bookingExport';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { tripKeys } from '@/hooks/trip/keys';
import type { BookingExport } from '@/types/bookingExport';
import { bookingDocument } from './bookingExportModel';
import { bookingPngFileName, downloadPng } from './downloadPng';
import { renderBookingPng } from './renderBookingPng';

interface Png {
  blob: Blob;
  /** For the preview `<img>` only; revoked when the dialog closes or the image is redrawn. */
  url: string;
}

/**
 * The PNG for one export, drawn once from the server's document data.
 *
 * ★ THE PREVIEW IS THE FILE. The `<img>` shows this blob and the download saves
 * this blob — there is no HTML version of the document that could differ.
 */
function useBookingPng(booking: BookingExport | undefined): { png: Png | null; failed: boolean } {
  const [png, setPng] = useState<Png | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!booking) return;
    let live = true;
    let url: string | null = null;
    renderBookingPng(bookingDocument(booking, new Date())).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setPng({ blob, url });
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [booking]);

  return { png, failed };
}

/**
 * "Xem trước booking" — fetch the export, draw it, show it, save it.
 *
 * Its owner mounts it only while open — outside any sticky column or table
 * cell, whose stacking and `nowrap` would leak in — so every opening reads the
 * trip as it is now (`gcTime: 0`): once, however often React renders it, and
 * closing drops the request, the image and its object URL together.
 */
export function BookingExportDialog({ tripId, onClose }: Readonly<{ tripId: string; onClose: () => void }>) {
  const { t } = useLanguage();
  const booking = useQuery({
    queryKey: tripKeys.bookingExport(tripId),
    queryFn: () => fetchBookingExport(tripId),
    gcTime: 0,
    staleTime: Infinity,
  });
  const { png, failed } = useBookingPng(booking.data);
  const broken = booking.isError || failed;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('bookingExportTitle')}
      className="h-dvh max-h-dvh max-w-none rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-xl"
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={!png}
            onClick={() => png && booking.data && downloadPng(png.blob, bookingPngFileName(booking.data.customerName, booking.data.scheduledOn))}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {t('bookingExportDownload')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t('bookingExportHelp')}</p>
        {broken && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t('bookingExportFailed')}
          </p>
        )}
        {!broken && !png && (
          <div role="status" className="space-y-2">
            <span className="sr-only">{t('bookingExportPreparing')}</span>
            <Skeleton className="h-[28rem] w-full rounded-lg" />
          </div>
        )}
        {png && (
          <img
            src={png.url}
            alt={t('bookingExportPreviewAlt')}
            className="mx-auto block w-full max-w-[720px] rounded-lg border border-gray-200 shadow-sm"
          />
        )}
      </div>
    </Modal>
  );
}
