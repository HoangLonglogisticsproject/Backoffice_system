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
 * ★ `trip.read`, THE KEY THAT ALREADY SHOWS WHO DRIVES WHICH LORRY. Every
 * fact on this board except the money is already on Lịch xe for the same
 * readers; this is that same information turned to face the lorries.
 *
 * ★ THE MONEY IS `cost.read`, DECIDED HERE AND APPLIED IN THE STATEMENT. A
 * reader without it — Dispatch, Sales, Customer Service as the catalogue
 * stands — gets `null` where an amount would be, because the query never
 * read one. No permission is widened: Dispatch does not gain `cost.read`.
 */
@Controller('fleet-operations')
export class FleetOperationsController {
  constructor(private readonly fleet: FleetOperationsService) {}

  @Get()
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
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
