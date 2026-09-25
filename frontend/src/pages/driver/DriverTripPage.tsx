import { useCallback, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, MessageSquare, Package, Truck, User } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Stepper } from '@/components/common/Stepper';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDriverActions, useMyAssignment } from '@/hooks/driver';
import { driverErrorKey, isFinalRefusal, shouldReloadAfter } from '@/utils/driverErrors';
import { assignmentStatusOf, currentStage, workflowStages, type WorkflowStage } from '@/utils/driverExecution';
import { captureLocation } from '@/utils/driverLocation';
import { wasOpenedFromSchedule } from '@/utils/driverSchedule';
import { formatCalendarWeekday, formatTimeOnDay } from '@/utils/format/datetime';
import { cn } from '@/utils/cn';
import { formatPlate } from '@/utils/format';
import type { TranslationKey } from '@/types/translate';
import type { DriverTripDetail, ExecutionEventType, ExpenseDeclaration, LocationEvidence } from '@/types/driver';
import type { TripCostCategory } from '@/types/tripCost';
import { AssignmentStatusPill } from './components/AssignmentStatusPill';
import { CompletionPanel } from './components/CompletionPanel';
import { DriverLoadError } from './components/DriverLoadError';
import { ExpensePanel } from './components/ExpensePanel';
import { FactRow } from './components/FactRow';
import { MilestoneCard } from './components/MilestoneCard';

/**
 * One assignment, everything the driver needs, in the order they need it.
 *
 * ★ THE ORDER OF THE SECTIONS IS THE JOB, not a layout preference: where do I
 * stand and when do I load, in which lorry, the pickup, the delivery, what
 * else to know, what did I spend, am I finished. A driver scrolls top to
 * bottom once per trip, and the section that is live is the one lit up.
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
  // ★ THE ROUTE NAMES AN ASSIGNMENT, NOT A TRIP (ADR-0004). A driver on two
  // lorries of one trip opens two of these screens, one per turn; everything
  // below — timeline, figures, completion — is that turn's alone.
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const { t, language } = useLanguage();

  // ★ `loadError`, not `error`: this file already calls the WRITE failure
  // `actionError`, and the read failure had no name of its own — so it took
  // the generic one and every `catch` below had to avoid it.
  const { trip, loading, error: loadError, reload } = useMyAssignment(assignmentId);
  const { report, declare, correct, complete } = useDriverActions(assignmentId ?? '');

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

  if (loading) return <DetailSkeleton />;

  // ★ ONLY A FINAL ANSWER, OR NOTHING TO SHOW, TAKES THE PAGE AWAY. A refresh
  // that failed on a weak signal must not unmount a form the driver is typing
  // into; it is said above the page instead (see below).
  if (!trip || isFinalRefusal(loadError)) {
    return (
      <div className="space-y-4">
        <DetailHeader subtitle={null} />
        {/* ★ A 403 SAYS "not yours" AND NOTHING ELSE. Never whether the trip
            exists, never whose it is — and no retry, because asking again
            cannot change it. */}
        <DriverLoadError error={loadError} onRetry={reload}>
          <Link to="/driver" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 w-full')}>
            {t('driverBackToTrips')}
          </Link>
        </DriverLoadError>
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

  const stage = currentStage(trip);
  const now = new Date();

  return (
    <div className="space-y-4">
      <DetailHeader subtitle={formatCalendarWeekday(trip.scheduledOn, language)} />

      {/* The last good read stays on screen; this says it could not be refreshed. */}
      {loadError ? <DriverLoadError error={loadError} onRetry={reload} /> : null}

      <TripSummary trip={trip} />

      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {t(driverErrorKey(actionError))}
        </p>
      ) : null}

      <MilestoneCard end="pickup" trip={trip} now={now} onReport={reportEvent} reporting={report.isPending} locating={locating} />
      <MilestoneCard end="delivery" trip={trip} now={now} onReport={reportEvent} reporting={report.isPending} locating={locating} />

      <TripFacts trip={trip} />

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
 * The screen's title and the way back.
 *
 * ★ BACK MEANS BACK. Opened from a schedule card, the arrow returns through
 * history, so the tab the driver was on (`?view=upcoming`) survives. Opened any
 * other way there is no schedule behind this entry, and the link's own target
 * — the schedule — is where it goes. A link either way, because it navigates.
 */
function DetailHeader({ subtitle }: Readonly<{ subtitle: string | null }>) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { state } = useLocation();

  const back = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!wasOpenedFromSchedule(state)) return;
    event.preventDefault();
    navigate(-1);
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/driver"
        onClick={back}
        aria-label={t('driverBack')}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), '-ml-2 size-11')}
      >
        <ArrowLeft />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold">{t('driverTripDetail')}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/**
 * The first thing on the screen: where this assignment stands, when to load,
 * in which lorry — and the progress under it.
 *
 * ★ THE PLANNED PICKUP IS AN INSTANT, SHOWN ON THE VIEWER'S CLOCK. The DAY in
 * the header is the business day (`scheduledOn`); the time here is the moment
 * the office planned, rendered where the driver is standing.
 */
function TripSummary({ trip }: Readonly<{ trip: DriverTripDetail }>) {
  const { t, language } = useLanguage();
  const pickupAt = trip.scheduledPickupAt;

  return (
    <Card>
      <CardContent className="space-y-4">
        <AssignmentStatusPill status={assignmentStatusOf(trip)} />

        <div className="grid gap-3 sm:grid-cols-2">
          <FactRow
            icon={<Clock />}
            label={t('driverPlannedPickup')}
            value={pickupAt ? formatTimeOnDay(pickupAt, language) : null}
            emphasis
          />
          <FactRow icon={<Truck />} label={t('driverVehicle')} value={formatPlate(trip.vehicle?.plate) || null} emphasis />
        </div>

        <div className="border-t border-border pt-4">
          <Stepper
            label={t('driverProgress')}
            steps={workflowStages(trip).map((step) => ({
              key: step.stage,
              label: t(STAGE_LABEL[step.stage]),
              state: step.state,
            }))}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * What else is true of the trip: whose goods, what goods, and what the office
 * wrote for the driver. The lorry and the two ends have their own sections.
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

/** The sections' shapes while the assignment loads, and one sentence for a screen reader. */
function DetailSkeleton() {
  const { t } = useLanguage();
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{t('driverLoading')}</span>
      <div className="flex items-center gap-3 py-1">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <Card>
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-10 w-3/5" />
          <Skeleton className="h-10 w-2/5" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
      {[0, 1].map((end) => (
        <Card key={end}>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
