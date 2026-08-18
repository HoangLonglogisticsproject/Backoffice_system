import { ConflictError } from '../../../common/errors/domain.error';
import type { Database, DatabaseQuery } from '../../../common/types/database.port';
import { IdentityRepository } from './identity.repository';

/**
 * One behaviour is worth a unit test here, and it is the one the service cannot
 * cover: what happens when the pre-check is beaten to the unique index.
 *
 * `UserService` looks for a duplicate before inserting, but two callers can
 * both pass that check in the same instant and only one can win. The loser must
 * get the same conflict, not a raw driver error dressed up as a 500.
 */
describe('IdentityRepository', () => {
  const input = { displayName: 'A Person', subject: 'a@example.com', secretHash: 'scrypt$x' };

  /**
   * A Database port whose every query throws whatever it is given.
   *
   * The transaction now belongs to the service, so the failure this file cares
   * about surfaces from the INSERT itself rather than from a transaction body.
   */
  const dbThatFailsWith = (error: unknown): Database => ({
    query: jest.fn(async () => {
      throw error;
    }) as never,
    transaction: jest.fn(async (work: (tx: DatabaseQuery) => Promise<unknown>) =>
      work({
        query: jest.fn(async () => {
          throw error;
        }) as never,
      }),
    ) as never,
  });

  it('turns a unique violation into a ConflictError', async () => {
    // SQLSTATE 23505. Without this mapping the race answers 500, which says
    // "we broke" when the truth is "that identity is taken".
    const repository = new IdentityRepository(
      dbThatFailsWith(Object.assign(new Error('duplicate key value'), { code: '23505' })),
    );

    await expect(repository.insertLocal({ userId: 'u1', subject: input.subject, secretHash: input.secretHash })).rejects.toBeInstanceOf(ConflictError);
  });

  it('names no subject in that error either', async () => {
    const repository = new IdentityRepository(
      dbThatFailsWith(Object.assign(new Error('duplicate key value'), { code: '23505' })),
    );

    await expect(repository.insertLocal({ userId: 'u1', subject: input.subject, secretHash: input.secretHash })).rejects.toThrow(
      'That identity is already registered.',
    );
  });

  it('lets every OTHER database failure through unchanged', async () => {
    // Swallowing these into a conflict would report "already registered" for a
    // dropped connection — a lie that sends someone looking in the wrong place.
    const repository = new IdentityRepository(
      dbThatFailsWith(Object.assign(new Error('connection terminated'), { code: '08006' })),
    );

    await expect(repository.insertLocal({ userId: 'u1', subject: input.subject, secretHash: input.secretHash })).rejects.toThrow(
      'connection terminated',
    );
  });
});
