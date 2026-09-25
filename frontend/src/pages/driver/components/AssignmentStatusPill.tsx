import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/types/translate';
import type { AssignmentStatus } from '@/utils/driverExecution';

/**
 * An assignment's status, as the shared pill says it.
 *
 * ★ THIS FILE OWNS THE WORDS AND THE COLOURS, NOTHING ELSE. Which status an
 * assignment is in is `assignmentStatusOf`'s decision; the pill is the
 * Backoffice's own. Every status has its words, so colour is never the only
 * thing that says it.
 *
 *   gray   nothing reported yet
 *   blue   on the road
 *   amber  waiting — on the driver's submission or on the office's review
 *   red    sent back: the driver has something to fix
 *   green  approved
 */
const PRESENTATION: Record<AssignmentStatus, { label: TranslationKey; tone: StatusTone }> = {
  assigned: { label: 'driverStatusAssigned', tone: 'gray' },
  'at-pickup': { label: 'driverStatusAtPickup', tone: 'blue' },
  'in-transit': { label: 'driverStatusInTransit', tone: 'blue' },
  'at-delivery': { label: 'driverStatusAtDelivery', tone: 'blue' },
  'awaiting-completion': { label: 'driverStatusAwaitingCompletion', tone: 'amber' },
  'completion-pending': { label: 'driverStatusCompletionPending', tone: 'amber' },
  'completion-rejected': { label: 'driverStatusCompletionRejected', tone: 'red' },
  approved: { label: 'driverStatusApproved', tone: 'green' },
};

export function AssignmentStatusPill({ status }: Readonly<{ status: AssignmentStatus }>) {
  const { t } = useLanguage();
  const { label, tone } = PRESENTATION[status];
  return <StatusPill tone={tone}>{t(label)}</StatusPill>;
}
