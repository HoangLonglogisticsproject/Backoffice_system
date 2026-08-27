import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { rosterQuerySchema, type RosterQuery } from './roster-query.dto';
import type { Page } from '../../../common/pagination/cursor';
import { AuthGuard } from '../../identity/api/auth.guard';
import { PermissionGuard, RequirePermission } from '../../authorization/api/permission.guard';
import { EmployeeRosterRow } from '../domain/department.entity';
import { MembershipService } from '../application/membership.service';

/**
 * The DEPLOYMENT-WIDE employee roster.
 *
 * ★ WHY A SEPARATE ROUTE RATHER THAN A QUERY PARAMETER ON THE SCOPED ONE.
 * `GET /departments/:id/members` is authorized `unit.member.read` WITH the
 * route's department as the target, so a head passes it for their own unit. The
 * global read has no target at all — and in this permission model an unscoped
 * check is precisely what only a global caller survives (`PERMISSION_REQUIREMENT`
 * maps `unit.member.read` to 'head', and `can()` returns false for a head when
 * no department is named). Making "all departments" a parameter of the scoped
 * route would have put both audiences behind one guard call that can only
 * answer one of them.
 *
 * ★ THE NAME FOLLOWS THE TWO GLOBAL QUEUES ALREADY HERE. `GET /membership-requests`
 * and `GET /account-invitations` are the department-scoped resource at the root,
 * meaning "across every unit". `GET /memberships` is the same sentence about
 * the same table, so nothing new has to be learned to read it.
 *
 * ★ IT IS A READ MODEL, NOT AN ENTITY. Every row is a join over
 * `department_memberships`, `users`, `departments` and `role_assignments` —
 * tables that already exist. No employee table was added, and none should be:
 * a copy of this data would be a second source of truth that disagrees with the
 * first the moment somebody transfers.
 *
 * ⚠ NOT AN APPROVAL QUEUE. Nothing here is decided, approved or rejected; it
 * answers "who works here", which is a different question from "what is waiting
 * for me". The two share a screen in the UI and must not share a meaning.
 */
@Controller('memberships')
export class EmployeeRosterController {
  constructor(private readonly memberships: MembershipService) {}

  /**
   * Everyone, everywhere, one page at a time.
   *
   * ★ NO DEPARTMENT IS ACCEPTED, deliberately. A `?departmentId=` here would be
   * a second way to ask the scoped question, authorized by the WRONG guard —
   * global — and a head who discovered it would read any unit they liked. The
   * scoped read already exists and is guarded correctly; this route's whole
   * identity is that it names no unit.
   */
  @Get()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('unit.member.read')
  async list(
    @Query(new ZodValidationPipe(rosterQuerySchema)) query: RosterQuery,
  ): Promise<Page<EmployeeRosterRow>> {
    return this.memberships.listRoster({ membershipStatus: query.membershipStatus }, query);
  }
}
