import { UserContext } from '@bo/types';

/**
 * Test personas for the acceptance runs. Each one exercises a different
 * workspace composition; the persona switcher in the topbar exists only
 * because this list is non-empty.
 */
export const PERSONAS: UserContext[] = [
  {
    userId: 'u-ceo',
    name: 'Vương Nguyên Hảo',
    title: 'Tổng giám đốc',
    role: 'SUPERADMIN',
  },
  {
    userId: 'u-head-sales',
    name: 'Huyền Trang',
    title: 'Trưởng phòng Sales',
    role: 'DEPARTMENT_HEAD',
    departmentId: 'd-sales',
  },
  {
    userId: 'u-sales-a',
    name: 'Sales A',
    title: 'Nhân viên kinh doanh',
    role: 'MEMBER',
    departmentId: 'd-sales',
  },
  {
    userId: 'u-sales-b',
    name: 'Sales B',
    title: 'Nhân viên kinh doanh',
    role: 'MEMBER',
    departmentId: 'd-sales',
  },
  {
    userId: 'u-head-operations',
    name: 'Min',
    title: 'Trưởng phòng Vận hành',
    role: 'DEPARTMENT_HEAD',
    departmentId: 'd-operations',
  },
  {
    userId: 'u-head-marketing',
    name: 'Hoa Tran',
    title: 'Trưởng phòng Marketing',
    role: 'DEPARTMENT_HEAD',
    departmentId: 'd-marketing',
  },
  {
    userId: 'u-mkt-member',
    name: 'Marketing A',
    title: 'Chuyên viên nội dung',
    role: 'MEMBER',
    departmentId: 'd-marketing',
  },
];

/** Who the app starts as. */
export const DEFAULT_PERSONA = PERSONAS[0];
