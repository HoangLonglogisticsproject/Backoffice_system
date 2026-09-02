import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../core/authorization/authorization.module';
import { IdentityModule } from '../../core/identity/identity.module';
import { UsersModule } from '../../core/users/users.module';
import { DriverAccountController } from './api/driver-account.controller';
import { DriverAccountService } from './application/driver-account.service';
import { DriverAccountRequestRepository } from './persistence/driver-account-request.repository';

/**
 * Driver accounts — the IDENTITY layer and nothing else.
 *
 * A CAPABILITY: another deployment deletes this folder, drops the request table
 * from `0018`, and its administrators create every account through
 * `core/users`. Account creation itself is reused rather than reimplemented —
 * see the service.
 *
 * ★ NO `OrganizationModule` IMPORT, AND THAT ABSENCE IS THE DESIGN. Employee
 * onboarding needs `organization` because an employee lands in a department. A
 * driver lands nowhere, so this capability has no reason to know departments
 * exist — and cannot accidentally enroll one.
 *
 * ★ AND NOTHING HERE TOUCHES TRIPS. Creating a driver account assigns no
 * vehicle and no trip; those are `trip-schedule`'s, and they operate on an
 * account that already exists.
 */
@Module({
  imports: [AuthorizationModule, UsersModule, IdentityModule],
  controllers: [DriverAccountController],
  providers: [DriverAccountService, DriverAccountRequestRepository],
  exports: [DriverAccountService],
})
export class DriverAccountModule {}
