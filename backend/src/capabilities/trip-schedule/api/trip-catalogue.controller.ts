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
import { UuidParam } from '../../../common/http/uuid-param.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { PermissionGuard, RequirePermission } from '../../../core/authorization/api/permission.guard';
import { AuthGuard } from '../../../core/identity/api/auth.guard';
import { BackofficeOnlyGuard } from '../../../core/identity/api/backoffice-only.guard';
import { CsrfGuard } from '../../../core/identity/api/csrf.guard';
import { CurrentUser } from '../../../core/identity/api/current-user.decorator';
import type { SessionUser } from '../../../core/identity/application/session.service';
import { TripCatalogueService } from '../application/trip-catalogue.service';
import type { TripCustomer, TripLocation, TripVehicle } from '../domain/trip-schedule';

/**
 * The trucks and the customers, as rows rather than as text typed into a cell.
 *
 * ★ WHY ANY DISPATCHER MAY ADD A ROW HERE. Restricting creation to
 * administrators looks safer and is not: a dispatcher entering a trip for a
 * customer that is not yet in the list would have to stop, find an
 * administrator, and wait. What they would actually do is put the customer's
 * name in the cargo note — and the catalogue would be bypassed on exactly the
 * rows it exists to discipline. Adding is cheap and reversible; renaming
 * changes what every past trip appears to say, so THAT is `trip.write`.
 *
 * ⚠ NEITHER LIST IS PAGINATED, deliberately. Both are bounded small — a fleet
 * and a customer book — and both sort by a MUTABLE column, which ADR-0002 §4
 * gives as the reason `GET /departments` has no cursor either: a cursor over a
 * column that can be edited can skip or repeat rows through no fault of the
 * reader.
 */

const plate = z.string().trim().min(1).max(50);
const customerName = z.string().trim().min(1).max(200);
const note = z.string().trim().max(2000).nullable();

const createVehicleSchema = z.object({ plate, note: note.optional() });
const updateVehicleSchema = z.object({ plate: plate.optional(), note: note.optional() });

const createCustomerSchema = z.object({ name: customerName, note: note.optional() });
const updateCustomerSchema = z.object({ name: customerName.optional(), note: note.optional() });

/**
 * A customer's place. Coordinates are optional and, when given, a JSON number
 * each — a measurement, not money — bounded to the axis; `z.number()` refuses
 * `NaN`, and the service refuses one half without the other.
 */
const locationName = z.string().trim().min(1).max(200);
const address = z.string().trim().min(1).max(4000);
const contact = z.string().trim().max(2000).nullable();
const latitude = z.number().min(-90).max(90).nullable();
const longitude = z.number().min(-180).max(180).nullable();

const createLocationSchema = z.object({
  name: locationName,
  address,
  contact: contact.optional(),
  note: note.optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
});
const updateLocationSchema = createLocationSchema.partial();

/**
 * `?includeArchived=true`.
 *
 * Absent means active only, which is what every screen that offers a choice
 * wants. The single caller for `true` is the maintenance screen where a
 * retired truck is looked at again.
 */
const catalogueQuerySchema = z.object({
  /**
   * An enum rather than a boolean, and NOT transformed into one here.
   *
   * `z.coerce.boolean()` would be the obvious spelling and it is a trap:
   * `Boolean("false")` is `true`, so `?includeArchived=false` would turn
   * archived rows ON. The two literals make the only two accepted spellings
   * explicit and anything else a 422.
   *
   * The conversion to a boolean happens in the handler because a schema whose
   * input and output types genuinely differ does not fit `ZodValidationPipe`'s
   * single type parameter — and widening the pipe for one query flag would be
   * paying for this everywhere.
   */
  includeArchived: z.enum(['true', 'false']).optional(),
});

/** `?includeArchived=true` and nothing else means "show the retired rows too". */
const wantsArchived = (query: CatalogueQuery): boolean => query.includeArchived === 'true';

type CreateVehicleBody = z.infer<typeof createVehicleSchema>;
type UpdateVehicleBody = z.infer<typeof updateVehicleSchema>;
type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
type CreateLocationBody = z.infer<typeof createLocationSchema>;
type UpdateLocationBody = z.infer<typeof updateLocationSchema>;
type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;
type CatalogueQuery = z.infer<typeof catalogueQuerySchema>;

