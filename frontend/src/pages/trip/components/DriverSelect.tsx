import { useLanguage } from '@/contexts/LanguageContext';
import type { UserSummary } from '@/types/organization';

/**
 * The eligible drivers, as one select.
 *
 * ★ SHARED BY THE DISPATCH PANEL AND THE "THÊM CHUYẾN" FORM, so the two places
 * a crew is put on a trip offer the same list under the same words. Extracted
 * when the second caller appeared, not in advance of one.
 */
export function DriverSelect({
  id,
  value,
  onChange,
  options,
  loading,
  required = true,
}: Readonly<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: UserSummary[];
  loading: boolean;
  /**
   * Off where the row carries its own message. The create form validates in
   * JavaScript so it can name WHICH row is incomplete; a native bubble cannot,
   * and would also fire before the form's own checks had a chance to run.
   */
  required?: boolean;
}>) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {t('selectDriver')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">{loading ? t('loading') : t('selectDriver')}</option>
        {options.map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
