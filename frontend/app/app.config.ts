import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { DepartmentRepository, SessionRepository } from '@bo/store';
import { provideCapabilities, provideWorkspaceWidgets, provideWorkspaces } from '@bo/services';
import { provideBranding, provideOrganizationBootstrap } from './bootstrap';
import { provideFormatting } from '@bo/components';
import { provideShellNavigation } from './navigation/navigation.model';
import {
  FixtureOverviewRepository,
  OverviewRepository,
  workspaceCapabilities,
  workspaceDescriptors,
} from '../features/organization';
import {
  FixtureWorkItemRepository,
  WorkItemRepository,
  worklistCapabilities,
  worklistWidgets,
} from '../features/worklist';
import {
  FixturePotentialCustomerRepository,
  PotentialCustomerRepository,
  potentialCustomerCapabilities,
  potentialCustomerWidgets,
} from '../features/leads';
import { routes } from './app.routes';
import { THG_BRANDING } from './tenant/branding';
import { THG_NAVIGATION } from './tenant/navigation';
import { FixtureDepartmentRepository, FixtureSessionRepository } from './tenant/fixtures/fixture.repositories';

/**
 * THE COMPOSITION ROOT — the only file that knows the whole system.
 *
 * Three jobs, nothing else:
 *   1. bind every repository contract to an implementation,
 *   2. register the capabilities and persona workspaces this tenant runs,
 *   3. supply the tenant's branding and fixed navigation.
 *
 * Moving to real APIs is a change to the `useClass` values below — no feature
 * code is touched. Selling the platform to another company is a change to the
 * tenant/ folder and this capability list.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),

    // --- tenant identity -------------------------------------------------
    provideBranding(THG_BRANDING),
    provideShellNavigation(THG_NAVIGATION),
    // Locale and currency are this customer's, not the foundation's. Without
    // this line the platform formats in en-US/USD and still works.
    provideFormatting({ locale: 'vi-VN', currency: 'VND', justNow: 'vừa xong' }),

    // --- what this tenant runs -------------------------------------------
    provideCapabilities(workspaceCapabilities, worklistCapabilities, potentialCustomerCapabilities),
    provideWorkspaces(workspaceDescriptors),
    provideWorkspaceWidgets(worklistWidgets, potentialCustomerWidgets),

    // --- data sources ----------------------------------------------------
    // Client-side phase: fixtures. Replace with Http* implementations later;
    // this is the only edit that requires.
    { provide: DepartmentRepository, useClass: FixtureDepartmentRepository },
    { provide: SessionRepository, useClass: FixtureSessionRepository },
    { provide: OverviewRepository, useClass: FixtureOverviewRepository },
    { provide: WorkItemRepository, useClass: FixtureWorkItemRepository },
    { provide: PotentialCustomerRepository, useClass: FixturePotentialCustomerRepository },

    // Session and departments must resolve before the first guard runs.
    provideOrganizationBootstrap(),
  ],
};
