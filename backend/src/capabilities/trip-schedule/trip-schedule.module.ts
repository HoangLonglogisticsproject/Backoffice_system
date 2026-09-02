import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../core/authorization/authorization.module';
import { IdentityModule } from '../../core/identity/identity.module';
import { ActiveAssignmentGuard } from './api/active-assignment.guard';
import { DriverPortalController } from './api/driver-portal.controller';
import { TripCatalogueController } from './api/trip-catalogue.controller';
import { TripCompletionController } from './api/trip-completion.controller';
import { TripCostController } from './api/trip-cost.controller';
import { TripScheduleController } from './api/trip-schedule.controller';
import { TripCatalogueService } from './application/trip-catalogue.service';
import { DriverPortalService } from './application/driver-portal.service';
import { OperationalBoardService } from './application/operational-board.service';
import { TripCompletionService } from './application/trip-completion.service';
import { TripCostService } from './application/trip-cost.service';
import { TripExecutionService } from './application/trip-execution.service';
import { TripScheduleService } from './application/trip-schedule.service';
import {
  TripCustomerRepository,
  TripVehicleRepository,
} from './persistence/trip-catalogue.repository';
import {
  OutsourceHireRepository,
  TripCostRepository,
  TripCostTotalsRepository,
} from './persistence/trip-cost.repository';
import {
  CompletionRequestRepository,
  DriverAssignmentRepository,
  ExecutionEventRepository,
} from './persistence/trip-execution.repository';
import { DriverTripReadModelRepository } from './persistence/driver-read-model.repository';
import { OperationalBoardRepository } from './persistence/operational-board.repository';
import { TripScheduleRepository } from './persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from './persistence/trip-status-history.repository';

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
  controllers: [
    TripScheduleController,
    TripCatalogueController,
    TripCostController,
    DriverPortalController,
    TripCompletionController,
  ],
  providers: [
    TripScheduleService,
    TripCatalogueService,
    TripCostService,
    TripExecutionService,
    TripCompletionService,
    DriverPortalService,
    OperationalBoardService,
    ActiveAssignmentGuard,
    TripScheduleRepository,
    TripVehicleRepository,
    TripCustomerRepository,
    TripCostRepository,
    OutsourceHireRepository,
    TripCostTotalsRepository,
    TripStatusHistoryRepository,
    DriverAssignmentRepository,
    ExecutionEventRepository,
    CompletionRequestRepository,
    DriverTripReadModelRepository,
    OperationalBoardRepository,
  ],
  exports: [
    TripScheduleService,
    TripCatalogueService,
    TripCostService,
    TripExecutionService,
    TripCompletionService,
  ],
})
export class TripScheduleModule {}
