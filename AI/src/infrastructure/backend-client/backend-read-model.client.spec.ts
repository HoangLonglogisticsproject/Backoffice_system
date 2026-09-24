import type { AppConfig } from '../../config/app.config';
import { BackendReadModelClient, ReadModelError } from './backend-read-model.client';

/**
 * What the client does with every kind of answer — and in particular that no
 * failure ever looks like an empty page. The distinction is the whole of
 * invariant M on this side.
 */
describe('BackendReadModelClient', () => {
  const TOKEN = 'ai-to-backend-service-token-for-unit-0000';
  const BEFORE = new Date('2026-09-24T08:00:00.000Z');

  const clientWith = (over: Partial<AppConfig> = {}) =>
    new BackendReadModelClient({
      backendInternalUrl: 'http://backend:3000',
      serviceTokenAiToBackend: TOKEN,
      backendTimeoutMs: 10_000,
      ...over,
    } as unknown as AppConfig);

  const tripPayload = {
    tripId: '11111111-1111-4111-8111-111111111111',
    scheduledOn: '2026-09-24',
    pickupAt: '2026-09-24T09:00:00.000Z',
    deliveryAt: null,
    status: 'confirmed',
    archived: false,
    activeAssignmentCount: 0,
    customer: null,
  };

  /** The three fields the client reads. `unknown` first: a stub is not a Response. */
  const respond = (body: unknown, status = 200): Response =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

  let fetchMock: jest.SpyInstance;

  afterEach(() => {
    fetchMock?.mockRestore();
  });

  const stub = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(impl as never);
  };

  describe('configuration', () => {
    it('is unconfigured without a URL or without a token, and refuses to call', async () => {
      expect(clientWith({ backendInternalUrl: '' } as Partial<AppConfig>).configured).toBe(false);
      expect(clientWith({ serviceTokenAiToBackend: '' } as Partial<AppConfig>).configured).toBe(false);
      expect(clientWith().configured).toBe(true);

      await expect(
        clientWith({ backendInternalUrl: '' } as Partial<AppConfig>).unassignedTrips(
          { before: BEFORE, limit: 10 },
          'cid',
        ),
      ).rejects.toMatchObject({ kind: 'unconfigured' });
    });
  });

  describe('a successful read', () => {
    it('sends the bearer, the correlation id, the window and the page size', async () => {
      let seenUrl = '';
      let seenInit: RequestInit = {};
      stub(async (url, init) => {
        seenUrl = url;
        seenInit = init;
        return respond({ items: [tripPayload], nextCursor: 'c1', hasMore: true });
      });

      const page = await clientWith().unassignedTrips({ before: BEFORE, limit: 25, cursor: 'c0' }, 'cid-1');

      expect(seenUrl).toBe(
        'http://backend:3000/internal/v1/read-models/dispatch/unassigned-trips?before=2026-09-24T08%3A00%3A00.000Z&limit=25&cursor=c0',
      );
      const headers = seenInit.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
      expect(headers['X-Correlation-Id']).toBe('cid-1');
      expect(page.items[0]?.pickupAt).toBeInstanceOf(Date);
      expect(page.items[0]?.pickupAt?.toISOString()).toBe('2026-09-24T09:00:00.000Z');
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe('c1');
    });

    it('omits the cursor on a first page', async () => {
      let seenUrl = '';
      stub(async (url) => {
        seenUrl = url;
        return respond({ items: [], nextCursor: null, hasMore: false });
      });
      await clientWith().pendingCompletions({ before: BEFORE, limit: 50 }, 'cid');
      expect(seenUrl).not.toContain('cursor=');
    });

    it('posts a lookup body with all three id lists', async () => {
      let seenBody = '';
      stub(async (_url, init) => {
        seenBody = init.body as string;
        return respond({ trips: [tripPayload], assignments: [], completionRequests: [] });
      });

      const result = await clientWith().lookup({ tripIds: ['t1'] }, 'cid-2');

      expect(JSON.parse(seenBody)).toEqual({ tripIds: ['t1'], assignmentIds: [], completionRequestIds: [] });
      expect(result.trips).toHaveLength(1);
    });
  });

  describe('★ every failure is a failure, never an empty page', () => {
    it('a 401 is `unauthorized`', async () => {
      stub(async () => respond({}, 401));
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toMatchObject({
        kind: 'unauthorized',
        status: 401,
      });
    });

    it('a 500 is `http`, and carries the status', async () => {
      stub(async () => respond({}, 500));
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toMatchObject({
        kind: 'http',
        status: 500,
      });
    });

    it('a timeout is `timeout`', async () => {
      stub(async () => {
        const error = new Error('aborted');
        error.name = 'TimeoutError';
        throw error;
      });
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toMatchObject({
        kind: 'timeout',
      });
    });

    it('a connection failure is `network`', async () => {
      stub(async () => {
        throw new Error('ECONNREFUSED');
      });
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toMatchObject({
        kind: 'network',
      });
    });

    it('a body that is not JSON is `malformed`', async () => {
      stub(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('not json');
            },
          }) as unknown as Response,
      );
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toMatchObject({
        kind: 'malformed',
      });
    });

    it('★ a body that does not match the contract is `malformed`, not an empty page', async () => {
      stub(async () => respond({ items: [{ tripId: 'not-a-uuid' }], nextCursor: null, hasMore: false }));
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toBeInstanceOf(
        ReadModelError,
      );
    });

    it('a page envelope with the wrong shape is `malformed`', async () => {
      stub(async () => respond({ rows: [] }));
      await expect(clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid')).rejects.toMatchObject({
        kind: 'malformed',
      });
    });

    it('never puts the token in the error it throws', async () => {
      stub(async () => respond({}, 500));
      try {
        await clientWith().unassignedTrips({ before: BEFORE, limit: 10 }, 'cid');
        throw new Error('expected a refusal');
      } catch (error) {
        expect((error as Error).message).not.toContain(TOKEN);
      }
    });
  });
});
