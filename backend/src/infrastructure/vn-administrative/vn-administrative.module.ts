import { Module } from '@nestjs/common';
import { IdentityModule } from '../../core/identity/identity.module';
import { VnAdministrativeClient } from './vn-administrative.client';
import { VnAdministrativeController } from './vn-administrative.controller';
import { VnAdministrativeService } from './vn-administrative.service';

/**
 * Vietnam's tỉnh/thành and xã/phường, proxied and cached for the location form.
 *
 * Infrastructure rather than a capability: it owns no business rule and stores
 * nothing. It is an adapter over one outside service, and the only reason it
 * has a controller is that the browser must not call that service itself.
 *
 * `IdentityModule` is here for exactly one reason: the controller declares
 * `AuthGuard`, and a guard is instantiated inside the module that USES it, not
 * the module that defines it — so the guard's own dependency, `SessionService`,
 * has to be resolvable from here. Same import, same reason, as
 * `TripScheduleModule`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [VnAdministrativeController],
  providers: [VnAdministrativeClient, VnAdministrativeService],
})
export class VnAdministrativeModule {}
