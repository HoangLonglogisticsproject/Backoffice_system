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
  // ------------------------------------- Driver expense declaration (P0 fix) --
  driverLineCount: { vi: 'khoản', en: 'items' },
  driverExpenseOpen: { vi: 'Còn sửa được', en: 'Still editable' },
  driverResubmit: { vi: 'Gửi lại', en: 'Send again' },
  driverReviewExpenses: { vi: 'Xem lại chi phí đã khai', en: 'Review the figures' },
  driverConfirmAnyway: { vi: 'Vẫn chọn không phát sinh', en: 'Keep "no expenses"' },
  // ★ Hỏi lại trước khi gửi một trạng thái server chắc chắn từ chối.
  driverDeclareConflict: {
    vi: 'Chuyến này đang có chi phí đã khai. Bạn chắc chắn là không phát sinh?',
    en: 'This trip already has declared expenses. Are you sure there were none?',
  },
  // ★ Gợi ý theo nhóm — khác biệt duy nhất giữa 5 nhóm, vì schema cho cả năm
  // cùng một hình dạng (nhóm · số tiền · ghi chú).
  driverHintFuel: { vi: 'Đổ ở đâu, bao nhiêu lít', en: 'Where, how many litres' },
  driverHintToll: { vi: 'Trạm nào', en: 'Which toll station' },
  driverHintWarehouse: { vi: 'Kho nào', en: 'Which warehouse' },
  driverHintLoading: { vi: 'Bốc hay xếp, mấy người', en: 'Loading or unloading, how many' },
  driverHintOvertime: { vi: 'Tăng ca vì lý do gì', en: 'Why the overtime' },
  // ------------------------------------------- Completion review (backoffice) --
  reviewNav: { vi: 'Duyệt hoàn tất', en: 'Completion review' },
  reviewTitle: { vi: 'Duyệt hoàn tất chuyến', en: 'Completion review' },
  reviewQueueEmpty: { vi: 'Không có chuyến nào chờ duyệt', en: 'Nothing waiting for review' },
  reviewOpen: { vi: 'Xem hồ sơ', en: 'Inspect' },
  reviewClose: { vi: 'Đóng', en: 'Close' },
  reviewApprove: { vi: 'Duyệt lượt xe này', en: 'Approve this assignment' },
  reviewReject: { vi: 'Từ chối', en: 'Send back' },
  reviewRejectReasonLabel: {
    vi: 'Lý do từ chối (bắt buộc — tài xế sẽ đọc)',
    en: 'Reason (required — the driver reads this)',
  },
  reviewRejectPlaceholder: { vi: 'Ví dụ: Số tiền dầu sai', en: 'For example: the fuel figure is wrong' },
  reviewReasonRequired: { vi: 'Phải nhập lý do', en: 'A reason is required' },
  // ★ APPROVAL IS IRREVERSIBLE. The wording says so before the click, because
  // there is no screen after it that can undo anything.
  //
  // ★ AND IT IS SCOPED TO THE ASSIGNMENT (ADR-0004). Approving finalises the
  // figures on the assignment being reviewed — not every figure on the trip,
  // and it does not close the trip: that happens only once every active
  // assignment has been approved. Promising trip closure here would be a
  // promise the button cannot keep while another lorry is still running.
  reviewApproveWarning: {
    vi: 'Duyệt sẽ khoá vĩnh viễn chi phí của lượt xe này. Không thể mở lại. Chuyến chỉ đóng khi mọi lượt xe đang chạy đều được duyệt.',
    en: 'Approving permanently freezes the figures on this assignment. It cannot be undone. The trip closes only once every active assignment is approved.',
  },
  reviewTimeline: { vi: 'Tiến trình tài xế báo', en: 'What the driver reported' },
  reviewRecordedAt: { vi: 'Máy chủ ghi', en: 'Server recorded' },
  reviewDeviceTime: { vi: 'Đồng hồ thiết bị (tham khảo)', en: 'Device clock (diagnostic)' },
  reviewNotReported: { vi: 'Chưa báo', en: 'Not reported' },
  reviewExecutionIncomplete: { vi: 'Chưa hoàn thành tiến trình', en: 'Execution not complete' },
  reviewExecutionIncompleteHint: {
    vi: 'Lượt này chưa có đủ bốn mốc (đến điểm lấy, đã lấy hàng, đến điểm giao, đã giao hàng). Chưa duyệt được; có thể từ chối kèm lý do để tài xế báo lại.',
    en: 'This turn does not have all four milestones (arrived at pickup, picked up, arrived at delivery, delivered). It cannot be approved yet; reject it with a reason so the driver reports them.',
  },
  reviewErrExecutionIncomplete: {
    vi: 'Lượt này không còn đủ bốn mốc nên chưa duyệt được. Hãy xem lại tiến trình.',
    en: 'This turn no longer has all four milestones, so it cannot be approved. Check its progress.',
  },
  reviewVoided: { vi: 'Đã thu hồi', en: 'Withdrawn' },
  // ★ THE SERVER'S GEOFENCE VERDICT, SHOWN. Four readings of one event, and
  // none of them is computed here: `geofencePassed` and `distanceM` arrive
  // decided. Absent evidence is said to be absent — never called a failure.
  reviewLocationCheck: { vi: 'Xác minh vị trí', en: 'Location verification' },
  reviewLocationVerified: { vi: 'Đã xác minh', en: 'Verified' },
  reviewLocationNotVerified: { vi: 'Không xác minh được', en: 'Not verified' },
  reviewLocationNoEvidence: { vi: 'Không có dữ liệu xác minh vị trí', en: 'No location evidence' },
  reviewLocationNoVerdict: {
    vi: 'Có vị trí thiết bị, chưa có kết luận xác minh',
    en: 'Device position recorded, no verification verdict',
  },
  reviewDistance: { vi: 'Khoảng cách tới điểm', en: 'Distance from the point' },
  reviewGpsAccuracy: { vi: 'Độ chính xác GPS', en: 'GPS accuracy' },
  reviewExpenses: { vi: 'Chi phí tài xế khai', en: 'Expenses the driver declared' },
  reviewNoExpense: { vi: 'Không có khoản nào', en: 'None' },
  reviewExpensesHidden: {
    vi: 'Bạn không có quyền xem số tiền',
    en: 'You may not see the figures',
  },
  reviewDeclaration: { vi: 'Tài xế khai báo', en: 'Driver declared' },
  reviewAttempts: { vi: 'Số lần gửi', en: 'Attempts' },
  reviewSubmittedAt: { vi: 'Gửi lúc', en: 'Submitted' },
  reviewDecidedAt: { vi: 'Quyết định lúc', en: 'Decided' },
  // ★ Per assignment, never "trip completed": the trip closes only when every
  // active assignment is approved (ADR-0004).
  reviewAssignmentApproved: { vi: 'Lượt xe này đã được duyệt', en: 'This assignment is approved' },
  reviewAssignmentApprovedHint: {
    vi: 'Chi phí của lượt xe này là cuối cùng. Chuyến chỉ đóng khi mọi lượt xe đang chạy đều được duyệt.',
    en: 'Its figures are final. The trip closes only once every active assignment is approved.',
  },
  reviewNothingPending: {
    vi: 'Chuyến này không có yêu cầu nào đang chờ duyệt',
    en: 'This trip has no request waiting for a decision',
  },
  reviewStage: { vi: 'Trạng thái', en: 'Stage' },
  reviewDriver: { vi: 'Tài xế', en: 'Driver' },
  reviewDelayPickup: { vi: 'Trễ lấy hàng', en: 'Pickup late by' },
  reviewDelayDelivery: { vi: 'Trễ giao hàng', en: 'Delivery late by' },
  // Shown in place of a dispatch screen to a caller without `trip.read` — a
  // member or head of a unit that is not sales, accounting or dispatch.
  tripNoPermission: {
    vi: 'Tài khoản của bạn không thuộc phòng có quyền xem lịch xe.',
    en: 'Your account is not in a department that may see the trip schedule.',
  },
  reviewNoPermission: {
    vi: 'Bạn không có quyền duyệt hoàn tất chuyến',
    en: 'You may not decide completions',
  },

  stageNO_DRIVER: { vi: 'Chưa có tài xế', en: 'No driver' },
  stageDRIVER_ASSIGNED: { vi: 'Đã gán tài xế', en: 'Driver assigned' },
  stageWAITING_PICKUP: { vi: 'Chờ đến điểm lấy', en: 'Waiting for pickup' },
  stagePICKUP_DELAYED: { vi: 'Trễ điểm lấy', en: 'Pickup delayed' },
  stageAT_PICKUP: { vi: 'Đang ở điểm lấy', en: 'At pickup' },
  stageIN_TRANSIT: { vi: 'Đang vận chuyển', en: 'In transit' },
  stageDELIVERY_DELAYED: { vi: 'Trễ điểm giao', en: 'Delivery delayed' },
  stageAT_DELIVERY: { vi: 'Đang ở điểm giao', en: 'At delivery' },
  stageAWAITING_COMPLETION: { vi: 'Chờ tài xế gửi hoàn tất', en: 'Awaiting completion' },
  stageCOMPLETION_PENDING: { vi: 'Chờ duyệt', en: 'Waiting for review' },
  stageCOMPLETION_REJECTED: { vi: 'Đã từ chối', en: 'Sent back' },
  stageDONE: { vi: 'Đã hoàn tất', en: 'Completed' },

  reviewErrConflict: {
    vi: 'Yêu cầu này vừa được xử lý ở nơi khác. Màn hình đã cập nhật.',
    en: 'This request was just decided elsewhere. The screen has been refreshed.',
  },
  reviewErrForbidden: {
    vi: 'Bạn không có quyền thực hiện thao tác này.',
    en: 'You are not allowed to do that.',
  },
  reviewErrNetwork: {
    vi: 'Không kết nối được máy chủ. Thử lại.',
    en: 'Could not reach the server. Try again.',
  },
  reviewErrValidation: { vi: 'Dữ liệu chưa hợp lệ.', en: 'That is not valid.' },
  reviewErrUnknown: { vi: 'Có lỗi xảy ra. Thử lại.', en: 'Something went wrong. Try again.' },
  // ------------------------------------------------------------ Driver Portal --
  //
  // ★ WRITTEN FOR SOMEBODY STANDING BESIDE A LORRY. Short, concrete, and about
  // what to do next rather than about what the system is. Nothing here names a
  // status code, a table or a state machine.
  // A proper name: the same in every language.
  companyName: { vi: 'Hoàng Long', en: 'Hoàng Long' },
  driverPortal: { vi: 'Cổng tài xế', en: 'Driver Portal' },
  driverSchedule: { vi: 'Lịch làm việc', en: 'Work schedule' },
  // ★ "ĐÃ CHẠY XONG", NOT "LỊCH SỬ CHUYẾN". What belongs here is defined by the
  // TRIP having finished, and the label says exactly that — a driver swapped
  // off a trip that later finished still finds it, and one still on the road
  // does not.
  driverHistory: { vi: 'Đã chạy xong', en: 'Completed' },
  driverHistoryHint: {
    vi: 'Các chuyến đã hoàn thành, mới nhất trước.',
    en: 'Trips that have been completed, newest first.',
  },
  driverHistoryEmpty: {
    vi: 'Chưa có chuyến nào hoàn thành.',
    en: 'No completed trips yet.',
  },
  driverHistoryMore: { vi: 'Xem thêm', en: 'Show more' },
  // Said out loud: a list that simply stops looks like one that failed to load
  // the rest.
  driverHistoryEnd: { vi: 'Đã hết.', en: 'That is everything.' },
  // ★ THE SCHEDULE IS SPLIT BY THE TRIP'S DAY, NOT BY A STATUS: the list the
  // server sends carries no execution state, so "done" is not something it can
  // say. This third tab is EVERY assignment whose day has gone by — including
  // one still waiting for the office to approve it.
  //
  // ⚠ ITS NAME PROMISES MORE THAN IT HOLDS, AND THAT IS A KNOWN TRADE. "Chuyến
  // đã chạy" reads as a verdict, which the tab cannot give; it was chosen over
  // "Đã qua" because a driver reads it as "trips I have driven" and that is
  // what they are looking for. THE SCREEN BENEATH IT STILL SAYS NOTHING ABOUT
  // COMPLETION — `DriverWorkflow.spec` holds that line.
  //
  // ⚠ NOT THE SAME LIST AS `driverHistory` ("Đã chạy xong", `/driver/history`),
  // which asks the server for trips that really are `finished`. They do not
  // overlap: a finished trip is nobody's work any more, so the schedule does
  // not list it (2026-09-29) — this tab is past days still OPEN, run and
  // waiting on the office; "Đã chạy xong" holds the finished ones.
  driverViewToday: { vi: 'Hôm nay', en: 'Today' },
  driverViewUpcoming: { vi: 'Sắp tới', en: 'Upcoming' },
  driverViewPast: { vi: 'Chuyến đã chạy', en: 'Trips driven' },
  // The three sections of "Lịch làm việc" (0035): the driver's work, and where they ask for more.
  driverSectionMine: { vi: 'Chuyến của tôi', en: 'My trips' },
  driverDaysLabel: { vi: 'Chuyến theo ngày', en: 'Trips by day' },
  driverSectionOpen: { vi: 'Booking đang mở', en: 'Open bookings' },
  driverSectionRequests: { vi: 'Yêu cầu của tôi', en: 'My requests' },
  openBookingIntro: {
    vi: 'Booking chưa có tài xế. Bấm “Xin nhận chuyến” — Điều độ sẽ duyệt và chọn xe cho bạn.',
    en: 'Bookings nobody is on yet. Tap “Ask for this trip” — Dispatch approves and picks your lorry.',
  },
  openBookingEmpty: { vi: 'Hiện chưa có booking nào đang mở.', en: 'No open bookings right now.' },
  openBookingAsk: { vi: 'Xin nhận chuyến', en: 'Ask for this trip' },
  openBookingAsking: { vi: 'Đang gửi…', en: 'Sending…' },
  openBookingCargo: { vi: 'Hàng', en: 'Cargo' },
  openBookingNote: { vi: 'Lưu ý', en: 'Note' },
  requestEmpty: { vi: 'Bạn chưa gửi yêu cầu nhận chuyến nào.', en: 'You have not asked for any trip yet.' },
  requestSentAt: { vi: 'Gửi lúc', en: 'Sent' },
  requestWithdraw: { vi: 'Rút yêu cầu', en: 'Withdraw request' },
  requestStatePending: { vi: 'Đang chờ duyệt', en: 'Waiting for approval' },
  requestStateApproved: { vi: 'Đã được nhận', en: 'Approved — it is yours' },
  requestStateRejected: { vi: 'Bị từ chối', en: 'Declined' },
  requestStateWithdrawn: { vi: 'Đã rút', en: 'Withdrawn' },
  requestStateTakenByOther: { vi: 'Đã có tài xế khác nhận', en: 'Another driver got it' },
  requestStateClosed: { vi: 'Booking đã đóng', en: 'Booking closed' },
  // Dispatch's side of an ask (0035): review in "Phương tiện điều độ".
  requestsPill: { vi: 'tài xế xin nhận', en: 'drivers asking' },
  requestReviewTitle: { vi: 'Tài xế xin nhận', en: 'Drivers asking for this trip' },
  requestReviewNonePending: { vi: 'Không còn yêu cầu nào đang chờ.', en: 'No request is waiting.' },
  requestReviewCrewed: {
    vi: 'Chuyến đã có xe — giai đoạn này chỉ duyệt yêu cầu khi chuyến chưa có ai.',
    en: 'This trip already has a lorry — for now, requests are approved only on an uncrewed trip.',
  },
  requestReviewHistory: { vi: 'Đã xử lý', en: 'Decided' },
  requestReviewApproved: { vi: 'Đã duyệt', en: 'Approved' },
  requestAskedAt: { vi: 'xin lúc', en: 'asked' },
  requestApprove: { vi: 'Duyệt…', en: 'Approve…' },
  requestApproveConfirm: { vi: 'Duyệt & giao chuyến', en: 'Approve & assign' },
  requestReject: { vi: 'Từ chối…', en: 'Decline…' },
  requestRejectConfirm: { vi: 'Từ chối', en: 'Decline' },
  requestRejectReason: { vi: 'Lý do (không bắt buộc)', en: 'Reason (optional)' },
  requestReviewConflict: {
    vi: 'Yêu cầu này vừa được xử lý hoặc booking đã có xe. Danh sách đã được cập nhật.',
    en: 'This request was just decided, or the booking already has a lorry. The list is up to date.',
  },
  /**
   * ★ A HEADLINE AND A LINE, NOT ONE SENTENCE TWICE. The title names WHAT is
   * empty; the line under it says which emptiness this is. The three lines
   * below are unchanged — a driver has read them for months and the tests pin
   * them word for word.
   */
  driverEmptyTitle: { vi: 'Chưa có chuyến nào', en: 'No trips yet' },
  driverEmptyToday: { vi: 'Bạn chưa có chuyến nào hôm nay.', en: 'You have no trips today.' },
  driverEmptyUpcoming: { vi: 'Chưa có lịch sắp tới.', en: 'Nothing is scheduled yet.' },
  driverEmptyPast: { vi: 'Chưa có chuyến nào đã qua.', en: 'No earlier trips.' },
  /** The one useful step out of an empty day: look at tomorrow. */
  driverEmptySeeUpcoming: { vi: 'Xem chuyến sắp tới', en: 'See upcoming trips' },
  /** And out of an empty week: ask for work (0035). */
  driverEmptySeeOpen: { vi: 'Xem booking đang mở', en: 'See open bookings' },
  openBookingEmptyTitle: { vi: 'Chưa có booking nào', en: 'No open bookings' },
  requestEmptyTitle: { vi: 'Chưa có yêu cầu nào', en: 'No requests yet' },
  driverViewTrip: { vi: 'Xem chuyến', en: 'View trip' },
  driverNoPickupTime: { vi: 'Chưa có giờ lấy hàng', en: 'No pickup time yet' },
  driverTripDetail: { vi: 'Chi tiết chuyến', en: 'Trip details' },
  driverPlannedPickup: { vi: 'Dự kiến lấy hàng', en: 'Planned pickup' },
  driverBack: { vi: 'Quay lại', en: 'Back' },
  driverBackToTrips: { vi: 'Về lịch làm việc', en: 'Back to schedule' },
  driverRetry: { vi: 'Thử lại', en: 'Try again' },
  driverLoading: { vi: 'Đang tải…', en: 'Loading…' },
  // Where ONE assignment stands, read from its own events and completion —
  // never the dispatch board's status, which is the office's word (DL-69).
  driverStatusAssigned: { vi: 'Đã phân công', en: 'Assigned' },
  driverStatusAtPickup: { vi: 'Đang ở điểm lấy hàng', en: 'At pickup' },
  driverStatusInTransit: { vi: 'Đang vận chuyển', en: 'In transit' },
  driverStatusAtDelivery: { vi: 'Đang ở điểm giao hàng', en: 'At delivery' },
  driverStatusAwaitingCompletion: { vi: 'Chờ gửi hoàn tất', en: 'Ready to submit' },
  driverStatusCompletionPending: { vi: 'Chờ duyệt', en: 'Waiting for review' },
  driverStatusCompletionRejected: { vi: 'Bị trả lại', en: 'Sent back' },
  driverStatusApproved: { vi: 'Đã duyệt', en: 'Approved' },
  // The words of the history tab itself ("Đã chạy xong"): the same fact.
  driverStatusClosed: { vi: 'Đã chạy xong', en: 'Completed' },
  driverClosedTitle: { vi: 'Chuyến đã chạy xong', en: 'This trip is completed' },
  driverClosedHint: {
    vi: 'Đây là bản ghi để xem lại — không còn thao tác nào cần làm.',
    en: 'This is a record to look back on — nothing is left to do.',
  },

  driverVehicle: { vi: 'Xe', en: 'Vehicle' },
  driverCustomer: { vi: 'Khách hàng', en: 'Customer' },
  driverPickup: { vi: 'Điểm lấy hàng', en: 'Pickup' },
  driverDelivery: { vi: 'Điểm giao hàng', en: 'Delivery' },
  driverCargo: { vi: 'Hàng hoá', en: 'Cargo' },
  driverContact: { vi: 'Liên hệ', en: 'Contact' },
  driverInstructions: { vi: 'Chỉ dẫn cho tài xế', en: 'Instructions' },
  driverScheduled: { vi: 'Dự kiến', en: 'Scheduled' },
  driverActual: { vi: 'Thực tế', en: 'Actual' },
  driverNotSet: { vi: 'Chưa có', en: 'Not set' },

  driverProgress: { vi: 'Tiến trình chuyến', en: 'Trip progress' },
  // The four stages a driver walks through — the stepper and the header pill.
  driverStagePickup: { vi: 'Lấy hàng', en: 'Pickup' },
  driverStageDelivery: { vi: 'Giao hàng', en: 'Delivery' },
  driverStageExpense: { vi: 'Chi phí', en: 'Expenses' },
  driverStageCompletion: { vi: 'Hoàn thành', en: 'Completion' },
  // The end of the trip where the next tap is — not a status, which the
  // summary above already states.
  driverStageCurrent: { vi: 'Việc tiếp theo', en: 'Next up' },
  driverTripSummary: { vi: 'Thông tin chuyến', en: 'Trip information' },
  driverAddress: { vi: 'Địa chỉ', en: 'Address' },
  driverActualPickup: { vi: 'Lấy hàng lúc', en: 'Picked up at' },
  driverActualDelivery: { vi: 'Giao hàng lúc', en: 'Delivered at' },
  driverExpenseNone: { vi: 'Không có khoản chi', en: 'No expenses' },
  driverStepArrivedPickup: { vi: 'Đến điểm lấy hàng', en: 'Arrived at pickup' },
  driverStepPickupConfirmed: { vi: 'Xác nhận lấy hàng', en: 'Pickup confirmed' },
  driverStepArrivedDelivery: { vi: 'Đến điểm giao hàng', en: 'Arrived at delivery' },
  driverStepDeliveryConfirmed: { vi: 'Xác nhận giao hàng', en: 'Delivery confirmed' },
  driverActionArrivedPickup: { vi: 'Tôi đã đến điểm lấy hàng', en: 'I have arrived at pickup' },
  driverActionPickupConfirmed: { vi: 'Đã lấy hàng xong', en: 'Pickup is done' },
  driverActionArrivedDelivery: { vi: 'Tôi đã đến điểm giao hàng', en: 'I have arrived at delivery' },
  driverActionDeliveryConfirmed: { vi: 'Đã giao hàng xong', en: 'Delivery is done' },
  driverStepWaiting: { vi: 'Chưa đến', en: 'Not yet' },
  driverStepDone: { vi: 'Đã xong', en: 'Done' },
  // ★ A FACT, NOT A VERDICT. No threshold decides this — the planned time has
  // simply passed and the step has not been reported.
  driverOverdue: { vi: 'Đã quá giờ dự kiến', en: 'Past the planned time' },
  driverLateBy: { vi: 'Trễ', en: 'Late by' },
  driverMinutes: { vi: 'phút', en: 'min' },
  driverAllStepsDone: { vi: 'Đã hoàn tất các bước vận chuyển', en: 'All journey steps reported' },

  // ------------------------------------------------ pickup location check --
  driverLocating: { vi: 'Đang xác định vị trí…', en: 'Finding your location…' },
  // Said BEFORE the tap, so the permission prompt is not a surprise.
  // Said at both ends: the pickup confirmation and the delivery confirmation.
  driverPickupNeedsLocation: {
    vi: 'Xác nhận dùng vị trí GPS của điện thoại. Hãy đứng gần điểm lấy/giao hàng.',
    en: 'Confirming uses your phone’s location. Stand near the pickup or delivery point.',
  },
  // ★ NOT THE DRIVER'S TO FIX. The office has not entered the point yet.
  driverPickupNoCoordinates: {
    vi: 'Điểm này chưa có toạ độ. Liên hệ điều độ để bổ sung trước khi xác nhận.',
    en: 'This point has no coordinates yet. Ask the office to add them before confirming.',
  },
  driverErrLocationUnsupported: {
    vi: 'Điện thoại này không hỗ trợ định vị. Dùng điện thoại khác hoặc báo văn phòng.',
    en: 'This phone cannot provide a location. Use another phone or tell the office.',
  },
  driverErrLocationDenied: {
    vi: 'Chưa cho phép truy cập vị trí. Bật quyền vị trí cho trình duyệt rồi thử lại.',
    en: 'Location access was denied. Allow location for this browser and try again.',
  },
  driverErrLocationUnavailable: {
    vi: 'Không lấy được vị trí. Ra chỗ thoáng, bật GPS rồi thử lại.',
    en: 'Could not get a location. Move to open sky, turn GPS on and try again.',
  },
  driverErrLocationTimeout: {
    vi: 'Lấy vị trí quá lâu. Thử lại; nếu vẫn không được hãy báo văn phòng.',
    en: 'Getting a location took too long. Try again, and tell the office if it keeps failing.',
  },
  driverErrLocationRequired: {
    vi: 'Cần vị trí để xác nhận lấy hàng. Thử lại.',
    en: 'A location is needed to confirm pickup. Try again.',
  },
  driverErrDestinationMissing: {
    vi: 'Điểm này chưa có toạ độ nên chưa xác nhận được. Liên hệ điều độ.',
    en: 'This point has no coordinates yet, so it cannot be confirmed. Contact the office.',
  },
  driverErrLocationInvalid: {
    vi: 'Vị trí nhận được không hợp lệ. Thử lại.',
    en: 'The location received is not valid. Try again.',
  },
  driverErrLocationAccuracy: {
    vi: 'Tín hiệu GPS chưa đủ chính xác. Ra chỗ thoáng rồi thử lại.',
    en: 'The GPS signal is not precise enough. Move to open sky and try again.',
  },
  driverErrLocationStale: {
    vi: 'Vị trí đã cũ. Thử lại để lấy vị trí mới.',
    en: 'That location is too old. Try again to get a fresh one.',
  },
  // ⚠ No distance and no radius: what to do, not what the rule is.
  driverErrOutsideGeofence: {
    vi: 'Bạn chưa ở đúng điểm lấy/giao hàng. Đến đúng điểm rồi thử lại; nếu đã đúng chỗ, báo văn phòng.',
    en: 'You are not at the pickup or delivery point. Go to it and try again; if you are there, tell the office.',
  },

  // ------------------------------------------------------- notifications --
  driverNotifications: { vi: 'Thông báo', en: 'Notifications' },
  driverProfile: { vi: 'Hồ sơ', en: 'Profile' },
  driverUnread: { vi: 'chưa đọc', en: 'unread' },
  driverNoNotifications: { vi: 'Chưa có thông báo nào.', en: 'No notifications yet.' },
  driverTripOn: { vi: 'Chuyến ngày', en: 'Trip on' },
  notifReason: { vi: 'Lý do', en: 'Reason' },
  notifTripAssigned: { vi: 'Bạn được phân công chuyến', en: 'You have been assigned a trip' },
  notifTripUnassigned: {
    vi: 'Chuyến đã được điều chỉnh phân công — bạn không còn lái chuyến này',
    en: 'This trip’s assignment changed — you are no longer driving it',
  },
  notifCompletionRejected: {
    vi: 'Yêu cầu hoàn tất bị trả lại — cần sửa và gửi lại',
    en: 'Completion request sent back — correct it and send again',
  },
  notifCompletionApproved: { vi: 'Chuyến đã được duyệt hoàn tất', en: 'Trip completion approved' },
  notifRequestRejected: { vi: 'Yêu cầu nhận chuyến bị từ chối', en: 'Your request for a trip was declined' },
  notifRequestSuperseded: { vi: 'Booking bạn xin nhận không còn mở', en: 'A booking you asked for is no longer open' },
  /**
   * ★ READ IN THE BACKOFFICE, NOT IN THE PORTAL (0036) — the bell's label and
   * the one sentence the reviewer sees. Worded as the WORK, not as the event:
   * what a reviewer needs from a bell is what to do next.
   */
  notifCompletionSubmitted: {
    vi: 'Tài xế đã gửi hoàn tất chuyến — chờ duyệt',
    en: 'A driver has sent a trip for completion — waiting for your decision',
  },
  /** The bell's panel: what it is, and the way out of it. */
  notifPanelTitle: { vi: 'Thông báo', en: 'Notifications' },
  notifPanelSeeQueue: { vi: 'Mở hàng đợi duyệt', en: 'Open the review queue' },
  /**
   * ★ WHAT A DEEP LINK FINDS, OR DOES NOT. Both are real outcomes of opening a
   * notification minutes after it arrived, and both have to be said rather than
   * shown as an empty screen.
   */
  reviewTripAlreadyDecided: {
    vi: 'Chuyến này đã được xử lý — không còn trong hàng đợi.',
    en: 'This trip has already been decided — it is no longer in the queue.',
  },
  reviewPickWhichLorry: {
    vi: 'Chuyến này có nhiều lượt xe đang chờ duyệt. Chọn đúng xe bên dưới.',
    en: 'This trip has more than one lorry waiting. Pick the right one below.',
  },

  // ---------------------------------------------- driver assignment (board) --
  colDriver: { vi: 'Tài xế', en: 'Driver' },
  driverUnassigned: { vi: 'Chưa phân công', en: 'Not assigned' },
  assignDriver: { vi: 'Phân công', en: 'Assign' },
  changeDriver: { vi: 'Đổi tài xế', en: 'Change driver' },
  assignDriverTitle: { vi: 'Phân công tài xế', en: 'Assign driver' },
  currentDriver: { vi: 'Tài xế hiện tại', en: 'Current driver' },
  selectDriver: { vi: 'Chọn tài xế', en: 'Choose a driver' },
  // ★ Multi-vehicle dispatch (ADR-0004): a trip carries any number of lorries,
  // each with its own driver. The panel, its rows and its counts.
  dispatchTitle: { vi: 'Phương tiện điều độ', en: 'Dispatched vehicles' },
  dispatchEmpty: { vi: 'Chưa điều độ xe nào cho chuyến này.', en: 'No vehicle dispatched on this trip yet.' },
  dispatchAdd: { vi: 'Thêm phương tiện', en: 'Add vehicle' },
  dispatchSelectVehicle: { vi: 'Chọn xe', en: 'Choose a vehicle' },
  dispatchRemove: { vi: 'Gỡ', en: 'Remove' },
  // ★ THE CREW TYPED ON THE "THÊM CHUYẾN" FORM. Scoped to a ROW, because that
  // is where the mistake is and where the reader is looking.
  crewIncomplete: {
    vi: 'Chọn cả xe và tài xế cho dòng này.',
    en: 'Choose both a vehicle and a driver for this row.',
  },
  crewDuplicateVehicle: {
    vi: 'Xe này đã có ở một dòng khác.',
    en: 'This vehicle is already on another row.',
  },
  // ★ SAYS THE TRIP EXISTS, because it does — and pressing save again sends
  // only the rows still listed, never a second trip.
  crewPartlyAssigned: {
    vi: 'Đã tạo chuyến, nhưng còn phương tiện chưa gán được. Sửa các dòng bên dưới rồi lưu lại, hoặc hoàn tất trong Điều độ.',
    en: 'The trip was created, but some vehicles could not be dispatched. Fix the rows below and save again, or finish in the dispatch panel.',
  },
  dispatchEndReason: { vi: 'Lý do gỡ', en: 'Reason for removal' },
  dispatchStarted: { vi: 'Đang thực hiện', en: 'In progress' },
  dispatchHistory: { vi: 'Lịch sử điều độ', en: 'Dispatch history' },
  dispatchHistoryFailed: { vi: 'Không tải được lịch sử điều độ.', en: 'Could not load the dispatch history.' },
  dispatchMissingVehicle: { vi: 'Thiếu xe (dữ liệu cũ)', en: 'No vehicle (legacy row)' },
  dispatchLegacyVehicle: {
    vi: 'Chuyến này có xe dự kiến từ dữ liệu cũ nhưng chưa có cặp xe + tài xế. Hãy điều độ lại.',
    en: 'This trip carries a planned vehicle from legacy data but no vehicle + driver pair. Dispatch it again.',
  },
  dispatchVehicleUnit: { vi: 'xe', en: 'vehicles' },
  dispatchDriverUnit: { vi: 'tài xế', en: 'drivers' },
  dispatchManage: { vi: 'Điều độ', en: 'Dispatch' },
  assignmentAssigned: { vi: 'Đã phân công', en: 'Assigned' },
  dispatchLegacyBadge: { vi: 'Xe dự kiến (dữ liệu cũ)', en: 'Planned vehicle (legacy)' },
  assignReason: { vi: 'Lý do thay đổi', en: 'Reason for the change' },
  noEligibleDrivers: {
    vi: 'Chưa có tài khoản tài xế nào đang hoạt động để phân công.',
    en: 'There is no active driver account to assign.',
  },
  // ★ A 409 IS THE BOARD MOVING. The list has already been re-read.
  assignConflict: {
    vi: 'Phân công vừa thay đổi ở nơi khác hoặc chuyến đã đóng. Danh sách đã được cập nhật — kiểm tra lại.',
    en: 'The assignment just changed elsewhere or the trip is closed. The board has been refreshed — check again.',
  },

  driverExpenses: { vi: 'Chi phí tôi đã khai', en: 'Expenses I declared' },
  driverAddExpense: { vi: 'Thêm khoản chi', en: 'Add an expense' },
  driverNoExpenseYet: { vi: 'Chưa khai khoản chi nào', en: 'No expenses declared yet' },
  driverAmount: { vi: 'Số tiền', en: 'Amount' },
  driverCategory: { vi: 'Loại chi phí', en: 'Category' },
  driverNote: { vi: 'Ghi chú', en: 'Note' },
  driverSave: { vi: 'Lưu', en: 'Save' },
  driverCancel: { vi: 'Huỷ', en: 'Cancel' },
  driverEdit: { vi: 'Sửa', en: 'Edit' },
  driverExpenseLocked: { vi: 'Đang chờ duyệt — chưa sửa được', en: 'Under review — locked' },
  driverExpenseFinal: { vi: 'Đã duyệt — không sửa được', en: 'Approved — final' },
  // A trip that finished without this turn's approval: not "under review".
  driverExpenseClosed: { vi: 'Đã đóng', en: 'Closed' },
  driverExpenseClosedHint: {
    vi: 'Chuyến đã kết thúc — không khai thêm được',
    en: 'The trip is closed — nothing more can be declared',
  },
  driverExpenseRejected: { vi: 'Bị từ chối — cần sửa', en: 'Sent back — needs correction' },
  // The lifecycle in one word each, for the pill: editable → sent → sent back → approved.
  driverExpenseSent: { vi: 'Đã gửi', en: 'Sent' },
  driverExpenseSentBack: { vi: 'Đã từ chối', en: 'Sent back' },
  driverExpenseApproved: { vi: 'Đã duyệt', en: 'Approved' },
  driverNeedVehicleFirst: {
    vi: 'Chuyến chưa có xe nên chưa khai chi phí được',
    en: 'This trip has no vehicle yet, so expenses cannot be declared',
  },
  driverAmountHint: { vi: 'Ví dụ: 1,500,000', en: 'For example: 1,500,000' },
  driverErrBookingNotOpen: {
    vi: 'Booking này không còn mở — đã có người nhận hoặc đã đóng.',
    en: 'This booking is no longer open — someone got it, or it was closed.',
  },
  driverErrRequestResolved: {
    vi: 'Yêu cầu này đã được xử lý. Danh sách đã được cập nhật.',
    en: 'This request has already been decided. The list is up to date.',
  },
  driverErrExecutionIncomplete: {
    vi: 'Cần báo đủ các bước lấy hàng và giao hàng trước khi gửi hoàn tất chuyến.',
    en: 'Report every pickup and delivery step before you submit the trip for completion.',
  },
  driverErrFuelOnVehicle: {
    vi: 'Nhiên liệu của xe này khai trên xe — khai đầu ca hoặc "Ghi nhận đổ nhiên liệu" — không khai vào chi phí chuyến.',
    en: 'This lorry’s fuel is recorded on the lorry — at the start of the shift or as "Record a fill" — not as a trip expense.',
  },

  // The lorry's beginning-of-shift fuel check — asked before the day's first
  // milestone. ★ "ĐẦU CA", NEVER "HÔM NAY": a fill later the same day is
  // recorded on its own ("Ghi nhận đổ nhiên liệu") and leaves this answer true.
  driverFuelTitle: { vi: 'Khai nhiên liệu đầu ca', en: 'Start-of-shift fuel check' },
  driverFuelIntro: {
    vi: 'Xe này cần khai nhiên liệu một lần mỗi ngày, đầu ca, trước chuyến đầu tiên.',
    en: 'This lorry needs its fuel declared once a day, at the start of the shift, before its first run.',
  },
  driverFuelVehicle: { vi: 'Xe', en: 'Lorry' },
  driverFuelDay: { vi: 'Ngày', en: 'Day' },
  driverFuelOutcome: { vi: 'Đầu ca, xe có đổ nhiên liệu không?', en: 'Was the lorry fuelled at the start of the shift?' },
  driverFuelAdded: { vi: 'Có đổ nhiên liệu', en: 'Fuel added' },
  driverFuelNone: { vi: 'Không đổ nhiên liệu đầu ca', en: 'No fuel at the start of the shift' },
  driverFuelAmount: { vi: 'Số tiền *', en: 'Amount *' },
  driverFuelLiters: { vi: 'Số lít (không bắt buộc)', en: 'Liters (optional)' },
  driverFuelOdometer: { vi: 'Số km trên đồng hồ (không bắt buộc)', en: 'Odometer, km (optional)' },
  driverFuelNote: { vi: 'Ghi chú (không bắt buộc)', en: 'Note (optional)' },
  driverFuelLitersInvalid: { vi: 'Số lít phải lớn hơn 0, tối đa 2 chữ số thập phân.', en: 'Liters must be above 0, with at most 2 decimals.' },
  driverFuelOdometerInvalid: { vi: 'Số km phải là số nguyên.', en: 'The odometer must be a whole number.' },
  driverFuelSubmit: { vi: 'Lưu và tiếp tục', en: 'Save and continue' },
  // A fill after the check — one more row of the lorry's ledger, never a change to the check.
  driverFillTitle: { vi: 'Ghi nhận đổ nhiên liệu', en: 'Record a fill' },
  driverFillIntro: {
    vi: 'Ghi lại một lần đổ nhiên liệu trong ngày. Phần khai nhiên liệu đầu ca giữ nguyên.',
    en: 'Records one fill during the day. The start-of-shift answer stays as it is.',
  },
  driverFillSubmit: { vi: 'Lưu', en: 'Save' },

  // "Ca làm việc hôm nay" — the top of the schedule.
  driverWorkdayFuel: { vi: 'Nhiên liệu đầu ca', en: 'Start-of-shift fuel' },
  driverWorkdayCurrent: { vi: 'Chuyến hiện tại', en: 'Current trip' },
  driverWorkdayNext: { vi: 'Chuyến tiếp theo', en: 'Next trip' },
  driverWorkdayContinue: { vi: 'Tiếp tục chuyến', en: 'Continue trip' },
  driverWorkdayAllDone: { vi: 'Đã chạy xong các chuyến hôm nay của xe này.', en: 'Every trip of this lorry today is done.' },
  driverWorkdayDeclare: { vi: 'Khai nhiên liệu đầu ca', en: 'Declare start-of-shift fuel' },
  driverWorkdayRecordFill: { vi: 'Ghi nhận đổ nhiên liệu', en: 'Record a fill' },
  driverProgressNotStarted: { vi: 'Chưa bắt đầu', en: 'Not started' },
  driverErrNotOperatedToday: {
    vi: 'Xe này không thuộc ca làm việc hôm nay của bạn.',
    en: 'This lorry is not part of your shift today.',
  },
  // The four answers of the beginning-of-shift check, as the driver and the office read them.
  fuelObligationNotRequired: { vi: 'Không yêu cầu', en: 'Not required' },
  fuelObligationMissing: { vi: 'Chưa khai', en: 'Not declared' },
  fuelObligationAdded: { vi: 'Đã khai · Có đổ nhiên liệu', en: 'Declared · Fuel added' },
  fuelObligationNone: { vi: 'Đã khai · Không đổ nhiên liệu đầu ca', en: 'Declared · No fuel at the start of the shift' },

  driverCompletion: { vi: 'Hoàn tất chuyến', en: 'Completing the trip' },
  driverSubmitCompletion: { vi: 'Gửi hoàn tất chuyến', en: 'Submit for completion' },
  // ★ THE QUESTION THE SERVER REFUSES TO ANSWER FOR THEM. No expense rows is
  // not a declaration — it is either a trip that cost nothing or a driver who
  // forgot, and only the driver knows which.
  driverDeclareQuestion: {
    vi: 'Chuyến này có phát sinh chi phí không?',
    en: 'Did this trip have any expenses?',
  },
  driverDeclareNone: { vi: 'Không phát sinh chi phí', en: 'No expenses' },
  driverDeclareExpenses: { vi: 'Có phát sinh chi phí', en: 'There were expenses' },
  driverFinishStepsFirst: {
    vi: 'Hoàn tất các bước vận chuyển ở trên trước',
    en: 'Report the journey steps above first',
  },
  driverCompletionPending: { vi: 'Đã gửi — đang chờ duyệt', en: 'Sent — waiting for review' },
  driverCompletionPendingHint: {
    vi: 'Chi phí đang tạm khoá cho tới khi có kết quả duyệt.',
    en: 'Expenses are locked until the review is decided.',
  },
  driverCompletionRejected: { vi: 'Yêu cầu bị từ chối', en: 'Sent back' },
  driverRejectReason: { vi: 'Lý do từ chối', en: 'Reason' },
  driverFixAndResubmit: { vi: 'Chỉnh sửa và gửi lại', en: 'Correct and send again' },
  // ★ THE DRIVER'S OWN TURN, NEVER "THE TRIP" (ADR-0004). The driver read
  // model carries no trip status, and the trip closes only when every active
  // assignment is approved — so nothing here may claim the trip is done.
  driverCompletionApproved: { vi: 'Lượt xe của bạn đã được duyệt', en: 'Your assignment is approved' },
  driverCompletionApprovedHint: {
    vi: 'Chi phí của lượt xe này không thay đổi được nữa.',
    en: 'Its figures are final.',
  },
  driverAttempt: { vi: 'Lần gửi', en: 'Attempt' },
  driverDeclaredNone: { vi: 'Đã khai: không phát sinh', en: 'Declared: no expenses' },
  driverDeclaredExpenses: { vi: 'Đã khai: có phát sinh', en: 'Declared: there were expenses' },

  driverErrNetwork: {
    vi: 'Không có kết nối. Kiểm tra mạng rồi thử lại.',
    en: 'No connection. Check your network and try again.',
  },
  driverErrSession: {
    vi: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    en: 'Your session has expired. Please sign in again.',
  },
  driverErrForbidden: {
    vi: 'Chuyến này không thuộc về bạn.',
    en: 'This trip is not yours.',
  },
  driverErrPasswordChange: {
    vi: 'Bạn cần đổi mật khẩu trước khi sử dụng.',
    en: 'You must change your password first.',
  },
  driverErrNotFound: { vi: 'Không tìm thấy chuyến này.', en: 'This trip was not found.' },
  driverErrValidation: {
    vi: 'Thông tin chưa hợp lệ. Kiểm tra lại số tiền và các ô đã nhập.',
    en: 'Something is not valid. Check the amount and the fields you filled in.',
  },
  driverErrTooMany: {
    vi: 'Bạn thao tác quá nhanh. Chờ một lát rồi thử lại.',
    en: 'Too many attempts. Wait a moment and try again.',
  },
  // ★ ONE SENTENCE FOR EVERY 409, AND IT SAYS WHAT TO DO. The trip changed
  // underneath — from the office, from another device, or because a review
  // landed. Re-reading the screen is always the right next step.
  driverErrConflict: {
    vi: 'Chuyến vừa thay đổi. Màn hình đã được cập nhật — xem lại rồi thao tác tiếp.',
    en: 'This trip just changed. The screen has been refreshed — check it and try again.',
  },
  driverErrUnknown: {
    vi: 'Có lỗi xảy ra. Thử lại, nếu vẫn lỗi hãy báo văn phòng.',
    en: 'Something went wrong. Try again, and tell the office if it keeps failing.',
  },
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

  // Driver accounts — account type, proposal and review
  accountTypeLabel: { vi: 'Loại tài khoản', en: 'Account type' },
  accountTypeEmployee: { vi: 'Nhân viên', en: 'Employee' },
  accountTypeDriver: { vi: 'Tài xế', en: 'Driver' },
  driverNoDepartmentNote: {
    vi: 'Tài xế không thuộc phòng ban.',
    en: 'Drivers do not belong to a department.',
  },
  driverNoDepartmentWhy: {
    vi: 'Tài xế đăng nhập vào Driver Portal và chỉ thấy chuyến được phân công cho mình. Việc phân công chuyến là một nghiệp vụ riêng, không thực hiện ở đây.',
    en: 'A driver signs in to the Driver Portal and sees only the trips assigned to them. Assigning trips is a separate task and is not done here.',
  },
  driverProposeTitle: { vi: 'Đề xuất tài khoản tài xế', en: 'Propose a driver account' },
  driverProposeNote: {
    vi: 'Bạn có thể đề xuất; tài khoản chỉ được kích hoạt sau khi SuperAdmin duyệt. Mật khẩu tạm sẽ do hệ thống sinh lúc duyệt.',
    en: 'You may propose one; the account is activated only after a SuperAdmin approves it. The temporary password is generated at approval.',
  },
  driverProposeSubmit: { vi: 'Gửi đề xuất', en: 'Send proposal' },
  driverProposeSent: {
    vi: 'Đã gửi đề xuất. Đang chờ SuperAdmin duyệt.',
    en: 'Proposal sent. Awaiting a SuperAdmin decision.',
  },
  driverRequestQueue: { vi: 'Đề xuất tài khoản tài xế', en: 'Driver account requests' },

  // ------------------------------------------------------- Driver Management --
  driverManagement: { vi: 'Quản lý tài xế', en: 'Driver management' },
  driverManagementIntro: {
    vi: 'Tài khoản tài xế: tạo mới, xem chi tiết, vô hiệu hóa và kích hoạt lại. Phân công chuyến được thực hiện trên Lịch xe.',
    en: 'Driver accounts: create, view, disable and re-enable. Trips are assigned on the schedule board.',
  },
  renameDriver: { vi: 'Sửa tên tài xế', en: 'Edit driver name' },
  // Says what the dialog does NOT change, because the obvious next question
  // when somebody opens it is whether the sign-in address moves too.
  renameDriverHint: {
    vi: 'Tên này hiện trên bảng điều phối, trên app tài xế và trên mọi chuyến đã chạy. Đổi tên không ảnh hưởng tài khoản đăng nhập, mật khẩu hay trạng thái.',
    en: 'This name appears on the dispatch board, in the driver app and on every past trip. Renaming touches neither the sign-in account, the password, nor the status.',
  },
  addDriver: { vi: 'Thêm tài xế', en: 'Add driver' },
  driverListEmpty: { vi: 'Chưa có tài khoản tài xế nào.', en: 'No driver accounts yet.' },
  colUsername: { vi: 'Tên đăng nhập', en: 'Username' },
  colAccountType: { vi: 'Loại tài khoản', en: 'Account type' },
  colCreatedAt: { vi: 'Ngày tạo', en: 'Created' },
  viewDetail: { vi: 'Chi tiết', en: 'Details' },
  driverDetail: { vi: 'Chi tiết tài xế', en: 'Driver details' },
  driverStatusActive: { vi: 'Đang hoạt động', en: 'Active' },
  driverStatusDisabled: { vi: 'Đã vô hiệu hóa', en: 'Disabled' },
  driverCreated: { vi: 'Đã tạo tài khoản tài xế.', en: 'Driver account created.' },
  disableDriver: { vi: 'Vô hiệu hóa', en: 'Disable' },
  enableDriver: { vi: 'Kích hoạt lại', en: 'Re-enable' },
  disableDriverTitle: { vi: 'Vô hiệu hóa tài khoản tài xế?', en: 'Disable this driver account?' },
  enableDriverTitle: { vi: 'Kích hoạt lại tài khoản tài xế?', en: 'Re-enable this driver account?' },
  disableDriverConfirm: { vi: 'Xác nhận vô hiệu hóa', en: 'Confirm disable' },
  enableDriverConfirm: { vi: 'Xác nhận kích hoạt', en: 'Confirm re-enable' },
  disableDriverWarning: {
    vi: 'Nếu tài xế đang được phân công chuyến, các phân công hiện tại KHÔNG tự động thay đổi. Vô hiệu hóa tài khoản chỉ khiến tài xế không thể đăng nhập; Điều độ phải đổi tài xế trên chuyến nếu chuyến vẫn cần người chạy.',
    en: 'If this driver is assigned to trips, those assignments do NOT change automatically. Disabling only stops the driver from signing in; Operations must replace the driver on the trip if it still needs one.',
  },
  disableDriverEffectLogin: {
    vi: 'Tài xế không đăng nhập được nữa; các phiên đang mở bị kết thúc.',
    en: 'The driver can no longer sign in; open sessions are ended.',
  },
  disableDriverEffectAssignments: {
    vi: 'Phân công chuyến hiện tại và sắp tới giữ nguyên — không kết thúc, không thay thế.',
    en: 'Current and upcoming trip assignments stay as they are — nothing is ended or replaced.',
  },
  disableDriverEffectHistory: {
    vi: 'Lịch sử chuyến, chi phí và xác nhận hoàn thành được giữ nguyên.',
    en: 'Trip history, expenses and completion records are kept.',
  },
  enableDriverEffectLogin: {
    vi: 'Tài xế đăng nhập được trở lại bằng mật khẩu hiện có.',
    en: 'The driver can sign in again with their existing password.',
  },
  enableDriverEffectNoAssignment: {
    vi: 'Không phân công chuyến nào được tạo hay khôi phục; lịch sử không thay đổi.',
    en: 'No trip assignment is created or restored; history is unchanged.',
  },
  driverRequestQueueEmpty: {
    vi: 'Không có đề xuất nào đang chờ.',
    en: 'No requests are waiting.',
  },
  driverRequestMine: { vi: 'Đề xuất của tôi', en: 'My proposals' },
  driverRequestMineEmpty: {
    vi: 'Bạn chưa gửi đề xuất tài khoản tài xế nào.',
    en: 'You have not proposed a driver account yet.',
  },
  driverRequestDecidedBy: { vi: 'Người duyệt', en: 'Decided by' },
  driverRequestRejectReason: { vi: 'Lý do từ chối', en: 'Reason for rejection' },

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

  // ---- A DRIVER opened on the employee detail page. ----
  // ★ AN ANSWER, NOT AN EMPTY TABLE. A driver belongs to no unit and never
  // will, so "Lịch sử phòng ban" is permanently blank for one — and a blank
  // table with no sentence beside it reads as a record that failed to load.
  driverAccountLabel: { vi: 'Tài xế', en: 'Driver' },
  driverNoDepartment: {
    vi: 'Tài xế không thuộc phòng ban nào — đây là trạng thái đúng, không phải dữ liệu thiếu.',
    en: 'A driver belongs to no department. This is the correct state, not missing data.',
  },
  driverTripsTitle: { vi: 'Chuyến đã nhận', en: 'Trips assigned' },
  emptyDriverTrips: {
    vi: 'Tài xế này chưa được phân công chuyến nào.',
    en: 'This driver has not been given a trip yet.',
  },
  // ★ THE ASSIGNMENT's state, not the trip's. A trip can be well under way while
  // this driver's turn on it has already ended — that is precisely what a
  // replacement is — so the two are shown as separate columns.
  assignmentActive: { vi: 'Đang phụ trách', en: 'Driving' },
  assignmentEnded: { vi: 'Đã kết thúc', en: 'Ended' },
  colAssignment: { vi: 'Phân công', en: 'Assignment' },

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

  // ---- Putting a DRIVER account back into service. ----
  // ★ TÀI XẾ THÔI, và lý do nằm ở chỗ khác: mở lại tài khoản nhân viên phải trả
  // lời "về phòng ban nào", câu đó chưa ai quyết. Tài xế vốn không thuộc phòng
  // ban nào nên không có câu hỏi để trả lời.
  enableAccount: { vi: 'Kích hoạt lại', en: 'Re-enable' },
  enableAccountTitle: { vi: 'Kích hoạt lại tài khoản tài xế?', en: 'Re-enable this driver account?' },
  enableAccountConfirm: { vi: 'Xác nhận kích hoạt', en: 'Confirm' },
  enableEffectLogin: {
    vi: 'Tài xế đăng nhập lại được bằng mật khẩu cũ.',
    en: 'The driver can sign in again with their existing password.',
  },
  enableEffectDispatch: {
    vi: 'Tài xế xuất hiện trở lại trong danh sách phân công chuyến.',
    en: 'They appear again in the list of drivers who can be assigned a trip.',
  },
  // ⚠ NÓI RÕ ĐIỀU KHÔNG XẢY RA. Vô hiệu hóa có thu hồi phiên đăng nhập, và mở
  // lại KHÔNG trả chúng về — người đọc cần biết trước khi bấm.
  enableEffectNoSessions: {
    vi: 'Các phiên đăng nhập đã bị thu hồi không được khôi phục.',
    en: 'Sessions revoked at the time are not restored.',
  },
  enabling: { vi: 'Đang kích hoạt…', en: 'Enabling…' },
  enableFailed: { vi: 'Không kích hoạt lại được tài khoản.', en: 'Could not re-enable the account.' },
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
  close: { vi: 'Đóng', en: 'Close' },
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
  closeNavigation: { vi: 'Đóng điều hướng', en: 'Close navigation' },
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
  // ★ LỊCH SỬ CHUYẾN — những chuyến ĐÃ HOÀN TẤT (`finished`), không phải
  // những chuyến có ngày đã qua. Cùng một chuyến, hai màn hình.
  tripHistory: { vi: 'Lịch sử chuyến', en: 'Trip history' },
  tripHistoryTitle: { vi: 'Lịch sử chuyến', en: 'Trip history' },
  emptyTripHistory: {
    vi: 'Không có chuyến nào đã hoàn tất trong khoảng ngày này.',
    en: 'No completed trips in this date range.',
  },
  tripMasterData: { vi: 'Danh mục xe & khách', en: 'Vehicles & customers' },
  // "Điều hành xe" — every lorry's day, derived from turns, milestones and fuel.
  fleetOperations: { vi: 'Điều hành xe', en: 'Fleet operations' },
  fleetSubtitle: {
    vi: 'Mỗi xe một dòng: đang chạy, chờ chạy, chưa phân công và nhiên liệu đầu ca trong ngày đã chọn.',
    en: 'One row per lorry: running, waiting, unassigned and start-of-shift fuel on the chosen day.',
  },
  fleetDate: { vi: 'Ngày', en: 'Day' },
  fleetToday: { vi: 'Hôm nay', en: 'Today' },
  fleetCardTotal: { vi: 'Tổng xe', en: 'Lorries' },
  fleetCardRunning: { vi: 'Đang chạy', en: 'Running' },
  fleetCardWaiting: { vi: 'Chờ chạy', en: 'Waiting' },
  fleetCardUnassigned: { vi: 'Chưa phân công', en: 'Unassigned' },
  fleetCardFuelMissing: { vi: 'Chưa khai nhiên liệu', en: 'Fuel not declared' },
  fleetStateRunning: { vi: 'Đang chạy', en: 'Running' },
  fleetStateWaiting: { vi: 'Chờ chạy', en: 'Waiting' },
  fleetStateDone: { vi: 'Đã chạy xong', en: 'Done' },
  fleetStateUnassigned: { vi: 'Chưa phân công', en: 'Unassigned' },
  fleetColVehicle: { vi: 'Xe', en: 'Lorry' },
  fleetColState: { vi: 'Trạng thái', en: 'State' },
  fleetColDrivers: { vi: 'Tài xế', en: 'Driver' },
  fleetColTrip: { vi: 'Chuyến hiện tại', en: 'Current trip' },
  fleetColFuel: { vi: 'Nhiên liệu đầu ca', en: 'Start-of-shift fuel' },
  fleetColFuelDay: { vi: 'Nhiên liệu trong ngày', en: 'Fuel during the day' },
  fleetColIssues: { vi: 'Cần kiểm tra', en: 'To check' },
  fleetFilterAll: { vi: 'Tất cả', en: 'All' },
  fleetSearch: { vi: 'Tìm biển số, tài xế, khách hàng…', en: 'Search plate, driver, customer…' },
  fleetEmpty: { vi: 'Không có xe nào khớp bộ lọc.', en: 'No lorry matches the filters.' },
  fleetTurns: { vi: 'chuyến', en: 'trips' },
  fleetIssueUndeclared: { vi: 'Chưa khai', en: 'Not declared' },
  fleetIssueLiters: { vi: 'Thiếu số lít', en: 'Liters missing' },
  fleetIssueOdometer: { vi: 'Thiếu công-tơ-mét', en: 'Odometer missing' },
  fleetMoneyHidden: {
    vi: 'Số tiền nhiên liệu chỉ hiển thị cho người có quyền xem chi phí.',
    en: 'Fuel amounts are shown only to people allowed to read costs.',
  },
  fleetTabOverview: { vi: 'Tổng quan', en: 'Overview' },
  fleetTabSchedule: { vi: 'Lịch chạy', en: 'Runs' },
  fleetTabFuel: { vi: 'Nhiên liệu', en: 'Fuel' },
  fleetTabCosts: { vi: 'Chi phí', en: 'Costs' },
  fleetDetailSections: { vi: 'Các mục điều hành xe', en: 'Lorry operations sections' },
  fleetCheckSection: { vi: 'Khai nhiên liệu đầu ca', en: 'Start-of-shift fuel check' },
  fleetFillsSection: { vi: 'Giao dịch nhiên liệu trong ngày', en: 'Fuel transactions during the day' },
  fleetCheckMissing: { vi: 'Chưa có khai báo đầu ca.', en: 'No start-of-shift answer yet.' },
  fleetCheckNotRequired: {
    vi: 'Không có khai báo đầu ca: xe không yêu cầu, hoặc không có chuyến trong ngày.',
    en: 'No start-of-shift answer: not required for this lorry, or it had no run that day.',
  },
  fleetCheckBy: { vi: 'Người khai', en: 'Declared by' },
  fleetCheckAt: { vi: 'Lúc', en: 'At' },
  fleetCheckAmount: { vi: 'Số tiền khai đầu ca', en: 'Amount declared at the start' },
  fleetFillsTotal: { vi: 'Tổng nhiên liệu trong ngày', en: 'Fuel total for the day' },
  fleetFillFromCheck: { vi: 'Khai đầu ca', en: 'Start of shift' },
  fleetFillLater: { vi: 'Đổ thêm', en: 'Later fill' },
  fleetFillsNone: { vi: 'Không có giao dịch nhiên liệu trong ngày.', en: 'No fuel transactions that day.' },
  fleetNoTurns: { vi: 'Không có chuyến trong ngày.', en: 'No runs that day.' },
  fleetAwaitingApproval: { vi: 'Đã giao · chờ duyệt', en: 'Delivered · awaiting review' },
  fleetCurrent: { vi: 'Hiện tại', en: 'Current' },
  fleetNext: { vi: 'Tiếp theo', en: 'Next' },
  fleetNoAccess: { vi: 'Màn hình này dành cho Điều độ.', en: 'This screen is for Dispatch.' },
  fleetNoAccessTripSchedule: {
    vi: 'Màn hình này dành cho Điều độ. Bạn vẫn xem được Lịch xe.',
    en: 'This screen is for Dispatch. You can still read the trip schedule.',
  },


  // Actions shared by both dispatch screens.
  save: { vi: 'Lưu', en: 'Save' },
  saving: { vi: 'Đang lưu…', en: 'Saving…' },
  saveFailed: { vi: 'Không lưu được.', en: 'Could not save.' },
  edit: { vi: 'Sửa', en: 'Edit' },
  archive: { vi: 'Lưu trữ', en: 'Archive' },

  // Trip schedule — the table
  addTrip: { vi: 'Thêm chuyến', en: 'Add trip' },
  editTrip: { vi: 'Sửa chuyến', en: 'Edit trip' },
  // ★ HAI Ý ĐỊNH, HAI CÁCH GỌI, MỘT FORM. "Thêm chuyến" đặt việc sắp chạy;
  // "Nhập chuyến cũ" ghi nhận một chuyến đã chạy — ngày trong quá khứ là hợp lệ.
  createTripTitle: { vi: 'Tạo chuyến mới', en: 'New trip' },
  // The booking workspace ("Thêm chuyến"): its sections, its summary, its action.
  // (Customer and route reuse the detail panel's `bookingSectionCustomer` / `bookingSectionRoute`.)
  bookingSectionTime: { vi: 'Thời gian', en: 'Schedule' },
  bookingSectionPrice: { vi: 'Giá cước', en: 'Rates' },
  bookingCrewToggle: { vi: 'Phân công xe ngay (không bắt buộc)', en: 'Assign a lorry now (optional)' },
  bookingCrewLater: { vi: 'Có thể phân công sau ở Lịch xe', en: 'You can assign one later from the schedule' },
  bookingCrewAdded: { vi: 'Đã thêm xe', en: 'Lorries added' },
  bookingSummaryTitle: { vi: 'Tóm tắt booking', en: 'Booking summary' },
  bookingSummaryEmpty: {
    vi: 'Thông tin booking sẽ hiện ở đây khi bạn điền form.',
    en: 'The booking appears here as you fill in the form.',
  },
  bookingSummaryPickupTime: { vi: 'Lấy hàng', en: 'Pickup' },
  bookingSummaryDeliveryTime: { vi: 'Giao hàng', en: 'Delivery' },
  bookingSummaryPurchase: { vi: 'Giá mua', en: 'Buying price' },
  bookingSummarySell: { vi: 'Giá bán', en: 'Selling price' },
  bookingCreate: { vi: 'Tạo booking', en: 'Create booking' },
  bookingCreating: { vi: 'Đang tạo booking…', en: 'Creating booking…' },
  bookingCreateHelper: {
    vi: 'Booking sẽ được tạo ở trạng thái Chờ xử lý. Bạn có thể phân công xe và tài xế sau.',
    en: 'The booking is created as Pending. You can assign a lorry and driver later.',
  },
  importTrip: { vi: 'Nhập chuyến cũ', en: 'Record a past trip' },
  // The wording of the system-written end reason `historical_entry` — the crew
  // of a trip recorded after it ran. The stored token is audit data; this is
  // only what a person reads (`utils/assignmentEndReason`).
  historicalEntryReason: { vi: 'Nhập chuyến cũ', en: 'Recorded past trip' },
  importTripSaved: {
    vi: 'Đã ghi nhận chuyến vào Lịch sử chuyến.',
    en: 'Trip recorded in Trip history.',
  },
  importTripHint: {
    vi: 'Ghi nhận một chuyến đã chạy và đã kết thúc. Chuyến được lưu ở trạng thái Hoàn thành và vào thẳng Lịch sử chuyến — không xuất hiện ở Lịch xe.',
    en: 'Records a trip that already ran and ended. It is saved as completed and goes straight to Trip history — never onto the schedule.',
  },
  dateFrom: { vi: 'Từ ngày', en: 'From' },
  dateTo: { vi: 'Đến ngày', en: 'To' },
  thisMonth: { vi: 'Tháng này', en: 'This month' },
  colDate: { vi: 'Ngày', en: 'Date' },
  colVehicle: { vi: 'Xe', en: 'Vehicle' },
  colCustomer: { vi: 'Khách hàng', en: 'Customer' },
  /**
   * ★ THE PLACEHOLDER SAYS WHAT THE BOX DOES, not what to do with it. "Tìm theo
   * tên khách hàng" tells a dispatcher it matches part of a name — the one
   * thing that is not obvious from an empty field beside a label reading
   * "Khách hàng", which could as easily be a dropdown.
   */
  tripCustomerSearchHint: { vi: 'Tìm theo tên khách hàng…', en: 'Search by customer name…' },
  /**
   * ⚠ NOT "Khách hàng". The trip FORM already labels a field that, and a second
   * control with the same accessible name on the same screen is one a test — and
   * a screen reader — cannot tell from the other.
   */
  tripCustomerSearchLabel: { vi: 'Tìm khách hàng', en: 'Find customer' },
  tripCustomerSearch: { vi: 'Tìm', en: 'Search' },
  tripCustomerSearchClear: { vi: 'Bỏ lọc', en: 'Clear' },
  colCargo: { vi: 'Hàng hoá', en: 'Cargo' },
  colPickup: { vi: 'Điểm lấy hàng', en: 'Pickup' },
  colDelivery: { vi: 'Điểm giao hàng', en: 'Delivery' },
  // Lịch sử chuyến's date column: the planned pickup day, `scheduled_on`.
  colPickupDate: { vi: 'Ngày lấy hàng', en: 'Pickup date' },
  colSellPrice: { vi: 'Giá cước bán', en: 'Selling price' },
  colPurchasePrice: { vi: 'Giá cước mua', en: 'Buying price' },
  colNote: { vi: 'Ghi chú', en: 'Note' },
  colCreatedBy: { vi: 'Người tạo', en: 'Created by' },
  // ----------------------------------------- Xuất lịch xe ra Excel (SheetJS) --
  // ★ Hai cột chỉ có trong file, không có trên bảng: bảng gộp địa chỉ, liên hệ
  // và giờ vào một ô cho dễ đọc, còn bảng tính thì tách ra mới lọc được.
  exportColContact: { vi: 'Liên hệ', en: 'Contact' },
  exportColTime: { vi: 'Thời gian', en: 'Time' },
  exportExcel: { vi: 'Xuất Excel', en: 'Export to Excel' },
  exportRunning: { vi: 'Đang xuất…', en: 'Exporting…' },
  exportDone: { vi: 'Đã xuất file Excel', en: 'Excel file downloaded' },
  exportRowsUnit: { vi: 'chuyến', en: 'trips' },
  // Không có dòng nào thì không tạo file — một file chỉ có dòng tiêu đề trông
  // y hệt một lần xuất hỏng.
  exportEmpty: {
    vi: 'Không có chuyến nào trong khoảng ngày này để xuất.',
    en: 'No trips in this date range to export.',
  },
  exportFailed: {
    vi: 'Không xuất được file. Vui lòng thử lại.',
    en: 'The export failed. Please try again.',
  },
  emptyTrips: {
    vi: 'Không có chuyến nào trong khoảng ngày này.',
    en: 'No trips in this date range.',
  },

  // ------------------------------------------- Trip schedule — the crew tabs --
  // ★ THREE TABS OVER ONE LIST, AND THE MIDDLE ONE IS A QUEUE. A trip enters it
  // when it is entered on the board and leaves it the moment a driver is put on
  // the row — so "chưa phân công" is a job to do, not a state of the cargo.
  tripTabAll: { vi: 'Tất cả', en: 'All' },
  // ★ "Chờ", NOT "Chưa" — the driver cell of an uncrewed row already says "Chưa
  // phân công", and a tab repeating it word for word would leave two different
  // things on the same screen reading identically. The tab is the QUEUE; the
  // cell is one row's answer.
  tripTabUnassigned: { vi: 'Chờ phân công', en: 'Awaiting a driver' },
  tripTabAssigned: { vi: 'Đã phân công', en: 'Has a driver' },
  tripTabsLabel: { vi: 'Lọc theo tài xế', en: 'Filter by driver' },
  // The board's order. Every one is a date, so the direction reads as time.
  // Keys follow the server's sort names; only the words are presentation.
  tripSortBy: { vi: 'Sắp xếp theo', en: 'Sort by' },
  // ★ "NGÀY LẤY HÀNG", NOT "NGÀY CHẠY". The key orders by `scheduled_on`,
  // which is now the pickup's day (derived from "Thời gian lấy hàng"), and it
  // is day-level — so the label names the day, not the instant.
  tripSortExecutionDate: { vi: 'Ngày lấy hàng', en: 'Pickup day' },
  tripSortBookingCreated: { vi: 'Booking mới nhất', en: 'Latest booking' },
  // ★ "CHỈNH SỬA", NOT "CẬP NHẬT". The key is the trip ROW's `updated_at`: an
  // edit or a status move changes it; a new crew, a cost line or a driver's
  // milestone does not. "Cập nhật" would promise all of those.
  tripSortLastUpdated: { vi: 'Chỉnh sửa gần nhất', en: 'Last edited' },
  tripSortDirection: { vi: 'Thứ tự', en: 'Order' },
  sortNewestFirst: { vi: 'Mới nhất trước', en: 'Newest first' },
  sortOldestFirst: { vi: 'Cũ nhất trước', en: 'Oldest first' },
  // ★ A DIFFERENT SENTENCE PER TAB. "Không có chuyến nào" under a filter reads
  // as "the month is empty" when what it means is "every trip here already has
  // somebody on it" — and a dispatcher who believes the first one goes looking
  // for rows that were never missing.
  emptyUnassignedTrips: {
    vi: 'Mọi chuyến trong khoảng ngày này đều đã có tài xế.',
    en: 'Every trip in this date range already has a driver.',
  },
  emptyAssignedTrips: {
    vi: 'Chưa chuyến nào trong khoảng ngày này được phân công tài xế.',
    en: 'No trip in this date range has a driver yet.',
  },
  // ★ AN ANSWER, NOT A PROMPT. The workbook wrote `ĐIỀN SAU` in a cell it had
  // not filled yet, and the API stores that as null — so this reads as a state
  // the row is genuinely in, both in a select and in a table cell.
  notSelected: { vi: 'Chưa chọn', en: 'Not selected' },

  // Trip schedule — the form
  fieldStatus: { vi: 'Trạng thái', en: 'Status' },
  fieldVehicle: { vi: 'Xe', en: 'Vehicle' },
  fieldCustomer: { vi: 'Khách hàng', en: 'Customer' },
  fieldCargo: { vi: 'Thông tin hàng', en: 'Cargo details' },
  fieldPickupAddress: { vi: 'Địa chỉ lấy hàng', en: 'Pickup address' },
  fieldDeliveryAddress: { vi: 'Địa chỉ giao hàng', en: 'Delivery address' },
  fieldPickupContact: { vi: 'Liên hệ lấy hàng', en: 'Pickup contact' },
  fieldDeliveryContact: { vi: 'Liên hệ giao hàng', en: 'Delivery contact' },
  // The driver's card shows the HOUR alone under this one — "Giờ" is right there.
  fieldPickupAt: { vi: 'Giờ lấy hàng', en: 'Pickup time' },
  // ★ EACH LABEL SAYS WHAT ITS CONTROL HOLDS. "Ngày" is a day — the planned
  // pickup date, `scheduled_on`, not the booking date and not when a driver
  // started; "Giờ" an hour on it (the key above, shared with the driver's
  // card); "Thời gian" a date AND an hour. Only the date is compulsory: a
  // trip is booked for a day before anybody knows the hour.
  fieldPickupDate: { vi: 'Ngày lấy hàng *', en: 'Pickup date *' },
  // The same hour, required: a booking for today must say when it picks up.
  fieldPickupAtRequired: { vi: 'Giờ lấy hàng *', en: 'Pickup time *' },
  fieldDeliveryDateTime: { vi: 'Thời gian giao hàng', en: 'Delivery date & time' },
  fieldDeliveryTime: { vi: 'Giờ giao hàng', en: 'Delivery time' },
  // The date and time controls (`DateInput`, `TimeInput`): dd/mm/yyyy and a picked hour in any browser.
  dateFormatInvalid: { vi: 'Nhập ngày theo dạng dd/mm/yyyy.', en: 'Enter the date as dd/mm/yyyy.' },
  dateTimeIncomplete: { vi: 'Nhập đủ cả ngày và giờ.', en: 'Enter both the date and the time.' },
  chooseDate: { vi: 'Chọn ngày trên lịch', en: 'Pick a date' },
  timePickerDialog: { vi: 'Chọn giờ', en: 'Choose a time' },
  timePickerHour: { vi: 'Giờ', en: 'Hour' },
  timePickerMinute: { vi: 'Phút', en: 'Minute' },
  timePickerPeriod: { vi: 'Sáng/chiều (AM/PM)', en: 'AM/PM' },
  timePickerClear: { vi: 'Xóa', en: 'Clear' },
  timePickerDone: { vi: 'Xong', en: 'Done' },
  timePickerIncomplete: { vi: 'Chọn đủ giờ, phút và AM/PM.', en: 'Pick the hour, the minute and AM or PM.' },
  timeMayBeUnknown: { vi: 'Để trống nếu chưa chốt giờ.', en: 'Leave empty until the hour is agreed.' },
  historicalInstantInFuture: {
    vi: 'Chuyến cũ không thể có thời gian sau thời điểm hiện tại.',
    en: 'A past trip cannot have a time later than now.',
  },
  historicalInFuture: {
    vi: 'Chuyến cũ phải có ngày lấy hàng không muộn hơn hôm nay.',
    en: 'A past trip cannot have a pickup date after today.',
  },
  deliveryNotAfterPickup: {
    vi: 'Thời gian giao hàng phải sau thời gian lấy hàng.',
    en: 'The delivery time must be after the pickup time.',
  },
  pickupTimeRequiredToday: {
    vi: 'Chuyến hôm nay phải có giờ lấy hàng.',
    en: 'A trip for today needs a pickup time.',
  },
  pickupInPast: {
    vi: 'Giờ lấy hàng đã qua. Chuyến đã chạy được ghi nhận bằng “Nhập chuyến cũ” ở Lịch sử chuyến.',
    en: 'This pickup time has passed. Record a trip that already ran with “Record a past trip” in Trip history.',
  },
  pickupOnPastDay: {
    vi: 'Ngày lấy hàng đã qua. Chuyến đã chạy được ghi nhận bằng “Nhập chuyến cũ” ở Lịch sử chuyến.',
    en: 'This pickup date has passed. Record a trip that already ran with “Record a past trip” in Trip history.',
  },
  // ------------------------------------------------ customer locations --
  locationsTitle: { vi: 'Địa điểm', en: 'Locations' },
  manageLocations: { vi: 'Địa điểm', en: 'Locations' },
  emptyLocations: { vi: 'Khách hàng chưa có địa điểm.', en: 'This customer has no locations yet.' },
  addLocation: { vi: 'Thêm địa điểm', en: 'Add location' },
  editLocation: { vi: 'Sửa địa điểm', en: 'Edit location' },
  locationName: { vi: 'Tên địa điểm', en: 'Location name' },
  locationAddress: { vi: 'Địa chỉ', en: 'Address' },
  locationContact: { vi: 'Liên hệ', en: 'Contact' },
  // ---------------------------------------------- the locations catalogue --
  //
  // The sidebar entry and the screen behind it: every place, shared and
  // customer-owned, in one list.
  locationCatalogue: { vi: 'Địa điểm', en: 'Locations' },
  locationCatalogueHint: {
    vi: 'Tên hay dùng và địa chỉ cụ thể của nó. Địa điểm dùng chung không thuộc khách hàng nào.',
    en: 'The names everyone uses, and the address each one resolves to. A shared place belongs to no customer.',
  },
  addSharedLocation: { vi: 'Thêm địa điểm dùng chung', en: 'Add shared location' },
  emptyLocationCatalogue: { vi: 'Chưa có địa điểm nào.', en: 'No locations yet.' },
  /** The owner column, and the filter above it. */
  locationOwner: { vi: 'Khách hàng', en: 'Customer' },
  locationOwnerAll: { vi: 'Tất cả', en: 'All' },
  /** What the owner cell says for a place belonging to nobody. */
  locationShared: { vi: '— Dùng chung —', en: '— Shared —' },
  /** Tỉnh · xã, as one column and as two fields. */
  // ★ TWO LEVELS, BECAUSE THE 2025 MERGER LEFT TWO. The 63 provinces became 34
  // and quận/huyện was abolished on 1 July 2025, so a ward hangs straight off a
  // province and nothing here offers a third control.
  locationAdminArea: { vi: 'Tỉnh / Phường', en: 'Province / ward' },
  locationProvince: { vi: 'Tỉnh / Thành phố', en: 'Province / city' },
  locationWard: { vi: 'Phường / Xã', en: 'Ward / commune' },
  locationProvincePick: { vi: 'Gõ để tìm tỉnh / thành phố', en: 'Type to find a province' },
  // Shown inside the dropdown when what was typed matches no unit. Not an
  // error: these boxes filter a fixed official list, so "no match" usually
  // means a typo or a name that changed in the 2025 merger.
  locationNoUnitMatches: {
    vi: 'Không có đơn vị nào khớp.',
    en: 'No administrative unit matches that.',
  },
  locationWardPick: { vi: 'Gõ để tìm phường / xã', en: 'Type to find a ward' },
  locationWardNeedsProvince: { vi: 'Chọn tỉnh trước', en: 'Choose a province first' },
  // The abolished tier, shown READ-ONLY and only on a row that still carries
  // one. It explains why such a row's address line reads "…, Quận 7, …" when
  // no control offers that any more, and it goes as soon as the province is
  // re-picked.
  locationDistrictLegacy: { vi: 'Quận / Huyện (trước sáp nhập)', en: 'District (pre-merger)' },
  locationDistrictLegacyHint: {
    vi: 'Cấp quận / huyện đã bỏ từ 01/07/2025. Chọn lại tỉnh / thành phố để cập nhật địa điểm này.',
    en: 'The district tier was abolished on 1 July 2025. Re-pick the province to bring this location up to date.',
  },
  // Shown under a dropdown that could not be filled. The form still saves:
  // these two fields describe a place, they are not what makes one real.
  adminAreaUnavailable: {
    vi: 'Không lấy được danh mục hành chính. Vẫn lưu được địa điểm, bổ sung sau.',
    en: 'The administrative list could not be loaded. The location still saves; fill these in later.',
  },
  // Same reassurance the vehicle and customer bodies give, for the same
  // misreading: "lưu trữ" is not a delete, and past trips keep their snapshot.
  confirmArchiveLocationBody: {
    vi: 'Lưu trữ địa điểm này? Các chuyến đã chạy vẫn giữ nguyên địa chỉ đã lưu — địa điểm chỉ không còn được chọn cho chuyến mới.',
    en: 'Archive this location? Past trips keep the address they copied — it is only no longer offered for new trips.',
  },
  locationCoordinates: { vi: 'Toạ độ', en: 'Coordinates' },
  locationLocated: { vi: 'Đã định vị', en: 'Located' },
  locationUnlocated: { vi: 'Chưa định vị', en: 'Not located' },
  // ★ THE WARNING THAT STANDS IN FRONT OF `OUTSIDE_GEOFENCE`. Correcting the
  // address of a located place leaves the old pair attached; saved that way,
  // the driver reaches the right gate and the server says he is somewhere else
  // — which reads as the driver lying rather than as the row being wrong.
  // While the address is being turned into a point by itself. Named as a state,
  // not as a spinner: the operator needs to know something is in flight before
  // they conclude nothing happened and reach for the map.
  locationLocating: { vi: 'Đang xác định vị trí…', en: 'Locating…' },
  // ★ THE HONEST LABEL ON AN AUTOMATIC ANSWER. A geocoded point is the street
  // or the parcel, not the gate — close enough for most places and not for a
  // 160-hectare port. Saying where it came from is what makes somebody check it.
  locationAutoLocated: {
    vi: 'Vị trí lấy tự động từ địa chỉ. Kiểm tra lại ghim nếu là cảng, kho lớn hay khu công nghiệp.',
    en: 'Position derived automatically from the address. Check the pin for ports, large yards and industrial parks.',
  },
  locationAddressChanged: {
    vi: 'Địa chỉ đã thay đổi nhưng toạ độ vẫn là toạ độ cũ. Chọn lại một gợi ý địa chỉ, hoặc chỉnh ghim trên bản đồ.',
    en: 'The address changed but the coordinates are still the old ones. Pick an address suggestion again, or move the pin on the map.',
  },
  // ------------------------------------------- the position, as the operator sees it --
  locationPosition: { vi: 'Vị trí', en: 'Position' },
  // ★ THE NORMAL PATH IN ONE LINE: pick the suggested address, and the position is done.
  locationAddressHint: {
    vi: 'Chọn một gợi ý khi nhập địa chỉ — vị trí sẽ được xác định tự động.',
    en: 'Pick a suggestion as you type the address — the position is set automatically.',
  },
  locationResolveHint: {
    vi: 'Chọn một gợi ý địa chỉ ở trên, hoặc xác định vị trí trên bản đồ.',
    en: 'Pick an address suggestion above, or set the position on the map.',
  },
  editLocationPosition: { vi: 'Chỉnh sửa vị trí', en: 'Edit position' },
  confirmPosition: { vi: 'Xác nhận vị trí', en: 'Confirm position' },
  manualCoordinates: { vi: 'Nhập toạ độ thủ công (nâng cao)', en: 'Enter coordinates by hand (advanced)' },
  // ------------------------------------------- location authoring with a map --
  locationSearch: { vi: 'Tìm địa chỉ / địa điểm', en: 'Search address or place' },
  locationSearchPlaceholder: { vi: 'Ví dụ: Kho TCS Bình Dương', en: 'For example: Kho TCS Bình Dương' },
  locationSearching: { vi: 'Đang tìm…', en: 'Searching…' },
  locationNoResults: { vi: 'Không tìm thấy địa điểm phù hợp.', en: 'No matching place found.' },
  locationSearchFailed: {
    vi: 'Không tìm được địa điểm. Thử lại, hoặc đặt ghim trực tiếp trên bản đồ.',
    en: 'The search failed. Try again, or place the pin on the map directly.',
  },
  // ★ THE POINT OF THE MAP. The geocoder finds the parcel; the operator finds
  // the gate. Cảng Cát Lái is 1.3 km across, so its centre is outside the 300 m
  // the server confirms a driver within.
  locationPinHint: {
    vi: 'Điều chỉnh ghim đến đúng cổng/điểm mà tài xế cần đến. Kéo ghim hoặc bấm lên bản đồ; toạ độ bên dưới là toạ độ được lưu.',
    en: 'Move the pin to the exact gate or point the driver must reach. Drag it or click the map; the coordinates below are what is saved.',
  },
  locationMapLoading: { vi: 'Đang tải bản đồ…', en: 'Loading the map…' },
  locationMapFailed: {
    vi: 'Không tải được bản đồ. Vẫn có thể nhập toạ độ thủ công bên dưới.',
    en: 'The map could not be loaded. Coordinates can still be entered by hand below.',
  },
  locationMapNoPin: {
    vi: 'Chưa có ghim. Tìm địa điểm ở trên hoặc bấm lên bản đồ để đặt ghim.',
    en: 'No pin yet. Search above or click the map to place one.',
  },
  // Display only: the server measures the driver, this circle merely shows the reach.
  locationRadiusNote: {
    vi: 'Vòng tròn là bán kính xác nhận GPS hiện hành (300 m), chỉ để hình dung.',
    en: 'The circle is the current GPS confirmation radius (300 m), for orientation only.',
  },
  locationPairIncomplete: {
    vi: 'Cần cả vĩ độ và kinh độ, hoặc để trống cả hai.',
    en: 'Enter both latitude and longitude, or leave both empty.',
  },
  locationPairInvalid: {
    vi: 'Toạ độ không hợp lệ: vĩ độ từ −90 đến 90, kinh độ từ −180 đến 180.',
    en: 'Invalid coordinates: latitude −90 to 90, longitude −180 to 180.',
  },
  archiveLocationConfirm: { vi: 'Lưu trữ địa điểm', en: 'Archive location' },
  selectLocation: { vi: 'Chọn địa điểm', en: 'Choose a location' },
  noLocationSelected: { vi: 'Chưa chọn địa điểm — nhập địa chỉ tự do', en: 'No location chosen — enter the address by hand' },
  chooseCustomerFirst: { vi: 'Chọn khách hàng trước', en: 'Choose a customer first' },
  // ★ Said on the trip form the moment an unlocated place is chosen: the driver
  // will be refused the GPS confirmation there until the place is located.
  locationUnlocatedWarning: {
    vi: 'Chưa định vị — tài xế chưa thể xác nhận GPS tại đây.',
    en: 'Not located — the driver cannot confirm by GPS here yet.',
  },
  fieldPickupLocation: { vi: 'Điểm lấy hàng', en: 'Pickup location' },
  fieldDeliveryLocation: { vi: 'Điểm giao hàng', en: 'Delivery location' },
  // ------------------------------------------------ location readiness --
  // "Located" means the place has coordinates and can be checked against;
  // it says nothing about whether any driver's reading passed. That verdict
  // is the server's and is worded separately (reviewLocation*).
  setupLocation: { vi: 'Thiết lập vị trí', en: 'Set up location' },
  locationNotYetLocated: {
    vi: 'Địa điểm này chưa có vị trí trên bản đồ.',
    en: 'This location has no position on the map yet.',
  },
  tripLocationReadiness: { vi: 'Xác minh vị trí của chuyến', en: 'Trip location verification' },
  tripLocationReady: { vi: 'Sẵn sàng xác minh vị trí', en: 'Ready for location verification' },
  tripLocationNotReady: { vi: 'Chưa sẵn sàng xác minh vị trí', en: 'Not ready for location verification' },
  fieldLatitude: { vi: 'Vĩ độ', en: 'Latitude' },
  fieldLongitude: { vi: 'Kinh độ', en: 'Longitude' },
  // Why the office is asked for numbers next to a prose address.
  coordinatesHint: {
    vi: 'Toạ độ lấy hàng dùng để kiểm tra vị trí GPS khi tài xế xác nhận lấy hàng. Nhập cả hai hoặc để trống cả hai.',
    en: 'Pickup coordinates are what the driver’s GPS is checked against on pickup. Enter both or leave both empty.',
  },
  // ★ THE STAR ON THE SELLING PRICE IS THE FIELD'S ONLY MARK OF BEING
  // COMPULSORY, and it matches every other required label in this file.
  fieldSellPrice: { vi: 'Giá cước bán (VND) *', en: 'Selling price (VND) *' },
  fieldPurchasePrice: { vi: 'Giá cước mua (VND)', en: 'Buying price (VND)' },
  // Why the selling price cannot be left out, and why neither may be zero.
  sellPriceHint: {
    vi: 'Bắt buộc. Tối đa 2 số lẻ, phải lớn hơn 0. Ví dụ: 4,500,000',
    en: 'Required. At most 2 decimals, and greater than zero. e.g. 4,500,000',
  },
  // Why THIS one may be left empty, unlike the one above it.
  purchasePriceHint: {
    vi: 'Để trống nếu chạy xe nhà hoặc chưa chốt giá mua. Tối đa 2 số lẻ. Ví dụ: 3,000,000',
    en: 'Leave empty for our own lorry, or if the buying price is not agreed yet. At most 2 decimals. e.g. 3,000,000',
  },
  // Shown in place of the two fields to somebody who may not see prices.
  priceRestricted: {
    vi: 'Giá cước do điều độ nhập. Chuyến vẫn lưu được khi chưa có giá.',
    en: 'Prices are entered by dispatch. The trip can be saved without them.',
  },
  // Shown at the top of the edit form to somebody who may set the prices and
  // nothing else on the row — a dispatch member without `trip.write`.
  priceOnlyEdit: {
    vi: 'Bạn chỉ sửa được giá cước của chuyến này; các trường khác do trưởng phòng sửa.',
    en: 'You can only change the prices of this trip; the other fields are corrected by a department head.',
  },
  // Shown above the two fields to somebody who may SEE prices but not set them.
  priceReadOnly: {
    vi: 'Bạn xem được giá cước; chỉ điều độ mới nhập hoặc sửa được.',
    en: 'You can see the prices; only dispatch can enter or change them.',
  },
  fieldNote: { vi: 'Ghi chú', en: 'Note' },
  // Why the delivery control asks for a date as well as a time.
  deliveryMayBeLater: {
    vi: 'Có thể rơi sang ngày sau ngày lấy hàng. Để trống nếu chưa biết.',
    en: 'Delivery may fall on a later day than pickup. Leave empty if unknown.',
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
  // ★ THE FOUR LIFECYCLE STATES (0025). These replaced the workbook's five row
  // colours; "Book xe ngoài" is gone as a status because it named a ROUTE, not
  // a stage — whether a run is subcontracted lives on the vehicle instead.
  tripPending: { vi: 'Chờ xử lý', en: 'Pending' },
  // ★ "ĐÃ XÁC NHẬN" MEANS THE TRIP IS DONE (business owner, 2026-09-29) — the
  // label of `finished`. The retired `confirmed` says what it meant AND that it
  // is old data, so a legacy row never shows the completion's words twice. It
  // exists only until the production normalization moves those rows.
  tripConfirmed: { vi: 'Đã xác nhận (dữ liệu cũ)', en: 'Confirmed (legacy data)' },
  tripExecuting: { vi: 'Đang thực hiện', en: 'Executing' },
  tripFinished: { vi: 'Đã xác nhận', en: 'Confirmed — done' },
  // ★ LỊCH XE'S DOMAIN ACTIONS — verbs, never "đổi trạng thái". The office
  // crews a trip; the DRIVER starts it (first milestone) and asks to close it.
  bookingAssign: { vi: 'Phân công xe & tài xế', en: 'Assign vehicle & driver' },
  bookingReassign: { vi: 'Đổi phân công', en: 'Change assignment' },
  // ★ READINGS OF THE LIST ROW, NOT STATUSES. "Quá giờ dự kiến" is the booked
  // hour against the clock — deliberately not the operational board's
  // PICKUP_DELAYED, which judges a driver's arrival.
  bookingDueSoon: { vi: 'Sắp đến giờ', en: 'Due soon' },
  bookingPastPlanned: { vi: 'Quá giờ dự kiến', en: 'Past planned time' },
  bookingDriverStarted: { vi: 'Tài xế đã bắt đầu', en: 'Driver has started' },
  bookingListLabel: { vi: 'Danh sách chuyến', en: 'Trips' },
  bookingDetailTitle: { vi: 'Chi tiết chuyến', en: 'Trip details' },
  bookingSelectHint: { vi: 'Chọn một chuyến để xem chi tiết.', en: 'Select a trip to see its details.' },
  bookingSectionRoute: { vi: 'Lộ trình', en: 'Route' },
  bookingSectionCustomer: { vi: 'Khách hàng & hàng hoá', en: 'Customer & cargo' },
  bookingSectionCrew: { vi: 'Xe & tài xế', en: 'Vehicles & drivers' },
  bookingSectionPricing: { vi: 'Giá cước & chi phí', en: 'Prices & costs' },
  bookingSectionMeta: { vi: 'Thông tin bản ghi', en: 'Record' },
  colUpdatedAt: { vi: 'Cập nhật lần cuối', en: 'Last updated' },
  // ★ THE BOOKING PNG — one fixed external-safe document. The IMAGE is always
  // Vietnamese (`bookingExportModel`); only the dialog around it is translated.
  // Short: the button sits on the booking itself, so "booking" goes without saying.
  bookingExportAction: { vi: 'Xuất PNG', en: 'Export PNG' },
  bookingExportTitle: { vi: 'Xem trước booking', en: 'Booking preview' },
  bookingExportHelp: {
    vi: 'Ảnh booking dùng để chia sẻ thông tin vận hành. Không bao gồm giá, chi phí hoặc dữ liệu tài chính nội bộ.',
    en: 'The booking image is for sharing operational details. It contains no prices, costs or internal financial data.',
  },
  bookingExportDownload: { vi: 'Tải ảnh PNG', en: 'Download PNG' },
  bookingExportPreparing: { vi: 'Đang tạo ảnh booking…', en: 'Preparing the booking image…' },
  bookingExportFailed: {
    vi: 'Không tạo được ảnh booking. Đóng lại và thử lần nữa.',
    en: 'Could not prepare the booking image. Close this and try again.',
  },
  bookingExportPreviewAlt: { vi: 'Ảnh xem trước phiếu booking', en: 'Booking document preview' },

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
  // A lorry's daily fuel policy — a real flag on the vehicle, never the note.
  fuelPolicyLabel: { vi: 'Khai nhiên liệu đầu ca', en: 'Start-of-shift fuel check' },
  fuelPolicyRequired: { vi: 'Bắt buộc', en: 'Required' },
  fuelPolicyNotApplicable: { vi: 'Không áp dụng', en: 'Not applicable' },
  fuelPolicyHint: {
    vi: 'Bắt buộc: tài xế khai nhiên liệu đầu ca, một lần mỗi ngày, trước chuyến đầu tiên của xe.',
    en: 'Required: the driver declares the lorry’s fuel once a day, before its first run.',
  },
  fuelPolicyOutsourced: {
    vi: 'Xe thuê ngoài đã gồm nhiên liệu trong giá thuê, không áp dụng khai nhiên liệu đầu ca.',
    en: 'A hired lorry’s fuel is inside the carrier’s price, so it has no daily fuel check.',
  },
  showArchived: { vi: 'Hiện cả mục đã lưu trữ', en: 'Show archived' },
  // A lorry as an object: the catalogue opens it, its sections are tabs.
  vehicleViewDetail: { vi: 'Xem chi tiết', en: 'View details' },
  vehicleDetailSections: { vi: 'Các mục của xe', en: 'Vehicle sections' },
  vehicleOverview: { vi: 'Tổng quan', en: 'Overview' },
  archiveVehicle: { vi: 'Lưu trữ xe', en: 'Archive vehicle' },
  // "Chi phí xe" — the lorry's own ledger (0034), read only. Never a trip cost.
  vehicleCostsSection: { vi: 'Chi phí xe', en: 'Vehicle costs' },
  vehicleCostsTotal: { vi: 'Tổng chi phí xe', en: 'Total vehicle cost' },
  vehicleCostsTransactions: { vi: 'giao dịch', en: 'transactions' },
  vehicleCostsColDate: { vi: 'Ngày', en: 'Date' },
  vehicleCostsColCategory: { vi: 'Khoản', en: 'Heading' },
  vehicleCostsColAmount: { vi: 'Số tiền', en: 'Amount' },
  vehicleCostsColLiters: { vi: 'Số lít', en: 'Liters' },
  vehicleCostsColOdometer: { vi: 'Công-tơ-mét (km)', en: 'Odometer (km)' },
  vehicleCostsColSource: { vi: 'Nguồn', en: 'Source' },
  vehicleCostsColTrip: { vi: 'Chuyến liên quan', en: 'Related trip' },
  vehicleCostsSourceDriver: { vi: 'Tài xế khai', en: 'Driver declared' },
  vehicleCostsSourceBackoffice: { vi: 'Văn phòng', en: 'Office' },
  vehicleCostsEmpty: { vi: 'Không có chi phí xe trong khoảng ngày này.', en: 'No vehicle costs in this range.' },
  vehicleCostsRangeInvalid: {
    vi: 'Khoảng ngày không hợp lệ: ngày bắt đầu không được sau ngày kết thúc, tối đa 366 ngày.',
    en: 'Invalid range: the start may not be after the end, and at most 366 days.',
  },
  // "Đang hiển thị 200/257 giao dịch mới nhất." — the two counts sit between these.
  vehicleCostsShowing: { vi: 'Đang hiển thị', en: 'Showing' },
  vehicleCostsLatest: { vi: 'giao dịch mới nhất.', en: 'latest transactions.' },
  vehicleCostsTruncated: {
    vi: 'Tổng chi phí vẫn tính trên cả khoảng ngày; thu hẹp khoảng ngày để xem giao dịch cũ hơn.',
    en: 'The total still covers the whole range; narrow the range to see older transactions.',
  },
  // ★ SAYS WHAT THE TRIP COLUMN IS NOT. A cost beside a trip reads as that
  // trip's cost; it is the lorry's, and in no trip's total.
  vehicleCostsNotTripCost: {
    vi: 'Chuyến liên quan: chỉ dùng để truy vết nguồn phát sinh. Chi phí xe không được cộng vào chi phí chuyến.',
    en: 'Related trip: only traces where a cost arose. Vehicle costs are never added to a trip’s cost.',
  },
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
  // The board's cost cell. "Chưa có" is a zero the server counted; the unknown
  // state is a dash, because it is not a zero and must not read as one.
  tripCostNone: { vi: 'Chưa có', en: 'None yet' },
  tripCostItems: { vi: 'khoản', en: 'item(s)' },
  tripCostUnknown: { vi: 'Không rõ chi phí', en: 'Cost unknown' },
  // Hover help on the column header — once, not on every row. The total is the
  // cost dialog's, which counts a driver's lines before they are approved.
  tripCostHelp: {
    vi: 'Tổng các khoản chi phí đã ghi nhận cho chuyến; có thể bao gồm khoản chưa duyệt.',
    en: 'Total of the cost items recorded for this trip; may include items not yet approved.',
  },
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
  // ★ THE WORD ON SCREEN IS "DELETE", THE MECHANISM UNDERNEATH IS NOT. Nothing
  // is destroyed: the row survives with who removed it and when, and only stops
  // counting — which is why every line of copy below says so out loud. The
  // interface speaks the word people already use for this button; the keys, the
  // API and the column keep saying `void`, because that is what still happens.
  voidRecord: { vi: 'Xóa', en: 'Delete' },
  // ★ THE DIALOG NAMES WHAT IT IS ABOUT, THE ROW BUTTON CANNOT. That button
  // lives in a column one word wide and can only say 'Xóa'; the confirmation it
  // opens has the room, and needs it — removing a fuel line and removing a hired
  // truck are not the same act, and a dialog that reads the same for both is one
  // people click through without reading.
  voidCostTitle: { vi: 'Xóa chi phí', en: 'Delete cost' },
  voidHireTitle: { vi: 'Xóa xe thuê ngoài', en: 'Delete hire' },
  confirmVoidCostBody: {
    vi: 'Bạn có chắc muốn xóa khoản chi phí này? Bản ghi vẫn được giữ lại — chỉ là không còn tính vào tổng.',
    en: 'Delete this cost line? It is kept — it simply stops counting.',
  },
  confirmVoidHireBody: {
    vi: 'Bạn có chắc muốn xóa xe thuê ngoài này? Bản ghi vẫn được giữ lại — chỉ là không còn tính vào tổng.',
    en: 'Delete this outsourced hire? It is kept — it simply stops counting.',
  },
  statusVoided: { vi: 'Đã xóa', en: 'Deleted' },
  showVoided: { vi: 'Hiện cả khoản đã xóa', en: 'Show deleted' },
  emptyCosts: { vi: 'Chưa có chi phí xe nhà.', en: 'No own-vehicle cost yet.' },
  emptyHires: { vi: 'Chưa có xe thuê ngoài.', en: 'No outsourced hire yet.' },
  amountHint: {
    vi: 'Nhập số tiền, tối đa 2 số lẻ. Ví dụ: 1,500,000',
    en: 'A positive amount, at most 2 decimals. e.g. 1,500,000',
  },
  // ------------------------------------------------- Toasts (write receipts) --
  // ★ ONE LINE, PAST TENSE, NAMING THE THING THAT MOVED. A toast is read in the
  // corner of the eye while the screen behind it is already redrawing, so it
  // says what happened and nothing else — no "!", no next step, no id. Raised in
  // the mutation hooks (`utils/toast`), never in a component.
  // The button sonner draws on the right of a toast. One word, because that is
  // all the room there is — and it is a key like every other string, so the
  // button is not the one place the interface forgets which language it speaks.
  undo: { vi: 'Hoàn tác', en: 'Undo' },
  toastSignedIn: { vi: 'Đăng nhập thành công', en: 'Signed in' },
  toastSignedOut: { vi: 'Đã đăng xuất', en: 'Signed out' },
  // Says the consequence, because this one ends every session the person has.
  toastPasswordChanged: {
    vi: 'Đã đổi mật khẩu — vui lòng đăng nhập lại',
    en: 'Password changed — please sign in again',
  },
  toastTripStatusUpdated: { vi: 'Đã cập nhật trạng thái chuyến', en: 'Trip status updated' },
  toastDriverAssigned: { vi: 'Đã phân công tài xế', en: 'Driver assigned' },
  toastDriverReplaced: { vi: 'Đã đổi tài xế', en: 'Driver replaced' },
  toastAssignmentEnded: { vi: 'Đã kết thúc phân công', en: 'Assignment ended' },
  // ★ "KHÓA SỔ", NOT "ĐÃ DUYỆT". Approving is irreversible and the receipt is
  // the last chance to say so — but what it closes is THIS ASSIGNMENT's books,
  // not the trip's (ADR-0004). The trip closes only once every active
  // assignment has been approved, which this click cannot know it has done.
  toastCompletionApproved: {
    vi: 'Đã duyệt — chi phí lượt xe này đã khóa sổ',
    en: 'Approved — this assignment is closed',
  },
  toastCompletionRejected: {
    vi: 'Đã trả lại cho tài xế khai lại',
    en: 'Sent back to the driver',
  },
  // The driver portal. Read one-handed, in a cab, so they are shorter still.
  toastEventReported: { vi: 'Đã ghi nhận', en: 'Recorded' },
  toastBookingRequested: { vi: 'Đã gửi yêu cầu — chờ Điều độ duyệt', en: 'Request sent — waiting for Dispatch' },
  toastBookingRequestWithdrawn: { vi: 'Đã rút yêu cầu', en: 'Request withdrawn' },
  toastRequestApproved: { vi: 'Đã duyệt — tài xế đã được giao chuyến', en: 'Approved — the driver is on the trip' },
  toastRequestRejected: { vi: 'Đã từ chối yêu cầu', en: 'Request declined' },
  toastExpenseDeclared: { vi: 'Đã khai chi phí', en: 'Expense declared' },
  toastFuelDeclared: { vi: 'Đã khai nhiên liệu', en: 'Fuel declared' },
  toastFuelFillRecorded: { vi: 'Đã ghi nhận đổ nhiên liệu', en: 'Fill recorded' },
  toastExpenseCorrected: { vi: 'Đã sửa khoản chi phí', en: 'Expense corrected' },
  toastCompletionSubmitted: {
    vi: 'Đã gửi hoàn tất — chờ văn phòng duyệt',
    en: 'Completion sent — waiting for review',
  },

  // ---------------------------------------------------- department admin --
  departmentsSubtitle: {
    vi: 'Tạo phòng, đặt chức năng nghiệp vụ, bổ nhiệm trưởng phòng và chuyển nhân sự.',
    en: 'Create units, set their business function, appoint heads and move people.',
  },
  addDepartment: { vi: 'Thêm phòng', en: 'Add department' },
  editDepartment: { vi: 'Sửa phòng', en: 'Edit department' },
  viewDepartment: { vi: 'Xem', en: 'View' },
  emptyDepartments: { vi: 'Chưa có phòng ban nào.', en: 'No departments yet.' },
  colDepartmentName: { vi: 'Tên phòng', en: 'Name' },
  colFunction: { vi: 'Chức năng', en: 'Function' },
  colSlug: { vi: 'Slug', en: 'Slug' },
  colHead: { vi: 'Trưởng phòng', en: 'Head' },
  colMembers: { vi: 'Thành viên', en: 'Members' },
  departmentActive: { vi: 'Hoạt động', en: 'Active' },
  fieldSlug: { vi: 'Slug *', en: 'Slug *' },
  fieldDepartmentName: { vi: 'Tên phòng *', en: 'Name *' },
  fieldFunction: { vi: 'Chức năng nghiệp vụ', en: 'Business function' },
  slugHint: {
    vi: 'Định danh cố định dùng trong URL và cấu hình — không đổi được sau khi tạo.',
    en: 'A fixed identifier for URLs and configuration — cannot be changed after creation.',
  },
  functionHint: {
    vi: 'Quyết định thành viên phòng giữ quyền nào trên Trip. Bỏ trống = phòng thường.',
    en: 'Decides which trip permissions the unit’s members hold. Empty = ordinary unit.',
  },
  functionNone: { vi: 'Không phân loại', en: 'Not classified' },
  functionSales: { vi: 'Sales', en: 'Sales' },
  functionAccounting: { vi: 'Kế toán', en: 'Accounting' },
  functionDispatch: { vi: 'Điều phối', en: 'Dispatch' },
  functionCustomerService: { vi: 'Customer Service', en: 'Customer Service' },
  fieldRequired: { vi: 'Bắt buộc.', en: 'Required.' },
  departmentCreated: { vi: 'Đã tạo phòng', en: 'Department created' },
  departmentUpdated: { vi: 'Đã cập nhật phòng', en: 'Department updated' },
  headSection: { vi: 'Trưởng phòng', en: 'Department head' },
  noHead: { vi: 'Chưa có trưởng phòng.', en: 'No head appointed.' },
  assignHead: { vi: 'Bổ nhiệm', en: 'Appoint' },
  replaceHead: { vi: 'Thay trưởng phòng', en: 'Replace head' },
  revokeHead: { vi: 'Bãi nhiệm', en: 'Revoke' },
  pickMember: { vi: 'Chọn thành viên…', en: 'Pick a member…' },
  headCandidate: { vi: 'Thành viên bổ nhiệm', en: 'Member to appoint' },
  transferCandidate: { vi: 'Nhân viên cần chuyển', en: 'Employee to move' },
  noMembersToPick: { vi: 'Không có thành viên phù hợp.', en: 'No matching member.' },
  headMustBeMember: {
    vi: 'Chỉ thành viên đang thuộc phòng mới được bổ nhiệm.',
    en: 'Only a current member of the unit can be appointed.',
  },
  headAssigned: { vi: 'Đã bổ nhiệm trưởng phòng', en: 'Head appointed' },
  headRevoked: { vi: 'Đã bãi nhiệm trưởng phòng', en: 'Head revoked' },
  headActionFailed: { vi: 'Không thực hiện được.', en: 'Could not do that.' },
  membersSection: { vi: 'Thành viên', en: 'Members' },
  transferIn: { vi: 'Chuyển vào phòng', en: 'Move into this unit' },
  transferInHint: {
    vi: 'Một người luôn thuộc đúng một phòng: chuyển vào đây sẽ kết thúc phòng hiện tại của họ.',
    en: 'A person belongs to exactly one unit: moving them here ends their current membership.',
  },
  pickEmployee: { vi: 'Chọn nhân viên…', en: 'Pick an employee…' },
  noEmployeesToPick: { vi: 'Không có nhân viên phù hợp.', en: 'No matching employee.' },
  memberTransferred: { vi: 'Đã chuyển vào phòng', en: 'Moved into the unit' },
  transferFailed: { vi: 'Không chuyển được.', en: 'Could not move them.' },
  // ---------------------------- Chứng từ nhiên liệu (PR-2, `cost.import`) --
  accountingSection: { vi: 'Kế toán', en: 'Accounting' },
  fuelReceipts: { vi: 'Chứng từ nhiên liệu', en: 'Fuel receipts' },
  fuelReceiptsSubtitle: {
    vi: 'Gắn chứng từ vào chi phí nhiên liệu ĐÃ GHI ở Chi phí xe hoặc Chi phí chuyến. Màn hình này không tạo chi phí mới.',
    en: 'Attach a receipt to fuel ALREADY recorded on a lorry or a trip. This screen never creates a cost.',
  },
  fuelReceiptsNoAccess: { vi: 'Màn hình này dành cho Kế toán.', en: 'This screen is for Accounting.' },
  fuelVehicle: { vi: 'Xe', en: 'Lorry' },
  fuelPickVehicle: { vi: 'Chọn biển số…', en: 'Pick a plate…' },
  fuelNoVehicle: { vi: 'Không có xe phù hợp.', en: 'No matching lorry.' },
  fuelReceiptDay: { vi: 'Ngày trên chứng từ', en: 'Day on the receipt' },
  fuelAmount: { vi: 'Số tiền', en: 'Amount' },
  fuelLiters: { vi: 'Số lít', en: 'Liters' },
  fuelVendorName: { vi: 'Cây xăng', en: 'Station' },
  fuelVendorTaxCode: { vi: 'Mã số thuế', en: 'Tax code' },
  fuelDocumentSeries: { vi: 'Ký hiệu', en: 'Series' },
  fuelDocumentNumber: { vi: 'Số hoá đơn', en: 'Invoice no.' },
  fuelImagesLabel: { vi: 'Ảnh chứng từ', en: 'Receipt images' },
  fuelImagesHint: {
    vi: 'JPEG, PNG hoặc WebP, tối đa 2 MB mỗi ảnh. Ảnh HEIC của iPhone: chụp lại hoặc chọn JPEG.',
    en: 'JPEG, PNG or WebP, up to 2 MB each. iPhone HEIC: retake, or pick JPEG.',
  },
  fuelAddImage: { vi: 'Thêm ảnh', en: 'Add image' },
  fuelRemoveImage: { vi: 'Bỏ ảnh', en: 'Remove image' },
  fuelUploading: { vi: 'Đang tải lên…', en: 'Uploading…' },
  fuelSearch: { vi: 'Tìm chi phí đã ghi', en: 'Find the recorded cost' },
  fuelSearchFailed: { vi: 'Không tìm được — kiểm tra các trường đã nhập.', en: 'Could not search — check the fields.' },
  fuelOutcomeNone: { vi: 'Không có chi phí nhiên liệu đã ghi nào khớp chứng từ này.', en: 'No recorded fuel cost matches this receipt.' },
  fuelOutcomeSingle: { vi: 'Tìm thấy 1 chi phí khớp chứng từ.', en: 'One recorded cost matches this receipt.' },
  fuelOutcomeAmbiguous: { vi: 'Nhiều chi phí giống chứng từ', en: 'Several costs look like this receipt' },
  fuelNoCreateHint: {
    vi: 'Màn hình này không tạo chi phí mới. Hãy ghi chi phí theo đúng quy trình trước, rồi quay lại gắn chứng từ.',
    en: 'This screen does not create costs. Record the cost through its own workflow first, then attach the receipt.',
  },
  fuelPickHint: {
    vi: 'Hệ thống không tự chọn. Kiểm tra từng dòng và bấm “Gắn vào chi phí này” ở đúng một chi phí.',
    en: 'Nothing is chosen for you. Check each row and press “Attach here” on exactly one cost.',
  },
  fuelLevelExact: { vi: 'Trùng ảnh', en: 'Same image' },
  fuelLevelHigh: { vi: 'Trùng số hoá đơn', en: 'Same invoice' },
  fuelLevelPossible: { vi: 'Khớp số tiền', en: 'Same amount' },
  fuelLedgerVehicle: { vi: 'Đã ghi ở Chi phí xe', en: 'Recorded on the lorry' },
  fuelLedgerTrip: { vi: 'Đã ghi ở Chi phí chuyến', en: 'Recorded on a trip' },
  fuelDayRows: { vi: 'Chi phí nhiên liệu khác của xe quanh ngày này', en: 'The lorry’s other fuel around this day' },
  fuelLorryUnknown: { vi: 'chưa rõ xe', en: 'lorry unknown' },
  fuelSourceDriver: { vi: 'Tài xế ghi', en: 'Driver' },
  fuelSourceOffice: { vi: 'Văn phòng ghi', en: 'Office' },
  fuelTrip: { vi: 'Chuyến', en: 'Trip' },
  fuelWrapped: { vi: 'Đã có hồ sơ nhiên liệu', en: 'Has a fuel record' },
  fuelNotWrapped: { vi: 'Chưa có hồ sơ nhiên liệu', en: 'No fuel record yet' },
  fuelImageCount: { vi: 'ảnh', en: 'image(s)' },
  fuelBlockedVoided: { vi: 'Chi phí đã huỷ — không gắn được.', en: 'Withdrawn cost — cannot attach.' },
  fuelBlockedConflicts: {
    vi: 'Hồ sơ này đã ghi thông tin khác chứng từ (cây xăng, số hoá đơn hoặc số lít) — đây là chứng từ khác.',
    en: 'This record holds different receipt details (station, invoice or liters) — it is another receipt.',
  },
  fuelAttachHere: { vi: 'Gắn vào chi phí này', en: 'Attach here' },
  fuelAttachTitle: { vi: 'Gắn chứng từ vào chi phí đã ghi', en: 'Attach the receipt to the recorded cost' },
  fuelAttachConfirm: { vi: 'Gắn chứng từ', en: 'Attach' },
  fuelAttachNoCreate: { vi: 'Không tạo chi phí mới; số tiền vẫn là của chi phí đã ghi.', en: 'No new cost; the amount stays the recorded one.' },
  fuelAlsoOnOther: { vi: 'Chứng từ này đã có ở giao dịch khác:', en: 'This receipt is already on another fill:' },
  fuelConfirmDifferent: { vi: 'tôi đã kiểm tra, đây là giao dịch khác', en: 'I checked: it is a different fill' },
  fuelAttachedVehicle: { vi: 'Đã gắn chứng từ vào Chi phí xe · không tạo chi phí mới', en: 'Attached to the lorry’s cost · no new cost' },
  fuelAttachedTrip: { vi: 'Đã gắn chứng từ vào Chi phí chuyến · không tạo chi phí mới', en: 'Attached to the trip’s cost · no new cost' },
  fuelAttachFailed: { vi: 'Không gắn được chứng từ.', en: 'Could not attach the receipt.' },
  fuelOnAnotherFill: {
    vi: 'Chứng từ vừa được gắn vào giao dịch khác — danh sách đã được tải lại, hãy kiểm tra.',
    en: 'The receipt was just put on another fill — the list was reloaded; check it.',
  },
  fuelImageTooLarge: { vi: 'Ảnh quá 2 MB.', en: 'The image is over 2 MB.' },
  fuelImageHeic: { vi: 'Ảnh HEIC chưa được hỗ trợ — chụp lại hoặc chọn JPEG/PNG.', en: 'HEIC is not supported — retake, or pick JPEG/PNG.' },
  fuelImageUnsupported: { vi: 'Không phải ảnh JPEG, PNG hoặc WebP.', en: 'Not a JPEG, PNG or WebP image.' },
  fuelTooManyStaged: { vi: 'Đã có quá nhiều ảnh chờ gắn — bỏ bớt ảnh.', en: 'Too many images waiting — remove some.' },
  fuelStorageUnavailable: { vi: 'Kho chứng từ chưa được cấu hình trên máy chủ.', en: 'Receipt storage is not configured on the server.' },
  fuelUploadFailed: { vi: 'Không tải ảnh lên được.', en: 'Could not upload the image.' },
  fuelDiscardFailed: { vi: 'Không bỏ được ảnh.', en: 'Could not remove the image.' },
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
