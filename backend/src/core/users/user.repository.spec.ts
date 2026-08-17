import { ConflictError } from '../../common/errors/domain.error';
import type { Database, DatabaseQuery } from '../../common/types/database.port';
import { UserRepository } from './user.repository';

/**
 * One behaviour is worth a unit test here, and it is the one the service cannot
 * cover: what happens when the pre-check is beaten to the unique index.
 *
 * `UserService` looks for a duplicate before inserting, but two callers can
 * both pass that check in the same instant and only one can win. The loser must
 * get the same conflict, not a raw driver error dressed up as a 500.
 */
describe('UserRepository', () => {
  const input = { displayName: 'A Person', subject: 'a@example.com', secretHash: 'scrypt$x' };

  /** A Database port whose transaction body throws whatever it is given. */
  const dbThatFailsWith = (error: unknown): Database => ({
    query: jest.fn(),
    transaction: jest.fn(async (work: (tx: DatabaseQuery) => Promise<unknown>) => {
      await work({ query: jest.fn(async () => [{ id: 'u1' }]) as never });
      throw error;
    }) as never,
  });

  it('turns a unique violation into a ConflictError', async () => {
    // SQLSTATE 23505. Without this mapping the race answers 500, which says
    // "we broke" when the truth is "that identity is taken".
    const repository = new UserRepository(
      dbThatFailsWith(Object.assign(new Error('duplicate key value'), { code: '23505' })),
    );

    await expect(repository.createWithLocalIdentity(input)).rejects.toBeInstanceOf(ConflictError);
  });

  it('names no subject in that error either', async () => {
    const repository = new UserRepository(
      dbThatFailsWith(Object.assign(new Error('duplicate key value'), { code: '23505' })),
    );

    await expect(repository.createWithLocalIdentity(input)).rejects.toThrow(
      'That identity is already registered.',
    );
  });

  it('lets every OTHER database failure through unchanged', async () => {
    // Swallowing these into a conflict would report "already registered" for a
    // dropped connection — a lie that sends someone looking in the wrong place.
    const repository = new UserRepository(
      dbThatFailsWith(Object.assign(new Error('connection terminated'), { code: '08006' })),
    );

    await expect(repository.createWithLocalIdentity(input)).rejects.toThrow(
      'connection terminated',
    );
  });
});
