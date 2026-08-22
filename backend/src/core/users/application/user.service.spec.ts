import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import type { PasswordHasher } from '../../identity/domain/password-hasher.port';
import { LOCAL_PROVIDER } from '../domain/user.entity';
import { IdentityRepository } from '../../identity/persistence/identity.repository';
import { UserRepository } from '../persistence/user.repository';
import type { Database } from '../../../common/types/database.port';
import { UserService } from './user.service';

describe('UserService', () => {
  let users: { insertUser: jest.Mock; findById: jest.Mock };
  let identities: { subjectExists: jest.Mock; insertLocal: jest.Mock };
  let hasher: jest.Mocked<PasswordHasher>;
  let service: UserService;

  beforeEach(() => {
    users = {
      insertUser: jest.fn().mockResolvedValue({ id: 'u1' }),
      findById: jest.fn(),
    };
    identities = {
      subjectExists: jest.fn().mockResolvedValue(false),
      insertLocal: jest.fn().mockResolvedValue(undefined),
    };
    hasher = {
      hash: jest.fn().mockResolvedValue('scrypt$digest'),
      verify: jest.fn(),
      fakeVerify: jest.fn(),
    };
    const db = {
      query: jest.fn(),
      // Runs the callback straight through: proves composition, claims no atomicity.
      transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
    } as unknown as Database;
    service = new UserService(
      db,
      users as unknown as UserRepository,
      identities as unknown as IdentityRepository,
      hasher,
    );
  });

  it('stores a hash, never the password', async () => {
    await service.createWithPassword({
      displayName: 'A Person',
      subject: 'a@example.com',
      password: 'a real password',
    });

    const stored = identities.insertLocal.mock.calls[0][0];
    expect(stored.secretHash).toBe('scrypt$digest');
    expect(JSON.stringify(stored)).not.toContain('a real password');
  });

  /**
   * ★ THE DEFAULT IS THE STRICT ONE, and that is the whole design.
   *
   * A password handed to this method was chosen by somebody, and the only case
   * where that somebody is the account owner is an operator typing one at a
   * prompt. Everything else is a secret that travelled. So omitting the flag
   * has to produce the credential that MUST be replaced — the reverse default
   * would let a future caller mint a permanent one by saying nothing, and
   * nothing would report it.
   */
  it('★ marks the credential as one that must be replaced, by default', async () => {
    await service.createWithPassword({
      displayName: 'A Person',
      subject: 'a@example.com',
      password: 'a valid passphrase',
    });

    expect(identities.insertLocal.mock.calls[0][0].mustChangeSecret).toBe(true);
  });

  it('honours an explicit true — the bootstrap CLI passes it at the call site', async () => {
    await service.createWithPassword({
      displayName: 'A Person',
      subject: 'b@example.com',
      password: 'a valid passphrase',
      mustChangeSecret: true,
    });

    expect(identities.insertLocal.mock.calls[0][0].mustChangeSecret).toBe(true);
  });

  it('allows an explicit false, for a caller that owns its own secret', async () => {
    // No production caller does this today. The option exists so that opting
    // OUT is a deliberate sentence somebody wrote, rather than the outcome of
    // forgetting an argument.
    await service.createWithPassword({
      displayName: 'A Person',
      subject: 'c@example.com',
      password: 'a valid passphrase',
      mustChangeSecret: false,
    });

    expect(identities.insertLocal.mock.calls[0][0].mustChangeSecret).toBe(false);
  });

  it('rejects a duplicate identity', async () => {
    identities.subjectExists.mockResolvedValue(true);

    await expect(
      service.createWithPassword({ displayName: 'X', subject: 'a@example.com', password: 'a valid passphrase' }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(identities.insertLocal).not.toHaveBeenCalled();
  });

  it('does not echo the subject back in the duplicate error', async () => {
    identities.subjectExists.mockResolvedValue(true);

    // This path is a CLI today, but the moment user creation is exposed over
    // HTTP, repeating the submitted address makes it an enumeration oracle.
    let message = '';
    try {
      await service.createWithPassword({
        displayName: 'X',
        subject: 'someone@example.com',
        password: 'a valid passphrase',
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toContain('someone@example.com');
    expect(message).toBe('That identity is already registered.');
  });

  it('trims the display name, so a padded name is not stored padded', async () => {
    await service.createWithPassword({
      displayName: '  A Person  ',
      subject: 'a@example.com',
      password: 'a valid passphrase',
    });

    expect(users.insertUser.mock.calls[0][0].displayName).toBe('A Person');
  });

  it('checks for the duplicate BEFORE hashing, so a repeat does not cost 100ms of scrypt', async () => {
    identities.subjectExists.mockResolvedValue(true);

    await expect(
      service.createWithPassword({ displayName: 'X', subject: 'a@example.com', password: 'a valid passphrase' }),
    ).rejects.toThrow();

    expect(hasher.hash).not.toHaveBeenCalled();
  });

  it('normalises the subject, so casing and spacing cannot create a second account', async () => {
    await service.createWithPassword({
      displayName: 'A',
      subject: '  A@Example.COM ',
      password: 'a valid passphrase',
    });

    expect(identities.subjectExists).toHaveBeenCalledWith(LOCAL_PROVIDER, 'a@example.com');
    expect(identities.insertLocal.mock.calls[0][0].subject).toBe('a@example.com');
  });

  it('applies the password policy before touching the database', async () => {
    await expect(
      service.createWithPassword({ displayName: 'A', subject: 'a@b.c', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(identities.subjectExists).not.toHaveBeenCalled();
    expect(hasher.hash).not.toHaveBeenCalled();
  });

  it('never silently truncates an over-long password', async () => {
    // Truncating would create the account with a shorter secret than the user
    // believes they chose, and nobody would find out.
    await expect(
      service.createWithPassword({ displayName: 'A', subject: 'a@b.c', password: 'x'.repeat(2000) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('raises NotFound rather than returning null for a missing user', async () => {
    users.findById.mockResolvedValue(null);
    await expect(service.requireById('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
