import {
  OnboardingStage,
  PotentialCustomer,
  PotentialCustomerStatus,
  SourceChannel,
} from '../../domain/potential-customer';

const days = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

let seq = 0;
const customer = (
  name: string,
  businessLine: string,
  assigneeId: string | null,
  status: PotentialCustomerStatus,
  source: SourceChannel,
  onboarding: OnboardingStage,
  lastContactedDays: number | null,
  followUpDays: number | null,
  contact: string,
): PotentialCustomer => ({
  id: `pc-${++seq}`,
  departmentId: 'd-sales',
  assigneeId,
  name,
  businessLine,
  status,
  source,
  onboarding,
  contact,
  createdAt: days(-(seq + 2)),
  lastContactedAt: lastContactedDays === null ? null : days(-lastContactedDays),
  followUpAt: followUpDays === null ? null : days(followUpDays),
});

/**
 * Ownership is the point of this fixture: ABC belongs to Sales A, XYZ to
 * Sales B. A member sees only their own, a head sees the whole department.
 */
export const POTENTIAL_CUSTOMERS: PotentialCustomer[] = [
  // Sales A
  customer('Công ty TNHH An Phát', 'THG Fulfillment', 'u-sales-a', 'ASSIGNED', 'FACEBOOK_GROUP', 'CATALOGUE_SENT', 1, 0, 'Chị Lan · 0903 xxx 112'),
  customer('Công ty CP GreenFarm', 'THG Fulfillment', 'u-sales-a', 'CONVERTED', 'REFERRAL', 'ONBOARDED', 3, null, 'Anh Dũng · 0912 xxx 334'),
  customer('Shop Hoa Tươi 360', 'THG eCommerce', 'u-sales-a', 'ASSIGNED', 'FANPAGE', 'MEETING_BOOKED', 2, 1, 'Chị Mai · 0987 xxx 771'),
  customer('Nhà thuốc Minh Tâm', 'THG Fulfillment', 'u-sales-a', 'ASSIGNED', 'TELEGRAM', 'NOT_STARTED', 9, 0, 'Anh Tâm · 0938 xxx 205'),
  customer('Xưởng may Hòa Bình', 'THG Global', 'u-sales-a', 'ASSIGNED', 'WEBSITE', 'SALE_KIT_SENT', 4, 3, 'Chị Hòa · 0977 xxx 618'),

  // Sales B — invisible to Sales A, visible to the head
  customer('Cửa hàng Mẹ & Bé Happy', 'THG eCommerce', 'u-sales-b', 'ASSIGNED', 'FACEBOOK_GROUP', 'CATALOGUE_SENT', 2, 1, 'Chị Hạnh · 0909 xxx 448'),
  customer('Công ty TNHH Minh Khang', 'THG Global', 'u-sales-b', 'ASSIGNED', 'EVENT', 'MEETING_BOOKED', 5, 2, 'Anh Khang · 0913 xxx 900'),
  customer('Mỹ phẩm Bella', 'THG eCommerce', 'u-sales-b', 'CONVERTED', 'FANPAGE', 'ONBOARDED', 6, null, 'Chị Bella · 0965 xxx 233'),
  customer('Đồ chơi Kidbox', 'THG eCommerce', 'u-sales-b', 'CLOSED', 'WEBSITE', 'NOT_STARTED', 21, null, 'Anh Bách · 0944 xxx 019'),

  // Sales C
  customer('Thực phẩm sạch FarmGo', 'THG Fulfillment', 'u-sales-c', 'ASSIGNED', 'REFERRAL', 'SALE_KIT_SENT', 1, 2, 'Chị Trang · 0978 xxx 552'),
  customer('Gia dụng HomeLine', 'THG eCommerce', 'u-sales-c', 'ASSIGNED', 'FACEBOOK_GROUP', 'CATALOGUE_SENT', 12, -1, 'Anh Lâm · 0932 xxx 087'),

  // Unassigned pool — the head's queue to distribute
  customer('Thời trang Ruby', 'THG eCommerce', null, 'UNASSIGNED', 'FACEBOOK_GROUP', 'NOT_STARTED', null, null, 'Chị Ruby · 0901 xxx 664'),
  customer('Nội thất Anh Quân', 'THG Fulfillment', null, 'UNASSIGNED', 'WEBSITE', 'NOT_STARTED', null, null, 'Anh Quân · 0918 xxx 320'),
  customer('Cà phê Nguyên Chất', 'THG Global', null, 'UNASSIGNED', 'TELEGRAM', 'NOT_STARTED', null, null, 'Anh Nguyên · 0966 xxx 145'),
  customer('Phụ kiện GadgetHub', 'THG eCommerce', null, 'UNASSIGNED', 'FANPAGE', 'NOT_STARTED', null, null, 'Chị Vy · 0925 xxx 738'),
  customer('Dược phẩm Việt An', 'THG Fulfillment', null, 'UNASSIGNED', 'EVENT', 'NOT_STARTED', null, null, 'Anh An · 0983 xxx 471'),
  customer('Bánh kẹo Sweeta', 'THG eCommerce', null, 'UNASSIGNED', 'REFERRAL', 'NOT_STARTED', null, null, 'Chị Sương · 0947 xxx 512'),
];

/** Who a head may hand work to. In production this comes from DepartmentRepository.members(). */
export const SALES_TEAM = [
  { userId: 'u-sales-a', name: 'Sales A' },
  { userId: 'u-sales-b', name: 'Sales B' },
  { userId: 'u-sales-c', name: 'Sales C' },
];
