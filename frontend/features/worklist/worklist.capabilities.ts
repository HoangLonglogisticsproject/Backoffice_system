import { CapabilityDescriptor, CapabilityPresentation, WorkspaceWidget } from '@bo/services';

const workList = () => import('./feature/work-list.page').then((m) => m.WorkListPage);

/** Same page, persona-specific label — the difference users actually notice. */
const present = (title: string, icon: string): CapabilityPresentation => ({ title, icon, load: workList });

/**
 * Generic internal-work capabilities. Any department can be configured with
 * any of them; a member simply never receives the supervisory presentations.
 */
export const worklistCapabilities: CapabilityDescriptor[] = [
  {
    key: 'tasks',
    title: 'Công việc',
    icon: 'check-square',
    accent: 'teal',
    presentations: {
      SUPERADMIN: present('Công việc', 'check-square'),
      DEPARTMENT_HEAD: present('Công việc phòng', 'check-square'),
      MEMBER: present('Công việc của tôi', 'check-square'),
    },
  },
  {
    key: 'content',
    title: 'Nội dung',
    icon: 'image',
    accent: 'rose',
    presentations: {
      SUPERADMIN: present('Nội dung', 'image'),
      DEPARTMENT_HEAD: present('Nội dung', 'image'),
      MEMBER: present('Nội dung', 'image'),
    },
  },
  {
    key: 'documents',
    title: 'Tài liệu',
    icon: 'folder',
    accent: 'slate',
    presentations: {
      SUPERADMIN: present('Tài liệu', 'folder'),
      DEPARTMENT_HEAD: present('Tài liệu', 'folder'),
      MEMBER: present('Tài liệu & Sale Kit', 'book-open'),
    },
  },
  {
    key: 'reports',
    title: 'Báo cáo',
    icon: 'bar-chart',
    accent: 'blue',
    presentations: {
      SUPERADMIN: present('Báo cáo', 'bar-chart'),
      DEPARTMENT_HEAD: present('Báo cáo phòng', 'bar-chart'),
      MEMBER: present('Báo cáo T3/T6', 'bar-chart'),
    },
  },
  {
    key: 'requests',
    title: 'Yêu cầu nội bộ',
    icon: 'inbox',
    accent: 'amber',
    presentations: {
      SUPERADMIN: present('Yêu cầu', 'inbox'),
      DEPARTMENT_HEAD: present('Yêu cầu', 'inbox'),
      MEMBER: present('Yêu cầu của tôi', 'inbox'),
    },
  },
];

export const worklistWidgets: WorkspaceWidget[] = [
  {
    id: 'today-priority',
    capability: 'tasks',
    role: 'MEMBER',
    order: 20,
    span: 3,
    load: () => import('./feature/widgets/today-priority.widget').then((m) => m.TodayPriorityWidget),
  },
  {
    id: 'overdue-head',
    capability: 'tasks',
    role: 'DEPARTMENT_HEAD',
    order: 60,
    span: 2,
    load: () => import('./feature/widgets/overdue-work.widget').then((m) => m.OverdueWorkWidget),
  },
];
