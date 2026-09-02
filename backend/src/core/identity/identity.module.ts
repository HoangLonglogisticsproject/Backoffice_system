import { Module } from '@nestjs/common';
import { AuthController } from './api/auth.controller';
import { AuthGuard } from './api/auth.guard';
import { BackofficeOnlyGuard } from './api/backoffice-only.guard';
import { AuthenticationService } from './application/authentication.service';
import { CsrfGuard } from './api/csrf.guard';
import { LoginThrottleService } from './application/login-throttle.service';
import { IdentityRepository } from './persistence/identity.repository';
import { SessionRepository } from './persistence/session.repository';
import { SessionService } from './application/session.service';

/**
 * Who is calling, and how they proved it.
 *
 * Knows nothing about what they may DO — that is authorization, a later phase
 * with its own module. Keeping the two apart is what lets a deployment change
 * its permission model without touching login.
 */
@Module({
  controllers: [AuthController],
  providers: [
    IdentityRepository,
    SessionRepository,
    SessionService,
    AuthenticationService,
    AuthGuard,
    BackofficeOnlyGuard,
    CsrfGuard,
    LoginThrottleService,
  ],
  exports: [
    SessionService,
    SessionRepository,
    IdentityRepository,
    AuthGuard,
    BackofficeOnlyGuard,
    AuthenticationService,
  ],
})
export class IdentityModule {}
