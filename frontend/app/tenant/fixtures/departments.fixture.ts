import { Department, Member } from '@bo/types';

/**
 * THG's organization structure, as data.
 *
 * ACCEPTANCE TEST E lives here: append a department below with any capability
 * set and it appears in navigation, routing, dashboards and the department
 * directory — no other file changes. `Legal` is the standing proof.
 */
export const DEPARTMENTS: Department[] = [
  {
    id: 'd-sales',
    slug: 'sales',
    name: 'Sales',
    description: 'Quản lý khách hàng, cơ hội bán hàng và doanh thu',
    icon: 'trending-up',
    accent: 'blue',
    active: true,
    headId: 'u-head-sales',
    memberCount: 14,
    capabilities: ['overview', 'potential-customers', 'tasks', 'content', 'reports', 'documents', 'requests'],
  },
  {
    id: 'd-operations',
    slug: 'operations',
    name: 'Operations',
    description: 'Vận hành đơn hàng, kho bãi và chuỗi cung ứng',
    icon: 'package',
    accent: 'teal',
    active: true,
    headId: 'u-head-operations',
    memberCount: 22,
    capabilities: ['overview', 'tasks', 'documents', 'reports', 'requests'],
  },
  {
    id: 'd-marketing',
    slug: 'marketing',
    name: 'Marketing',
    description: 'Chiến dịch, nội dung, lead và thương hiệu',
    icon: 'megaphone',
    accent: 'rose',
    active: true,
    headId: 'u-head-marketing',
    memberCount: 9,
    capabilities: ['overview', 'content', 'tasks', 'reports', 'documents'],
  },
  {
    id: 'd-finance',
    slug: 'finance',
    name: 'Finance',
    description: 'Kế toán, công nợ, ngân sách và báo cáo tài chính',
    icon: 'dollar-sign',
    accent: 'amber',
    active: true,
    headId: null,
    memberCount: 7,
    capabilities: ['overview', 'tasks', 'reports'],
  },
  {
    id: 'd-it',
    slug: 'it',
    name: 'IT',
    description: 'Hệ thống, bảo mật, tích hợp và hỗ trợ người dùng',
    icon: 'code',
    accent: 'violet',
    active: true,
    headId: null,
    memberCount: 6,
    capabilities: ['overview', 'tasks', 'documents', 'reports'],
  },
  {
    id: 'd-legal',
    slug: 'legal',
    name: 'Legal',
    description: 'Hợp đồng, tuân thủ và rủi ro pháp lý',
    icon: 'shield',
    accent: 'slate',
    active: true,
    headId: null,
    memberCount: 3,
    // A deliberately different capability set — no reports, no content.
    capabilities: ['overview', 'documents', 'tasks'],
  },
];

export const MEMBERS: Member[] = [
  { userId: 'u-head-sales', departmentId: 'd-sales', name: 'Huyền Trang', title: 'Trưởng phòng Sales', role: 'DEPARTMENT_HEAD' },
  { userId: 'u-head-operations', departmentId: 'd-operations', name: 'Min', title: 'Trưởng phòng Vận hành', role: 'DEPARTMENT_HEAD' },
  { userId: 'u-sales-a', departmentId: 'd-sales', name: 'Sales A', title: 'Nhân viên kinh doanh', role: 'MEMBER' },
  { userId: 'u-sales-b', departmentId: 'd-sales', name: 'Sales B', title: 'Nhân viên kinh doanh', role: 'MEMBER' },
  { userId: 'u-sales-c', departmentId: 'd-sales', name: 'Sales C', title: 'Nhân viên kinh doanh', role: 'MEMBER' },
  { userId: 'u-head-marketing', departmentId: 'd-marketing', name: 'Hoa Tran', title: 'Trưởng phòng Marketing', role: 'DEPARTMENT_HEAD' },
  { userId: 'u-mkt-member', departmentId: 'd-marketing', name: 'Marketing A', title: 'Chuyên viên nội dung', role: 'MEMBER' },
];
