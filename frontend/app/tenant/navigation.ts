import { ShellNavigation } from '../navigation/navigation.model';

/**
 * THG's fixed sidebar entries. The shell holds no defaults, so this list is
 * the whole answer — and each persona's sidebar differs by the `roles` filter
 * plus the department entries the shell derives from runtime data.
 *
 * ponytail: badge counts are static configuration for now; wire them to a
 * counter once the numbers come from real data.
 */
export const THG_NAVIGATION: ShellNavigation = {
  groupsLabel: 'Phòng ban',
  secondaryLabel: 'Hệ thống',

  primary: [
    { label: 'Tổng quan', icon: 'layout-dashboard', link: '/' },
    { label: 'Việc của tôi', icon: 'briefcase', link: '/my-work', badge: 12 },
    // Only a superadmin browses the organization; a head or member has exactly
    // one department, already shown below.
    { label: 'Phòng ban', icon: 'building', link: '/departments', roles: ['SUPERADMIN'] },
  ],
  secondary: [
    { label: 'Yêu cầu', icon: 'inbox', link: '/requests', roles: ['SUPERADMIN'] },
    { label: 'Phê duyệt', icon: 'check-square', link: '/approvals', roles: ['SUPERADMIN'], badge: 7 },
    { label: 'Tài liệu', icon: 'file-text', link: '/documents' },
    { label: 'Báo cáo', icon: 'bar-chart', link: '/reports', roles: ['SUPERADMIN', 'DEPARTMENT_HEAD'] },
    { label: 'AI Điều phối', icon: 'sparkles', link: '/ai' },
    { label: 'Cài đặt', icon: 'settings', link: '/settings', roles: ['SUPERADMIN'] },
  ],
};
