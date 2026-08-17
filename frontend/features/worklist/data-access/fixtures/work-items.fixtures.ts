import { WorkItem, WorkItemPriority, WorkItemStatus } from '../../domain/work-item';

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

let seq = 0;
const item = (
  departmentId: string,
  capability: string,
  title: string,
  assigneeId: string | null,
  status: WorkItemStatus,
  priority: WorkItemPriority,
  dueInHours: number | null,
  context?: string,
): WorkItem => ({
  id: `wi-${++seq}`,
  departmentId,
  capability,
  assigneeId,
  title,
  status,
  priority,
  dueAt: dueInHours === null ? null : hours(dueInHours),
  updatedAt: hours(-2 - (seq % 9)),
  context,
});

/**
 * Ownership matters here: Sales A and Sales B own different rows so the
 * member/head/superadmin difference is visible in the demo.
 */
export const WORK_ITEMS: WorkItem[] = [
  // Sales — tasks
  item('d-sales', 'tasks', 'Gọi lại khách An Phát', 'u-sales-a', 'TODO', 'HIGH', 2, 'Công ty TNHH An Phát'),
  item('d-sales', 'tasks', 'Gửi catalogue Fulfillment 2024', 'u-sales-a', 'TODO', 'MEDIUM', 5, 'Shop Hoa Tươi 360'),
  item('d-sales', 'tasks', 'Chuẩn bị báo giá GreenFarm', 'u-sales-a', 'IN_PROGRESS', 'HIGH', -3, 'Công ty CP GreenFarm'),
  item('d-sales', 'tasks', 'Follow-up nhóm khách mẹ & bé', 'u-sales-b', 'TODO', 'MEDIUM', 6, 'Cửa hàng Mẹ & Bé Happy'),
  item('d-sales', 'tasks', 'Tổng hợp pipeline tuần', 'u-sales-b', 'IN_PROGRESS', 'LOW', 30),
  item('d-sales', 'tasks', 'Rà soát khách chưa phân công', 'u-head-sales', 'TODO', 'HIGH', 4),
  item('d-sales', 'tasks', 'Duyệt kịch bản tiếp cận Telegram', 'u-head-sales', 'BLOCKED', 'MEDIUM', -20),

  // Sales — content & reporting, the real daily work of a sales member
  item('d-sales', 'content', 'Đăng bài nhóm Facebook ngành mỹ phẩm', 'u-sales-a', 'TODO', 'MEDIUM', 3),
  item('d-sales', 'content', 'Quay video giới thiệu dịch vụ kho', 'u-sales-a', 'IN_PROGRESS', 'LOW', 48),
  item('d-sales', 'content', 'Cập nhật fanpage tuần 21', 'u-sales-b', 'DONE', 'LOW', -50),
  item('d-sales', 'reports', 'Báo cáo T3 — tiến độ khách mới', 'u-sales-a', 'TODO', 'HIGH', 20),
  item('d-sales', 'reports', 'Báo cáo T6 — tổng kết tháng', 'u-sales-a', 'TODO', 'MEDIUM', 200),
  item('d-sales', 'reports', 'Báo cáo hiệu suất đội Sales', 'u-head-sales', 'IN_PROGRESS', 'MEDIUM', 26),
  item('d-sales', 'documents', 'Sale Kit — Catalogue Fulfillment 2024', null, 'DONE', 'LOW', null),
  item('d-sales', 'documents', 'Kịch bản tiếp cận khách TMĐT', null, 'DONE', 'LOW', null),
  item('d-sales', 'requests', 'Xin quyền xem báo cáo doanh thu', 'u-sales-a', 'TODO', 'LOW', 60),

  // Marketing
  item('d-marketing', 'tasks', 'Brief thiết kế banner tháng 6', 'u-mkt-member', 'TODO', 'MEDIUM', 8),
  item('d-marketing', 'tasks', 'Duyệt nội dung tuần', 'u-head-marketing', 'IN_PROGRESS', 'HIGH', 1),
  item('d-marketing', 'content', 'Kịch bản email automation', 'u-mkt-member', 'TODO', 'HIGH', -2),
  item('d-marketing', 'reports', 'Hiệu quả kênh quảng cáo', 'u-head-marketing', 'TODO', 'MEDIUM', 40),
  item('d-marketing', 'documents', 'Brand guideline 2024', null, 'DONE', 'LOW', null),

  // Operations / Finance / IT — enough to prove other departments render
  item('d-operations', 'tasks', 'Kiểm kê kho HCM', null, 'TODO', 'HIGH', 12),
  item('d-operations', 'tasks', 'Sắp xếp ca giao hàng cuối tuần', null, 'TODO', 'MEDIUM', 24),
  item('d-operations', 'documents', 'SOP đóng gói hàng dễ vỡ', null, 'DONE', 'LOW', null),
  item('d-operations', 'reports', 'Tỷ lệ giao đúng hạn', null, 'IN_PROGRESS', 'MEDIUM', 30),
  item('d-finance', 'tasks', 'Đối soát công nợ tháng 5', null, 'IN_PROGRESS', 'HIGH', 6),
  item('d-finance', 'reports', 'Báo cáo dòng tiền Q2', null, 'TODO', 'HIGH', 72),
  item('d-it', 'tasks', 'Nâng cấp hệ thống SSO', null, 'IN_PROGRESS', 'HIGH', 18),
  item('d-it', 'tasks', 'Rà soát phân quyền Backoffice', null, 'TODO', 'MEDIUM', 36),
  item('d-it', 'documents', 'Chính sách bảo mật nội bộ', null, 'DONE', 'LOW', null),
  item('d-legal', 'tasks', 'Rà soát hợp đồng đối tác kho', null, 'TODO', 'MEDIUM', 28),
  item('d-legal', 'documents', 'Mẫu hợp đồng dịch vụ 2024', null, 'DONE', 'LOW', null),
];
