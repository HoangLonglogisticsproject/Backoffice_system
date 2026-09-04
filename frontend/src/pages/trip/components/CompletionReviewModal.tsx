import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import { reviewErrorKey } from '@/utils/driverErrors';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney } from '@/utils/format/money';
import { formatPlate } from '@/utils/format';
import { useCompletionDecision, useCompletionEvidence } from '@/hooks/trip/useCompletionReview';
import { EXECUTION_EVENT_TYPES } from '@/types/driver';
import type {
  CompletionRequest,
  CompletionState,
  ExecutionEvent,
  ExecutionEventType,
} from '@/types/driver';
import type { OperationalBoardRow } from '@/types/operationalBoard';
import type { TranslationKey } from '@/types/translate';

/**
 * One trip's evidence, and the decision that closes it.
 *
 * ★ THE ORDER ANSWERS THE REVIEWER'S QUESTIONS IN THE ORDER THEY ASK THEM: did
 * the driver start, did they arrive, were they late, did they confirm, did they
 * declare anything, and what did the last review say. A reviewer deciding fifty
 * of these a day should not have to hunt.
 *
 * ★ NOTHING IS OPTIMISTIC. Approving is irreversible on the server, so this
 * screen never renders the outcome before the server has confirmed it — the
 * mutation resolves, the queries invalidate, and what appears is what is true.
 * Two reviewers clicking at once means one of them sees a conflict, and that is
 * the correct outcome rather than a bug to paper over.
 *
 * ★ AND THE CLIENT DECIDES NOTHING. No `decidedBy`, no `decidedAt`, no
 * `approved` flag is sent; the server reads the actor from the session and
 * stamps its own clock.
 */

const EVENT_LABEL: Record<ExecutionEventType, TranslationKey> = {
  ARRIVED_PICKUP: 'driverStepArrivedPickup',
  PICKUP_CONFIRMED: 'driverStepPickupConfirmed',
  ARRIVED_DELIVERY: 'driverStepArrivedDelivery',
  DELIVERY_CONFIRMED: 'driverStepDeliveryConfirmed',
};

/**
 * How each attempt reads at a glance.
 *
 * ★ A MAP, NOT A CHAIN. `CompletionState` has exactly three members and the
 * mapping is data; spelling it as nested ternaries put a lookup table inside a
 * JSX attribute. `pending` is included explicitly so adding a fourth state is a
 * compile error here rather than a silent fall-through to `secondary`.
 */
const ATTEMPT_VARIANT: Record<CompletionState, 'default' | 'destructive' | 'secondary'> = {
  approved: 'default',
  rejected: 'destructive',
  pending: 'secondary',
};

const CATEGORY_LABEL = {
  fuel: 'costFuel',
  toll: 'costToll',
  warehouse: 'costWarehouse',
  loading: 'costLoading',
  overtime: 'costOvertime',
} as const;

interface Props {
  tripId: string;
  row: OperationalBoardRow | null;
  mayReview: boolean;
  onClose: () => void;
}

/**
 * Which of the four endings this trip has reached.
 *
 * ★ A NAMED STAGE RATHER THAN A CHAIN OF TERNARIES IN THE MARKUP. The four
 * cases were spelled as `approved ? … : !pending ? … : !mayReview ? … : …`,
 * nested three deep inside the JSX. That reads as one decision but counts as
 * three, and it put the branch that matters — may this person close the trip —
 * at the bottom of a stack a reader has to unwind.
 *
 * The ORDER is the behaviour and is unchanged: an approved trip says so even
 * to a reviewer without the permission, because it is settled and there is
 * nothing left to decide.
 */
type ReviewStage = 'approved' | 'nothing-pending' | 'no-permission' | 'decide';

const reviewStage = (approved: boolean, pending: boolean, mayReview: boolean): ReviewStage => {
  if (approved) return 'approved';
  if (!pending) return 'nothing-pending';
  if (!mayReview) return 'no-permission';
  return 'decide';
};

/** The two stages that are just a sentence. */
const STAGE_NOTE: Partial<Record<ReviewStage, TranslationKey>> = {
  'nothing-pending': 'reviewNothingPending',
  'no-permission': 'reviewNoPermission',
};

