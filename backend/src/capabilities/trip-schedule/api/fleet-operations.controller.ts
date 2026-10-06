import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { isoDate } from '../../../common/pagination/date-range-page-query.dto';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import {
  authorizationOf,
  PermissionGuard,
  RequirePermission,
} from '../../../core/authorization/api/permission.guard';
import { can } from '../../../core/authorization/domain/authorization.context';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { FleetOperationsService } from '../application/fleet-operations.service';
import type { FleetBoard } from '../domain/fleet-operations';

const fleetQuerySchema = z.object({ date: isoDate });
type FleetQuery = z.infer<typeof fleetQuerySchema>;

/**
 * "Điều hành xe" — under ĐIỀU PHỐI, beside Lịch xe.
 *
 * ★ `dispatch.write` — THE GLOBAL TIER AND THE DISPATCH FUNCTION, NOBODY ELSE.
 * Not `trip.read`: that key is also Sales', Accounting's and Customer
 * Service's, and this board tells them what no route told them before — how
 * each lorry answered its start-of-shift fuel check, who declared it and when,
 * how many fills it took and which lack liters or an odometer reading. The rest
 * of the board (plates, crews, milestones) is already theirs on Lịch xe; the
 * fuel facts are dispatch's work, and the narrowest existing key that says
 * "dispatch" is the one already guarding `GET /trip-drivers` and the
 * assignment-request queue. No permission is added and none is widened.
 *
 * ★ THE MONEY IS `cost.read`, DECIDED HERE AND APPLIED IN THE STATEMENT. A
 * dispatcher gets `null` where an amount would be, because the query never
 * read one. Dispatch does not gain `cost.read`.
 */
@Controller('fleet-operations')
export class FleetOperationsController {
  constructor(private readonly fleet: FleetOperationsService) {}

  @Get()
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('dispatch.write')
  async board(
    @Query(new ZodValidationPipe(fleetQuerySchema)) query: FleetQuery,
    @Req() request: Request,
  ): Promise<FleetBoard> {
    const authorization = authorizationOf(request);
    return this.fleet.board({
      day: query.date,
      withMoney: authorization !== undefined && can(authorization, 'cost.read'),
    });
  }
}
