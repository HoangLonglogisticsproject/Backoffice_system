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
  // ★ THE HEAD'S OWN SECTION. A head does not administer the deployment; they
  // run the people in ONE unit. Naming their area for the work (personnel)
  // rather than for the unit is what stops it reading as a smaller copy of the
  // global "Phê duyệt".
  hrSection: { vi: 'NHÂN SỰ', en: 'PERSONNEL' },
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
  // ★ NEUTRAL ON PURPOSE. This is `department_memberships.status === 'ended'`,
  // and exactly two paths produce it: `MembershipService.transfer` and
  // `AccountLifecycleService.disable`. A TRANSFERRED employee is still employed
  // — their previous period simply closed — so "Đã nghỉ việc" / "Resigned"
  // would state a reason the data does not carry, and would be plainly wrong on
  // most rows of an employee's department history.
  statusInactive: { vi: 'Đã kết thúc', en: 'Ended' },
  statusPause: { vi: 'Tạm nghỉ', en: 'On Leave' },
  filterBtn: { vi: 'Bộ lọc', en: 'Filter' },
  colIndex: { vi: '#', en: '#' },
  colEmployee: { vi: 'Nhân viên', en: 'Employee' },
  colEmpCode: { vi: 'Mã nhân viên', en: 'Emp Code' },
  colDepartment: { vi: 'Phòng ban', en: 'Department' },
  // ★ POSITION, NOT SYSTEM ROLE. The column shows what somebody DOES here —
  // derived from whether they hold an active DEPARTMENT_HEAD assignment, which
  // is the only thing `role_assignments` can answer.
  colPosition: { vi: 'Vị trí', en: 'Position' },
  colEndedAt: { vi: 'Ngày kết thúc', en: 'Ended' },

  // ---- Employee detail. READ ONLY: no action word appears anywhere here. ----
  employeeDetailTitle: { vi: 'Thông tin nhân viên', en: 'Employee' },
  sectionIdentity: { vi: 'Thông tin nhân viên', en: 'Employee information' },
  sectionAccount: { vi: 'Tài khoản Backoffice', en: 'Backoffice account' },
  sectionCurrentDepartment: { vi: 'Phòng ban hiện tại', en: 'Current department' },
  // ★ ACCOUNT, NOT WORK. `users.status` answers whether the account may operate;
  // saying "Trạng thái nhân viên" here would merge two different columns in the
  // reader's head even though the code keeps them apart.
  accountStatusLabel: { vi: 'Trạng thái tài khoản', en: 'Account status' },
  accountActive: { vi: 'Đang hoạt động', en: 'Active' },
  accountDisabled: { vi: 'Đã vô hiệu hóa', en: 'Disabled' },
  // ★ WORK, NOT ACCOUNT. `department_memberships.status`.
  workStatusLabel: { vi: 'Trạng thái làm việc', en: 'Work status' },
  historyTitle: { vi: 'Lịch sử phòng ban', en: 'Department history' },
  // ⚠ SAID OUT LOUD, because a filtered list that looks complete is worse than
  // no list. A head sees only the units they lead.
  historyTitleScoped: {
    vi: 'Lịch sử phòng ban trong phạm vi được phân quyền',
    en: 'Department history within your authorized scope',
  },
  historyScopedNote: {
    vi: 'Chỉ hiển thị các giai đoạn thuộc phòng ban bạn được phân quyền quản lý.',
    en: 'Only periods in departments you are authorized to manage are shown.',
  },
  noCurrentDepartment: {
    vi: 'Nhân viên này hiện không thuộc phòng ban nào.',
    en: 'This employee currently belongs to no department.',
  },
  noHistory: { vi: 'Không có giai đoạn nào để hiển thị.', en: 'No periods to show.' },
  employeeNotFound: { vi: 'Không tìm thấy nhân viên này.', en: 'Employee not found.' },
  employeeForbidden: {
    vi: 'Bạn không có quyền xem nhân viên này.',
    en: 'You are not allowed to view this employee.',
  },

  // ---- Disabling an account. ACCESS, never deletion. ----
  // ★ THE WORD IS "vô hiệu hóa", NEVER "xóa". Nothing is deleted: the person,
  // their credential and every past period survive. Calling it a deletion would
  // describe an operation this system does not have and cannot undo.
  disableAccount: { vi: 'Vô hiệu hóa tài khoản', en: 'Disable account' },
  disableAccountTitle: { vi: 'Vô hiệu hóa tài khoản Backoffice?', en: 'Disable this Backoffice account?' },
  disableAccountConfirm: { vi: 'Xác nhận vô hiệu hóa', en: 'Confirm disable' },
  disableEffectLogin: {
    vi: 'Tài khoản Backoffice sẽ không thể đăng nhập.',
    en: 'This Backoffice account will no longer be able to sign in.',
  },
  disableEffectKeepsData: {
    vi: 'Dữ liệu nhân viên không bị xóa.',
    en: 'The employee record is not deleted.',
  },
  disableEffectKeepsHistory: {
    vi: 'Lịch sử phòng ban vẫn được giữ lại.',
    en: 'Department history is retained.',
  },
  disableEffectAccess: {
    vi: 'Đây là thao tác ảnh hưởng quyền truy cập hệ thống.',
    en: 'This changes what the person may access.',
  },
  disabling: { vi: 'Đang vô hiệu hóa…', en: 'Disabling…' },
  disableFailed: { vi: 'Không vô hiệu hóa được tài khoản.', en: 'Could not disable the account.' },
  // ★ MANAGEMENT, NOT APPROVAL. It shares a screen with the two decision
  // queues and must not share their meaning: nothing here is approved or
  // rejected, it answers "who works here".
  tabEmployeeRoster: { vi: 'Quản lý nhân viên', en: 'Employee management' },
  filterAllStatuses: { vi: 'Tất cả', en: 'All' },
  filterMembershipStatus: { vi: 'Lọc theo trạng thái', en: 'Filter by status' },
  emptyRoster: { vi: 'Không có nhân viên nào khớp bộ lọc này.', en: 'No employee matches this filter.' },
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
  initialPasswordLabel: { vi: 'Mật khẩu tạm *', en: 'Temporary password *' },
  initialPasswordHint: {
    vi: 'Người dùng sẽ phải đổi mật khẩu ở lần đăng nhập đầu tiên.',
    en: 'The user must change this at first sign-in.',
  },
  creating: { vi: 'Đang tạo…', en: 'Creating…' },
  createFailed: { vi: 'Không tạo được tài khoản.', en: 'Could not create the account.' },
  requestAccountTitle: { vi: 'Đề nghị mở tài khoản', en: 'Request an account' },
  // ★ SAYS WHAT THE REQUEST DOES NOT CARRY, not just what it does.
  //
  // `account_invitations` has no role column and approval reads nothing off the
  // row but the address and the department, so a head cannot express a chức vụ
  // at this step through any endpoint that exists. Leaving that unsaid invites
  // somebody to assume the field was merely forgotten and that the role will
  // arrive with the account.
  requestAccountBody: {
    vi: 'Đề nghị này chỉ mở tài khoản: bạn gửi email, quản trị viên duyệt và hệ thống sinh mật khẩu tạm. Đề nghị KHÔNG mang chức vụ — quản trị viên bổ nhiệm sau khi tài khoản đã tồn tại.',
    en: 'This request only opens an account: you submit the email, an administrator approves it and the system issues a temporary password. It carries NO role — an administrator appoints one after the account exists.',
  },
  submitRequest: { vi: 'Gửi đề nghị', en: 'Submit request' },

  // Add employee — the company email field. The user types the local part; the
  // domain is drawn beside it and cannot be edited.
  emailLocalPartPlaceholder: { vi: 'uyen', en: 'uyen' },
  invalidCompanyEmail: {
    vi: 'Vui lòng nhập email công ty hợp lệ.',
    en: 'Please enter a valid company email.',
  },

  // Add employee — the department and the role, both from real backend data.
  //
  // ⚠ THE ROLE IS NOT A FIELD ON `POST /users`. Only two of the three role keys
  // are storable at all (MEMBER is the absence of an assignment), and the one
  // that is stored is written by `POST /departments/:id/head`. So this select
  // offers exactly what the backend can actually record — see the modal.
  departmentLabelRequired: { vi: 'Phòng ban *', en: 'Department *' },
  roleLabel: { vi: 'Chức vụ *', en: 'Role *' },
  roleMember: { vi: 'Nhân viên', en: 'Member' },
  roleDepartmentHead: { vi: 'Trưởng phòng', en: 'Department head' },
  roleHint: {
    vi: 'Trưởng phòng được bổ nhiệm sau khi tài khoản được tạo.',
    en: 'A department head is appointed after the account is created.',
  },
  roleAssignFailed: {
    vi: 'Đã tạo tài khoản nhưng chưa bổ nhiệm được trưởng phòng:',
    en: 'The account was created but the head appointment failed:',
  },
  // The action that finishes a partial success. It appoints the account that
  // already exists; it never creates a second one.
  retryAppointment: { vi: 'Thử bổ nhiệm lại', en: 'Retry the appointment' },
  loadDepartmentsFailed: {
    vi: 'Không tải được danh sách phòng ban.',
    en: 'Could not load the departments.',
  },
  // ★ FOLLOWED BY THE FULL ADDRESS at the call site. The administrator typed a
  // LOCAL PART; `POST /auth/login` takes the whole address as `subject`. Saying
  // only "created" leaves them to reconstruct it, and the approval dialog
  // already carries a note about where that assumption led once.
  employeeCreated: { vi: 'Đã tạo tài khoản nhân viên:', en: 'Employee account created:' },
  requestSubmitted: {
    vi: 'Đã gửi đề nghị mở tài khoản, đang chờ quản trị viên duyệt:',
    en: 'The account request was submitted and is awaiting a decision:',
  },
  dismiss: { vi: 'Bỏ qua', en: 'Dismiss' },

  // The head's own view of the two queues — read only, because a head proposes
  // and never decides.
  myDepartmentQueues: {
    vi: 'Yêu cầu của phòng ban bạn phụ trách. Quản trị viên là người duyệt.',
    en: 'Your department’s requests. An administrator decides them.',
  },
  statusPending: { vi: 'Chờ duyệt', en: 'Pending' },
  statusApproved: { vi: 'Đã duyệt', en: 'Approved' },
  statusRejected: { vi: 'Từ chối', en: 'Rejected' },
  // ★ SCOPE. Only ever true of a caller who HAS a scope — a head. It answers
  // "why is this menu empty" with "because of who you are".
  noDepartmentScope: {
    vi: 'Tài khoản của bạn không phụ trách phòng ban nào.',
    en: 'Your account does not lead any department.',
  },
  // ★ INVENTORY, and the distinction is the whole point. A SUPERADMIN is scoped
  // to nothing BY DESIGN, so telling them they lead no department states a rule
  // that does not apply to them and hides the real reason: the deployment has
  // no active department to put anybody into yet.
  noActiveDepartments: {
    vi: 'Chưa có phòng ban nào đang hoạt động.',
    en: 'No department is active yet.',
  },

  // ── Dispatch ──────────────────────────────────────────────────────────────
  // The trip schedule and its catalogue, replacing `LỊCH XE - CHI PHÍ XE.xlsx`.
  //
  // ★ THE VIETNAMESE IS THE SOURCE, NOT THE TRANSLATION. Dispatch has entered
  // these columns by hand for months and says "chuyến", "biển số", "đợi SX" —
  // so the vi side records the words already in use and the en side follows it.
  // Inventing tidier Vietnamese here would rename a vocabulary that is already
  // shared with the drivers on the phone.
  dispatchSection: { vi: 'ĐIỀU PHỐI', en: 'DISPATCH' },
  tripSchedule: { vi: 'Lịch xe', en: 'Trip schedule' },
  tripScheduleTitle: { vi: 'Lịch xe', en: 'Trip schedule' },
  tripMasterData: { vi: 'Danh mục xe & khách', en: 'Vehicles & customers' },

  // Actions shared by both dispatch screens.
  save: { vi: 'Lưu', en: 'Save' },
  saving: { vi: 'Đang lưu…', en: 'Saving…' },
  saveFailed: { vi: 'Không lưu được.', en: 'Could not save.' },
  edit: { vi: 'Sửa', en: 'Edit' },
  archive: { vi: 'Lưu trữ', en: 'Archive' },

  // Trip schedule — the table
  addTrip: { vi: 'Thêm chuyến', en: 'Add trip' },
  editTrip: { vi: 'Sửa chuyến', en: 'Edit trip' },
  dateFrom: { vi: 'Từ ngày', en: 'From' },
  dateTo: { vi: 'Đến ngày', en: 'To' },
  thisMonth: { vi: 'Tháng này', en: 'This month' },
  colDate: { vi: 'Ngày', en: 'Date' },
  colVehicle: { vi: 'Xe', en: 'Vehicle' },
  colCustomer: { vi: 'Khách hàng', en: 'Customer' },
  colCargo: { vi: 'Hàng hoá', en: 'Cargo' },
  colPickup: { vi: 'Điểm lấy hàng', en: 'Pickup' },
  colDelivery: { vi: 'Điểm giao hàng', en: 'Delivery' },
  colNote: { vi: 'Ghi chú', en: 'Note' },
  colCreatedBy: { vi: 'Người tạo', en: 'Created by' },
  emptyTrips: {
    vi: 'Không có chuyến nào trong khoảng ngày này.',
    en: 'No trips in this date range.',
  },
  // ★ AN ANSWER, NOT A PROMPT. The workbook wrote `ĐIỀN SAU` in a cell it had
  // not filled yet, and the API stores that as null — so this reads as a state
  // the row is genuinely in, both in a select and in a table cell.
  notSelected: { vi: 'Chưa chọn', en: 'Not selected' },

  // Trip schedule — the form
  fieldDate: { vi: 'Ngày chạy', en: 'Trip date' },
  fieldStatus: { vi: 'Trạng thái', en: 'Status' },
  fieldVehicle: { vi: 'Xe', en: 'Vehicle' },
  fieldCustomer: { vi: 'Khách hàng', en: 'Customer' },
  fieldCargo: { vi: 'Thông tin hàng', en: 'Cargo details' },
  fieldPickupAddress: { vi: 'Địa chỉ lấy hàng', en: 'Pickup address' },
  fieldDeliveryAddress: { vi: 'Địa chỉ giao hàng', en: 'Delivery address' },
  fieldPickupContact: { vi: 'Liên hệ lấy hàng', en: 'Pickup contact' },
  fieldDeliveryContact: { vi: 'Liên hệ giao hàng', en: 'Delivery contact' },
  fieldPickupAt: { vi: 'Giờ lấy hàng', en: 'Pickup time' },
  fieldDeliveryAt: { vi: 'Giờ giao hàng', en: 'Delivery time' },
  fieldNote: { vi: 'Ghi chú', en: 'Note' },
  // Why the delivery control asks for a date as well as a time.
  deliveryMayBeLater: {
    vi: 'Giờ giao có thể rơi sang ngày khác ngày lấy hàng.',
    en: 'Delivery may fall on a later day than pickup.',
  },
  catalogueHint: {
    vi: 'Chưa có xe hoặc khách trong danh mục? Bấm + để thêm ngay tại đây.',
    en: 'Vehicle or customer not in the catalogue? Use + to add it here.',
  },
  confirmArchiveTripTitle: { vi: 'Lưu trữ chuyến', en: 'Archive trip' },
  confirmArchiveTripBody: {
    vi: 'Lưu trữ chuyến này? Chuyến sẽ không còn hiện trong lịch, nhưng dữ liệu vẫn được giữ lại.',
    en: 'Archive this trip? It leaves the schedule, but the record is kept.',
  },

  // Trip status — the workbook's legend, kept as dispatch already says it.
  //
  // ⚠ NOT PARAPHRASED. Each monthly sheet carries this legend at the bottom and
  // dispatch reads it daily; a neater wording would be a second name for a
  // state everybody can already name. See `tripStatus.ts` for the colours,
  // which are carried over from the row fills for the same reason.
  //
  // `tripAwaitingVehicle` is the one abbreviation: the sheet writes `SX RỒI
  // ĐANG ĐỢI XE`, which does not fit a badge. The short form is what the page
  // spec pins, so it is the wording the screen is actually held to.
  tripAwaitingProduction: { vi: 'Đang đợi SX', en: 'Awaiting production' },
  tripAwaitingVehicle: { vi: 'SX rồi, đợi xe', en: 'Produced, awaiting vehicle' },
  tripNeedsConfirmation: { vi: 'Thông tin cần xác nhận lại', en: 'Needs confirmation' },
  tripExternalBooking: { vi: 'Book xe ngoài', en: 'External booking' },
  tripDone: { vi: 'Đã xong', en: 'Done' },
  changeStatus: { vi: 'Đổi trạng thái', en: 'Change status' },
  statusChangeFailed: {
    vi: 'Không đổi được trạng thái.',
    en: 'Could not change the status.',
  },

  // Catalogue — vehicles and customers, the two tabs of one screen
  vehicles: { vi: 'Xe', en: 'Vehicles' },
  customers: { vi: 'Khách hàng', en: 'Customers' },
  addVehicle: { vi: 'Thêm xe', en: 'Add vehicle' },
  addCustomer: { vi: 'Thêm khách hàng', en: 'Add customer' },
  // ★ SEPARATE FROM THE "ADD" TITLES, because the dialog is the same component
  // in both modes and a rename titled "Thêm xe" reads as though it will create
  // a second row — which is the exact mistake the catalogue exists to prevent.
  editVehicle: { vi: 'Sửa xe', en: 'Edit vehicle' },
  editCustomer: { vi: 'Sửa khách hàng', en: 'Edit customer' },
  plateLabel: { vi: 'Biển số *', en: 'Plate *' },
  platePlaceholder: { vi: '51C-123.45', en: '51C-123.45' },
  customerNameLabel: { vi: 'Tên khách hàng *', en: 'Customer name *' },
  customerNamePlaceholder: { vi: 'Nhập tên khách hàng', en: 'Enter the customer name' },
  noteOptional: { vi: 'Ghi chú (không bắt buộc)', en: 'Note (optional)' },
  showArchived: { vi: 'Hiện cả mục đã lưu trữ', en: 'Show archived' },
  statusArchived: { vi: 'Đã lưu trữ', en: 'Archived' },
  emptyVehicles: { vi: 'Chưa có xe nào.', en: 'No vehicles yet.' },
  emptyCustomers: { vi: 'Chưa có khách hàng nào.', en: 'No customers yet.' },
  // ★ SAYS WHAT ARCHIVING IS NOT. People read "lưu trữ" as a delete and worry
  // that last month's trips will lose the plate they were run under. They do
  // not: the row stops being OFFERED, and nothing already written changes.
  confirmArchiveVehicleBody: {
    vi: 'Lưu trữ xe này? Các chuyến đã chạy vẫn giữ nguyên biển số — xe chỉ không còn được chọn cho chuyến mới.',
    en: 'Archive this vehicle? Past trips keep the plate — it is only no longer offered for new trips.',
  },
  confirmArchiveCustomerBody: {
    vi: 'Lưu trữ khách hàng này? Các chuyến cũ vẫn giữ nguyên tên khách — khách chỉ không còn được chọn cho chuyến mới.',
    en: 'Archive this customer? Past trips keep the name — they are only no longer offered for new trips.',
  },
  // Trip cost — the CHI PHÍ block of the workbook, behind `cost.read`
  tripCost: { vi: 'Chi phí chuyến', en: 'Trip cost' },
  costOwnVehicle: { vi: 'Chi phí xe nhà', en: 'Own-vehicle cost' },
  costOutsource: { vi: 'Xe thuê ngoài', en: 'Outsourced hire' },
  // The five headings, exactly as the sheet writes them.
  costFuel: { vi: 'Dầu', en: 'Fuel' },
  costToll: { vi: 'Cầu trạm', en: 'Tolls' },
  costWarehouse: { vi: 'Phí kho', en: 'Warehouse' },
  costLoading: { vi: 'Bốc xếp', en: 'Loading' },
  costOvertime: { vi: 'Tăng ca', en: 'Overtime' },
  totalOwnVehicle: { vi: 'Tổng chi phí xe nhà', en: 'Own-vehicle total' },
  totalOutsource: { vi: 'Tổng xe thuê ngoài', en: 'Outsourced total' },
  totalTripCost: { vi: 'Tổng chi phí chuyến', en: 'Trip total' },
  addCost: { vi: 'Thêm chi phí', en: 'Add cost' },
  addHire: { vi: 'Thêm xe ngoài', en: 'Add hire' },
  colCategory: { vi: 'Khoản mục', en: 'Category' },
  colAmount: { vi: 'Số tiền (VND)', en: 'Amount (VND)' },
  colCarrier: { vi: 'Nhà xe', en: 'Carrier' },
  colDocumentRef: { vi: 'Chứng từ', en: 'Document' },
  fieldCategory: { vi: 'Khoản mục *', en: 'Category *' },
  fieldAmount: { vi: 'Số tiền (VND) *', en: 'Amount (VND) *' },
  fieldCarrier: { vi: 'Nhà xe *', en: 'Carrier *' },
  fieldAgreedAmount: { vi: 'Giá thỏa thuận (VND) *', en: 'Agreed price (VND) *' },
  fieldDocumentRef: { vi: 'Số chứng từ', en: 'Document reference' },
  vatIncluded: { vi: 'Đã bao gồm VAT', en: 'VAT included' },
  vatIncludedShort: { vi: 'Có VAT', en: 'incl. VAT' },
  // ★ SAYS WHAT VOID IS NOT. A withdrawn line is not deleted — it stays on
  // the record with a reason, and only stops counting.
  voidRecord: { vi: 'Hủy khoản', en: 'Void' },
  voidReason: { vi: 'Lý do hủy *', en: 'Reason for voiding *' },
  confirmVoidBody: {
    vi: 'Hủy khoản này? Bản ghi vẫn được giữ lại kèm lý do — chỉ là không còn tính vào tổng.',
    en: 'Void this record? It is kept, with the reason — it simply stops counting.',
  },
  statusVoided: { vi: 'Đã hủy', en: 'Voided' },
  showVoided: { vi: 'Hiện cả khoản đã hủy', en: 'Show voided' },
  emptyCosts: { vi: 'Chưa có chi phí xe nhà.', en: 'No own-vehicle cost yet.' },
  emptyHires: { vi: 'Chưa có xe thuê ngoài.', en: 'No outsourced hire yet.' },
  amountHint: {
    vi: 'Nhập số tiền, tối đa 2 số lẻ. Ví dụ: 1500000',
    en: 'A positive amount, at most 2 decimals. e.g. 1500000',
  },
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
