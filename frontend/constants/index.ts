/*
 * @bo/constants — values shared frontend-wide.
 *
 * Not a bucket. A constant belongs here only when more than one owner reads it
 * AND it is generic: business thresholds live with their feature, customer
 * values live in `app/tenant/`.
 */
export * from './breakpoints';
