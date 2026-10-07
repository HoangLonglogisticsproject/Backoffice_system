/**
 * "Phiếu booking" — the ONE external-safe document a trip can be exported as.
 *
 * ★ A FIXED CONTRACT, NOT A PERMISSION-SHAPED ONE. The PNG built from this is
 * downloaded and sent on — Zalo, email — to customers, drivers and partners.
 * So it carries the same fields for SuperAdmin, Dispatch, Sales, Customer
 * Service and Accounting alike: whoever may read the trip (`trip.read`) gets
 * exactly this, and nobody gets more. There is no price here to redact.
 *
 * ★ AN ALLOWLIST, BUILT IN THE SELECT (`persistence/booking-export.repository`).
 * Every field below was named on purpose; a column added to `trip_schedules`
 * later does not appear until somebody decides it should. Same doctrine as the
 * driver read model (contract §5.4.1, DL-82).
 *
 * ★ WHAT IS DELIBERATELY ABSENT, AND WHY:
 *
 *   sell / purchase price, margin, trip costs, hires, vehicle costs, fuel
 *                     commercial — never selected, never joined.
 *   note              GHI CHÚ: internal free text with no stated audience; it
 *                     may hold prices and payment terms (contract §5.2).
 *   status            the dispatch board's word. "Đã xác nhận" means DONE here,
 *                     and on a booking confirmation it would read as "booked".
 *   ids               internal UUIDs — the caller already holds the trip's.
 *   created_by, archived_*, closed_*   internal bookkeeping.
 *   driver phone      not stored anywhere; nothing to leak.
 *   customer contact  no such field — `trip_customers` has a name and an
 *                     internal note, and only the name is read.
 *
 * ⚠ RESIDUAL RISK, STATED: cargo, the two addresses and the two contacts are
 * free text Operations types. The contract accepts them as execution data
 * that leaves the office (DL-68); `driverInstructions` is the one free-text
 * field safe by construction.
 */
export interface BookingExport {
  /** The planned pickup day, `YYYY-MM-DD` — never a `Date` (off by one in Hồ Chí Minh). */
  scheduledOn: string;
  /** Planned instants, not actual ones. `null` until booked to the hour. */
  scheduledPickupAt: Date | null;
  scheduledDeliveryAt: Date | null;
  pickup: BookingExportStop;
  delivery: BookingExportStop;
  /** The catalogue name only. `null` for an internal move. */
  customerName: string | null;
  cargoInfo: string | null;
  /** Written FOR people outside the office (0017) — the only note that leaves. */
  driverInstructions: string | null;
  /** The board's crew, oldest first: 0..N lorries, each with its driver (ADR-0004). */
  crew: BookingExportCrewMember[];
}

/**
 * One end of the run. `name` is the place on file; `address` and `contact` are
 * the trip's own snapshot (0022) — what the driver drives to and calls.
 */
export interface BookingExportStop {
  name: string | null;
  address: string | null;
  contact: string | null;
}

/** A lorry and its driver: the plate and the display name, nothing else. */
export interface BookingExportCrewMember {
  /** `null` only on a pre-0027 turn that never named a lorry. */
  plate: string | null;
  driverName: string;
}
