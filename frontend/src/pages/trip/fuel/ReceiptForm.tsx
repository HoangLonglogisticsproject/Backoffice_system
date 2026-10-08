import { ImagePlus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useLanguage } from '@/contexts/LanguageContext';
import type { StagedImage } from '@/hooks/trip/useFuelReceipt';
import type { TripVehicle } from '@/types/trip';
import type { TranslationKey } from '@/types/translate';
import { formatPlate } from '@/utils/format';

/** The receipt as typed, before it is asked about. Every field a plain string. */
export interface ReceiptDraft {
  vehicleId: string | null;
  businessDate: string;
  amount: string;
  liters: string;
  vendorName: string;
  vendorTaxCode: string;
  documentSeries: string;
  documentNumber: string;
}

type TextField = 'liters' | 'vendorName' | 'vendorTaxCode' | 'documentSeries' | 'documentNumber';
const TEXT_FIELDS: Array<{ field: TextField; label: TranslationKey; inputMode?: 'decimal' | 'numeric' }> = [
  { field: 'liters', label: 'fuelLiters', inputMode: 'decimal' },
  { field: 'vendorName', label: 'fuelVendorName' },
  { field: 'vendorTaxCode', label: 'fuelVendorTaxCode', inputMode: 'numeric' },
  { field: 'documentSeries', label: 'fuelDocumentSeries' },
  { field: 'documentNumber', label: 'fuelDocumentNumber' },
];

interface ReceiptFormProps {
  draft: ReceiptDraft;
  onChange: (patch: Partial<ReceiptDraft>) => void;
  vehicles: TripVehicle[];
  images: StagedImage[];
  uploading: boolean;
  onPick: (files: File[]) => void;
  onRemove: (image: StagedImage) => void;
  onSearch: () => void;
}

/**
 * The receipt in hand: its lorry, day and amount — what every search needs —
 * then whatever else is legible on it, and its images. The images are uploaded
 * as they are picked, so the search can recognise one already on a fill.
 */
export function ReceiptForm({ draft, onChange, vehicles, images, uploading, onPick, onRemove, onSearch }: Readonly<ReceiptFormProps>) {
  const { t } = useLanguage();
  const ready = Boolean(draft.vehicleId && draft.businessDate && draft.amount.trim());
  const lorries = vehicles.map((vehicle) => ({ value: vehicle.id, label: formatPlate(vehicle.plate) }));

  return (
    <form
      className="space-y-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSearch();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="fuel-vehicle" className="text-xs font-medium text-gray-600">{t('fuelVehicle')}</label>
          <SearchableSelect
            id="fuel-vehicle"
            items={lorries}
            value={draft.vehicleId}
            onValueChange={(vehicleId) => onChange({ vehicleId })}
            placeholder={t('fuelPickVehicle')}
            emptyText={t('fuelNoVehicle')}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="fuel-day" className="text-xs font-medium text-gray-600">{t('fuelReceiptDay')}</label>
          <DateInput id="fuel-day" value={draft.businessDate} onChange={(businessDate) => onChange({ businessDate })} />
        </div>
        <div className="space-y-1">
          <label htmlFor="fuel-amount" className="text-xs font-medium text-gray-600">{t('fuelAmount')}</label>
          <MoneyInput id="fuel-amount" value={draft.amount} onChange={(amount) => onChange({ amount })} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {TEXT_FIELDS.map(({ field, label, inputMode }) => (
          <div key={field} className="space-y-1">
            <label htmlFor={`fuel-${field}`} className="text-xs font-medium text-gray-600">{t(label)}</label>
            <Input
              id={`fuel-${field}`}
              inputMode={inputMode}
              value={draft[field]}
              onChange={(event) => onChange({ [field]: event.target.value })}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium text-gray-600">{t('fuelImagesLabel')}</span>
        <div className="flex flex-wrap items-center gap-2">
          {images.map((image) => (
            <figure key={image.evidence.id} className="relative size-20 overflow-hidden rounded-lg border border-gray-200">
              <img src={image.previewUrl} alt={image.evidence.originalFilename ?? t('fuelImagesLabel')} className="size-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(image)}
                aria-label={`${t('fuelRemoveImage')} ${image.evidence.originalFilename ?? ''}`.trim()}
                className="absolute top-1 right-1 rounded-full bg-white/90 p-0.5 text-gray-700 shadow hover:text-red-600"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </figure>
          ))}
          <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600">
            <ImagePlus className="size-5" aria-hidden />
            {uploading ? t('fuelUploading') : t('fuelAddImage')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              aria-label={t('fuelAddImage')}
              onChange={(event) => {
                onPick(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="text-xs text-gray-500">{t('fuelImagesHint')}</p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!ready}>
          <Search className="size-4" aria-hidden />
          {t('fuelSearch')}
        </Button>
      </div>
    </form>
  );
}