@Controller()
export class TripCatalogueController {
  constructor(private readonly catalogue: TripCatalogueService) {}

  // ------------------------------------------------------------- vehicles ----

  @Get('trip-vehicles')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async listVehicles(
    @Query(new ZodValidationPipe(catalogueQuerySchema)) query: CatalogueQuery,
  ): Promise<TripVehicle[]> {
    return this.catalogue.listVehicles(wantsArchived(query));
  }

  @Post('trip-vehicles')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.create')
  async createVehicle(
    @Body(new ZodValidationPipe(createVehicleSchema)) body: CreateVehicleBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripVehicle> {
    return this.catalogue.createVehicle({ ...body, createdBy: actor.id });
  }

  @Patch('trip-vehicles/:vehicleId')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async updateVehicle(
    @Param('vehicleId', UuidParam) vehicleId: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) body: UpdateVehicleBody,
  ): Promise<TripVehicle> {
    return this.catalogue.updateVehicle(vehicleId, body);
  }

  @Post('trip-vehicles/:vehicleId/archive')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async archiveVehicle(
    @Param('vehicleId', UuidParam) vehicleId: string,
  ): Promise<TripVehicle> {
    return this.catalogue.archiveVehicle(vehicleId);
  }

  // ------------------------------------------------------------ customers ----

  @Get('trip-customers')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async listCustomers(
    @Query(new ZodValidationPipe(catalogueQuerySchema)) query: CatalogueQuery,
  ): Promise<TripCustomer[]> {
    return this.catalogue.listCustomers(wantsArchived(query));
  }

  @Post('trip-customers')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.create')
  async createCustomer(
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomerBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripCustomer> {
    return this.catalogue.createCustomer({ ...body, createdBy: actor.id });
  }

  @Patch('trip-customers/:customerId')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async updateCustomer(
    @Param('customerId', UuidParam) customerId: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerBody,
  ): Promise<TripCustomer> {
    return this.catalogue.updateCustomer(customerId, body);
  }

  // ------------------------------------------------------------ locations ----
  //
  // ★ ALWAYS UNDER A CUSTOMER, NEVER A POOL. Every route names the customer in
  // its path and the service holds the location to it; there is no
  // `GET /trip-locations`. Same permissions as the customer catalogue: reading
  // is `trip.read`, adding is `trip.create`, changing is `trip.write` — and
  // `BackofficeOnlyGuard` keeps every one of them from a driver account.

  @Get('trip-customers/:customerId/locations')
  @UseGuards(AuthGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.read')
  async listLocations(
    @Param('customerId', UuidParam) customerId: string,
    @Query(new ZodValidationPipe(catalogueQuerySchema)) query: CatalogueQuery,
  ): Promise<TripLocation[]> {
    return this.catalogue.listLocations(customerId, wantsArchived(query));
  }

  @Post('trip-customers/:customerId/locations')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.create')
  async createLocation(
    @Param('customerId', UuidParam) customerId: string,
    @Body(new ZodValidationPipe(createLocationSchema)) body: CreateLocationBody,
    @CurrentUser() actor: SessionUser,
  ): Promise<TripLocation> {
    return this.catalogue.createLocation(customerId, { ...body, createdBy: actor.id });
  }

  @Patch('trip-customers/:customerId/locations/:locationId')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  async updateLocation(
    @Param('customerId', UuidParam) customerId: string,
    @Param('locationId', UuidParam) locationId: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: UpdateLocationBody,
  ): Promise<TripLocation> {
    return this.catalogue.updateLocation(customerId, locationId, body);
  }

  @Post('trip-customers/:customerId/locations/:locationId/archive')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async archiveLocation(
    @Param('customerId', UuidParam) customerId: string,
    @Param('locationId', UuidParam) locationId: string,
  ): Promise<TripLocation> {
    return this.catalogue.archiveLocation(customerId, locationId);
  }

  @Post('trip-customers/:customerId/archive')
  @UseGuards(AuthGuard, CsrfGuard, BackofficeOnlyGuard, PermissionGuard)
  @RequirePermission('trip.write')
  @HttpCode(HttpStatus.OK)
  async archiveCustomer(
    @Param('customerId', UuidParam) customerId: string,
  ): Promise<TripCustomer> {
    return this.catalogue.archiveCustomer(customerId);
  }
}
