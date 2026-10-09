import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchTripVehicles } from '@/api/tripCatalogue';
import { PageHeader } from '@/components/common/PageHeader';
import { useLanguage } from '@/contexts/LanguageContext';
import { tripKeys } from '@/hooks/trip/keys';
import { useFuelReceipt } from '@/hooks/trip/useFuelReceipt';
import { useBusinessToday } from '@/hooks/useBusinessToday';
import type { FuelCandidate, FuelReceiptQuery } from '@/types/fuel';
import { FuelAttachDialog } from './fuel/FuelAttachDialog';
import { sharingFills } from './fuel/fuelCandidates';
import { FuelMatchPanel } from './fuel/FuelMatchPanel';
import { ReceiptForm, type ReceiptDraft } from './fuel/ReceiptForm';
import { StagedLeftovers } from './fuel/StagedLeftovers';

/** The receipt as the API takes it: a field left blank is not sent. */
const toQuery = ({ vehicleId: _vehicle, businessDate, amount, ...rest }: ReceiptDraft): FuelReceiptQuery => ({
  businessDate,
  amount: amount.trim(),
  ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value !== '')),
});

/**
 * "Đối soát chứng từ" — Accounting's screen for receipts of fuel that is
 * ALREADY recorded, on a lorry's ledger or a trip's (`cost.import`).
 *
 * ★ ATTACH-ONLY. It finds candidates on both ledgers, a person picks one, and
 * the receipt goes onto that cost — opening its fuel record or adding to the
 * one it has. With no candidate, it says so and writes nothing: a cost is
 * recorded through its own workflow, never as a side effect of a receipt.
 */
export default function FuelReceiptPage() {
  const { t } = useLanguage();
  const today = useBusinessToday();
  const fuel = useFuelReceipt();
  const [draft, setDraft] = useState<ReceiptDraft>({
    vehicleId: null, businessDate: today, amount: '', liters: '', vendorName: '', vendorTaxCode: '', documentSeries: '', documentNumber: '',
  });
  const [target, setTarget] = useState<FuelCandidate | null>(null);
  // Archived lorries too: a receipt can be older than a lorry's service.
  const vehicles = useQuery({ queryKey: tripKeys.vehicles(true), queryFn: () => fetchTripVehicles(true), enabled: fuel.allowed });

  if (!fuel.allowed) return <PageHeader title={t('fuelReceipts')} subtitle={t('fuelReceiptsNoAccess')} />;

  const { search, matches } = fuel;
  const attach = (acknowledged: string[]) => {
    if (!target || !search) return;
    const { businessDate, amount: _amount, ...facts } = search.receipt;
    fuel.attach.mutate(
      {
        target,
        attachment: {
          evidenceIds: fuel.images.map((image) => image.evidence.id),
          facts,
          acknowledgedMatches: acknowledged,
          vehicleId: search.vehicleId,
          businessDate,
        },
      },
      { onSettled: () => setTarget(null) },
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('fuelReceipts')} subtitle={t('fuelReceiptsSubtitle')} />
      <ReceiptForm
        draft={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        vehicles={vehicles.data ?? []}
        images={fuel.images}
        uploading={fuel.upload.isPending}
        onPick={(files) => files.forEach((file) => fuel.upload.mutate(file))}
        onRemove={(image) => fuel.discard.mutate(image.evidence)}
        onSearch={() =>
          fuel.setSearch({
            vehicleId: draft.vehicleId as string,
            receipt: toQuery(draft),
            evidenceIds: fuel.images.map((image) => image.evidence.id),
          })
        }
      />
      <StagedLeftovers leftovers={fuel.leftovers} onUse={fuel.reuse} onDiscard={(image) => fuel.discard.mutate(image)} />
      {matches.isError ? <p role="alert" className="text-sm text-red-600">{t('fuelSearchFailed')}</p> : null}
      {matches.isFetching && !matches.data ? <p className="py-6 text-center text-sm text-gray-500">{t('driverLoading')}</p> : null}
      {matches.data ? <FuelMatchPanel result={matches.data} onAttach={setTarget} /> : null}
      {target && matches.data ? (
        <FuelAttachDialog
          target={target}
          others={sharingFills(target, matches.data.matches)}
          imageCount={fuel.images.length}
          pending={fuel.attach.isPending}
          onCancel={() => setTarget(null)}
          onConfirm={attach}
        />
      ) : null}
    </div>
  );
}
