import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app.config';
import { IdentityModule } from '../../core/identity/identity.module';
import { NotificationController } from './api/notification.controller';
import { NotificationGateway } from './api/notification.gateway';
import { PushDeviceController } from './api/push-device.controller';
import { NotificationStream } from './application/notification-stream';
import { NotificationService } from './application/notification.service';
import { PushDeviceService } from './application/push-device.service';
import { PushSchedulerService } from './application/push-scheduler.service';
import { PushSenderService } from './application/push-sender.service';
import { PushWorkerService } from './application/push-worker.service';
import { NotificationRepository } from './persistence/notification.repository';
import { PushDeviceRepository } from './persistence/push-device.repository';
import { PushJobRepository } from './persistence/push-job.repository';

/**
 * What a person is told, kept and pushed.
 *
 * A CAPABILITY: another deployment deletes this folder, drops `0020`, and its
 * drivers learn about their trips by being rung. Imports `IdentityModule` for
 * `AuthGuard` and nothing else — it knows recipients, not departments, roles
 * or trips; the trip module hands it a trip id and a day, and that is all it
 * stores.
 *
 * `NotificationService` is the export, and it is what the trip services call
 * from inside their own transactions. Nothing here opens one.
 */
@Module({
  imports: [IdentityModule],
  controllers: [NotificationController, PushDeviceController],
  providers: [
    NotificationService,
    NotificationRepository,
    // Web Push (0038). Cùng capability, vì nó trả lời đúng câu hỏi mà phần
    // còn lại của thư mục này trả lời — "một người được báo cái gì" — chỉ qua
    // một đường khác, đường duy nhất chạm được tới một tài xế đã đóng trình duyệt.
    PushDeviceRepository,
    PushJobRepository,
    PushDeviceService,
    PushSchedulerService,
    PushSenderService,
    PushWorkerService,
    // The socket. Authenticates its own handshake against `SessionService`,
    // which is why `IdentityModule` is imported for more than `AuthGuard` now.
    NotificationGateway,
    // The limits come from the validated environment, like every other
    // deployment knob; the class itself takes them as a plain value so a test
    // or an integration spec can construct one with its own.
    {
      provide: NotificationStream,
      useFactory: (config: AppConfig) =>
        new NotificationStream({
          perUser: config.realtimeMaxConnectionsPerUser,
          total: config.realtimeMaxConnections,
        }),
      inject: [AppConfig],
    },
  ],
  // `PushSchedulerService` đi cùng `NotificationService` vì cùng một lý do: nó
  // là thứ các service của chuyến đi gọi từ TRONG transaction của chúng.
  exports: [NotificationService, PushSchedulerService],
})
export class NotificationModule {}
