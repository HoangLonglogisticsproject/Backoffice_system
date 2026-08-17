import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OrgStore } from '../../store/organization/org.store';
import { SessionStore } from '../../store/session/session.store';
import { AccessService } from './access.service';

export const authGuard: CanActivateFn = () => {
  if (inject(SessionStore).context()) return true;
  // Authentication lives outside Backoffice; bounce to the gateway.
  location.assign('/auth/login');
  return false;
};

/** Level 1 — may this persona enter /departments/:slug at all? */
export const departmentGuard: CanActivateFn = (route) => {
  const department = inject(OrgStore).bySlug(route.paramMap.get('slug'));
  return inject(AccessService).canViewDepartment(department?.id) || noAccess();
};

/**
 * Every registered capability gets a route; this decides whether the
 * department in the URL actually has it AND whether this persona has a
 * presentation for it.
 */
export const capabilityGuard: CanActivateFn = (route) => {
  const department = inject(OrgStore).bySlug(route.parent?.paramMap.get('slug'));
  const key = String(route.data['capability'] ?? route.routeConfig?.path ?? '');
  return inject(AccessService).canUseCapability(department, key) || noAccess();
};

export const superadminGuard: CanActivateFn = () =>
  inject(AccessService).isSuperadmin() || noAccess();

const noAccess = () => inject(Router).createUrlTree(['/no-access']);
