import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../core/authorization/authorization.module';
import { IdentityModule } from '../../core/identity/identity.module';
import { UsersModule } from '../../core/users/users.module';
import { NotificationModule } from '../notification/notification.module';
import { ActiveAssignmentGuard } from './api/active-assignment.guard';
import { AssignmentRequestController } from './api/assignment-request.controller';
import { BookingExportController } from './api/booking-export.controller';
import { DriverOpenBookingController } from './api/driver-open-booking.controller';
import { FleetOperationsController } from './api/fleet-operations.controller';
import { ExpenseAssignmentGuard } from './api/expense-assignment.guard';
import { ReadableAssignmentGuard } from './api/readable-assignment.guard';
import { DriverPortalController } from './api/driver-portal.controller';
import { TripCatalogueController } from './api/trip-catalogue.controller';
import { TripCompletionController } from './api/trip-completion.controller';
import { TripCostController } from './api/trip-cost.controller';
import { TripScheduleController } from './api/trip-schedule.controller';
import { VehicleCostController } from './api/vehicle-cost.controller';
import { AssignmentRequestReviewService } from './application/assignment-request-review.service';
import { AssignmentRequestSupersession } from './application/assignment-request-supersession';
import { BookingExportService } from './application/booking-export.service';
import { DispatchCrew } from './application/dispatch-crew';
import { DriverAssignmentRequestService } from './application/driver-assignment-request.service';
import { TripBoardService } from './application/trip-board.service';
import { TripCatalogueService } from './application/trip-catalogue.service';
import { DriverPortalService } from './application/driver-portal.service';
import { OperationalBoardService } from './application/operational-board.service';
import { TripCompletionService } from './application/trip-completion.service';
import { TripCostService } from './application/trip-cost.service';
import { TripExecutionService } from './application/trip-execution.service';
import { TripEntryCrew } from './application/trip-entry-crew';
import { LegacyConfirmedNormalization } from './application/legacy-confirmed-normalization';
import { TripScheduleService } from './application/trip-schedule.service';
import { FleetOperationsService } from './application/fleet-operations.service';
import { VehicleCostService } from './application/vehicle-cost.service';
import { VehicleFuelService } from './application/vehicle-fuel.service';
import {
  TripCustomerRepository,
  TripLocationRepository,
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
import { BookingExportRepository } from './persistence/booking-export.repository';
import { DriverTripReadModelRepository } from './persistence/driver-read-model.repository';
import { FleetOperationsRepository } from './persistence/fleet-operations.repository';
import { OpenBookingRepository } from './persistence/open-booking.repository';
import { TripAssignmentRequestRepository } from './persistence/trip-assignment-request.repository';
import { OperationalBoardRepository } from './persistence/operational-board.repository';
import { TripBoardCostRepository } from './persistence/trip-board-cost.repository';
import { TripScheduleRepository } from './persistence/trip-schedule.repository';
import { TripStatusHistoryRepository } from './persistence/trip-status-history.repository';
import { VehicleCostRepository } from './persistence/vehicle-cost.repository';
import { VehicleDailyFuelCheckRepository } from './persistence/vehicle-fuel-check.repository';

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
  // `UsersModule` for driver eligibility — is this account a live driver —
  // and `NotificationModule` because an assignment is something the driver
  // has to be told about, inside the transaction that made it.
  imports: [AuthorizationModule, IdentityModule, UsersModule, NotificationModule],
  controllers: [
    TripScheduleController,
    TripCatalogueController,
    TripCostController,
    DriverPortalController,
    TripCompletionController,
    VehicleCostController,
    DriverOpenBookingController,
    FleetOperationsController,
    AssignmentRequestController,
    BookingExportController,
  ],
  providers: [
    TripScheduleService,
    TripBoardService,
    TripCatalogueService,
    TripCostService,
    TripExecutionService,
    TripCompletionService,
    TripEntryCrew,
    LegacyConfirmedNormalization,
    DriverPortalService,
    OperationalBoardService,
    VehicleFuelService,
    VehicleCostService,
    FleetOperationsService,
    DispatchCrew,
    AssignmentRequestSupersession,
    DriverAssignmentRequestService,
    AssignmentRequestReviewService,
    BookingExportService,
    ActiveAssignmentGuard,
    ExpenseAssignmentGuard,
    ReadableAssignmentGuard,
    TripScheduleRepository,
    TripVehicleRepository,
    TripCustomerRepository,
    TripLocationRepository,
    TripCostRepository,
    OutsourceHireRepository,
    TripCostTotalsRepository,
    TripBoardCostRepository,
    TripStatusHistoryRepository,
    DriverAssignmentRepository,
    ExecutionEventRepository,
    CompletionRequestRepository,
    DriverTripReadModelRepository,
    OperationalBoardRepository,
    VehicleDailyFuelCheckRepository,
    VehicleCostRepository,
    TripAssignmentRequestRepository,
    OpenBookingRepository,
    FleetOperationsRepository,
    BookingExportRepository,
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
