import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../core/authorization/authorization.module';
import { IdentityModule } from '../../core/identity/identity.module';
import { OrganizationModule } from '../../core/organization/organization.module';
import { UsersModule } from '../../core/users/users.module';
import { MembershipRequestController } from './api/membership-request.controller';
import { MembershipRequestService } from './application/membership-request.service';
import { MembershipRequestRepository } from './persistence/membership-request.repository';

/**
 * Hoàng Long's membership approval policy.
 *
 * A CAPABILITY, not foundation: another deployment deletes this folder, drops
 * `0006`, and its heads either get `unit.member.write` or do without. Nothing in
 * `core/` imports anything here — `B1` proves it.
 *
 * Imports core the other way round, which is the allowed direction. It owns the
 * workflow; core owns the effects it triggers.
 */
@Module({
  imports: [AuthorizationModule, OrganizationModule, UsersModule, IdentityModule],
  controllers: [MembershipRequestController],
  providers: [MembershipRequestService, MembershipRequestRepository],
  exports: [MembershipRequestService],
})
export class MembershipApprovalModule {}
