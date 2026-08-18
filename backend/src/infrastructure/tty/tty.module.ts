import { Module } from '@nestjs/common';
import { SECRET_READER } from '../../common/types/secret-reader.port';
import { TtySecretReader } from './hidden-line-reader';

/**
 * The terminal adapter, bound to its port.
 *
 * Same shape as `AuthModule` binding the scrypt hasher: `core/` declares what it
 * needs, `infrastructure/` provides it, and the composition root is the only
 * place that knows both.
 */
@Module({
  providers: [{ provide: SECRET_READER, useClass: TtySecretReader }],
  exports: [SECRET_READER],
})
export class TtyModule {}
