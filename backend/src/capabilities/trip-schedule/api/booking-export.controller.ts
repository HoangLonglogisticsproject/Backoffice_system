import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { BookingExportService } from '../application/booking-export.service';
import type { BookingExport } from '../domain/booking-export';

/**
 * The booking document — "Phiếu booking" (contract §30).
 *
 * ★ THE TRIP DETAIL'S OWN GUARDS, AND NO NEW PERMISSION. Whoever may read the
 * trip on the board (`trip.read`, Backoffice accounts only, temporary
 * credential refused by `PermissionGuard`) may export it; a driver may not.
 *
 * ★ AND NOTHING READ FROM THE CALLER'S PERMISSIONS. Unlike the detail route,
 * nothing here is redacted per role — the projection carries no figure to
 * redact. One trip, one document, whoever asks.
 */
@Controller()
export class BookingExportController {
  constructor(private readonly bookings: BookingExportService) {}

  @Get('trip-schedules/:tripId/booking-export')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  find(@Param('tripId', UuidParam) tripId: string): Promise<BookingExport> {
    return this.bookings.find(tripId);
  }
}
