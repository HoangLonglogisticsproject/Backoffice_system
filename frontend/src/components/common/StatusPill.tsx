import type { ReactNode } from 'react';

/**
 * The Backoffice status pill — the ring-bordered capsule every list uses to
 * say what state a row is in (a membership, a decision, a catalogue entry).
 * One place for the three tones, so a new list gets the same pill rather
 * than a near copy.
 */
export type StatusTone = 'green' | 'amber' | 'gray';

const TONES: Record<StatusTone, string> = {
  green: 'bg-green-50 text-green-700 ring-green-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  gray: 'bg-gray-50 text-gray-600 ring-gray-500/10',
};

export function StatusPill({ tone, children }: Readonly<{ tone: StatusTone; children: ReactNode }>) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
