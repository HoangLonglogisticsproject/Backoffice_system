import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationModule } from '../organization/organization.module';
import { UsersController } from './api/users.controller';
import { AccountLifecycleService } from './application/account-lifecycle.service';
import { AccountProvisioningService } from './application/account-provisioning.service';
import { UserService } from './application/user.service';
import { UserRepository } from './persistence/user.repository';

/**
 * The account record, and the two lifecycle transactions that span contexts.
 *
 * Provisioning and disabling are the only places where users, identities,
 * memberships, role assignments and sessions all change together — so this
 * module imports the contexts that own those rows rather than duplicating their
 * SQL. The dependency runs one way: `organization` and `authorization` never
 * learn that accounts exist.
 *
 * NO forwardRef here. `IdentityModule` used to import this one — authentication
 * read credentials through the user repository — which closed a three-node cycle
 * once this module needed authorization. Moving `identities` into
 * `core/identity/persistence`, where the ownership documentation always said it
 * belonged, dissolved the cycle rather than papering over it.
 */
@Module({
  imports: [IdentityModule, AuthorizationModule, OrganizationModule],
  controllers: [UsersController],
  providers: [UserService, UserRepository, AccountProvisioningService, AccountLifecycleService],
  exports: [UserService, UserRepository, AccountProvisioningService, AccountLifecycleService],
})
export class UsersModule {}
