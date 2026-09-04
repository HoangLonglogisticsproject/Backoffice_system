import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Package, Truck, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/common/StatusPill';
import { Stepper } from '@/components/common/Stepper';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDriverActions, useMyTrip } from '@/hooks/driver';
import { driverErrorKey, shouldReloadAfter } from '@/utils/driverErrors';
import { currentStage, workflowStages, type WorkflowStage } from '@/utils/driverExecution';
import { captureLocation } from '@/utils/driverLocation';
import { formatCalendarDay } from '@/utils/format/datetime';
import { formatPlate } from '@/utils/format';
import type { TranslationKey } from '@/types/translate';
import type { DriverTripDetail, ExecutionEventType, ExpenseDeclaration, LocationEvidence } from '@/types/driver';
import type { TripCostCategory } from '@/types/tripCost';
import { CompletionPanel } from './components/CompletionPanel';
import { ExpensePanel } from './components/ExpensePanel';
import { FactRow } from './components/FactRow';
import { MilestoneCard } from './components/MilestoneCard';

/**
 * One trip, everything the driver needs, in the order they need it.
 *
 * ★ THE ORDER OF THE SECTIONS IS THE JOB, not a layout preference: where do I
 * stand, what is this trip, the pickup, the delivery, what did I spend, am I
 * finished. A driver scrolls top to bottom once per trip, and the section
 * that is live is the one lit up.
 *
 * ★ EVERY BUSINESS RULE ON THIS PAGE COMES FROM `utils/driverExecution`. This
 * file wires data to components and turns failures into sentences; it decides
 * no lifecycle. That is what keeps the rules testable without a browser and
 * stops them drifting from the server quietly.
 */

const STAGE_LABEL: Record<WorkflowStage, TranslationKey> = {
  pickup: 'driverStagePickup',
  delivery: 'driverStageDelivery',
  expense: 'driverStageExpense',
  completion: 'driverStageCompletion',
};

