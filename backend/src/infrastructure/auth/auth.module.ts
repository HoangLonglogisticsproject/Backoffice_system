import { Global, Module } from '@nestjs/common';
import { PASSWORD_HASHER } from '../../core/identity/domain/password-hasher.port';
import { ScryptPasswordHasher } from './scrypt-password-hasher';

/**
 * Binds the PasswordHasher port to its scrypt adapter.
 *
 * This one line is the whole point of the port: adopting argon2, or a provider
 * that verifies elsewhere, changes this file and nothing in `core/`.
 */
@Global()
@Module({
  providers: [{ provide: PASSWORD_HASHER, useClass: ScryptPasswordHasher }],
  exports: [PASSWORD_HASHER],
})
export class AuthModule {}
