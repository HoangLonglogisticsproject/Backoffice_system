import { useEffect, useId, useState } from 'react';
import { Loader2, Lock, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import {
  allowedCategories,
  canDeclareExpense,
  isEditable,
  liveExpenses,
  vehicleOwnershipOf,
} from '@/utils/driverExecution';
import { clearDraft, newRequestId, readDraft, writeDraft, type ExpenseDraft } from '@/utils/driverDraft';
import { formatMoney, sumMoney } from '@/utils/format/money';
import { TRIP_COST_CATEGORIES } from '@/types/tripCost';
import type { TripCost, TripCostCategory } from '@/types/tripCost';
import type { TranslationKey } from '@/types/translate';
import type { DriverTripDetail } from '@/types/driver';
import { RejectionNotice } from './RejectionNotice';

/**
 * The five headings a driver may declare, and the figures they have declared.
 *
 * ★ FUEL AND TOLLS ARE NOT OFFERED ON A HIRED LORRY. The carrier absorbs both
 * into the one price agreed with them, so claiming either is the same money
 * counted twice — the server refuses it with a constraint, and this never puts
 * the option in front of somebody who would then be told no.
 *
 * ★ THE TOTAL IS THE DRIVER'S OWN LINES, AND ONLY THOSE. A trip's real total
 * includes the price agreed with a hired carrier, which is never sent here and
 * cannot be reconstructed from what is. What is added up is exactly what is on
 * screen — and it is added with `sumMoney`, which never goes through a float.
 */

/** The same five labels the backoffice cost modal uses. One vocabulary. */
const CATEGORY_LABEL: Record<TripCostCategory, TranslationKey> = {
  fuel: 'costFuel',
  toll: 'costToll',
  warehouse: 'costWarehouse',
  loading: 'costLoading',
  overtime: 'costOvertime',
};

/**
 * ★ A HINT PER HEADING, AND NOT A FIELD PER HEADING.
 *
 * `trip_costs` gives all five categories one shape — category, amount, note.
 * Differentiating them by required fields would be inventing a business rule
 * nobody has agreed. What CAN differ is what the note is FOR, so the
 * placeholder does the teaching instead.
 */
const NOTE_HINT: Record<TripCostCategory, TranslationKey> = {
  fuel: 'driverHintFuel',
  toll: 'driverHintToll',
  warehouse: 'driverHintWarehouse',
  loading: 'driverHintLoading',
  overtime: 'driverHintOvertime',
};

/**
 * Why the declaration form is not on screen.
 *
 * ★ THREE REASONS, ASKED IN THE ORDER THEY OVERRIDE EACH OTHER. No lorry means
 * no trip to spend against and nothing else matters; an approved trip is closed
 * for good; anything else still open is merely waiting on the review. As nested
 * ternaries inside the markup that precedence was real but invisible.
 */
const lockedReasonKey = (trip: DriverTripDetail): TranslationKey => {
  if (trip.vehicle === null) return 'driverNeedVehicleFirst';
  if (trip.accountability === 'APPROVED_IMMUTABLE') return 'driverExpenseFinal';
  return 'driverExpenseLocked';
};

/**
 * The pill in the panel header — where the figures stand, in the lifecycle
 * the driver has to be able to read: editable → sent (locked) → sent back
 * (editable again, with a reason) → approved (final).
 *
 * ★ THE SAME PRECEDENCE AS `lockedReasonKey`, AND DELIBERATELY NOT MERGED.
 * They agree today but answer different questions: one explains an absent
 * form, the other labels a state that also exists while the form IS shown.
 */
const expenseState = (trip: DriverTripDetail): { label: TranslationKey; tone: StatusTone } => {
  if (trip.accountability === 'APPROVED_IMMUTABLE') return { label: 'driverExpenseApproved', tone: 'green' };
  if (trip.completion?.state === 'pending') return { label: 'driverExpenseSent', tone: 'amber' };
  if (trip.accountability === 'REJECTED_NEEDS_CORRECTION') return { label: 'driverExpenseSentBack', tone: 'gray' };
  return { label: 'driverExpenseOpen', tone: 'gray' };
};

interface Props {
  trip: DriverTripDetail;
  /** This is the stage the driver is on: the card is lit up. */
  live: boolean;
  onDeclare: (input: {
    category: TripCostCategory;
    amount: string;
    note: string | null;
    clientRequestId: string;
  }) => Promise<boolean>;
  /**
   * ★ RESOLVES TO WHETHER THE SERVER ACCEPTED, exactly like `onDeclare`.
   *
   * A correction carries no draft — persisting one would resurrect an abandoned
   * edit on the next reload — so the open form is the ONLY place the retyped
   * figure exists. The panel therefore has to know the answer before it may
   * close the form.
   */
  onCorrect: (input: {
    costId: string;
    category: TripCostCategory;
    amount: string;
    note: string | null;
  }) => Promise<boolean>;
  saving: boolean;
  /**
   * Opened from the completion checkpoint.
   *
   * ★ THE FIX FOR THE WORST BUG ON THIS SCREEN. Choosing "there were expenses"
   * used to set a variable and nothing else, leaving the driver at a dead end
   * that the server answered with a 409. Now that choice opens this form.
   */
  openForm: boolean;
  onFormClosed: () => void;
}

export function ExpensePanel({
  trip,
  live,
  onDeclare,
  onCorrect,
  saving,
  openForm,
  onFormClosed,
}: Readonly<Props>) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Driven from outside so the completion checkpoint can open it.
  useEffect(() => {
    if (openForm) setAdding(true);
  }, [openForm]);

  const lines = liveExpenses(trip.expenses);
  // `null` when a line is not a plain decimal — see `sumMoney`. Computed here
  // rather than in the markup so the fallback is a value, not a branch.
  const declaredTotal = sumMoney(lines.map((line) => line.amount));
  const categories = allowedCategories(vehicleOwnershipOf(trip), TRIP_COST_CATEGORIES);
  const open = canDeclareExpense(trip);

  const close = () => {
    setAdding(false);
    onFormClosed();
  };

  const state = expenseState(trip);
  const rejected = trip.accountability === 'REJECTED_NEEDS_CORRECTION';

  return (
    <Card id="driver-expenses" className={cn(live && 'ring-primary/60')}>
      <CardHeader>
        <CardTitle>{t('driverExpenses')}</CardTitle>
        <CardAction>
          <StatusPill tone={state.tone}>{t(state.label)}</StatusPill>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
      {/* ★ THE REASON COMES FIRST when the figures were sent back: it is the
          one thing that says what to correct, and the lines to correct are
          right below it. Resubmitting is the completion card's, and it is
          never automatic. */}
      {rejected && trip.completion ? (
        <RejectionNotice title={t('driverExpenseRejected')} reason={trip.completion.decisionReason} />
      ) : null}

      {lines.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t('driverNoExpenseYet')}</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li key={line.id} className="py-2.5">
                {editingId === line.id ? (
                  <ExpenseForm
                    categories={categories}
                    initial={{ category: line.category, amount: line.amount, note: line.note ?? '' }}
                    saving={saving}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async (values) => {
                      // ★ CLOSES ON A YES AND ONLY ON A YES. This used to fire
                      // and close in the same breath, so a 409 or a dead
                      // network left the driver looking at the OLD figure with
                      // an error above it and their correction gone — and
                      // corrections keep no draft, so there was nothing to
                      // restore. Staying open keeps what they typed exactly
                      // where they typed it.
                      if (await onCorrect({ costId: line.id, ...values })) {
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <LineRow
                    line={line}
                    onEdit={isEditable(line) ? () => setEditingId(line.id) : undefined}
                  />
                )}
              </li>
            ))}
          </ul>

          {/* ★ WHAT THE DRIVER HAS DECLARED, IN ONE LINE. Reviewing three fuel
              receipts against a list is what they do before sending. */}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-medium">
            <span>
              {lines.length} {t('driverLineCount')}
            </span>
            {/* ★ AN EXACT TOTAL OR A DASH — never a number that is not the sum.
                `sumMoney` answers `null` when a line is not a plain decimal,
                which is the case that used to throw out of render and blank
                the screen. A dash tells the driver the total is unavailable;
                every individual line is still listed above, so nothing is
                hidden from them. */}
            <span className="tabular-nums">
              {declaredTotal === null ? '—' : formatMoney(declaredTotal)}
            </span>
          </div>
        </>
      )}

      </CardContent>

      {/* ★ THREE STATES, ASKED FLAT. Shut, open-and-typing, open-and-idle —
          exactly one is true. As a chain the middle case sat inside the
          negation of the first, which is not how anyone reads a panel that is
          either locked, in use, or waiting. */}
      <CardFooter className="flex-col items-stretch">
        {!open ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {t(lockedReasonKey(trip))}
          </p>
        ) : null}

        {open && adding ? (
          <ExpenseForm
            categories={categories}
            tripId={trip.tripId}
            saving={saving}
            onCancel={close}
            onSubmit={async (values, clientRequestId) => {
              const accepted = await onDeclare({ ...values, clientRequestId });
              // ★ THE DRAFT SURVIVES A FAILURE. A network error is when the
              // driver is most likely to retry, and throwing the figure away
              // then is the one moment it must not happen.
              if (accepted) {
                clearDraft(trip.tripId);
                close();
              }
            }}
          />
        ) : null}

        {open && !adding ? (
          <Button
            variant={live ? 'default' : 'outline'}
            size="lg"
            className="h-12 w-full text-base"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
            {t('driverAddExpense')}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function LineRow({ line, onEdit }: Readonly<{ line: TripCost; onEdit?: () => void }>) {
  const { t } = useLanguage();

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t(CATEGORY_LABEL[line.category])}</p>
        {line.note ? <p className="truncate text-xs text-muted-foreground">{line.note}</p> : null}
      </div>

      {/* ★ FORMATTED, NEVER PARSED. The amount is a decimal string from a
          NUMERIC column; `Number()` on it is the rounding the column exists
          to prevent. */}
      <p className="shrink-0 text-sm tabular-nums">{formatMoney(line.amount)}</p>

      {onEdit ? (
        <Button variant="ghost" size="icon" aria-label={t('driverEdit')} onClick={onEdit}>
          <Pencil />
        </Button>
      ) : (
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

interface FormValues {
  category: TripCostCategory;
  amount: string;
  note: string | null;
}

/**
 * One form for declaring and for correcting.
 *
 * ★ ONE COMPONENT, NOT TWO. The two used to differ — declaring offered all
 * three fields and correcting offered only the amount, which meant a driver who
 * picked the wrong heading had no way to fix it and had to ask the office to
 * withdraw the line. The API accepted all three the whole time.
 *
 * `tripId` present means this is a NEW declaration, and only then is a draft
 * kept: a correction is a short edit of something already stored, and persisting
 * it would resurrect an abandoned edit on the next reload.
 */
function ExpenseForm({
  categories,
  initial,
  tripId,
  saving,
  onSubmit,
  onCancel,
}: Readonly<{
  categories: TripCostCategory[];
  initial?: { category: TripCostCategory; amount: string; note: string };
  tripId?: string;
  saving: boolean;
  onSubmit: (values: FormValues, clientRequestId: string) => void;
  onCancel: () => void;
}>) {
  const { t } = useLanguage();

  /**
   * ★ UNIQUE PER FORM, BECAUSE TWO OF THESE FORMS CAN BE OPEN AT ONCE.
   *
   * `editingId` and `adding` are independent, so a driver correcting one line
   * while declaring another had two `id="driver-expense-amount"` inputs on the
   * page. Duplicate ids are not merely invalid: `htmlFor` resolves to the FIRST
   * match, so tapping the amount label of the second form put the cursor in the
   * first one — and on a phone, where the label is the easiest thing to hit,
   * that is the amount going into the wrong line.
   */
  const fieldId = useId();
  const amountId = `${fieldId}-amount`;
  const noteId = `${fieldId}-note`;

  const [draft, setDraft] = useState<ExpenseDraft>(() => {
    // Whatever the restored draft says, the category must be one this trip can
    // actually accept.
    const fallbackCategory = initial?.category ?? categories[0] ?? 'warehouse';
    const restored = tripId ? readDraft(tripId) : null;

    if (restored) {
      /**
       * ★ THE SAVED CATEGORY IS RE-CHECKED, NOT TRUSTED.
       *
       * `allowedCategories` drops `fuel` and `toll` once the lorry turns out to
       * be a hired one, and a draft outlives that discovery: pick `fuel` while
       * the ownership is still unknown, come back after the first event
       * resolved it to `outsourced`, and the restored draft named a category
       * with no button to match it. Nothing looked selected, and sending it
       * earned a refusal the driver could do nothing about.
       *
       * The typed figure and note are what the draft exists to save, so they
       * are kept; only the impossible choice is replaced.
       */
      return categories.includes(restored.category)
        ? restored
        : { ...restored, category: fallbackCategory };
    }

    return {
      category: fallbackCategory,
      amount: initial?.amount ?? '',
      note: initial?.note ?? '',
      // Minted once, with the draft. One id per intent — see `driverDraft`.
      clientRequestId: newRequestId(),
    };
  });

  useEffect(() => {
    if (tripId) writeDraft(tripId, draft);
  }, [tripId, draft]);

  const set = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const amountMissing = draft.amount.trim() === '';

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('driverCategory')}</p>
        {/*
          Buttons rather than a dropdown: five options, and a driver picking one
          with a thumb should not have to open a menu and scroll it.
        */}
        <div className="flex flex-wrap gap-2">
          {categories.map((option) => (
            <Button
              key={option}
              type="button"
              variant={option === draft.category ? 'default' : 'outline'}
              size="lg"
              className="h-10"
              aria-pressed={option === draft.category}
              onClick={() => set('category', option)}
            >
              {t(CATEGORY_LABEL[option])}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label
          htmlFor={amountId}
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {t('driverAmount')}
        </label>
        {/*
          Grouped while it is typed, and stored plain: `draft.amount` stays the
          decimal string the server takes, so the persisted draft and the
          payload are unchanged by the formatting. Why not `type="number"` is
          explained in `MoneyInput`.
        */}
        <MoneyInput
          id={amountId}
          placeholder={t('driverAmountHint')}
          value={draft.amount}
          onChange={(plain) => set('amount', plain)}
          className="h-11"
        />
      </div>

      <div>
        <label
          htmlFor={noteId}
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {t('driverNote')}
        </label>
        <Input
          id={noteId}
          placeholder={t(NOTE_HINT[draft.category])}
          maxLength={2000}
          value={draft.note}
          onChange={(event) => set('note', event.target.value)}
          className="h-11"
        />
      </div>

      <div className="flex gap-2">
        <Button
          size="lg"
          className="h-11 flex-1"
          // Disabled while saving as well: a second tap would mint no new id,
          // but it would fire a second request for the server to deduplicate.
          disabled={saving || amountMissing}
          onClick={() =>
            onSubmit(
              {
                category: draft.category,
                amount: draft.amount.trim(),
                note: draft.note.trim() || null,
              },
              draft.clientRequestId,
            )
          }
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('driverSave')}
        </Button>
        <Button variant="ghost" size="lg" className="h-11" onClick={onCancel}>
          {t('driverCancel')}
        </Button>
      </div>
    </div>
  );
}
