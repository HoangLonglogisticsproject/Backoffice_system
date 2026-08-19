import { isApiError } from '@/lib/http/apiError'

/**
 * How long to wait, phrased for a person (§11: 429 carries `Retry-After`).
 *
 * Pure and separate so the 429 branch below is one line rather than a nested
 * conditional inside a conditional inside a catch.
 */
function tooManyAttemptsMessage(retryAfterSeconds: number | undefined): string {
  return retryAfterSeconds
    ? `Bạn đã thử quá nhiều lần. Vui lòng đợi ${Math.ceil(retryAfterSeconds / 60)} phút.`
    : 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.'
}

/**
 * Turns a failed sign-in into the sentence shown to the user.
 *
 * Extracted from the submit handler because classifying an error and running a
 * form are two jobs, and only one of them is worth reading when the other
 * breaks. Being pure, it can be checked directly — see the spec beside this
 * file — which the branching could not be while it lived inside a `catch`.
 *
 * Branches on STATUS and CODE only, never on message text (§11): the backend is
 * free to reword a message, and a client that matched on wording would break
 * silently when it did.
 *
 * A `switch` rather than an `else if` chain, for the same reason the extraction
 * happened: each arm is a mapping, not a decision that depends on the previous
 * one.
 */
export function loginErrorMessage(error: unknown): string {
  // Anything that never passed through the transport layer is a programming
  // fault, not an answer from the server.
  if (!isApiError(error)) return 'Đã xảy ra lỗi không mong muốn.'

  switch (error.status) {
    case 401:
      // Deliberately says nothing about whether the account exists — the
      // backend does not either.
      return 'Email hoặc mật khẩu không đúng.'
    case 429:
      return tooManyAttemptsMessage(error.retryAfterSeconds)
    case 422:
      return 'Vui lòng nhập email và mật khẩu hợp lệ.'
    case 0:
      return 'Không kết nối được tới máy chủ.'
    default:
      return error.message
  }
}
