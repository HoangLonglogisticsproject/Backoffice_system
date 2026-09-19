import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfig } from './app.config';
import { validateEnv } from './env.schema';

/**
 * Global because configuration is cross-cutting. `validate` runs once at boot
 * and throws on a bad environment, so a misconfigured service never serves.
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
