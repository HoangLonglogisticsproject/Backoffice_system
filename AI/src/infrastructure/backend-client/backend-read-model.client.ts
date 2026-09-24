import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../../config/app.config';
import {
  assignmentFactsSchema,
  completionRequestFactsSchema,
  pageSchema,
  subjectLookupSchema,
  tripFactsSchema,
  type AssignmentFacts,
  type CompletionRequestFacts,
  type SubjectLookupResult,
  type TripFacts,
} from './read-model.types';

/**
 * The only way this service learns anything about a trip.
 *
 * ★ EVERY FAILURE IS A FAILURE, NEVER AN EMPTY PAGE. A timeout, a 5xx, a 401,
 * a body that does not parse — each throws `ReadModelError`, and the engine
 * turns that into a `partial` scan that resolves nothing. This is the whole
 * of invariant M on this side: "the backend did not answer" and "there is
 * nothing there" must never produce the same value, because the second one
 * closes alerts.
 *
 * ★ THE TOKEN IS NEVER LOGGED, and never appears in a thrown message. The
 * error carries a classification and a status, which is what an operator
 * needs and all they need.
 */

/** Why a read failed, for the log line and the scan outcome. */
export type ReadFailureKind = 'unauthorized' | 'http' | 'timeout' | 'network' | 'malformed' | 'unconfigured';

export class ReadModelError extends Error {
  constructor(
    readonly kind: ReadFailureKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ReadModelError';
  }
}

export interface PageRequest {
  /** Upper bound of the anchor. */
  before: Date;
  /** Is `before` itself in the range? The backend defaults it to `true`. */
  beforeInclusive?: boolean;
  /** Lower bound. Absent means unbounded below. */
  after?: Date;
  /** Is `after` itself in the range? The backend defaults it to `false`. */
  afterInclusive?: boolean;
  limit: number;
  cursor?: string | null;
}

export interface FactsPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SubjectIds {
  tripIds?: readonly string[];
  assignmentIds?: readonly string[];
  completionRequestIds?: readonly string[];
}

const BASE_PATH = '/internal/v1/read-models/dispatch';

@Injectable()
export class BackendReadModelClient {
  private readonly logger = new Logger(BackendReadModelClient.name);

  constructor(private readonly config: AppConfig) {}

  /** False when there is no backend URL or no token — the engine then stays disarmed. */
  get configured(): boolean {
    return this.config.backendInternalUrl.length > 0 && this.config.serviceTokenAiToBackend.length > 0;
  }

  unassignedTrips(request: PageRequest, correlationId: string): Promise<FactsPage<TripFacts>> {
    return this.page('unassigned-trips', tripFactsSchema, request, correlationId);
  }

  unstartedAssignments(request: PageRequest, correlationId: string): Promise<FactsPage<AssignmentFacts>> {
    return this.page('unstarted-assignments', assignmentFactsSchema, request, correlationId);
  }

  pendingCompletions(request: PageRequest, correlationId: string): Promise<FactsPage<CompletionRequestFacts>> {
    return this.page('pending-completions', completionRequestFactsSchema, request, correlationId);
  }

  /**
   * The current facts for named subjects. An id that comes back absent means
   * the backend HAS NO SUCH ROW — it does not mean "unavailable", because an
   * unavailable backend throws instead of answering.
   */
  async lookup(ids: SubjectIds, correlationId: string): Promise<SubjectLookupResult> {
    const body = {
      tripIds: [...(ids.tripIds ?? [])],
      assignmentIds: [...(ids.assignmentIds ?? [])],
      completionRequestIds: [...(ids.completionRequestIds ?? [])],
    };
    const payload = await this.send(`${BASE_PATH}/subjects/lookup`, correlationId, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.parse(subjectLookupSchema, payload, `${BASE_PATH}/subjects/lookup`);
  }

  private async page<T extends z.ZodTypeAny>(
    path: string,
    item: T,
    request: PageRequest,
    correlationId: string,
  ): Promise<FactsPage<z.infer<T>>> {
    const query = new URLSearchParams({
      before: request.before.toISOString(),
      limit: String(request.limit),
    });
    if (request.after) query.set('after', request.after.toISOString());
    // Sent only when the caller has an opinion, so the wire stays quiet for
    // the ordinary `(after, before]` and the two flags are visible in a log
    // exactly when they are what makes the request different.
    if (request.beforeInclusive !== undefined) query.set('beforeInclusive', String(request.beforeInclusive));
    if (request.afterInclusive !== undefined) query.set('afterInclusive', String(request.afterInclusive));
    if (request.cursor) query.set('cursor', request.cursor);

    const payload = await this.send(`${BASE_PATH}/${path}?${query.toString()}`, correlationId, { method: 'GET' });
    return this.parse(pageSchema(item), payload, path);
  }

  private async send(path: string, correlationId: string, init: RequestInit): Promise<unknown> {
    if (!this.configured) {
      throw new ReadModelError('unconfigured', 'No backend URL or service token is configured.');
    }

    const url = new URL(path, this.config.backendInternalUrl).toString();
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        headers: {
          // The one place the token is used. It is never logged and never
          // put into an error.
          Authorization: `Bearer ${this.config.serviceTokenAiToBackend}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
        },
        signal: AbortSignal.timeout(this.config.backendTimeoutMs),
      });
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError';
      throw new ReadModelError(
        timedOut ? 'timeout' : 'network',
        timedOut
          ? `The backend did not answer ${path} within ${this.config.backendTimeoutMs}ms.`
          : `The backend could not be reached for ${path}: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      // A 401 is its own kind: the operator has to fix a secret, not a query.
      const kind: ReadFailureKind = response.status === 401 || response.status === 403 ? 'unauthorized' : 'http';
      throw new ReadModelError(kind, `The backend answered ${response.status} for ${path}.`, response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new ReadModelError('malformed', `The backend's answer to ${path} was not JSON.`, response.status);
    }
  }

  private parse<T extends z.ZodTypeAny>(schema: T, payload: unknown, path: string): z.infer<T> {
    const result = schema.safeParse(payload);
    if (!result.success) {
      // The issues say WHICH field, never what the value was: a read model
      // carries operational data, and a log line is the wrong place for it.
      const where = result.error.issues
        .slice(0, 3)
        .map((issue) => issue.path.join('.') || '(root)')
        .join(', ');
      this.logger.error(`Read model ${path} did not match the contract at: ${where}`);
      throw new ReadModelError('malformed', `The backend's answer to ${path} did not match the agreed contract.`);
    }
    return result.data;
  }
}
