import { Camera, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FuelPhotos } from '@/hooks/driver/fuel';
import { driverFuelPhotoUrl } from '@/api/driverFuel';
import type { FuelEvidenceType } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';

/** What a driver photographs at the pump — each its own big button, camera first. */
const SHOTS: Array<{ type: FuelEvidenceType; label: TranslationKey }> = [
  { type: 'pump_meter', label: 'driverPhotoPump' },
  { type: 'receipt', label: 'driverPhotoReceipt' },
  { type: 'payment_qr', label: 'driverPhotoQr' },
];
const LABEL_OF: Partial<Record<FuelEvidenceType, TranslationKey>> = Object.fromEntries(SHOTS.map((shot) => [shot.type, shot.label]));

/**
 * The photos of a fill: the pump's meter, the receipt or voucher, the
 * station's payment QR. Each button opens the camera (`capture`); the photo is
 * uploaded at once, so a weak signal shows up here and not at the end.
 *
 * ★ PHOTOS NOT SENT LAST TIME come back from the server below — the driver
 * uses them for this fill or removes them; none is sent on its own.
 */
export function FuelPhotoPicker({ photos }: Readonly<{ photos: FuelPhotos }>) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {SHOTS.map((shot) => (
          <label
            key={shot.type}
            className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-1 text-center text-xs font-medium text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <Camera className="size-5" aria-hidden />
            {t(shot.label)}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="sr-only"
              aria-label={t(shot.label)}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) photos.add(file, shot.type);
                event.target.value = '';
              }}
            />
          </label>
        ))}
      </div>
      {photos.uploading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t('driverPhotoUploading')}
        </p>
      ) : null}

      {photos.tray.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('driverPhotosTaken')}>
          {photos.tray.map((photo) => (
            <li key={photo.evidence.id} className="relative w-20">
              <img src={photo.previewUrl} alt={t(photo.type ? (LABEL_OF[photo.type] ?? 'driverPhotoOther') : 'driverPhotoOther')} className="size-20 rounded-lg border object-cover" />
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {t(photo.type ? (LABEL_OF[photo.type] ?? 'driverPhotoOther') : 'driverPhotoOther')}
              </span>
              <button
                type="button"
                onClick={() => photos.remove(photo.evidence)}
                aria-label={t('driverPhotoRemove')}
                className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full bg-background text-foreground shadow ring-1 ring-border"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('driverPhotosHint')}</p>
      )}

      {photos.leftovers.length > 0 ? (
        <section aria-label={t('driverPhotosLeftover')} className="space-y-2 rounded-lg bg-amber-50 p-3 text-amber-900">
          <p className="text-xs font-medium">{t('driverPhotosLeftover')} ({photos.leftovers.length})</p>
          <ul className="flex flex-wrap gap-3">
            {photos.leftovers.map((evidence) => (
              <li key={evidence.id} className="w-20 space-y-1">
                <img src={driverFuelPhotoUrl(evidence.id)} alt={evidence.originalFilename ?? t('driverPhotoOther')} className="size-20 rounded-lg border object-cover" />
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" className="h-8 flex-1 px-1 text-xs" onClick={() => photos.reuse(evidence)}>
                    {t('driverPhotoUse')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 px-1 text-xs" aria-label={t('driverPhotoRemove')} onClick={() => photos.remove(evidence)}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