export function CompletionReviewModal({ tripId, row, mayReview, onClose }: Readonly<Props>) {
  const { t, language } = useLanguage();
  const { requests, events, expenses, expensesHidden, loading } = useCompletionEvidence(tripId);
  const { approve, reject } = useCompletionDecision(tripId);

  const [failure, setFailure] = useState<unknown>(null);

  const latest: CompletionRequest | null = requests[0] ?? null;
  const pending = latest?.state === 'pending';
  const approved = requests.some((request) => request.state === 'approved');

  const run = async (work: () => Promise<unknown>) => {
    setFailure(null);
    try {
      await work();
      // Only after the server has agreed. A conflict leaves the modal open on
      // the refreshed truth instead of closing on a decision that did not land.
      onClose();
    } catch (error) {
      setFailure(error);
    }
  };

  const stage = reviewStage(approved, pending, mayReview);
  const note = STAGE_NOTE[stage];

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t('driverLoading')}</p>;
  }

  return (
    <div className="space-y-4">
      {row ? <TripSummary row={row} language={language} /> : null}

      <Timeline events={events} row={row} language={language} />

      <Expenses expenses={expenses} hidden={expensesHidden} />

      <Attempts requests={requests} language={language} />

      {failure ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {t(reviewErrorKey(failure))}
        </p>
      ) : null}

      {/* ★ THREE SIBLINGS, NOT ONE CHAIN NESTED THREE DEEP. `reviewStage` has
          already made the decision; each branch below only asks whether it is
          the one that happened. Exactly one can be true. */}
      {stage === 'approved' ? (
        <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
          {t('driverCompletionApproved')} — {t('driverCompletionApprovedHint')}
        </p>
      ) : null}

      {note ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{t(note)}</p>
      ) : null}

      {stage === 'decide' ? (
        <DecisionForm
          approving={approve.isPending}
          rejecting={reject.isPending}
          onApprove={() => void run(() => approve.mutateAsync())}
          onReject={(reason) => void run(() => reject.mutateAsync(reason))}
        />
      ) : null}
    </div>
  );
}

/**
 * The reason box and the two irreversible buttons.
 *
 * ★ ITS OWN COMPONENT SO THE REASON DRAFT IS ITS OWN CONCERN. `reason` and
 * `reasonTouched` are of no interest to anything outside this box, and while
 * they lived in the modal they sat beside evidence loading and mutation
 * failure in one function that had grown past reading.
 *
 * ★ THE MUTATIONS STAY WITH THE PARENT, AND DELIBERATELY. `run` is what closes
 * the modal only after the server agrees, and the failure it catches renders
 * ABOVE this box — moving either down here would put the conflict message
 * inside the thing a conflict makes disappear.
 */
function DecisionForm({
  approving,
  rejecting,
  onApprove,
  onReject,
}: Readonly<{
  approving: boolean;
  rejecting: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}>) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [reasonTouched, setReasonTouched] = useState(false);

  const deciding = approving || rejecting;
  const reasonMissing = reason.trim() === '';

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <label
          htmlFor="review-reject-reason"
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          {t('reviewRejectReasonLabel')}
        </label>
        <Input
          id="review-reject-reason"
          value={reason}
          placeholder={t('reviewRejectPlaceholder')}
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setReasonTouched(true)}
        />
        {reasonTouched && reasonMissing ? (
          <p className="mt-1 text-xs text-destructive">{t('reviewReasonRequired')}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="destructive"
          size="lg"
          className="flex-1"
          // ★ A BLANK REASON IS UNSENDABLE. The server refuses one with a
          // CHECK the row cannot exist without; this stops the round trip.
          disabled={deciding || reasonMissing}
          onClick={() => {
            setReasonTouched(true);
            if (!reasonMissing) onReject(reason.trim());
          }}
        >
          {rejecting ? <Loader2 className="animate-spin" aria-hidden /> : <XCircle aria-hidden />}
          {t('reviewReject')}
        </Button>

        <Button size="lg" className="flex-1" disabled={deciding} onClick={onApprove}>
          {approving ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {t('reviewApprove')}
        </Button>
      </div>

      {/* ★ SAID BEFORE THE CLICK, because there is no screen after it that
          can undo anything. */}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('reviewApproveWarning')}
      </p>
    </div>
  );
}

function TripSummary({
  row,
  language,
}: Readonly<{ row: OperationalBoardRow; language: 'vi' | 'en' }>) {
  const { t } = useLanguage();

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
      <Field label={t('driverCustomer')} value={row.customer?.name ?? '—'} />
      <Field label={t('driverVehicle')} value={formatPlate(row.vehicle?.plate) || '—'} />
      <Field label={t('reviewDriver')} value={row.driver?.displayName ?? '—'} />
      <Field
        label={`${t('driverScheduled')} — ${t('driverPickup')}`}
        value={row.scheduledPickupAt ? formatDateTime(row.scheduledPickupAt, language) : '—'}
      />
      <Field
        label={`${t('driverScheduled')} — ${t('driverDelivery')}`}
        value={row.scheduledDeliveryAt ? formatDateTime(row.scheduledDeliveryAt, language) : '—'}
      />
      <Field label={t('reviewAttempts')} value={String(row.completionAttempts)} />
    </dl>
  );
}

