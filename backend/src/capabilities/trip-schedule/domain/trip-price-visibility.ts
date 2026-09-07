import { can, type AuthorizationContext } from '../../../core/authorization/domain/authorization.context';

/**
 * The two figures on a trip row that not every caller may see.
 *
 * Structural rather than `Pick<TripSchedule, …>` so the operational board's
 * rows — a different projection of the same table — pass through the same
 * function without importing each other's types.
 */
export interface TripPrices {
  sellPrice: string | null;
  purchasePrice: string | null;
}

/**
 * May this caller see what a trip is sold and bought for?
 *
 * One question, asked in one place, so the guard on the write path and the
 * blanking on the read path cannot come to different answers. The decision
 * itself is `can()` — the same pure function every route is judged by — with
 * no target, because a trip belongs to no department.
 */
export const canSeeTripPrices = (authorization: AuthorizationContext | undefined): boolean =>
  authorization !== undefined && can(authorization, 'trip.price.read');

/**
 * Hands back the row with both prices blanked, unless the caller may see them.
 *
 * ★ WHY A PROJECTION AND NOT A NARROWER QUERY. 0024 put the quoted price on
 * `trip_schedules` and wrote down what it would take to restrict it later: "its
 * own permission and its own projection". This is the projection half. The
 * columns are still SELECTed — the same statement serves both kinds of caller,
 * and a second query built by permission would be a second query to keep
 * correct — and the narrowing happens once, here, on the way out.
 *
 * ★ BLANKED TO `null`, NOT DELETED FROM THE OBJECT. Two reasons and the second
 * is the real one:
 *
 *   The shape stays the shape. `TripSchedule` says `string | null`, and a
 *   response that sometimes omits the key would make every client write
 *   `'sellPrice' in trip` to tell "no permission" from "not priced".
 *
 *   ⚠ AND THE CLIENT IS DELIBERATELY NOT TOLD WHICH IT IS. An unpriced trip and
 *   a trip whose price is withheld look identical from outside, so the response
 *   never discloses THAT a figure exists — only somebody who may read it learns
 *   that much. A distinct marker would leak one bit about every trip on the
 *   board, which is a small leak repeated a few hundred times a day.
 *
 * ★ A NEW OBJECT, NEVER A MUTATION. The row may be the same object a caller
 * upstream is holding — the service returns what the repository mapped — and
 * blanking in place would redact it for everybody who shares the reference,
 * including the write path that has to return what it just stored.
 */
export const redactPrices = <T extends TripPrices>(row: T, visible: boolean): T =>
  visible ? row : { ...row, sellPrice: null, purchasePrice: null };

/** The same, for a page or any other list of rows. */
export const redactPricesIn = <T extends TripPrices>(rows: readonly T[], visible: boolean): T[] =>
  rows.map((row) => redactPrices(row, visible));
