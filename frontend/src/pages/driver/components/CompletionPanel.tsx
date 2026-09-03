import { useState } from 'react';
import { CheckCircle2, Clock, Flag, Loader2, MapPin, Receipt, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/utils/cn';
import { completionStage, executionSteps, liveExpenses, suggestedDeclaration } from '@/utils/driverExecution';
import { formatDateTime } from '@/utils/format/datetime';
import { formatMoney, sumMoney } from '@/utils/format/money';
import type { DriverTripDetail, ExpenseDeclaration } from '@/types/driver';
import { FactRow } from './FactRow';
import { RejectionNotice } from './RejectionNotice';

/**
 * Asking for the trip to be closed, and what came back.
 *
 * ★ THE DECLARATION IS A QUESTION, NOT A CHECKBOX WITH A DEFAULT.
 *
 * "No expense rows" is not an answer — it is either a trip that cost nothing or
 * a driver who forgot, and only the driver knows which. So both options are
 * rendered as equal buttons, the driver must pick one, and nothing is sent
 * until they have. Pre-selecting the consistent one saves a guaranteed
 * rejection; it does not answer on their behalf.
 *
 * ★ AND THERE IS NO REOPEN CONTROL IN THIS FILE. Approval closes a trip
 * permanently — a database trigger makes it irreversible — so a button that
 * appeared to undo it would be a lie in the one place a lie is most expensive.
 */
interface Props {
  trip: DriverTripDetail;
  /** This is the stage the driver is on: the card is lit up. */
  live: boolean;
  onSubmit: (declaration: ExpenseDeclaration) => void;
  submitting: boolean;
  /**
   * ★ THE FIX FOR THE WORST BUG ON THIS SCREEN.
   *
   * Choosing "there were expenses" used to set a variable and nothing else,
   * leaving the driver looking at an unchanged screen with no idea what to do
   * next — and the server answered their eventual tap with a 409. Now the
   * choice opens the declaration form.
   */
  onDeclareExpenses: () => void;
  /** Takes the driver back to the figures a rejection was about. */
  onReviewExpenses: () => void;
}

export function CompletionPanel({
  trip,
  live,
  onSubmit,
  submitting,
  onDeclareExpenses,
  onReviewExpenses,
}: Readonly<Props>) {
  const { t, language } = useLanguage();
  const stage = completionStage(trip);
  const request = trip.completion;

  const declared = liveExpenses(trip.expenses);
  const [declaration, setDeclaration] = useState<ExpenseDeclaration | null>(null);
  /**
   * ★ THE CONTRADICTION GUARD.
   *
   * Saying "nothing to claim" with figures already on the trip is a mistake —
   * both halves came from the same person — and the server refuses it. Asking
   * before sending turns a guaranteed rejection into a question, and the
   * question is one the driver can actually answer.
   */
  const [confirmingNone, setConfirmingNone] = useState(false);

  if (stage === 'approved') {
    return (
      <Card className="ring-primary/40 bg-primary/5">
        <CardContent className="text-center">
          <CheckCircle2 className="mx-auto mb-2 size-7 text-primary" aria-hidden />
          <p className="font-semibold">{t('driverCompletionApproved')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('driverCompletionApprovedHint')}</p>
        </CardContent>
        <CardContent>
          <TripSummary trip={trip} />
        </CardContent>
      </Card>
    );
  }

  if (stage === 'pending') {
    return (
      <Card className={cn(live && 'ring-primary/60')}>
        <CardContent className="text-center">
          <Clock className="mx-auto mb-2 size-7 text-muted-foreground" aria-hidden />
          <p className="font-semibold">{t('driverCompletionPending')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('driverCompletionPendingHint')}</p>
          <AttemptLine request={request} language={language} />
        </CardContent>
        <CardContent>
          <TripSummary trip={trip} />
        </CardContent>
      </Card>
    );
  }

  const suggested = suggestedDeclaration(trip);
  const chosen = declaration ?? suggested;

  const chooseExpenses = () => {
    setDeclaration('expenses');
    setConfirmingNone(false);
    // Nothing declared yet, so the only useful next move is the form.
    if (declared.length === 0) onDeclareExpenses();
  };

  const chooseNone = () => {
    setDeclaration('none');
    // Figures already stand: ask rather than send something the server refuses.
    setConfirmingNone(declared.length > 0);
  };

  return (
    <Card className={cn(live && 'ring-primary/60', stage === 'not-ready' && 'opacity-80')}>
      <CardHeader>
        <CardTitle>{t('driverCompletion')}</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
      {/*
        ★ THE REJECTION AND ITS REASON COME FIRST. A driver opening this after
        being sent back needs to read WHY before anything else on the panel.
        The action sends them to the figures, not straight back to the server.
      */}
      {stage === 'rejected' && request ? (
        <RejectionNotice
          title={t('driverCompletionRejected')}
          reason={request.decisionReason}
          actionLabel={t('driverFixAndResubmit')}
          onAction={onReviewExpenses}
        />
      ) : null}

      {stage === 'not-ready' ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-center text-sm text-muted-foreground">
          {t('driverFinishStepsFirst')}
        </p>
      ) : (
        <TripSummary trip={trip} />
      )}
      </CardContent>

      {stage === 'not-ready' ? null : (
        <CardFooter className="flex-col items-stretch">
        <DeclarationSection
          chosen={chosen}
          declaredCount={declared.length}
          confirmingNone={confirmingNone}
          resubmit={stage === 'rejected'}
          submitting={submitting}
          onChooseExpenses={chooseExpenses}
          onChooseNone={chooseNone}
          onReviewExpenses={onReviewExpenses}
          onConfirmAnyway={() => setConfirmingNone(false)}
          onSubmit={() => onSubmit(chosen)}
        />
        </CardFooter>
      )}
    </Card>
  );
}

