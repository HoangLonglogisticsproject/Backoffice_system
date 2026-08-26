import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { pageQuerySchema, type PageQuery } from '../../../common/pagination/page-query.dto';
import type { Page } from '../../../common/pagination/cursor';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { AuthGuard } from '../../identity/api/auth.guard';
import { CsrfGuard } from '../../identity/api/csrf.guard';
import { PermissionGuard, RequirePermission } from '../../authorization/api/permission.guard';
import {
  Department,
  DepartmentMembership,
  EmployeeRosterRow,
} from '../domain/department.entity';
import { DepartmentService } from '../application/department.service';
import { MembershipService } from '../application/membership.service';

/**
 * HTTP for the organization.
 *
 * Every route declares BOTH guards and a permission, on the line above the
 * handler, where review looks. There is no global guard with exemptions — an
 * endpoint that forgets one is visibly different from its neighbours rather
 * than silently covered.
 *
 * THE TARGET DEPARTMENT ALWAYS COMES FROM THE ROUTE. No DTO below carries a
 * `departmentId`, a role, a scope or a caller identity: the body says what the
 * caller wants done, never what they are allowed to do. The actor is whatever
 * `AuthGuard` resolved from the session cookie and nothing else.
 */

const createDepartmentSchema = z.object({
  slug: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
});

const renameDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

/**
 * Direct transfer by a global administrator.
 *
 * Named for what it does — a TRANSFER, never an "add". There is no add: an
 * active person always belongs somewhere, so putting them in this unit means
 * taking them out of the one they are in.
 *
 * Only `userId`. The DESTINATION is the route's department, and the SOURCE is
 * wherever that person currently is — a fact read from the database, never a
 * value the caller supplies.
 */
/**
 * `?membershipStatus=` on a roster read.
 *
 * ★ ABSENT MEANS BOTH, and the DEFAULT IS CHOSEN BY THE CLIENT, not here. A
 * server-side default of `active` would make "Tất cả" impossible to ask for —
 * there would be no value meaning "do not filter". The screens send
 * `membershipStatus=active` for their default view; this schema only says which
 * values are legal.
 *
 * The two values are `department_memberships.status`, not invented: 0003
 * CHECKs the column against exactly this pair.
 */
const rosterQuerySchema = pageQuerySchema.extend({
  membershipStatus: z.enum(['active', 'ended']).optional(),
});

type RosterQuery = z.infer<typeof rosterQuerySchema>;

const transferIntoSchema = z.object({
  userId: z.string().uuid(),
});

type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;
type RenameDepartmentInput = z.infer<typeof renameDepartmentSchema>;
type TransferIntoInput = z.infer<typeof transferIntoSchema>;

@Controller('departments')
export class OrganizationController {
  constructor(
    private readonly departments: DepartmentService,
    private readonly memberships: MembershipService,
  ) {}

  /**
   * Units this caller may see.
   *
   * `unit.read` with no route scope: the permission is checked without a
   * target, so only a global caller passes the guard. A head or member reads
   * their own unit through `GET /departments/:departmentId`, where the target
   * exists and the scope check is meaningful.
   */
  @Get()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('unit.read')
  async list(): Promise<Department[]> {
    return this.departments.list();
  }

  @Get(':departmentId')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('unit.read', 'departmentId')
  async findOne(@Param('departmentId', UuidParam) departmentId: string): Promise<Department> {
    return this.departments.require(departmentId);
  }

  @Post()
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('unit.write')
  async create(
    @Body(new ZodValidationPipe(createDepartmentSchema)) body: CreateDepartmentInput,
  ): Promise<Department> {
    return this.departments.create(body);
  }

  @Patch(':departmentId')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('unit.write')
  async rename(
    @Param('departmentId', UuidParam) departmentId: string,
    @Body(new ZodValidationPipe(renameDepartmentSchema)) body: RenameDepartmentInput,
  ): Promise<Department> {
    return this.departments.rename(departmentId, body.name);
  }

  /** Archiving refuses while anyone is still in the unit — see the service. */
  @Post(':departmentId/archive')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('unit.write')
  @HttpCode(HttpStatus.OK)
  async archive(@Param('departmentId', UuidParam) departmentId: string): Promise<Department> {
    return this.departments.archive(departmentId);
  }

  /**
   * Who is in this unit.
   *
   * `unit.member.read` is scoped to `head`, so a head sees their own unit and a
   * plain member sees nobody — including in their own unit, which is the
   * decided default.
   */
  @Get(':departmentId/members')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('unit.member.read', 'departmentId')
  async members(
    @Param('departmentId', UuidParam) departmentId: string,
    @Query(new ZodValidationPipe(rosterQuerySchema)) query: RosterQuery,
  ): Promise<Page<EmployeeRosterRow>> {
    // ★ THE SCOPE IS THE ROUTE PARAMETER, and it is not negotiable: the guard
    // checked `unit.member.read` against THIS department, so the query is built
    // from the same id it authorized. A head cannot widen it by sending
    // anything, because there is nothing in the query string that names a unit.
    return this.memberships.listRoster(
      { departmentId, membershipStatus: query.membershipStatus },
      query,
    );
  }

  /**
   * Move an existing person into this unit — a TRANSFER, not an add.
   *
   * `unit.member.write` is global-only, so a head cannot reach this at all.
   * Their path is to raise a membership change request and have a SuperAdmin
   * approve it; core does not name the capability that implements that.
   */
  @Post(':departmentId/members')
  @UseGuards(AuthGuard, CsrfGuard, PermissionGuard)
  @RequirePermission('unit.member.write')
  async transferInto(
    @Param('departmentId', UuidParam) departmentId: string,
    @Body(new ZodValidationPipe(transferIntoSchema)) body: TransferIntoInput,
  ): Promise<DepartmentMembership> {
    return this.memberships.transfer({
      userId: body.userId,
      toDepartmentId: departmentId,
    });
  }
}
