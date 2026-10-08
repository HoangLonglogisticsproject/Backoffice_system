import { isRecordableLiters } from './vehicle-fuel';

/**
 * ★ ONE REAL REFUELLING EVENT, FOR ONE LORRY (0037) — and not a ledger. Its
 * money is the backing row's: a lorry's `vehicle_costs` line, or a trip's
 * `trip_costs` fuel line recorded before the lorry ledger existed. Never both.
 *
 * `driverUserId` is only the driver known to have operated or reported this
 * fill, when known. It says nothing about who a lorry "belongs" to — a lorry
 * has no permanent driver, and nothing here may imply one.
 */

/**
 * What a fill may gain, each at most once (NULL → value): its descriptive
 * facts, and — for a TRIP-backed fill only — its readings. A vehicle-backed
 * fill's liters and odometer are the vehicle cost's, never stored twice.
 */
export interface FuelFacts {
  occurredAt: Date | null;
  driverUserId: string | null;
  vendorName: string | null;
  vendorTaxCode: string | null;
  documentSeries: string | null;
  documentNumber: string | null;
  liters: string | null;
  odometerKm: number | null;
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
  'liters',
  'odometerKm',
];

/** The readings a vehicle cost already owns — refused on a vehicle-backed fill. */
export const READING_KEYS: readonly FuelFactKey[] = ['liters', 'odometerKm'];

/** The column each fact lives in — also the `field` of its enrichment row. */
export const FUEL_FACT_COLUMN: Readonly<Record<FuelFactKey, string>> = {
  occurredAt: 'occurred_at',
  driverUserId: 'driver_user_id',
  vendorName: 'vendor_name',
  vendorTaxCode: 'vendor_tax_code',
  documentSeries: 'document_series',
  documentNumber: 'document_number',
  liters: 'liters',
  odometerKm: 'odometer_km',
};

export const NO_FACTS: FuelFacts = {
  occurredAt: null,
  driverUserId: null,
  vendorName: null,
  vendorTaxCode: null,
  documentSeries: null,
  documentNumber: null,
  liters: null,
  odometerKm: null,
};

/** `details` codes on the 422s these rules earn. */
export const FACT_ALREADY_SET = 'FACT_ALREADY_SET';
export const FACT_INVALID = 'FACT_INVALID';

// The shapes 0037's CHECKs hold. Normalised first, then tested.
const TAX_CODE = /^\d{10}(\d{2})?(-\d{3})?$/;
const DOCUMENT_CODE = (max: number) => new RegExp(`^[A-Z0-9][A-Z0-9/.-]{0,${max - 1}}$`);
const SERIES = DOCUMENT_CODE(20);
const NUMBER = DOCUMENT_CODE(30);

/** A fact's value, as any of its columns holds it. */
type FactValue = Date | string | number;

/** How one field is spelled the one way, and whether the spelling is a shape its column holds. */
interface FactRule {
  spell(value: FactValue): FactValue;
  valid(value: FactValue): boolean;
}

const text = (value: FactValue) => String(value).replace(/\s+/g, ' ').trim();
const code = (value: FactValue) => String(value).replace(/[\s.]+/g, '').toUpperCase();
/**
 * Liters as `NUMERIC(10,2)` prints them: "26" → "26.00", "026.5" → "26.50".
 * Only a value already in the recordable shape is respelled; anything else is
 * returned as given, so the rule refuses it rather than a respelling hiding it.
 */
const asStoredLiters = (value: FactValue) => {
  const raw = String(value).trim();
  if (!isRecordableLiters(raw)) return raw;
  const [whole, fraction = ''] = raw.split('.');
  return `${Number(whole)}.${fraction.padEnd(2, '0')}`;
};

const RULES: Partial<Record<FuelFactKey, FactRule>> = {
  vendorName: { spell: text, valid: (v) => String(v).length > 0 && String(v).length <= 200 },
  vendorTaxCode: { spell: (v) => String(v).replace(/[\s.]+/g, ''), valid: (v) => TAX_CODE.test(String(v)) },
  documentSeries: { spell: code, valid: (v) => SERIES.test(String(v)) },
  documentNumber: { spell: code, valid: (v) => NUMBER.test(String(v)) },
  liters: { spell: asStoredLiters, valid: (v) => isRecordableLiters(String(v)) },
  odometerKm: { spell: (v) => v, valid: (v) => Number.isInteger(v) && Number(v) >= 0 },
};

/**
 * ★ ONE SPELLING PER FACT, so a replay of what was typed yesterday is the same
 * value and not a "conflict". Station names keep their letters and lose stray
 * whitespace; codes lose spaces and dots and are upper-cased; liters are
 * written as `NUMERIC(10,2)` prints them. A value that is still not the shape
 * the column holds is refused, by field.
 */
export function normalizeFacts(input: FuelFactsInput): { facts: FuelFactsInput; invalid: FuelFactKey[] } {
  const facts: FuelFactsInput = { ...input };
  const invalid: FuelFactKey[] = [];
  for (const key of FUEL_FACT_KEYS) {
    const value = input[key];
    const rule = RULES[key];
    if (value === undefined || !rule) continue;
    const spelled = rule.spell(value);
    Object.assign(facts, { [key]: spelled });
    if (!rule.valid(spelled)) invalid.push(key);
  }
  return { facts, invalid };
}

const same = (stored: FactValue, incoming: FactValue): boolean =>
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
export const factText = (value: FactValue): string =>
  value instanceof Date ? value.toISOString() : String(value);

export const hasFacts = (facts: FuelFactsInput): boolean => FUEL_FACT_KEYS.some((key) => facts[key] !== undefined);