function Field({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

/**
 * What the driver reported, with the server's stamps.
 *
 * ★ `recordedAt` IS SHOWN AND `deviceReportedAt` IS LABELLED AS DIAGNOSTIC.
 * The handset's clock is set by its owner; a reviewer comparing the two is
 * exactly why the field is kept, and mislabelling it as a fact would make it
 * evidence rather than a hint.
 */
function Timeline({
  events,
  row,
  language,
}: Readonly<{
  events: ExecutionEvent[];
  row: OperationalBoardRow | null;
  language: 'vi' | 'en';
}>) {
  const { t } = useLanguage();

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t('reviewTimeline')}</h3>
      <ul className="space-y-2">
        {EXECUTION_EVENT_TYPES.map((type) => {
          // ★ `find`, not `filter(...)[0]`: only the FIRST live reading is shown,
          // which is DL-86's rule for this panel, and stopping at it says so.
          const first = events.find((event) => event.type === type && event.voidedAt === null);
          const withdrawn = events.filter((event) => event.type === type && event.voidedAt !== null);

          return (
            <li key={type} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{t(EVENT_LABEL[type])}</p>
                {first ? (
                  <Badge variant="secondary">
                    <Check aria-hidden />
                    {t('driverStepDone')}
                  </Badge>
                ) : (
                  <Badge variant="outline">{t('reviewNotReported')}</Badge>
                )}
              </div>

              {first ? (
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p>
                    {t('driverActual')}: {formatDateTime(first.actualAt, language)}
                  </p>
                  <p>
                    {t('reviewRecordedAt')}: {formatDateTime(first.recordedAt, language)}
                  </p>
                  {first.deviceReportedAt ? (
                    <p className="italic">
                      {t('reviewDeviceTime')}: {formatDateTime(first.deviceReportedAt, language)}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {withdrawn.map((event) => (
                <p key={event.id} className="mt-1 text-xs text-destructive">
                  {t('reviewVoided')}: {event.voidReason}
                </p>
              ))}
            </li>
          );
        })}
      </ul>

      {row ? (
        <div className="mt-2 space-y-1">
          <Delay label={t('reviewDelayPickup')} minutes={row.pickupDelayMinutes} />
          <Delay label={t('reviewDelayDelivery')} minutes={row.deliveryDelayMinutes} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * ★ THE SERVER'S FIGURE, RENDERED. No threshold decides the wording or the
 * colour; "how late is too late" has never been agreed, so the number is shown
 * and a person decides.
 */
function Delay({ label, minutes }: Readonly<{ label: string; minutes: number | null }>) {
  const { t } = useLanguage();
  if (minutes === null || minutes === 0) return null;

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      {label}: {minutes} {t('driverMinutes')}
    </p>
  );
}

function Expenses({
  expenses,
  hidden,
}: Readonly<{ expenses: readonly { id: string; category: keyof typeof CATEGORY_LABEL; amount: string; state: string }[]; hidden: boolean }>) {
  const { t } = useLanguage();

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t('reviewExpenses')}</h3>

      {/* ★ `cost.read` is a separate key with a separate tier. A reviewer who
          does not hold it decides on the declaration and the timeline. Asked as
          three flat questions rather than one chain: "may I see them", "are
          there any", "here they are". */}
      {hidden ? (
        <p className="text-sm text-muted-foreground">{t('reviewExpensesHidden')}</p>
      ) : null}

      {!hidden && expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('reviewNoExpense')}</p>
      ) : null}

      {!hidden && expenses.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {expenses.map((line) => (
            <li key={line.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">{t(CATEGORY_LABEL[line.category])}</span>
              <Badge variant="outline">{line.state}</Badge>
              <span className="tabular-nums">{formatMoney(line.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Attempts({
  requests,
  language,
}: Readonly<{ requests: CompletionRequest[]; language: 'vi' | 'en' }>) {
  const { t } = useLanguage();
  if (requests.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t('driverCompletion')}</h3>
      <ul className="space-y-2">
        {requests.map((request) => (
          <li
            key={request.id}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              request.state === 'rejected' ? 'border-destructive/30 bg-destructive/5' : 'border-border',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">
                {t('driverAttempt')} {request.attemptNo}
              </span>
              <Badge variant={ATTEMPT_VARIANT[request.state]}>
                {request.state}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {t('reviewDeclaration')}:{' '}
              {request.expenseDeclaration === 'expenses'
                ? t('driverDeclaredExpenses')
                : t('driverDeclaredNone')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('reviewSubmittedAt')}: {formatDateTime(request.submittedAt, language)}
            </p>
            {request.decidedAt ? (
              <p className="text-xs text-muted-foreground">
                {t('reviewDecidedAt')}: {formatDateTime(request.decidedAt, language)}
              </p>
            ) : null}
            {/* ★ THE ONE THING THE DRIVER HAD TO ACT ON, so it gets its own
                line rather than being appended to a label. A reviewer scanning
                a rejected attempt is looking for exactly this sentence. */}
            {request.decisionReason ? (
              <div className="mt-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('driverRejectReason')}
                </p>
                <p className="text-sm">{request.decisionReason}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
