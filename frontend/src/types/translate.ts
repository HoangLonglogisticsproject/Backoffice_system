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

  // Accessible names. Screen readers read these, so they are translated
  // like everything else a person can perceive.
  closeLabel: { vi: 'Đóng', en: 'Close' },
  toggleNavigation: { vi: 'Ẩn/hiện điều hướng', en: 'Toggle navigation' },
  pageSizeLabel: { vi: 'Số dòng mỗi trang', en: 'Rows per page' },
  languageLabel: { vi: 'Ngôn ngữ', en: 'Language' },
  copyFailed: { vi: 'Không sao chép được', en: 'Copy failed' },

  // Pagination — cursor based, so there is no total and no page number
  loading: { vi: 'Đang tải…', en: 'Loading…' },
  showingRows: { vi: 'Đang hiển thị', en: 'Showing' },
  previousPage: { vi: 'Trước', en: 'Previous' },
  nextPage: { vi: 'Sau', en: 'Next' },
  perPage: { vi: 'trang', en: 'page' },

  // Pagination — offset based. ONE list uses these: the trip schedule, whose
  // mandatory date range is what makes a total affordable (ADR-0003).
  page: { vi: 'Trang', en: 'Page' },
  totalRows: { vi: 'Tổng số dòng', en: 'Total rows' },

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
  // The FULL address. `username` is the display projection and is never what
  // somebody signs in with — see the approval modal.
  loginEmailLabel: { vi: 'Email đăng nhập', en: 'Login email' },

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

  // Add employee — the company email field. The user types the local part; the
  // domain is drawn beside it and cannot be edited.
  emailLocalPartPlaceholder: { vi: 'uyen', en: 'uyen' },
  invalidCompanyEmail: {
    vi: 'Vui lòng nhập email công ty hợp lệ.',
    en: 'Please enter a valid company email.',
  },

  // ---------------------------------------------------------- Trip schedule --
  // Replaces the shared workbook `LỊCH XE - CHI PHÍ XE.xlsx`. The Vietnamese
  // side reuses the wording dispatch already uses on that sheet, deliberately:
  // a screen that renames the columns is a screen people have to learn twice.
  dispatchSection: { vi: 'ĐIỀU VẬN', en: 'DISPATCH' },
  tripSchedule: { vi: 'Lịch xe', en: 'Trip schedule' },
  tripMasterData: { vi: 'Xe & khách hàng', en: 'Vehicles & customers' },
  tripScheduleTitle: { vi: 'Lịch xe trong ngày', en: 'Daily trip schedule' },
  addTrip: { vi: 'Thêm chuyến', en: 'Add trip' },
  editTrip: { vi: 'Sửa chuyến', en: 'Edit trip' },

  // Filters. The date range is the only server-side filter this list has.
  dateFrom: { vi: 'Từ ngày', en: 'From' },
  dateTo: { vi: 'Đến ngày', en: 'To' },
  thisMonth: { vi: 'Tháng này', en: 'This month' },
  dateRangeTooWide: {
    vi: 'Khoảng ngày tối đa là 366 ngày.',
    en: 'A range may span at most 366 days.',
  },
  dateRangeBackwards: {
    vi: 'Ngày kết thúc phải sau ngày bắt đầu.',
    en: 'The end date must not be before the start date.',
  },

  // Columns — the twelve of the sheet, in its order.
  colDate: { vi: 'Ngày', en: 'Date' },
  colVehicle: { vi: 'Số xe', en: 'Vehicle' },
  colCustomer: { vi: 'Khách hàng', en: 'Customer' },
  colCargo: { vi: 'Thông tin lô hàng', en: 'Cargo' },
  colPickup: { vi: 'Lấy hàng', en: 'Pickup' },
  colDelivery: { vi: 'Giao hàng', en: 'Delivery' },
  colNote: { vi: 'Ghi chú', en: 'Note' },
  colCreatedBy: { vi: 'Người nhập', en: 'Entered by' },

  // Form fields.
  fieldDate: { vi: 'Ngày *', en: 'Date *' },
  fieldVehicle: { vi: 'Số xe', en: 'Vehicle' },
  fieldCustomer: { vi: 'Khách hàng', en: 'Customer' },
  fieldCargo: { vi: 'Thông tin lô hàng', en: 'Cargo details' },
  fieldPickupAddress: { vi: 'Địa chỉ lấy hàng', en: 'Pickup address' },
  fieldDeliveryAddress: { vi: 'Địa chỉ giao hàng', en: 'Delivery address' },
  fieldPickupContact: { vi: 'Liên hệ lấy hàng', en: 'Pickup contact' },
  fieldDeliveryContact: { vi: 'Liên hệ giao hàng', en: 'Delivery contact' },
  fieldPickupAt: { vi: 'Thời gian lấy hàng', en: 'Pickup time' },
  fieldDeliveryAt: { vi: 'Thời gian giao hàng', en: 'Delivery time' },
  fieldStatus: { vi: 'Trạng thái', en: 'Status' },
  fieldNote: { vi: 'Ghi chú', en: 'Note' },
  // Delivery legitimately runs to the next day; the form says so rather than
  // letting somebody assume the two times share a date.
  deliveryMayBeLater: {
    vi: 'Giao hàng có thể sang ngày khác ngày lấy hàng.',
    en: 'Delivery may fall on a later day than pickup.',
  },

  // The five statuses — the row colours of the workbook, with its own wording.
  tripAwaitingProduction: { vi: 'Đang đợi SX', en: 'Awaiting production' },
  tripAwaitingVehicle: { vi: 'SX rồi, đợi xe', en: 'Awaiting a vehicle' },
  tripNeedsConfirmation: { vi: 'Cần xác nhận lại', en: 'Needs confirmation' },
  tripExternalBooking: { vi: 'Book xe ngoài', en: 'External booking' },
  tripDone: { vi: 'Đã xong', en: 'Done' },
  // The inline control on the board. "Đổi trạng thái" rather than "Trạng thái":
  // the column header already says what the value is, and this names the ACTION
  // for a screen reader that reaches the control without the header.
  changeStatus: { vi: 'Đổi trạng thái', en: 'Change status' },
  statusChangeFailed: {
    vi: 'Không đổi được trạng thái.',
    en: 'Could not change the status.',
  },

  // Catalogue.
  vehicles: { vi: 'Xe', en: 'Vehicles' },
  customers: { vi: 'Khách hàng', en: 'Customers' },
  addVehicle: { vi: 'Thêm xe', en: 'Add vehicle' },
  addCustomer: { vi: 'Thêm khách hàng', en: 'Add customer' },
  plateLabel: { vi: 'Biển số *', en: 'Plate *' },
  platePlaceholder: { vi: '51D-60088', en: '51D-60088' },
  customerNameLabel: { vi: 'Tên khách hàng *', en: 'Customer name *' },
  customerNamePlaceholder: { vi: 'WWL', en: 'WWL' },
  noteOptional: { vi: 'Ghi chú', en: 'Note' },
  notSelected: { vi: '— Chưa chọn —', en: '— Not set —' },
  selectVehicle: { vi: 'Chọn xe', en: 'Select a vehicle' },
  selectCustomer: { vi: 'Chọn khách hàng', en: 'Select a customer' },
  // The catalogue exists because the sheet accumulated two spellings of one
  // truck. Saying so at the point of entry is what stops it happening again.
  catalogueHint: {
    vi: 'Chọn từ danh mục thay vì gõ tay — đó là thứ tránh được hai cách viết cho cùng một xe.',
    en: 'Pick from the catalogue rather than typing — that is what prevents one truck under two spellings.',
  },

  // Actions.
  edit: { vi: 'Sửa', en: 'Edit' },
  archive: { vi: 'Lưu trữ', en: 'Archive' },
  restore: { vi: 'Dùng lại', en: 'Restore' },
  save: { vi: 'Lưu', en: 'Save' },
  saving: { vi: 'Đang lưu…', en: 'Saving…' },
  saveFailed: { vi: 'Không lưu được.', en: 'Could not save.' },
  showArchived: { vi: 'Hiện mục đã lưu trữ', en: 'Show archived' },
  statusArchived: { vi: 'Đã lưu trữ', en: 'Archived' },

  // ★ The confirmation says what archiving ACTUALLY does. A dialog that says
  // "delete permanently" over an operation that keeps the row is a lie, and a
  // dialog that says "remove" leaves people guessing which one it is.
  confirmArchiveTripTitle: { vi: 'Lưu trữ chuyến này?', en: 'Archive this trip?' },
  confirmArchiveTripBody: {
    vi: 'Chuyến sẽ không còn hiện trên lịch xe. Bản ghi vẫn được giữ lại — đây không phải xoá vĩnh viễn.',
    en: 'The trip leaves the schedule. The record is kept — this is not a permanent delete.',
  },
  confirmArchiveVehicleBody: {
    vi: 'Xe sẽ không còn được chọn khi nhập chuyến mới. Các chuyến cũ vẫn hiện đúng biển số này.',
    en: 'The vehicle stops being offered for new trips. Past trips keep showing this plate.',
  },
  confirmArchiveCustomerBody: {
    vi: 'Khách hàng sẽ không còn được chọn khi nhập chuyến mới. Các chuyến cũ vẫn hiện đúng tên này.',
    en: 'The customer stops being offered for new trips. Past trips keep showing this name.',
  },

  emptyTrips: {
    vi: 'Không có chuyến nào trong khoảng ngày này.',
    en: 'No trips in this date range.',
  },
  emptyVehicles: { vi: 'Danh mục xe còn trống.', en: 'The vehicle catalogue is empty.' },
  emptyCustomers: { vi: 'Danh mục khách hàng còn trống.', en: 'The customer catalogue is empty.' },
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
