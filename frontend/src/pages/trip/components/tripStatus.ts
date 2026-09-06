import { TRIP_STATUS_LABELS, type TripStatus } from '@/types/trip';
import type { TranslationKey } from '@/types/translate';

/**
 * The four states of a trip: what each is called, and what colour it wears.
 *
 * ★ THE COLOURS CARRY THE LIFECYCLE, NOT A PALETTE. The board used to wear the
 * workbook's five row colours, and the comment here used to argue hard for
 * keeping them: dispatch had read that code for months. 0025 replaced the five
 * states with four lifecycle ones, so the legend no longer describes anything —
 * and keeping its colours would have preserved the LOOK of a code whose meaning
 * had gone.
 *
 * The four now run cool → warm → settled, so a glance down the column reads as
 * progress: grey (nothing settled), blue (arranged), amber (moving), green
 * (closed). Green is the one carried over deliberately — ĐÃ XONG was green, and
 * closed still is.
 *
 * ⚠ AND THE COLOUR IS NEVER THE ONLY SIGNAL. Every control that uses this map
 * also renders the label, so the meaning survives greyscale printing and colour
 * blindness — which the spreadsheet's bare row fill did not.
 *
 * ★ THE LABELS ARE NOT DEFINED HERE. They live with the status type in
 * `types/trip`, because the mutation that announces a change needs the name
 * without needing the palette. This module owns the COLOURS.
 *
 * In its own module rather than beside the badge because three things need it
 * now — the badge, the inline status control, and the trip form's dropdown —
 * and the version that lived in the form had already drifted into a second
 * copy of the labels.
 */
export const TRIP_STATUS_STYLES: Record<TripStatus, { label: TranslationKey; className: string }> = {
  pending: {
    label: TRIP_STATUS_LABELS.pending,
    className: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  },
  confirmed: {
    label: TRIP_STATUS_LABELS.confirmed,
    className: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  },
  executing: {
    label: TRIP_STATUS_LABELS.executing,
    className: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  },
  finished: {
    label: TRIP_STATUS_LABELS.finished,
    className: 'bg-green-50 text-green-700 ring-green-600/20',
  },
};
