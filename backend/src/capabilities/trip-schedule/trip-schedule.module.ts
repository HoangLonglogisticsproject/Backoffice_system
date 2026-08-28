import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../core/authorization/authorization.module';
import { IdentityModule } from '../../core/identity/identity.module';
import { TripCatalogueController } from './api/trip-catalogue.controller';
import { TripScheduleController } from './api/trip-schedule.controller';
import { TripCatalogueService } from './application/trip-catalogue.service';
import { TripScheduleService } from './application/trip-schedule.service';
import {
  TripCustomerRepository,
  TripVehicleRepository,
} from './persistence/trip-catalogue.repository';
import { TripScheduleRepository } from './persistence/trip-schedule.repository';

/**
 * Hoàng Long's dispatch board.
 *
 * A CAPABILITY: another deployment deletes this folder, drops `0011`, and never
 * knows lorries existed.
 *
 * Note how little it imports. `AuthorizationModule` and `IdentityModule` are
 * there for the guards the controllers declare, and nothing else — this
 * capability touches no department, no membership and no account, which is the
 * same thing the routes say by not carrying a `:departmentId`.
 */
@Module({
  imports: [AuthorizationModule, IdentityModule],
  controllers: [TripScheduleController, TripCatalogueController],
  providers: [
    TripScheduleService,
    TripCatalogueService,
    TripScheduleRepository,
    TripVehicleRepository,
    TripCustomerRepository,
  ],
  exports: [TripScheduleService, TripCatalogueService],
})
export class TripScheduleModule {}
