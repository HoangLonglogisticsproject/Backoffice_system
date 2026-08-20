/**
 * Every string the interface can say, in both languages it speaks.
 *
 * ★ KEY-MAJOR, NOT LANGUAGE-MAJOR, and that is the whole point of the shape.
 *
 * The obvious layout is `{ vi: { ...71 keys... }, en: { ...the same 71... } }`,
 * and it is a trap: two large object literals with an identical key set are
 * flagged as duplicated blocks, and — far worse than any linter complaint — the
 * two halves drift. Adding a key to one and forgetting the other is a silent
 * fallback to the raw key name, in production, in one language only.
 *
 * Pairing the translations at the key instead makes the mistake unspellable:
 * there is one entry per phrase, and it cannot exist in Vietnamese without also
 * existing in English. `Record<TranslationKey, Record<Language, string>>` is
 * what enforces it, so a missing half is a compile error rather than a bug
 * somebody notices in the wrong locale six weeks later.
 *
 * Nothing about the product behaviour changed: same keys, same strings, same
 * `t(key)` call at every site. This is the storage shape, not the UX.
 */
export type Language = 'vi' | 'en';

/** One phrase, in every language. */
type Phrase = Record<Language, string>;

const PHRASES = {
  backofficeSystem: { vi: 'Backoffice System', en: 'Backoffice System' },
  adminUser: { vi: 'Admin User', en: 'Admin User' },
  logout: { vi: 'Đăng xuất', en: 'Logout' },
  common: { vi: 'CHUNG', en: 'GENERAL' },
  overview: { vi: 'Tổng quan', en: 'Overview' },
  myWork: { vi: 'Việc của tôi', en: 'My Work' },
  departments: { vi: 'Phòng ban', en: 'Departments' },
  employees: { vi: 'Nhân viên', en: 'Employees' },
  departmentsSection: { vi: 'PHÒNG BAN', en: 'DEPARTMENTS' },
  sales: { vi: 'Sales', en: 'Sales' },
  operations: { vi: 'Operations', en: 'Operations' },
  marketing: { vi: 'Marketing', en: 'Marketing' },
  finance: { vi: 'Finance', en: 'Finance' },
  it: { vi: 'IT', en: 'IT' },
  legal: { vi: 'Legal', en: 'Legal' },
  system: { vi: 'HỆ THỐNG', en: 'SYSTEM' },
  requests: { vi: 'Yêu cầu', en: 'Requests' },
  approvals: { vi: 'Phê duyệt', en: 'Approvals' },
  documents: { vi: 'Tài liệu', en: 'Documents' },
  reports: { vi: 'Báo cáo', en: 'Reports' },
  aiCoordinator: { vi: 'AI Điều phối', en: 'AI Coordinator' },
  settings: { vi: 'Cài đặt', en: 'Settings' },

  // Employee Management Page
  employeeList: { vi: 'Danh sách nhân viên', en: 'Employee List' },
  addEmployee: { vi: 'Thêm nhân viên', en: 'Add Employee' },
  searchPlaceholder: {
    vi: 'Tìm kiếm theo tên, email, SĐT...',
    en: 'Search by name, email, phone...',
  },
  branchAll: { vi: 'Chi nhánh: Tất cả', en: 'Branch: All' },
  branchHn: { vi: 'Hà Nội', en: 'Hanoi' },
  branchHcm: { vi: 'Hồ Chí Minh', en: 'Ho Chi Minh' },
  departmentAll: { vi: 'Phòng ban: Tất cả', en: 'Department: All' },
  statusAll: { vi: 'Trạng thái: Tất cả', en: 'Status: All' },
  statusActive: { vi: 'Đang làm việc', en: 'Active' },
  statusInactive: { vi: 'Nghỉ việc', en: 'Resigned' },
  statusPause: { vi: 'Tạm nghỉ', en: 'On Leave' },
  filterBtn: { vi: 'Bộ lọc', en: 'Filter' },
  colIndex: { vi: '#', en: '#' },
  colEmployee: { vi: 'Nhân viên', en: 'Employee' },
  colEmpCode: { vi: 'Mã nhân viên', en: 'Emp Code' },
  colDepartment: { vi: 'Phòng ban', en: 'Department' },
  colTitle: { vi: 'Chức danh', en: 'Title' },
  colEmail: { vi: 'Email', en: 'Email' },
  colPhone: { vi: 'SĐT', en: 'Phone' },
  colStatus: { vi: 'Trạng thái', en: 'Status' },
  colActions: { vi: 'Thao tác', en: 'Actions' },

  // Add Employee Modal
  addNewEmployee: { vi: 'Thêm nhân viên mới', en: 'Add New Employee' },
  cancel: { vi: 'Hủy bỏ', en: 'Cancel' },
  saveEmployee: { vi: 'Lưu nhân viên', en: 'Save Employee' },
  fullNameLabel: { vi: 'Họ và tên *', en: 'Full Name *' },
  fullNamePlaceholder: { vi: 'Nhập họ và tên', en: 'Enter full name' },
  empCodeLabel: { vi: 'Mã nhân viên *', en: 'Employee Code *' },
  emailLabel: { vi: 'Email *', en: 'Email *' },
  departmentLabel: { vi: 'Phòng ban', en: 'Department' },
  selectDepartment: { vi: 'Chọn phòng ban', en: 'Select department' },
  titleLabel: { vi: 'Chức danh', en: 'Job Title' },
  titlePlaceholder: { vi: 'Nhập chức danh', en: 'Enter job title' },

  // Account Security Page
  changePassword: { vi: 'Thay đổi mật khẩu', en: 'Change Password' },
  twoFactorAuth: { vi: 'Xác thực 2 lớp (2FA)', en: 'Two-Factor Auth (2FA)' },
  sessions: { vi: 'Phiên đăng nhập', en: 'Login Sessions' },
  loginHistory: { vi: 'Lịch sử đăng nhập', en: 'Login History' },
  devices: { vi: 'Thiết bị đã đăng nhập', en: 'Logged-in Devices' },
  updatePasswordDesc: {
    vi: 'Vui lòng cập nhật mật khẩu mới để bảo vệ tài khoản của bạn.',
    en: 'Please update your password to protect your account.',
  },
  currentPasswordLabel: { vi: 'Mật khẩu hiện tại *', en: 'Current Password *' },
  currentPasswordPlaceholder: { vi: 'Nhập mật khẩu hiện tại', en: 'Enter current password' },
  newPasswordLabel: { vi: 'Mật khẩu mới *', en: 'New Password *' },
  newPasswordPlaceholder: { vi: 'Nhập mật khẩu mới', en: 'Enter new password' },
  confirmPasswordLabel: { vi: 'Xác nhận mật khẩu mới *', en: 'Confirm New Password *' },
  confirmPasswordPlaceholder: { vi: 'Nhập lại mật khẩu mới', en: 'Re-enter new password' },
  passwordReq1: { vi: 'Tối thiểu 8 ký tự', en: 'Minimum 8 characters' },
  passwordReq2: {
    vi: 'Bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt',
    en: 'Includes uppercase, lowercase, number, and special character',
  },
  passwordReq3: { vi: 'Không chứa khoảng trắng', en: 'No spaces allowed' },
  updatePasswordBtn: { vi: 'Cập nhật mật khẩu', en: 'Update Password' },
  featureInDev: { vi: 'Tính năng đang được phát triển...', en: 'Feature in development...' },

  colJoinedAt: { vi: 'Ngày vào phòng', en: 'Joined' },

  // Pagination — cursor based, so there is no total and no page number
  loading: { vi: 'Đang tải…', en: 'Loading…' },
  showingRows: { vi: 'Đang hiển thị', en: 'Showing' },
  previousPage: { vi: 'Trước', en: 'Previous' },
  nextPage: { vi: 'Sau', en: 'Next' },
  perPage: { vi: 'trang', en: 'page' },

  passwordMismatch: {
    vi: 'Mật khẩu xác nhận không khớp.',
    en: 'The confirmation does not match.',
  },

  showPassword: { vi: 'Hiện mật khẩu', en: 'Show password' },
  hidePassword: { vi: 'Ẩn mật khẩu', en: 'Hide password' },

  // Feature availability — a screen may exist before its endpoint does
  comingSoon: { vi: 'Sắp có', en: 'Coming soon' },
  notAvailableYet: {
    vi: 'Tính năng này chưa được hỗ trợ.',
    en: 'This feature is not supported yet.',
  },
  fieldNotSupported: {
    vi: 'Hệ thống chưa lưu trường này.',
    en: 'The system does not store this field yet.',
  },
  searchNotSupported: {
    vi: 'Tìm kiếm phía máy chủ chưa được hỗ trợ.',
    en: 'Server-side search is not supported yet.',
  },
  filterNotSupported: {
    vi: 'Bộ lọc phía máy chủ chưa được hỗ trợ.',
    en: 'Server-side filtering is not supported yet.',
  },

  // Loading, empty and error states
  emptyMembers: { vi: 'Phòng ban này chưa có nhân viên nào.', en: 'This department has no members yet.' },
  emptyRequests: { vi: 'Không có yêu cầu nào đang chờ.', en: 'No pending requests.' },
  emptyInvitations: { vi: 'Không có lời mời nào đang chờ.', en: 'No pending invitations.' },
  loadFailed: { vi: 'Không tải được dữ liệu.', en: 'Could not load the data.' },
  forbiddenTitle: { vi: 'Không có quyền', en: 'Not permitted' },
  forbiddenBody: {
    vi: 'Tài khoản của bạn không được phép xem nội dung này.',
    en: 'Your account is not allowed to view this.',
  },
  retry: { vi: 'Thử lại', en: 'Retry' },

  // Approvals
  approvalsTitle: { vi: 'Phê duyệt', en: 'Approvals' },
  tabMembershipRequests: { vi: 'Yêu cầu nhân sự', en: 'Membership requests' },
  tabInvitations: { vi: 'Lời mời tài khoản', en: 'Account invitations' },
  approve: { vi: 'Duyệt', en: 'Approve' },
  reject: { vi: 'Từ chối', en: 'Reject' },
  colRequestedBy: { vi: 'Người yêu cầu', en: 'Requested by' },
  colTarget: { vi: 'Đối tượng', en: 'Subject' },
  colAction: { vi: 'Hành động', en: 'Action' },
  colRequestedAt: { vi: 'Thời điểm', en: 'Requested at' },
  confirmApproveTitle: { vi: 'Xác nhận duyệt', en: 'Confirm approval' },
  confirmRejectTitle: { vi: 'Xác nhận từ chối', en: 'Confirm rejection' },
  confirmApproveBody: {
    vi: 'Duyệt yêu cầu này? Hành động sẽ được máy chủ ghi nhận.',
    en: 'Approve this request? The server records the decision.',
  },
  confirmRejectBody: {
    vi: 'Từ chối yêu cầu này? Hành động sẽ được máy chủ ghi nhận.',
    en: 'Reject this request? The server records the decision.',
  },
  reasonLabel: { vi: 'Lý do', en: 'Reason' },
  reasonOptional: { vi: 'Không bắt buộc', en: 'Optional' },

  // Account provisioning — the one-time secret
  temporaryPasswordTitle: { vi: 'Mật khẩu tạm thời', en: 'Temporary password' },
  temporaryPasswordBody: {
    vi: 'Máy chủ sinh mật khẩu này và chỉ trả về đúng một lần. Hãy chuyển cho người dùng ngay — không có cách nào đọc lại.',
    en: 'The server generated this and returns it exactly once. Hand it over now — nothing can read it back.',
  },
  copy: { vi: 'Sao chép', en: 'Copy' },
  copied: { vi: 'Đã sao chép', en: 'Copied' },
  done: { vi: 'Xong', en: 'Done' },
  usernameLabel: { vi: 'Tên đăng nhập', en: 'Username' },

  // Add employee — SUPERADMIN direct create
  initialPasswordLabel: { vi: 'Mật khẩu khởi tạo', en: 'Initial password' },
  initialPasswordHint: {
    vi: 'Người dùng sẽ phải đổi mật khẩu ở lần đăng nhập đầu tiên.',
    en: 'The user must change this at first sign-in.',
  },
  creating: { vi: 'Đang tạo…', en: 'Creating…' },
  createFailed: { vi: 'Không tạo được tài khoản.', en: 'Could not create the account.' },
  requestAccountTitle: { vi: 'Đề nghị mở tài khoản', en: 'Request an account' },
  requestAccountBody: {
    vi: 'Trưởng phòng chỉ gửi email. Quản trị viên duyệt và hệ thống sinh mật khẩu.',
    en: 'A head submits the email only. An administrator approves and the system issues the password.',
  },
  submitRequest: { vi: 'Gửi đề nghị', en: 'Submit request' },
} as const satisfies Record<string, Phrase>;

export type TranslationKey = keyof typeof PHRASES;

/**
 * The lookup every call site uses.
 *
 * Falls back to the key itself rather than throwing or rendering an empty box:
 * a screen showing `addEmployee` is obviously wrong to whoever sees it, and it
 * still lets the rest of the page work. The type makes it unreachable anyway —
 * this is the belt to the compiler's braces.
 */
export function translate(language: Language, key: TranslationKey): string {
  return PHRASES[key]?.[language] ?? key;
}

/**
 * The same data language-major, for anything that wants a whole dictionary.
 *
 * Derived, never hand-written — which is what keeps the two languages in step.
 */
export const translations: Record<Language, Record<TranslationKey, string>> = {
  vi: buildDictionary('vi'),
  en: buildDictionary('en'),
};

function buildDictionary(language: Language): Record<TranslationKey, string> {
  const keys = Object.keys(PHRASES) as TranslationKey[];
  return Object.fromEntries(keys.map((key) => [key, PHRASES[key][language]])) as Record<
    TranslationKey,
    string
  >;
}
