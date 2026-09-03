import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app.config';
import { IdentityModule } from '../../core/identity/identity.module';
import { NotificationController } from './api/notification.controller';
import { NotificationStream } from './application/notification-stream';
import { NotificationService } from './application/notification.service';
import { NotificationRepository } from './persistence/notification.repository';

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
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationRepository,
    // The limits come from the validated environment, like every other
    // deployment knob; the class itself takes them as a plain value so a test
    // or an integration spec can construct one with its own.
    {
      provide: NotificationStream,
      useFactory: (config: AppConfig) =>
        new NotificationStream({
          perUser: config.sseMaxConnectionsPerUser,
          total: config.sseMaxConnections,
        }),
      inject: [AppConfig],
    },
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
