import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ProvisionedAccountGuard } from '../../../core/authorization/api/provisioned-account.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import { DriverOnlyGuard } from '../../../core/identity/api/driver-only.guard';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { DriverAssignmentRequestService } from '../application/driver-assignment-request.service';
import type {
  DriverAssignmentRequestView,
  DriverOpenBookingItem,
} from '../domain/trip-assignment-request';

/**
 * The driver's open bookings and their own asks (0035).
 *
 * ★ NO ASSIGNMENT GUARD, AND NONE IS NEEDED. These routes never touch a trip
 * the driver is on: they read the driver-safe projection of bookings nobody is
 * on, and the caller's OWN requests, filtered by the session id in the query.
 * Everything about a trip itself stays behind `ActiveAssignmentGuard` in
 * `DriverPortalController` — an ask grants none of it.
 *
 * Driver accounts only, provisioned (temporary credential changed), and CSRF
 * on every write — the portal's standing guards.
 */
@Controller('driver')
export class DriverOpenBookingController {
  constructor(private readonly requests: DriverAssignmentRequestService) {}

  @Get('open-bookings')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  listOpenBookings(@CurrentUser() actor: SessionUser): Promise<DriverOpenBookingItem[]> {
    return this.requests.listOpenBookings(actor.id);
  }

  @Get('assignment-requests')
  @UseGuards(AuthGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  listMine(@CurrentUser() actor: SessionUser): Promise<DriverAssignmentRequestView[]> {
    return this.requests.listMine(actor.id);
  }

  /** Asks for an open booking. 201 with the request — the SAME one on a retry. */
  @Post('open-bookings/:tripId/requests')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  request(
    @Param('tripId', UuidParam) tripId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAssignmentRequestView> {
    return this.requests.request(tripId, actor.id);
  }

  @Post('assignment-requests/:requestId/withdraw')
  @UseGuards(AuthGuard, CsrfGuard, DriverOnlyGuard, ProvisionedAccountGuard)
  @HttpCode(HttpStatus.OK)
  withdraw(
    @Param('requestId', UuidParam) requestId: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<DriverAssignmentRequestView> {
    return this.requests.withdraw(requestId, actor.id);
  }
}
