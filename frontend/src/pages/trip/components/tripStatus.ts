import { TRIP_STATUS_LABELS, type TripStatus } from '@/types/trip';
import type { TranslationKey } from '@/types/translate';

/**
 * The five states of a trip: what each is called, and what colour it wears.
 *
 * ★ THE COLOURS ARE NOT A DESIGN CHOICE. In the workbook this screen replaces,
 * the state of a trip WAS the fill colour of its row, with a legend at the
 * bottom of each monthly sheet:
 *
 *   red     ĐANG ĐỢI SX                  green   ĐÃ XONG
 *   yellow  SX RỒI ĐANG ĐỢI XE           blue    BOOK XE NGOÀI
 *   orange  THÔNG TIN CẦN XÁC NHẬN LẠI
 *
 * Dispatch reads those colours at a glance and has done for months. Recolouring
 * them to match a palette would mean everybody re-learns a code they already
 * know, for no gain.
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
  awaiting_production: {
    label: TRIP_STATUS_LABELS.awaiting_production,
    className: 'bg-red-50 text-red-700 ring-red-600/20',
  },
  awaiting_vehicle: {
    label: TRIP_STATUS_LABELS.awaiting_vehicle,
    className: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  },
  needs_confirmation: {
    label: TRIP_STATUS_LABELS.needs_confirmation,
    className: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  },
  external_booking: {
    label: TRIP_STATUS_LABELS.external_booking,
    className: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  },
  done: {
    label: TRIP_STATUS_LABELS.done,
    className: 'bg-green-50 text-green-700 ring-green-600/20',
  },
};
