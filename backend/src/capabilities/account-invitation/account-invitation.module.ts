import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../core/authorization/authorization.module';
import { IdentityModule } from '../../core/identity/identity.module';
import { OrganizationModule } from '../../core/organization/organization.module';
import { UsersModule } from '../../core/users/users.module';
import { AccountInvitationController } from './api/account-invitation.controller';
import { AccountInvitationService } from './application/account-invitation.service';
import { AccountInvitationRepository } from './persistence/account-invitation.repository';

/**
 * Hoàng Long's onboarding policy.
 *
 * A CAPABILITY: another deployment deletes this folder, drops `0007`, and its
 * administrators create accounts directly. Account creation itself is reused
 * from `core/users` rather than reimplemented — see the service.
 */
@Module({
  imports: [AuthorizationModule, OrganizationModule, UsersModule, IdentityModule],
  controllers: [AccountInvitationController],
  providers: [AccountInvitationService, AccountInvitationRepository],
  exports: [AccountInvitationService],
})
export class AccountInvitationModule {}