export default function DriverTripPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const { t, language } = useLanguage();

  // ★ `loadError`, not `error`: this file already calls the WRITE failure
  // `actionError`, and the read failure had no name of its own — so it took
  // the generic one and every `catch` below had to avoid it.
  const { trip, loading, error: loadError, reload } = useMyTrip(tripId);
  const { report, declare, correct, complete } = useDriverActions(tripId ?? '');

  const [actionError, setActionError] = useState<unknown>(null);
  /** The handset is being asked where it is. Separate from the request in flight. */
  const [locating, setLocating] = useState(false);
  /**
   * ★ THE COMPLETION CHECKPOINT CAN OPEN THE EXPENSE FORM.
   *
   * The two panels are separate components but one workflow: choosing "there
   * were expenses" with nothing declared has exactly one useful next step, and
   * making the driver find it themselves is the bug this replaces.
   */
  const [openExpenseForm, setOpenExpenseForm] = useState(false);

  /**
   * Brings the figures into view — used by the checkpoint and by a rejection.
   *
   * ★ `?.scrollIntoView?.()`, AND THE SECOND `?.` IS THE ONE THAT MATTERS. The
   * first guards a missing element; the second guards a missing METHOD, which
   * is a different failure and the one that actually bit: `scrollIntoView` is
   * not implemented by jsdom. Scrolling is a courtesy; somewhere that cannot
   * scroll should show an unscrolled page, never a broken one.
   */
  const goToExpenses = useCallback(() => {
    document.getElementById('driver-expenses')?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'start',
    });
  }, []);

  /**
   * Every write goes through here.
   *
   * ★ A 409 REFETCHES BEFORE IT COMPLAINS. It means the trip moved underneath —
   * the office changed the driver, a review landed, the completion was sent from
   * another device — so the screen is showing a state that no longer exists.
   * Re-reading turns a dead end into a screen that explains itself.
   */
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    try {
      await work();
      return true;
    } catch (error) {
      setActionError(error);
      if (shouldReloadAfter(error)) reload();
      return false;
    }
  };

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{t('driverLoading')}</p>;
  }

  if (loadError || !trip) {
    return (
      <div className="space-y-4 py-12 text-center">
        {/* ★ A 403 SAYS "not yours" AND NOTHING ELSE. Never whether the trip
            exists, never whose it is. */}
        <p className="text-sm text-muted-foreground">{t(driverErrorKey(loadError))}</p>
        <Button variant="outline" size="lg" render={<Link to="/driver" />}>
          {t('driverBackToTrips')}
        </Button>
      </div>
    );
  }

  const reportEvent = (type: ExecutionEventType) =>
    void run(async () => {
      // ★ CONFIRMING A PICKUP OR A DELIVERY ASKS THE PHONE WHERE IT IS, AND
      // SENDS THAT — A READING, NOT A VERDICT. The server holds the trip's
      // coordinates for each end and the radius, measures the distance
      // itself, and refuses with a reason the screen can name. If the phone
      // cannot produce a reading, no request is made at all: there is no
      // confirmation without a position.
      let location: LocationEvidence | undefined;
      if (type === 'PICKUP_CONFIRMED' || type === 'DELIVERY_CONFIRMED') {
        setLocating(true);
        try {
          location = await captureLocation();
        } finally {
          setLocating(false);
        }
      }

      await report.mutateAsync({
        type,
        // ★ NO TIME IS SENT, AND THAT IS THE RULE RATHER THAN AN OMISSION.
        // `actual_at` is what every delay is measured from, and a phone's
        // clock is set by the phone's owner. The server stamps it when the
        // tap arrives. The handset's own reading goes in `deviceReportedAt`,
        // which is DIAGNOSTIC — kept so a disagreement can be investigated,
        // never read by anything that computes a delay or an order.
        deviceReportedAt: new Date().toISOString(),
        ...(location ? { location } : {}),
        // ★ ONE ID PER INTENT, NOT PER ATTEMPT. A retried request must collide
        // with its own first attempt so an arrival is never recorded twice.
        clientEventId: `${trip.assignment.id}:${type}`,
      });
    });

  /**
   * ★ RETURNS WHETHER THE SERVER ACCEPTED, so the form knows whether to keep
   * the draft. Discarding it on a network error is the one moment a figure
   * must not be thrown away.
   */
  const declareExpense = async (input: {
    category: TripCostCategory;
    amount: string;
    note: string | null;
    clientRequestId: string;
  }): Promise<boolean> => {
    setActionError(null);
    try {
      await declare.mutateAsync(input);
      return true;
    } catch (error) {
      setActionError(error);
      if (shouldReloadAfter(error)) reload();
      return false;
    }
  };

  /**
   * ★ ANSWERS WHETHER THE SERVER ACCEPTED, for the same reason `declareExpense`
   * does: the form may only close on a yes. A correction carries no draft, so
   * the open form is the only place the retyped figure exists.
   */
  const correctExpense = (input: {
    costId: string;
    category: TripCostCategory;
    amount: string;
    note: string | null;
  }): Promise<boolean> => run(() => correct.mutateAsync(input));

  const submitCompletion = (declaration: ExpenseDeclaration) =>
    void run(() => complete.mutateAsync(declaration));

  const stages = workflowStages(trip);
  const stage = currentStage(trip);
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-lg" aria-label={t('driverBackToTrips')} render={<Link to="/driver" />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{trip.customer?.name ?? t('driverNotSet')}</h1>
          <p className="text-xs text-muted-foreground">{formatCalendarDay(trip.scheduledOn, language)}</p>
        </div>
        {/* Where the trip stands, in one word — the same reading the stepper draws. */}
        {stage ? (
          <StatusPill tone="amber">{t(STAGE_LABEL[stage])}</StatusPill>
        ) : (
          <StatusPill tone="green">{t('driverStageCompletion')}</StatusPill>
        )}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {t(driverErrorKey(actionError))}
        </p>
      ) : null}

      <Card size="sm">
        <CardContent>
          <Stepper
            label={t('driverProgress')}
            steps={stages.map((step) => ({ key: step.stage, label: t(STAGE_LABEL[step.stage]), state: step.state }))}
          />
        </CardContent>
      </Card>

      <TripFacts trip={trip} />

      <MilestoneCard end="pickup" trip={trip} now={now} onReport={reportEvent} reporting={report.isPending} locating={locating} />
      <MilestoneCard end="delivery" trip={trip} now={now} onReport={reportEvent} reporting={report.isPending} locating={locating} />

      <ExpensePanel
        trip={trip}
        live={stage === 'expense'}
        onDeclare={declareExpense}
        onCorrect={correctExpense}
        saving={declare.isPending || correct.isPending}
        openForm={openExpenseForm}
        onFormClosed={() => setOpenExpenseForm(false)}
      />

      <CompletionPanel
        trip={trip}
        live={stage === 'expense' || stage === 'completion'}
        onSubmit={submitCompletion}
        submitting={complete.isPending}
        onDeclareExpenses={() => {
          setOpenExpenseForm(true);
          goToExpenses();
        }}
        onReviewExpenses={goToExpenses}
      />
    </div>
  );
}

/**
 * The whitelisted facts about the trip itself. The two ends have their own
 * cards; this is what is true of the whole trip.
 *
 * ★ THERE IS NO PRICE, NO COST, NO HIRE AMOUNT AND NO `note` HERE — not because
 * they are filtered, but because the server never sends them. A field can only
 * appear on this screen after it appears in the server's whitelist.
 */
function TripFacts({ trip }: Readonly<{ trip: DriverTripDetail }>) {
  const { t } = useLanguage();

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('driverTripSummary')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FactRow icon={<User />} label={t('driverCustomer')} value={trip.customer?.name ?? null} />
        <FactRow icon={<Truck />} label={t('driverVehicle')} value={formatPlate(trip.vehicle?.plate) || null} />
        <FactRow icon={<Package />} label={t('driverCargo')} value={trip.cargoInfo} />

        {/* ★ THE ONE FIELD WRITTEN FOR THE DRIVER, so it is the one given room. */}
        {trip.driverInstructions ? (
          <div className="rounded-lg bg-muted/60 p-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquare className="size-3.5" aria-hidden />
              {t('driverInstructions')}
            </p>
            <p className="text-sm whitespace-pre-wrap">{trip.driverInstructions}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
