import { Module, forwardRef } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationModule } from '../organization/organization.module';
import { AuthorizationController } from './api/authorization.controller';
import { DepartmentHeadController } from './api/department-head.controller';
import { AuthorizationRepository } from './persistence/authorization.repository';
import { AuthorizationService } from './application/authorization.service';
import {
  HeadOfRouteDepartmentGuard,
  HeadOfTargetUserDepartmentGuard,
  PermissionGuard,
} from './api/permission.guard';

/**
 * Who may do what.
 *
 * Depends on `OrganizationModule` because invariant #6 is a statement about
 * BOTH tables — a head must hold a membership of the department they lead — and
 * on `IdentityModule` because handing over global authority must cut the
 * previous holder's sessions in the same transaction.
 *
 * `PermissionGuard` is exported rather than registered globally, and that
 * follows the same reasoning `AuthGuard` documents: opt-in per route means an
 * endpoint that forgets it is visible on the line above the handler, where
 * review looks, instead of being silently covered by a blanket rule with
 * escape hatches.
 */
@Module({
  imports: [forwardRef(() => OrganizationModule), IdentityModule],
  controllers: [AuthorizationController, DepartmentHeadController],
  providers: [
    AuthorizationRepository,
    AuthorizationService,
    PermissionGuard,
    HeadOfRouteDepartmentGuard,
    HeadOfTargetUserDepartmentGuard,
  ],
  exports: [
    AuthorizationService,
    AuthorizationRepository,
    PermissionGuard,
    HeadOfRouteDepartmentGuard,
    HeadOfTargetUserDepartmentGuard,
  ],
})
export class AuthorizationModule {}
