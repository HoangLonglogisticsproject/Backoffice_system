import { Routes } from '@angular/router';
import { CapabilityDescriptor, capabilityGuard } from '@bo/services';
import { CapabilityOutlet } from './capability-outlet';

/**
 * Turns registered capabilities into child routes of a department workspace.
 * Called by the composition root, which is the only place allowed to know the
 * full set — the shell itself never imports a capability library.
 *
 * Whether a route resolves to anything is decided at runtime by the guard
 * (is it enabled here?) and by the outlet (does this persona have a view?).
 */
export function capabilityRoutes(descriptors: readonly CapabilityDescriptor[]): Routes {
  return descriptors.flatMap((capability) => [
    {
      path: capability.key,
      component: CapabilityOutlet,
      canActivate: [capabilityGuard],
      data: { capability: capability.key, title: capability.title },
    },
    ...(capability.navigation ?? []).map((nav) => ({
      path: nav.path,
      component: CapabilityOutlet,
      canActivate: [capabilityGuard],
      data: { capability: capability.key, nav: nav.path, title: nav.title },
    })),
  ]);
}
