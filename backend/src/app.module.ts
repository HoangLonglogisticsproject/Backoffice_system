import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { HealthModule } from './infrastructure/health/health.module';
import { AuthModule } from './infrastructure/auth/auth.module';
import { TtyModule } from './infrastructure/tty/tty.module';
import { AuthorizationModule } from './core/authorization/authorization.module';
import { IdentityModule } from './core/identity/identity.module';
import { OrganizationModule } from './core/organization/organization.module';
import { UsersModule } from './core/users/users.module';
import { AccountInvitationModule } from './capabilities/account-invitation/account-invitation.module';
import { MembershipApprovalModule } from './capabilities/membership-approval/membership-approval.module';
import { TripScheduleModule } from './capabilities/trip-schedule/trip-schedule.module';

/**
 * THE COMPOSITION ROOT — the only file that knows the whole system.
 *
 * Three kinds of module land here and the order below reflects the dependency
 * direction the whole codebase is built on:
 *
 *   config/          the validated environment
 *   infrastructure/  technology adapters — database, health, later auth/storage
 *   core/            the Backoffice Foundation itself         (Phase 1 onward)
 *   capabilities/    optional business modules, per project    (empty by design)
 *
 * `core/` defines ports; `infrastructure/` implements them; this file is where
 * the two are wired together. That is why core never imports infrastructure —
 * if it did, swapping a password provider for OIDC would mean editing the
 * foundation.
 *
 * A deployment with zero capabilities is a valid deployment. The foundation has
 * to be useful on its own, or it is not a foundation.
 */
@Module({
  imports: [
    // config + technology adapters first: core modules consume the ports they
    // register, and nothing here consumes core.
    ConfigModule,
    DatabaseModule,
    AuthModule,
    TtyModule,
    HealthModule,

    // the foundation
    UsersModule,
    IdentityModule,
    OrganizationModule,
    AuthorizationModule,

    // project capabilities — a deployment without them is still valid
    MembershipApprovalModule,
    AccountInvitationModule,
    TripScheduleModule,
  ],
})
export class AppModule {}
