import { provideAppInitializer, inject } from '@angular/core';
import { BRANDING, Branding } from '../services/branding';
import { OrgStore } from '../store/organization/org.store';
import { SessionStore } from '../store/session/session.store';

/**
 * Session and organization must be resolved before the first route renders —
 * every guard and the whole navigation depend on them.
 */
export function provideOrganizationBootstrap() {
  return provideAppInitializer(async () => {
    const session = inject(SessionStore);
    const org = inject(OrgStore);
    await Promise.all([session.load(), org.load()]);
  });
}

/** Applies the tenant's theme overrides to :root. */
export function provideBranding(branding: Branding) {
  return [
    { provide: BRANDING, useValue: branding },
    provideAppInitializer(() => {
      const { theme } = inject(BRANDING);
      if (!theme) return;
      for (const [token, value] of Object.entries(theme)) {
        document.documentElement.style.setProperty(token, value);
      }
    }),
  ];
}
