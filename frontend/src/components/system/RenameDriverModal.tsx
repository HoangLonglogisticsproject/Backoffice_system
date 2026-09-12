import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { renameDriver } from '@/api/driverAccounts';
import { isApiError } from '@/utils/errors';
import type { DriverAccount } from '@/api/driverAccounts';

/**
 * Corrects the name a driver is known by.
 *
 * ★ ONE FIELD, BECAUSE ONE FIELD IS WHAT MAY CHANGE. A driver account holds a
 * name, a sign-in address, a status and a created date — and of those only the
 * name is ever simply WRONG. The address is an identity (changing it decides
 * who can sign in), the status has its own confirmed action beside this one,
 * and the date is history. A dialog offering all four would invite three
 * decisions nobody came here to make.
 *
 * ★ THE NAME IS NOT COPIED ONTO PAST TRIPS, so fixing it fixes it everywhere —
 * the board, the driver's own app, every completion already reviewed. That is
 * the point: a misspelling left alone turns one person into two.
 *
 * ★ SUPERADMIN ONLY, AND THE SERVER IS WHAT SAYS SO. The route behind this
 * requires `user.write`, a tier only an active SUPERADMIN holds. This whole
 * screen is already behind the same key, so there is no extra check here to
 * drift out of step with it.
 */
export function RenameDriverModal({
  driver,
  onClose,
  onRenamed,
}: Readonly<{
  driver: DriverAccount;
  onClose: () => void;
  onRenamed: () => void | Promise<void>;
}>) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState(driver.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = displayName.trim();
  // Empty is refused, and so is "no change" — saving a name back onto itself
  // is a request that can only fail or do nothing.
  const submittable = trimmed !== '' && trimmed !== driver.displayName;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!submittable || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renameDriver(driver.id, trimmed);
      await onRenamed();
      onClose();
    } catch (error_) {
      // The server refuses a blank name and a target that is not a driver with
      // a sentence of its own; that sentence is the honest one to show.
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const formId = 'rename-driver-form';

  return (
    <Modal
      isOpen
      onClose={busy ? () => undefined : onClose}
      title={t('renameDriver')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={busy || !submittable}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="driver-display-name" className="text-sm font-medium text-gray-700">
            {t('colDriver')}
          </label>
          <Input
            id="driver-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoFocus
            required
            maxLength={200}
          />
          <p className="text-xs text-gray-500">{t('renameDriverHint')}</p>
        </div>

        {/* The sign-in address is shown so nobody mistakes this dialog for the
            one that changes it — which does not exist. */}
        <p className="text-xs text-gray-500">
          {t('colUsername')}: <code className="font-mono">{driver.username ?? '—'}</code>
        </p>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
