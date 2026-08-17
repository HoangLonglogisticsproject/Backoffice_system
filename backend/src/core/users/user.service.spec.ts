import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/domain.error';
import type { PasswordHasher } from '../identity/password-hasher.port';
import { LOCAL_PROVIDER } from './user.entity';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

describe('UserService', () => {
  let users: { subjectExists: jest.Mock; createWithLocalIdentity: jest.Mock; findById: jest.Mock };
  let hasher: jest.Mocked<PasswordHasher>;
  let service: UserService;

  beforeEach(() => {
    users = {
      subjectExists: jest.fn().mockResolvedValue(false),
      createWithLocalIdentity: jest.fn().mockResolvedValue({ id: 'u1' }),
      findById: jest.fn(),
    };
    hasher = {
      hash: jest.fn().mockResolvedValue('scrypt$digest'),
      verify: jest.fn(),
      fakeVerify: jest.fn(),
    };
    service = new UserService(users as unknown as UserRepository, hasher);
  });

  it('stores a hash, never the password', async () => {
    await service.createWithPassword({
      displayName: 'A Person',
      subject: 'a@example.com',
      password: 'a real password',
    });

    const stored = users.createWithLocalIdentity.mock.calls[0][0];
    expect(stored.secretHash).toBe('scrypt$digest');
    expect(JSON.stringify(stored)).not.toContain('a real password');
  });

  it('rejects a duplicate identity', async () => {
    users.subjectExists.mockResolvedValue(true);

    await expect(
      service.createWithPassword({ displayName: 'X', subject: 'a@example.com', password: 'a valid passphrase' }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(users.createWithLocalIdentity).not.toHaveBeenCalled();
  });

  it('does not echo the subject back in the duplicate error', async () => {
    users.subjectExists.mockResolvedValue(true);

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

    expect(users.createWithLocalIdentity.mock.calls[0][0].displayName).toBe('A Person');
  });

  it('checks for the duplicate BEFORE hashing, so a repeat does not cost 100ms of scrypt', async () => {
    users.subjectExists.mockResolvedValue(true);

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

    expect(users.subjectExists).toHaveBeenCalledWith(LOCAL_PROVIDER, 'a@example.com');
    expect(users.createWithLocalIdentity.mock.calls[0][0].subject).toBe('a@example.com');
  });

  it('applies the password policy before touching the database', async () => {
    await expect(
      service.createWithPassword({ displayName: 'A', subject: 'a@b.c', password: 'short' }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(users.subjectExists).not.toHaveBeenCalled();
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
