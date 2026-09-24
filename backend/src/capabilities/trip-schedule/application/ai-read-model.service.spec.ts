import { ValidationError } from '../../../common/errors/domain.error';
import { LOOKUP_LIMIT, type SubjectIds } from '../persistence/ai-read-model.repository';
import { AiReadModelService } from './ai-read-model.service';

/**
 * The one rule this layer owns: no request may be unbounded, and a lookup
 * never silently returns less than it was asked for.
 */
describe('AiReadModelService', () => {
  const uuid = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

  const build = () => {
    const repository = {
      unassignedTrips: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      unstartedAssignments: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      pendingCompletions: jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
      lookup: jest.fn().mockResolvedValue({ trips: [], assignments: [], completionRequests: [] }),
    };
    return { repository, service: new AiReadModelService(repository as never) };
  };

  const ids = (over: Partial<SubjectIds> = {}): SubjectIds => ({
    tripIds: [],
    assignmentIds: [],
    completionRequestIds: [],
    ...over,
  });

  describe('windows pass straight through — the AI owns the threshold', () => {
    it.each(['unassignedTrips', 'unstartedAssignments', 'pendingCompletions'] as const)('%s', async (method) => {
      const { repository, service } = build();
      const before = new Date('2026-09-24T08:00:00Z');
      await service[method]({ before, limit: 25, cursor: 'abc' });
      expect(repository[method]).toHaveBeenCalledWith({ before, limit: 25, cursor: 'abc' });
    });
  });

  describe('lookup', () => {
    it('deduplicates ids before asking the database', async () => {
      const { repository, service } = build();
      await service.lookup(ids({ tripIds: [uuid(1), uuid(1), uuid(2)] }));
      expect(repository.lookup).toHaveBeenCalledWith(ids({ tripIds: [uuid(1), uuid(2)] }));
    });

    it('refuses an empty batch — an empty lookup is a caller mistake, not an empty answer', async () => {
      const { repository, service } = build();
      await expect(service.lookup(ids())).rejects.toBeInstanceOf(ValidationError);
      expect(repository.lookup).not.toHaveBeenCalled();
    });

    it('admits exactly the ceiling across the three kinds', async () => {
      const { repository, service } = build();
      const trips = Array.from({ length: LOOKUP_LIMIT - 2 }, (_, i) => uuid(i + 1));
      await service.lookup(ids({ tripIds: trips, assignmentIds: [uuid(900)], completionRequestIds: [uuid(901)] }));
      expect(repository.lookup).toHaveBeenCalled();
    });

    it('REFUSES above the ceiling rather than truncating — a truncated lookup would look like "does not exist"', async () => {
      const { repository, service } = build();
      const tooMany = Array.from({ length: LOOKUP_LIMIT + 1 }, (_, i) => uuid(i + 1));
      await expect(service.lookup(ids({ tripIds: tooMany }))).rejects.toBeInstanceOf(ValidationError);
      await expect(service.lookup(ids({ tripIds: tooMany }))).rejects.toThrow(/at most 200/);
      expect(repository.lookup).not.toHaveBeenCalled();
    });

    it('counts the ceiling across kinds, not per kind', async () => {
      const { service } = build();
      const half = Array.from({ length: LOOKUP_LIMIT / 2 + 1 }, (_, i) => uuid(i + 1));
      const otherHalf = Array.from({ length: LOOKUP_LIMIT / 2 + 1 }, (_, i) => uuid(i + 500));
      await expect(service.lookup(ids({ tripIds: half, assignmentIds: otherHalf }))).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('counts duplicates once, so a repetitive batch is not refused for nothing', async () => {
      const { repository, service } = build();
      const oneIdManyTimes = Array.from({ length: LOOKUP_LIMIT + 50 }, () => uuid(7));
      await service.lookup(ids({ tripIds: oneIdManyTimes }));
      expect(repository.lookup).toHaveBeenCalledWith(ids({ tripIds: [uuid(7)] }));
    });
  });
});
