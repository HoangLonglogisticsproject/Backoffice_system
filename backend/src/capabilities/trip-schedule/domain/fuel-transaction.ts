/**
 * ★ ONE REAL REFUELLING EVENT, FOR ONE LORRY (0037) — and not a ledger. Its
 * money is the backing row's: a lorry's `vehicle_costs` line, or a trip's
 * `trip_costs` fuel line recorded before the lorry ledger existed. Never both.
 *
 * `driverUserId` is only the driver known to have operated or reported this
 * fill, when known. It says nothing about who a lorry "belongs" to — a lorry
 * has no permanent driver, and nothing here may imply one.
 */

/** The descriptive facts a fill may gain, each at most once (NULL → value). */
export interface FuelFacts {
  occurredAt: Date | null;
  driverUserId: string | null;
  vendorName: string | null;
  vendorTaxCode: string | null;
  documentSeries: string | null;
  documentNumber: string | null;
}

export type FuelFactKey = keyof FuelFacts;

/** What a command brings: a fact it does not mention is `undefined`, never cleared. */
export type FuelFactsInput = { [K in FuelFactKey]?: NonNullable<FuelFacts[K]> };

export const FUEL_FACT_KEYS: readonly FuelFactKey[] = [
  'occurredAt',
  'driverUserId',
  'vendorName',
  'vendorTaxCode',
  'documentSeries',
  'documentNumber',
];

/** The column each fact lives in — also the `field` of its enrichment row. */
export const FUEL_FACT_COLUMN: Readonly<Record<FuelFactKey, string>> = {
  occurredAt: 'occurred_at',
  driverUserId: 'driver_user_id',
  vendorName: 'vendor_name',
  vendorTaxCode: 'vendor_tax_code',
  documentSeries: 'document_series',
  documentNumber: 'document_number',
};

export const NO_FACTS: FuelFacts = {
  occurredAt: null,
  driverUserId: null,
  vendorName: null,
  vendorTaxCode: null,
  documentSeries: null,
  documentNumber: null,
};

/** `details` codes on the 422s these rules earn. */
export const FACT_ALREADY_SET = 'FACT_ALREADY_SET';
export const FACT_INVALID = 'FACT_INVALID';

// The shapes 0037's CHECKs hold. Normalised first, then tested.
const TAX_CODE = /^\d{10}(\d{2})?(-\d{3})?$/;
const DOCUMENT_CODE = (max: number) => new RegExp(`^[A-Z0-9][A-Z0-9/.-]{0,${max - 1}}$`);
const SERIES = DOCUMENT_CODE(20);
const NUMBER = DOCUMENT_CODE(30);

/**
 * ★ ONE SPELLING PER FACT, so a replay of what was typed yesterday is the same
 * value and not a "conflict". Station names keep their letters and lose stray
 * whitespace; codes lose spaces and dots and are upper-cased. A value that is
 * still not the shape the column holds is refused, by field.
 */
export function normalizeFacts(input: FuelFactsInput): { facts: FuelFactsInput; invalid: FuelFactKey[] } {
  const facts: FuelFactsInput = { ...input };
  const invalid: FuelFactKey[] = [];
  const text = (value: string) => value.replace(/\s+/g, ' ').trim();
  const code = (value: string) => value.replace(/[\s.]+/g, '').toUpperCase();

  if (input.vendorName !== undefined) {
    facts.vendorName = text(input.vendorName);
    if (facts.vendorName.length === 0 || facts.vendorName.length > 200) invalid.push('vendorName');
  }
  if (input.vendorTaxCode !== undefined) {
    facts.vendorTaxCode = input.vendorTaxCode.replace(/[\s.]+/g, '');
    if (!TAX_CODE.test(facts.vendorTaxCode)) invalid.push('vendorTaxCode');
  }
  if (input.documentSeries !== undefined) {
    facts.documentSeries = code(input.documentSeries);
    if (!SERIES.test(facts.documentSeries)) invalid.push('documentSeries');
  }
  if (input.documentNumber !== undefined) {
    facts.documentNumber = code(input.documentNumber);
    if (!NUMBER.test(facts.documentNumber)) invalid.push('documentNumber');
  }
  return { facts, invalid };
}

const same = (stored: Date | string, incoming: Date | string): boolean =>
  stored instanceof Date && incoming instanceof Date
    ? stored.getTime() === incoming.getTime()
    : stored === incoming;

/**
 * ★ FIELD BY FIELD, APPEND-ONLY. Each fact a command brings is judged alone:
 *
 *   stored NULL                → an addition
 *   stored, the same value     → nothing (a replay)
 *   stored, a different value  → a conflict — never an overwrite
 *
 * Facts may arrive over many commands. A wrong stored value is corrected by
 * the SuperAdmin's void-and-recreate, not by writing over it.
 */
export function mergeFacts(
  stored: FuelFacts,
  incoming: FuelFactsInput,
): { additions: FuelFactsInput; conflicts: FuelFactKey[] } {
  const additions: FuelFactsInput = {};
  const conflicts: FuelFactKey[] = [];
  for (const key of FUEL_FACT_KEYS) {
    const value = incoming[key];
    if (value === undefined) continue;
    const current = stored[key];
    if (current === null) Object.assign(additions, { [key]: value });
    else if (!same(current, value)) conflicts.push(key);
  }
  return { additions, conflicts };
}

/** A fact as its enrichment row records it. */
export const factText = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export const hasFacts = (facts: FuelFactsInput): boolean => FUEL_FACT_KEYS.some((key) => facts[key] !== undefined);
