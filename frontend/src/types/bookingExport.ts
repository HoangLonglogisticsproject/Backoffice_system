/**
 * "Phiếu booking" — `GET /trip-schedules/:tripId/booking-export` (contract §30).
 * Mirrors `backend/.../domain/booking-export.ts`.
 *
 * ★ ONE EXTERNAL-SAFE DOCUMENT, THE SAME FOR EVERY READER. The server builds it
 * from an allowlist: no price, cost, internal note, status or id exists on it to
 * hide, so nothing here is redacted and nothing reads a permission.
 */
export interface BookingExport {
  /** The planned pickup day, `YYYY-MM-DD` — a calendar day, never an instant. */
  scheduledOn: string;
  /** Planned ISO instants; `null` until booked to the hour. */
  scheduledPickupAt: string | null;
  scheduledDeliveryAt: string | null;
  pickup: BookingExportStop;
  delivery: BookingExportStop;
  customerName: string | null;
  cargoInfo: string | null;
  /** The one note written for people outside the office ("Ghi chú vận hành"). */
  driverInstructions: string | null;
  /** 0..N lorries, oldest first. */
  crew: BookingExportCrewMember[];
}

export interface BookingExportStop {
  /** The place on file; `null` on an end typed as free text. */
  name: string | null;
  address: string | null;
  contact: string | null;
}

export interface BookingExportCrewMember {
  /** As stored — format with `formatPlate`. `null` on a pre-0027 turn. */
  plate: string | null;
  driverName: string;
}
