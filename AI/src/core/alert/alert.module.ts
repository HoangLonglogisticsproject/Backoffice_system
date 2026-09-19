import { Module } from '@nestjs/common';
import { ServiceAuthModule } from '../../infrastructure/service-auth/service-auth.module';
import { InternalAlertController } from './api/internal-alert.controller';
import { AlertService } from './application/alert.service';
import { AlertHistoryRepository } from './persistence/alert-history.repository';
import { AlertRepository } from './persistence/alert.repository';
import { ScanRunRepository } from './persistence/scan-run.repository';

/**
 * The Alert bounded context: domain, application, persistence and the
 * internal API. Wired to the service-auth adapter here, in the module, not in
 * `core/` files — the controller imports the guard's class for the decorator,
 * which is the one framework seam an API layer is allowed.
 */
@Module({
  imports: [ServiceAuthModule],
  controllers: [InternalAlertController],
  providers: [AlertService, AlertRepository, AlertHistoryRepository, ScanRunRepository],
  exports: [AlertService, ScanRunRepository],
})
export class AlertModule {}
