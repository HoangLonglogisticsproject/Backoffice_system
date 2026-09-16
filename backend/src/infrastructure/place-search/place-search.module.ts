import { Module } from '@nestjs/common';
import { IdentityModule } from '../../core/identity/identity.module';
import { GoongClient } from './goong.client';
import { NominatimClient } from './nominatim.client';
import { PlaceSearchController } from './place-search.controller';
import { PlaceSearchService } from './place-search.service';

/**
 * Finding a place by typing its address, proxied and cached for the location
 * form.
 *
 * Infrastructure rather than a capability: it owns no business rule and stores
 * nothing. It is an adapter over one outside service, and the only reason it
 * has a controller is that the browser must not hold that service's key.
 *
 * `IdentityModule` is here for exactly one reason: the controller declares
 * `AuthGuard`, and a guard is instantiated inside the module that USES it, not
 * the module that defines it — so the guard's own dependency, `SessionService`,
 * has to be resolvable from here. Same import, same reason, as
 * `VnAdministrativeModule`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PlaceSearchController],
  // Two geocoders: the keyed one, and the keyless one it falls back to when no
  // key is configured. Both are always constructed — they hold no connection
  // and no state worth deferring, and choosing at boot would mean a deployment
  // could not gain the better one by adding a key.
  providers: [GoongClient, NominatimClient, PlaceSearchService],
})
export class PlaceSearchModule {}
