import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthenticationService } from './authentication.service';
import { CsrfGuard } from './csrf.guard';
import { LoginThrottleService } from './login-throttle.service';
import { SessionService } from './session.service';

/**
 * Who is calling, and how they proved it.
 *
 * Knows nothing about what they may DO — that is authorization, a later phase
 * with its own module. Keeping the two apart is what lets a deployment change
 * its permission model without touching login.
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [SessionService, AuthenticationService, AuthGuard, CsrfGuard, LoginThrottleService],
  exports: [SessionService, AuthGuard],
})
export class IdentityModule {}
