import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app.config';
import { validateEnv } from './env.schema';

/**
 * Global because configuration is genuinely cross-cutting — the alternative is
 * importing it into every module, which is noise rather than architecture.
 *
 * `validate` runs once at boot and throws on the first bad environment, so a
 * misconfigured deployment never reaches the point of serving traffic.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfig],
  exports: [AppConfig],
})
export class ConfigModule {}
