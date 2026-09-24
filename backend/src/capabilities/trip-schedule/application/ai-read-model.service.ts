import { Injectable } from '@nestjs/common';
import { ValidationError } from '../../../common/errors/domain.error';
import type { Page } from '../../../common/pagination/cursor';
import type { AssignmentFacts, CompletionRequestFacts, SubjectLookupResult, TripFacts } from '../domain/ai-read-model';
import { AiReadModelRepository, LOOKUP_LIMIT, type SubjectIds, type WindowQuery } from '../persistence/ai-read-model.repository';

/**
 * The bounds on what the AI may ask for. Thin on purpose: the facts are the
 * repository's, the policy is the AI's, and what sits between them is only
 * "no request may be unbounded".
 */
@Injectable()
export class AiReadModelService {
  constructor(private readonly readModel: AiReadModelRepository) {}

  unassignedTrips(query: WindowQuery): Promise<Page<TripFacts>> {
    return this.readModel.unassignedTrips(query);
  }

  unstartedAssignments(query: WindowQuery): Promise<Page<AssignmentFacts>> {
    return this.readModel.unstartedAssignments(query);
  }

  pendingCompletions(query: WindowQuery): Promise<Page<CompletionRequestFacts>> {
    return this.readModel.pendingCompletions(query);
  }

  /**
   * At most `LOOKUP_LIMIT` ids across the three kinds, deduplicated. Refused
   * above that rather than truncated: a truncated lookup would let the AI
   * mistake "not returned" for "does not exist" — the exact confusion the
   * Resolution phase must never fall into.
   */
  // `async`, so a refusal REJECTS rather than throwing synchronously: the
  // signature promises a Promise, and a caller that only wrote `.catch()`
  // would otherwise take the error as an unhandled throw.
  async lookup(ids: SubjectIds): Promise<SubjectLookupResult> {
    const unique: SubjectIds = {
      tripIds: [...new Set(ids.tripIds)],
      assignmentIds: [...new Set(ids.assignmentIds)],
      completionRequestIds: [...new Set(ids.completionRequestIds)],
    };
    const total = unique.tripIds.length + unique.assignmentIds.length + unique.completionRequestIds.length;

    if (total === 0) {
      throw new ValidationError('A lookup names at least one subject id.', { ids: 'At least one id is required.' });
    }
    if (total > LOOKUP_LIMIT) {
      throw new ValidationError(`A lookup names at most ${LOOKUP_LIMIT} subject ids.`, {
        ids: `${total} ids given; the maximum is ${LOOKUP_LIMIT}. Split the batch.`,
      });
    }

    return this.readModel.lookup(unique);
  }
}