/**
 * What is about to be sent — or was: the trip in five facts, with the times
 * the SERVER recorded and the driver's own figures added up.
 *
 * ★ THE TOTAL IS THE DRIVER'S OWN LINES AND ONLY THOSE. No price, no hire
 * amount, no margin — none of it is sent here, and none can be reconstructed.
 */
function TripSummary({ trip }: Readonly<{ trip: DriverTripDetail }>) {
  const { t, language } = useLanguage();
  const steps = executionSteps(trip);
  const actualOf = (type: 'PICKUP_CONFIRMED' | 'DELIVERY_CONFIRMED') =>
    steps.find((step) => step.type === type)?.actualAt ?? null;
  const pickupAt = actualOf('PICKUP_CONFIRMED');
  const deliveryAt = actualOf('DELIVERY_CONFIRMED');
  const lines = liveExpenses(trip.expenses);
  const total = sumMoney(lines.map((line) => line.amount));

  let expenses: string;
  if (lines.length === 0) {
    expenses = t('driverExpenseNone');
  } else {
    expenses = `${lines.length} ${t('driverLineCount')} · ${total === null ? '—' : formatMoney(total)}`;
  }

  return (
    <div className="space-y-2.5 rounded-lg bg-muted/40 p-3">
      <FactRow icon={<User />} label={t('driverCustomer')} value={trip.customer?.name ?? null} />
      <FactRow
        icon={<MapPin />}
        label={t('driverActualPickup')}
        value={pickupAt ? formatDateTime(pickupAt, language) : null}
      />
      <FactRow
        icon={<Flag />}
        label={t('driverActualDelivery')}
        value={deliveryAt ? formatDateTime(deliveryAt, language) : null}
      />
      <FactRow icon={<Receipt />} label={t('driverStageExpense')} value={expenses} />
    </div>
  );
}

/**
 * Which attempt this was, and what it declared.
 *
 * ★ SPLIT OUT BECAUSE IT IS THE ONLY BRANCHING IN AN OTHERWISE FLAT PANEL, and
 * it was nested two deep inside a status card that says one thing.
 */
