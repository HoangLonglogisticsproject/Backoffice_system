import { CapabilityDescriptor, WorkspaceDescriptor } from '@bo/services';

/**
 * What this library contributes to the composition root. The app imports this
 * manifest; nothing imports the pages directly, so every surface below stays
 * lazily loaded.
 */

export const workspaceCapabilities: CapabilityDescriptor[] = [
  {
    key: 'overview',
    title: 'Tổng quan',
    icon: 'layout-dashboard',
    accent: 'blue',
    // Every persona gets the same department overview — it is already scoped
    // by the department it is rendered in.
    presentations: {
      SUPERADMIN: { title: 'Tổng quan', load: departmentOverview },
      DEPARTMENT_HEAD: { title: 'Tổng quan', load: departmentOverview },
      MEMBER: { title: 'Tổng quan', load: departmentOverview },
    },
  },
];

/** One dashboard per persona — three components, not one with branches. */
export const workspaceDescriptors: WorkspaceDescriptor[] = [
  {
    role: 'SUPERADMIN',
    loadDashboard: () =>
      import('./feature/superadmin/organization-dashboard.page').then(
        (m) => m.OrganizationDashboardPage,
      ),
  },
  {
    role: 'DEPARTMENT_HEAD',
    loadDashboard: () =>
      import('./feature/head/department-control-center.page').then(
        (m) => m.DepartmentControlCenterPage,
      ),
  },
  {
    role: 'MEMBER',
    loadDashboard: () =>
      import('./feature/member/personal-work-desk.page').then((m) => m.PersonalWorkDeskPage),
  },
];

function departmentOverview() {
  return import('./feature/department/department-overview.page').then(
    (m) => m.DepartmentOverviewPage,
  );
}
