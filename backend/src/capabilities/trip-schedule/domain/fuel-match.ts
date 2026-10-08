import { NO_FACTS, mergeFacts, type FuelFactKey, type FuelFactsInput } from './fuel-transaction';
import type { FuelTransactionView } from './fuel-transaction-view';

/**
 * ★ WHICH COST ALREADY RECORDS THIS RECEIPT? — answered with candidates, never
 * with a choice (PR-2). Accounting holds a real fuel receipt and attaches it to
 * the money row that already records it, on either ledger. Nothing here creates
 * a cost and nothing picks one: a person does, by naming the cost.
 *
 *   exact      the same image bytes are already on that fill
 *   high       the same tax code and document number are already on that fill
 *   possible   the searched lorry, the same amount, within a day of the receipt,
 *              and nothing on it contradicting the receipt
 *
 *   none       nothing looks like it — the cost is recorded through its own workflow first
 *   single     one candidate — still confirmed by a person
 *   ambiguous  several — never chosen for the person
 */
export type MatchLevel = 'exact' | 'high' | 'possible';
export type MatchBasis = 'evidence_hash' | 'document_identity' | 'fingerprint';
export type MatchOutcome = 'none' | 'single' | 'ambiguous';

/** What the receipt in hand says, its facts already in their one spelling. */
export interface FuelReceipt {
  businessDate: string;
  amount: string;
  facts: Pick<FuelFactsInput, 'liters' | 'vendorName' | 'vendorTaxCode' | 'documentSeries' | 'documentNumber'>;
}

/** A cost the search saw, before it is judged. */
export interface SeenCost {
  view: Omit<FuelTransactionView, 'evidence'>;
  evidenceCount: number;
  /** One of the receipt's images is already on this cost's fill. */
  imageOnFill: boolean;
  /** On the searched lorry within a day of the receipt — the only rows a fingerprint may match. */
  nearby: boolean;
}

export type FuelCandidate = Omit<FuelTransactionView, 'evidence'> & {
  evidenceCount: number;
  level: MatchLevel | null;
  /** Why, strongest first. */
  basis: MatchBasis[];
  /** Receipt facts this fill already holds differently — attaching them would be refused. */
  conflicts: FuelFactKey[];
};

export interface FuelMatchResult {
  outcome: MatchOutcome;
  /** Candidates, strongest first. */
  matches: FuelCandidate[];
  /** The lorry's other fuel costs around the day — visible, so a mismatched or lumped line is not missed. */
  dayRows: FuelCandidate[];
}

const LEVEL: Record<MatchBasis, MatchLevel> = { evidence_hash: 'exact', document_identity: 'high', fingerprint: 'possible' };
const RANK: Record<MatchLevel, number> = { exact: 0, high: 1, possible: 2 };
/** A fill whose receipt says otherwise is another receipt's fill. */
const IDENTITY_KEYS: ReadonlySet<FuelFactKey> = new Set<FuelFactKey>(['vendorTaxCode', 'documentSeries', 'documentNumber']);

const sameDecimal = (a: string | null | undefined, b: string | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined || Number(a) === Number(b);
const dayOf = (view: SeenCost['view']) => view.businessDate ?? view.trip?.scheduledOn ?? null;
const daysApart = (a: string | null, b: string) =>
  a === null ? Number.POSITIVE_INFINITY : Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** Facts the fill stores; a lorry-ledger fill's liters are the cost's, so never a stored fact here. */
function conflictsOf({ facts }: FuelReceipt, view: SeenCost['view']): FuelFactKey[] {
  const stored = {
    ...NO_FACTS,
    vendorName: view.vendor?.name ?? null,
    vendorTaxCode: view.vendor?.taxCode ?? null,
    documentSeries: view.document?.series ?? null,
    documentNumber: view.document?.number ?? null,
    liters: view.backing.ledger === 'trip' ? view.liters : null,
  };
  return mergeFacts(stored, facts).conflicts;
}

function sameDocument({ facts }: FuelReceipt, view: SeenCost['view']): boolean {
  const { vendorTaxCode, documentNumber, documentSeries } = facts;
  if (!vendorTaxCode || !documentNumber) return false;
  const series = view.document?.series;
  return (
    view.vendor?.taxCode === vendorTaxCode &&
    view.document?.number === documentNumber &&
    (!documentSeries || !series || series === documentSeries)
  );
}

function judgeOne(receipt: FuelReceipt, seen: SeenCost): FuelCandidate {
  const { view } = seen;
  const conflicts = conflictsOf(receipt, view);
  const basis: MatchBasis[] = [];
  if (seen.imageOnFill) basis.push('evidence_hash');
  if (sameDocument(receipt, view)) basis.push('document_identity');
  const fingerprint =
    seen.nearby &&
    daysApart(dayOf(view), receipt.businessDate) <= 1 &&
    Number(view.amount) === Number(receipt.amount) &&
    sameDecimal(view.liters, receipt.facts.liters) &&
    !conflicts.some((key) => IDENTITY_KEYS.has(key));
  if (fingerprint) basis.push('fingerprint');
  const level = basis[0] ? LEVEL[basis[0]] : null;
  return { ...view, evidenceCount: seen.evidenceCount, level, basis, conflicts };
}

function outcomeOf(count: number): MatchOutcome {
  if (count === 0) return 'none';
  return count === 1 ? 'single' : 'ambiguous';
}

/**
 * Judges every cost the search saw. A cost is one candidate however many
 * reasons it has; two costs are two candidates however alike they look — the
 * same lorry, day and amount never merge two money rows into one.
 */
export function judge(receipt: FuelReceipt, seen: readonly SeenCost[]): FuelMatchResult {
  const judged = seen.map((cost) => judgeOne(receipt, cost));
  const closeness = (a: FuelCandidate, b: FuelCandidate) =>
    daysApart(dayOf(a), receipt.businessDate) - daysApart(dayOf(b), receipt.businessDate) ||
    a.recordedAt.getTime() - b.recordedAt.getTime();
  const matches = judged
    .filter((candidate) => candidate.level !== null)
    .sort((a, b) => RANK[a.level as MatchLevel] - RANK[b.level as MatchLevel] || closeness(a, b));
  const dayRows = judged.filter((candidate) => candidate.level === null).sort(closeness);
  return { outcome: outcomeOf(matches.length), matches, dayRows };
}
