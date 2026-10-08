import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { FuelCandidate, FuelLedger, FuelMatchLevel, FuelMatchResult } from '@/types/fuel';
import type { TranslationKey } from '@/types/translate';
import { formatPlate } from '@/utils/format';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { blockedReason } from './fuelCandidates';

const LEVEL: Record<FuelMatchLevel, { label: TranslationKey; tone: StatusTone }> = {
  exact: { label: 'fuelLevelExact', tone: 'red' },
  high: { label: 'fuelLevelHigh', tone: 'amber' },
  possible: { label: 'fuelLevelPossible', tone: 'blue' },
};
const LEDGER: Record<FuelLedger, TranslationKey> = { vehicle: 'fuelLedgerVehicle', trip: 'fuelLedgerTrip' };
const OUTCOME: Record<FuelMatchResult['outcome'], TranslationKey> = {
  none: 'fuelOutcomeNone',
  single: 'fuelOutcomeSingle',
  ambiguous: 'fuelOutcomeAmbiguous',
};

function CandidateRow({ candidate, onAttach }: Readonly<{ candidate: FuelCandidate; onAttach: (c: FuelCandidate) => void }>) {
  const { t, language } = useLanguage();
  const day = candidate.businessDate ?? candidate.trip?.scheduledOn ?? null;
  const blocked = blockedReason(candidate);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-56 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
          {candidate.level ? <StatusPill tone={LEVEL[candidate.level].tone}>{t(LEVEL[candidate.level].label)}</StatusPill> : null}
          <span className="tabular-nums">{formatMoney(candidate.amount)} đ</span>
          {candidate.liters ? <span className="text-gray-500 tabular-nums">· {candidate.liters} L</span> : null}
          <span className="text-gray-500">· {day ? formatCalendarDay(day, language) : '—'}</span>
          <span className="text-gray-500">· {candidate.vehicle ? formatPlate(candidate.vehicle.plate) : t('fuelLorryUnknown')}</span>
        </div>
        <p className="text-xs text-gray-500">
          {t(LEDGER[candidate.backing.ledger])} · {t(candidate.backing.source === 'driver_portal' ? 'fuelSourceDriver' : 'fuelSourceOffice')}
          {candidate.driver ? ` · ${candidate.driver.displayName}` : ''}
          {candidate.trip ? ` · ${t('fuelTrip')} ${formatCalendarDay(candidate.trip.scheduledOn, language)}` : ''}
          {candidate.trip?.customerName ? ` · ${candidate.trip.customerName}` : ''}
        </p>
        <p className="text-xs text-gray-500">
          {candidate.fuelTransactionId
            ? `${t('fuelWrapped')} · ${candidate.evidenceCount} ${t('fuelImageCount')}`
            : t('fuelNotWrapped')}
          {candidate.vendor?.name ? ` · ${candidate.vendor.name}` : ''}
          {candidate.document?.number ? ` · ${t('fuelDocumentNumber')} ${candidate.document.number}` : ''}
        </p>
        {blocked ? <p className="text-xs text-red-600">{t(blocked)}</p> : null}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={blocked !== null} onClick={() => onAttach(candidate)}>
        {t('fuelAttachHere')}
      </Button>
    </li>
  );
}

function Group({ title, candidates, onAttach }: Readonly<{ title: string; candidates: FuelCandidate[]; onAttach: (c: FuelCandidate) => void }>) {
  if (candidates.length === 0) return null;
  return (
    <section aria-label={title} className="rounded-xl border border-gray-100 bg-white px-4 shadow-sm">
      <h3 className="pt-3 text-sm font-semibold text-gray-700">{title}</h3>
      <ul className="divide-y divide-gray-100">
        {candidates.map((candidate) => (
          <CandidateRow key={`${candidate.backing.ledger}:${candidate.backing.costId}`} candidate={candidate} onAttach={onAttach} />
        ))}
      </ul>
    </section>
  );
}

/**
 * What the search found, grouped by the ledger that holds the money. ★ IT
 * NEVER CHOOSES: even one candidate waits for a person to press "Gắn", and
 * "none" offers no way to create a cost — that is another workflow's.
 */
export function FuelMatchPanel({ result, onAttach }: Readonly<{ result: FuelMatchResult; onAttach: (c: FuelCandidate) => void }>) {
  const { t } = useLanguage();
  const byLedger = (ledger: FuelLedger) => result.matches.filter((match) => match.backing.ledger === ledger);
  return (
    <div className="space-y-3">
      <div role="status" className={result.outcome === 'none' ? 'rounded-lg bg-amber-50 p-3 text-sm text-amber-900' : 'rounded-lg bg-blue-50 p-3 text-sm text-blue-900'}>
        <p className="font-medium">
          {t(OUTCOME[result.outcome])}
          {result.outcome === 'ambiguous' ? ` (${result.matches.length})` : ''}
        </p>
        <p className="mt-1 text-xs">{t(result.outcome === 'none' ? 'fuelNoCreateHint' : 'fuelPickHint')}</p>
      </div>
      {(['vehicle', 'trip'] as const).map((ledger) => (
        <Group key={ledger} title={t(LEDGER[ledger])} candidates={byLedger(ledger)} onAttach={onAttach} />
      ))}
      {result.dayRows.length > 0 ? (
        <details className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            {t('fuelDayRows')} ({result.dayRows.length})
          </summary>
          <ul className="divide-y divide-gray-100">
            {result.dayRows.map((candidate) => (
              <CandidateRow key={`${candidate.backing.ledger}:${candidate.backing.costId}`} candidate={candidate} onAttach={onAttach} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
