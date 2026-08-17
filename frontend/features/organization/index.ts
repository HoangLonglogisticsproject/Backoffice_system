/*
 * ./features/organization — persona dashboards and the department
 * workspace frame. Tenant-neutral: it renders whatever departments and
 * capabilities exist at runtime.
 */

export * from './domain/overview';
export * from './data-access/overview.repository';
export * from './data-access/fixture-overview.repository';

export * from './ui/metric-row';
export * from './ui/department-card';
export * from './ui/approval-list';
export * from './ui/activity-feed';
export * from './ui/suggestion-list';

export * from './feature/department/department-workspace.page';
export * from './feature/department/departments.page';

export * from './workspace.capabilities';
