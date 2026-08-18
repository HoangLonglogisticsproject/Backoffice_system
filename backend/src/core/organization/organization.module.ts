import { Module, forwardRef } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationController } from './api/organization.controller';
import { DepartmentService } from './application/department.service';
import { MembershipService } from './application/membership.service';
import { DepartmentRepository } from './persistence/department.repository';
import { MembershipRepository } from './persistence/membership.repository';

/**
 * Units and memberships — the source of truth for where a person sits.
 *
 * Two aggregates, two repositories, two application services. Units are renamed
 * and archived; memberships are opened and closed. Keeping them apart is what
 * stops one class from owning both and slowly becoming the file nobody wants to
 * touch.
 *
 * `forwardRef` for AuthorizationModule because the two genuinely need each
 * other: authorization reads memberships to answer invariant #6, and this
 * context's controller needs the permission guard. The cycle is in the MODULE
 * graph only — no file here imports an authorization file except the controller,
 * and nothing in authorization imports this controller.
 */
@Module({
  imports: [forwardRef(() => AuthorizationModule), IdentityModule],
  controllers: [OrganizationController],
  providers: [DepartmentService, MembershipService, DepartmentRepository, MembershipRepository],
  exports: [DepartmentService, MembershipService, DepartmentRepository, MembershipRepository],
})
export class OrganizationModule {}
