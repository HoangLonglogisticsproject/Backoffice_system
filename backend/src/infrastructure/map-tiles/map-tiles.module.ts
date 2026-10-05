import { Module } from '@nestjs/common';
import { IdentityModule } from '../../core/identity/identity.module';
import { MapTilesClient } from './map-tiles.client';
import { MapTilesController } from './map-tiles.controller';
import { MapTilesService } from './map-tiles.service';

/**
 * The map's tiles, proxied and cached so the browser only ever talks to this
 * origin.
 *
 * Infrastructure rather than a capability, for the same reason `PlaceSearchModule`
 * is: it owns no business rule and stores nothing durable. It is an adapter over
 * one outside service, and the only reason it has a controller is that the
 * browser must not be the one making the request.
 *
 * `IdentityModule` is here for exactly one reason — the controller declares
 * `AuthGuard`, and a guard is instantiated inside the module that USES it, so
 * the guard's own dependency, `SessionService`, has to be resolvable from here.
 * Same import, same reason, as `PlaceSearchModule` and `VnAdministrativeModule`.
 */
@Module({
  imports: [IdentityModule],
  controllers: [MapTilesController],
  providers: [MapTilesClient, MapTilesService],
})
export class MapTilesModule {}
