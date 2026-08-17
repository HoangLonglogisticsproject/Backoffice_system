import { TestBed } from '@angular/core/testing';
import { Department, UserContext } from '@bo/types';
import { DepartmentRepository, OrgStore, SessionRepository, SessionStore } from '@bo/store';
import { provideCapabilities } from '@bo/services';
import { of } from 'rxjs';
import { NavigationService } from './navigation.service';

const dept = (id: string): Department => ({
  id,
  slug: id,
  name: id,
  description: '',
  icon: 'building',
  accent: 'slate',
  active: true,
  headId: null,
  memberCount: 1,
  capabilities: ['customers'],
});

const HEAD_SALES: UserContext = {
  userId: 'head-sales',
  name: 'Head Sales',
  title: '',
  role: 'DEPARTMENT_HEAD',
  departmentId: 'sales',
};

async function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideCapabilities([
        {
          key: 'customers',
          title: 'Records',
          icon: 'users',
          accent: 'blue',
          presentations: { DEPARTMENT_HEAD: { title: 'Records', load: async () => class {} } },
        },
      ]),
      {
        provide: DepartmentRepository,
        useValue: { list: () => of([dept('sales'), dept('marketing')]), members: () => of([]) },
      },
      {
        provide: SessionRepository,
        useValue: {
          current: () => of(HEAD_SALES),
          personas: () => of([]),
          switchPersona: () => of(HEAD_SALES),
        },
      },
    ],
  });
  await TestBed.inject(SessionStore).load();
  await TestBed.inject(OrgStore).load();
  return TestBed.inject(NavigationService);
}

/**
 * The sidebar, the rail and the drawer are three presentations of one
 * navigation. Which groups are open belongs to the navigation, not to whichever
 * presentation happens to be mounted — so it lives here and outlives them all.
 */
describe('navigation expansion state', () => {
  it('falls back to the default until the user decides otherwise', async () => {
    const nav = await setup();
    expect(nav.isExpanded('sales', true)).toBe(true);
    expect(nav.isExpanded('marketing', false)).toBe(false);
  });

  it('remembers an explicit toggle instead of the default', async () => {
    const nav = await setup();

    nav.toggle('sales', true);
    expect(nav.isExpanded('sales', true)).toBe(false);

    // The default is now irrelevant: the user has spoken for this group.
    expect(nav.isExpanded('sales', false)).toBe(false);
    // ...and only for this group.
    expect(nav.isExpanded('marketing', true)).toBe(true);
  });

  it('opens a group the user closed, without disturbing the others', async () => {
    const nav = await setup();

    nav.toggle('marketing', false);
    nav.toggle('marketing', false);

    expect(nav.isExpanded('marketing', false)).toBe(false);
    expect(nav.isExpanded('sales', true)).toBe(true);
  });
});