function AttemptLine({
  request,
  language,
}: Readonly<{ request: DriverTripDetail['completion']; language: 'vi' | 'en' }>) {
  const { t } = useLanguage();
  if (!request) return null;

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {t('driverAttempt')} {request.attemptNo} · {formatDateTime(request.submittedAt, language)} ·{' '}
      {request.expenseDeclaration === 'expenses'
        ? t('driverDeclaredExpenses')
        : t('driverDeclaredNone')}
    </p>
  );
}

/**
 * The question, the contradiction guard, and the button that sends it.
 *
 * ★ THE STATE STAYS WITH THE PANEL, AND THAT IS NOT AN OVERSIGHT. `declaration`
 * and `confirmingNone` are passed in rather than held here because the panel
 * early-returns while a request is pending: state living in this component
 * would be unmounted for the whole wait and rebuilt empty on a rejection,
 * quietly discarding the choice the driver had already made. This component
 * renders; it decides nothing.
 */
function DeclarationSection({
  chosen,
  declaredCount,
  confirmingNone,
  resubmit,
  submitting,
  onChooseExpenses,
  onChooseNone,
  onReviewExpenses,
  onConfirmAnyway,
  onSubmit,
}: Readonly<{
  chosen: ExpenseDeclaration;
  declaredCount: number;
  confirmingNone: boolean;
  resubmit: boolean;
  submitting: boolean;
  onChooseExpenses: () => void;
  onChooseNone: () => void;
  onReviewExpenses: () => void;
  onConfirmAnyway: () => void;
  onSubmit: () => void;
}>) {
  const { t } = useLanguage();

  return (
    <>
      <p className="mb-2 text-sm font-medium">{t('driverDeclareQuestion')}</p>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <DeclarationChoice
          label={
            declaredCount > 0
              ? `${t('driverDeclareExpenses')} — ${declaredCount} ${t('driverLineCount')}`
              : t('driverDeclareExpenses')
          }
          selected={chosen === 'expenses'}
          onSelect={onChooseExpenses}
        />
        <DeclarationChoice
          label={t('driverDeclareNone')}
          selected={chosen === 'none'}
          onSelect={onChooseNone}
        />
      </div>

      {/*
        ★ THE ONE PLACE A DRIVER CAN CONTRADICT THEMSELVES, so it is the one
        place that asks twice. Nothing is deleted or withdrawn on their
        behalf — voiding a figure is not the driver's to do — the question
        simply sends them back to the list or lets them confirm.
      */}
      {confirmingNone && chosen === 'none' ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm">
            {t('driverDeclareConflict')} ({declaredCount} {t('driverLineCount')})
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" size="lg" className="h-11 flex-1" onClick={onReviewExpenses}>
              {t('driverReviewExpenses')}
            </Button>
            <Button variant="ghost" size="lg" className="h-11" onClick={onConfirmAnyway}>
              {t('driverConfirmAnyway')}
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        size="lg"
        className="h-12 w-full text-base"
        // While the contradiction stands there is nothing to send that the
        // server would accept.
        disabled={submitting || confirmingNone}
        onClick={onSubmit}
      >
        {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {resubmit ? t('driverResubmit') : t('driverSubmitCompletion')}
      </Button>
    </>
  );
}

function DeclarationChoice({
  label,
  selected,
  onSelect,
}: Readonly<{ label: string; selected: boolean; onSelect: () => void }>) {
  return (
    <Button
      type="button"
      variant={selected ? 'default' : 'outline'}
      size="lg"
      // `aria-pressed` rather than a radio group: these are two large targets a
      // thumb hits, and a screen reader still hears which one is chosen.
      aria-pressed={selected}
      className={cn('h-12 w-full justify-center text-sm whitespace-normal')}
      onClick={onSelect}
    >
      {label}
    </Button>
  );
}
