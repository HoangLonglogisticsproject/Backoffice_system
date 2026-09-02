import { httpClient } from './client';
import type { CompletionRequest, ExecutionEvent } from '@/types/driver';
import type { OperationalBoardRow } from '@/types/operationalBoard';

/**
 * The office side of the operational lifecycle: watching it, and deciding it.
 *
 * ★ THE SAME LIFECYCLE THE DRIVER PORTAL USES, NOT A SECOND ONE. There is one
 * `trip_completion_requests` table, one set of states, one approval. This file
 * reads and decides it from the other side of the counter; `driverPortal.ts`
 * submits into it. A separate completion model for the backoffice would be two
 * answers to "is this trip finished".
 *
 * ★ WHAT IS DELIBERATELY ABSENT FROM EVERY BODY BELOW:
 *
 *   decidedBy     the reviewer is the SESSION. A body that names its own
 *   approvedBy    approver is a body that can name somebody else's — and this
 *   rejectedBy    is the decision that closes a trip permanently.
 *   decidedAt     the server owns its own clock. Nothing here dates a decision.
 *
 * ⚠ AND NO HIRE PRICE IS READ HERE. A carrier's agreed price is commercial and
 * has nothing to do with whether a driver's trip is finished; the review screen
 * fetches the driver's declared figures and nothing else.
 */

const tripPath = (tripId: string) => `/trip-schedules/${encodeURIComponent(tripId)}`;

/**
 * The operational board for a date range.
 *
 * ★ THE RANGE IS MANDATORY, and the server caps it. Same rule ADR-0003 applies
 * to the dispatch list, for the same reason: an unbounded scan of every trip
 * ever run is not a screen anybody wants.
 *
 * ⚠ THIS IS NOT THE REVIEW QUEUE, and it was, briefly. Filtering it to
 * `COMPLETION_PENDING` looked like the same list with a WHERE — until a trip
 * scheduled on the 30th and still undecided on the 1st fell outside the range
 * and vanished. A period and a backlog are different questions; see
 * `fetchCompletionReviewQueue`.
 */
export async function fetchOperationalBoard(range: {
  from: string;
  to: string;
}): Promise<OperationalBoardRow[]> {
  const { data } = await httpClient.get<OperationalBoardRow[]>('/operational-board', {
    params: range,
  });
  return data;
}

/**
 * The review queue: every completion still waiting on a decision.
 *
 * ★ NO DATE RANGE, UNLIKE EVERY OTHER TRIP LIST, and that is deliberate. The
 * board is a view of a PERIOD; this is a view of OUTSTANDING WORK. Filtering it
 * by the trip's scheduled day made a request submitted on the 30th disappear on
 * the 1st — while nobody had decided it.
 *
 * ★ AND IT REMOVES THE BROWSER'S CLOCK FROM THE QUESTION ENTIRELY. Computing a
 * month here would let a browser in another timezone decide which business
 * month it is; this screen now asks for outstanding work and the server answers.
 */
export async function fetchCompletionReviewQueue(): Promise<OperationalBoardRow[]> {
  const { data } = await httpClient.get<OperationalBoardRow[]>('/completion-review-queue');
  return data;
}

/**
 * Every completion attempt on a trip, newest first.
 *
 * Rejected attempts come back WITH their reasons — that history is the point.
 * Three rejections and an approval leave four rows.
 */
export async function fetchCompletionRequests(tripId: string): Promise<CompletionRequest[]> {
  const { data } = await httpClient.get<CompletionRequest[]>(`${tripPath(tripId)}/completion-requests`);
  return data;
}

/**
 * What the driver reported, with the server's own timestamps.
 *
 * `recordedAt` is when the SERVER heard, and is the figure a reviewer can trust;
 * `deviceReportedAt` is what the handset claimed and is diagnostic only.
 */
export async function fetchExecutionEvents(
  tripId: string,
  includeVoided = false,
): Promise<ExecutionEvent[]> {
  const { data } = await httpClient.get<ExecutionEvent[]>(`${tripPath(tripId)}/execution-events`, {
    params: includeVoided ? { includeVoided: 'true' } : {},
  });
  return data;
}

/**
 * Closes the trip.
 *
 * ★ ONE SERVER TRANSACTION DOES FOUR THINGS, AND THE CLIENT DOES NONE OF THEM:
 * the request becomes approved, every live figure becomes immutable, the trip
 * becomes `done`, and it is stamped with who closed it and when. There is no
 * undo — a database trigger makes `done` terminal — so nothing here may
 * optimistically render the outcome before the server has confirmed it.
 */
export async function approveCompletion(tripId: string): Promise<CompletionRequest> {
  const { data } = await httpClient.post<CompletionRequest>(
    `${tripPath(tripId)}/completion-requests/approve`,
    // No body at all. The decider and the moment are both the server's.
    {},
  );
  return data;
}

/**
 * Sends it back for correction.
 *
 * ★ THE REASON IS THE POINT OF THE CALL. A driver told only "rejected" has
 * nothing to act on; the server refuses a blank one with a CHECK the row cannot
 * exist without. Rejection also reopens every frozen figure so the driver can
 * correct what caused it.
 */
export async function rejectCompletion(
  tripId: string,
  reason: string,
): Promise<CompletionRequest> {
  const { data } = await httpClient.post<CompletionRequest>(
    `${tripPath(tripId)}/completion-requests/reject`,
    { reason },
  );
  return data;
}
