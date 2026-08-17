import { CapabilityDescriptor, WorkspaceWidget } from '@bo/services';

/**
 * The proof that one capability serves several personas.
 *
 * `potential-customers` is a single module with one model and one repository.
 * A head opens the department pool with assignment controls; a member opens
 * their own book. Neither page checks a role — they are simply registered
 * against different personas, and a persona with no entry here (SUPERADMIN
 * operates at organization level) never sees the capability at all.
 */
export const potentialCustomerCapabilities: CapabilityDescriptor[] = [
  {
    key: 'potential-customers',
    title: 'Khách hàng tiềm năng',
    icon: 'users',
    accent: 'blue',
    presentations: {
      DEPARTMENT_HEAD: {
        title: 'Khách hàng tiềm năng',
        icon: 'users',
        load: () =>
          import('./feature/head/potential-customer-pool.page').then(
            (m) => m.PotentialCustomerPoolPage,
          ),
      },
      MEMBER: {
        title: 'Khách hàng của tôi',
        icon: 'user-check',
        load: () => import('./feature/member/my-customers.page').then((m) => m.MyCustomersPage),
      },
      SUPERADMIN: {
        title: 'Khách hàng tiềm năng',
        icon: 'users',
        load: () =>
          import('./feature/head/potential-customer-pool.page').then(
            (m) => m.PotentialCustomerPoolPage,
          ),
      },
    },
  },
];

export const potentialCustomerWidgets: WorkspaceWidget[] = [
  {
    id: 'customer-pool',
    capability: 'potential-customers',
    role: 'DEPARTMENT_HEAD',
    order: 10,
    span: 2,
    load: () => import('./feature/head/customer-pool.widget').then((m) => m.CustomerPoolWidget),
  },
  {
    id: 'team-workload',
    capability: 'potential-customers',
    role: 'DEPARTMENT_HEAD',
    order: 20,
    span: 1,
    load: () => import('./feature/head/team-workload.widget').then((m) => m.TeamWorkloadWidget),
  },
  {
    id: 'my-customers',
    capability: 'potential-customers',
    role: 'MEMBER',
    order: 10,
    span: 3,
    load: () => import('./feature/member/my-customers.widget').then((m) => m.MyCustomersWidget),
  },
  {
    id: 'organization-customers',
    capability: 'potential-customers',
    role: 'SUPERADMIN',
    order: 10,
    span: 3,
    load: () =>
      import('./feature/superadmin/organization-customers.widget').then(
        (m) => m.OrganizationCustomersWidget,
      ),
  },
];
