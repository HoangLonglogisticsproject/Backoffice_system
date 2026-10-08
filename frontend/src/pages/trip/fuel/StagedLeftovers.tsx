import { Button } from '@/components/ui/button';
import { fuelEvidenceContentUrl } from '@/api/fuelEvidence';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FuelEvidence } from '@/types/fuel';

interface StagedLeftoversProps {
  leftovers: FuelEvidence[];
  onUse: (evidence: FuelEvidence) => void;
  onDiscard: (evidence: FuelEvidence) => void;
}

/**
 * Images this person uploaded before and never attached — a closed tab, a
 * crash, a lost network — read back from the SERVER. Each is used for this
 * receipt or discarded by a person; none goes onto a cost on its own.
 */
export function StagedLeftovers({ leftovers, onUse, onDiscard }: Readonly<StagedLeftoversProps>) {
  const { t } = useLanguage();
  if (leftovers.length === 0) return null;
  const title = `${t('fuelLeftoversTitle')} (${leftovers.length})`;
  return (
    <section aria-label={title} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">{title}</h3>
          <p className="text-xs text-amber-900">{t('fuelLeftoversHint')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => leftovers.forEach(onDiscard)}>
          {t('fuelDiscardAll')}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-3">
        {leftovers.map((image) => (
          <li key={image.id} className="w-24 space-y-1">
            <img
              src={fuelEvidenceContentUrl(image.id)}
              alt={image.originalFilename ?? t('fuelImagesLabel')}
              className="size-24 rounded-lg border border-gray-200 bg-white object-cover"
            />
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => onUse(image)}>
                {t('fuelUseImage')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`${t('fuelRemoveImage')} ${image.originalFilename ?? ''}`.trim()}
                onClick={() => onDiscard(image)}
              >
                {t('fuelDiscardShort')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
