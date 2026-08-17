import { Routes } from '@angular/router';
// Quyền đến từ core, khung ứng dụng đến từ shell — hai câu hỏi khác nhau.
import { authGuard, departmentGuard, superadminGuard } from '@bo/services';
import { Shell } from './layout/shell';
import { capabilityRoutes } from './routing/capability-routes';
import { NoAccessPage } from './routing/no-access.page';
import { PlaceholderPage } from './routing/placeholder.page';
import { WorkspaceHost } from './routing/workspace-host';
import { workspaceCapabilities } from '../features/organization';
import { worklistCapabilities } from '../features/worklist';
import { potentialCustomerCapabilities } from '../features/leads';

/** Same set the composition root registers — routes and registry stay in step. */
const CAPABILITIES = [
  ...workspaceCapabilities,
  ...worklistCapabilities,
  ...potentialCustomerCapabilities,
];

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      // One URL, three different pages — resolved by persona, not by branching.
      { path: '', component: WorkspaceHost, data: { title: 'Tổng quan' } },

      {
        path: 'my-work',
        loadComponent: () => import('../features/worklist').then((m) => m.MyWorkPage),
        data: { title: 'Việc của tôi' },
      },

      {
        path: 'departments',
        canActivate: [superadminGuard],
        loadComponent: () =>
          import('../features/organization').then((m) => m.DepartmentsPage),
        data: { title: 'Phòng ban' },
      },
      {
        path: 'departments/:slug',
        canActivate: [departmentGuard],
        loadComponent: () =>
          import('../features/organization').then((m) => m.DepartmentWorkspacePage),
        children: [
          { path: '', redirectTo: 'overview', pathMatch: 'full' },
          ...capabilityRoutes(CAPABILITIES),
        ],
      },

      // Slice 1 stops here; these routes exist so navigation never dead-ends.
      {
        path: 'requests',
        component: PlaceholderPage,
        data: { title: 'Yêu cầu', note: 'Trung tâm yêu cầu liên phòng ban sẽ có ở phiên bản tiếp theo.' },
      },
      {
        path: 'approvals',
        component: PlaceholderPage,
        data: { title: 'Phê duyệt', note: 'Hàng đợi phê duyệt đầy đủ sẽ có ở phiên bản tiếp theo.' },
      },
      {
        path: 'documents',
        component: PlaceholderPage,
        data: { title: 'Tài liệu', note: 'Kho tài liệu chung sẽ có ở phiên bản tiếp theo.' },
      },
      {
        path: 'reports',
        component: PlaceholderPage,
        data: { title: 'Báo cáo', note: 'Trung tâm báo cáo sẽ có ở phiên bản tiếp theo.' },
      },
      {
        path: 'ai',
        component: PlaceholderPage,
        data: { title: 'AI Điều phối', note: 'Trợ lý AI đầy đủ sẽ có ở phiên bản tiếp theo.' },
      },
      {
        path: 'activity',
        component: PlaceholderPage,
        data: { title: 'Hoạt động', note: 'Nhật ký hoạt động chi tiết sẽ có ở phiên bản tiếp theo.' },
      },
      {
        path: 'settings',
        canActivate: [superadminGuard],
        component: PlaceholderPage,
        data: {
          title: 'Cài đặt',
          note: 'Quản lý phòng ban, thành viên và cấp năng lực sẽ có ở phiên bản tiếp theo.',
        },
      },

      { path: 'no-access', component: NoAccessPage, data: { title: 'Không có quyền' } },
      { path: '**', redirectTo: '' },
    ],
  },
];
