import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Lock } from 'lucide-react'
import logo from '@/assets/img/LOGO.png'
import { useSession } from '@/contexts/SessionProvider'
import { changePassword } from '@/api/auth'
import { isApiError } from '@/utils/errors'

/** Contract §13: a password the USER chooses must be at least 12 characters. */
const MIN_PERMANENT_PASSWORD_LENGTH = 12

/**
 * The two rules the SERVER cannot apply for us, in the order they are asked.
 *
 * The length is checked here for a fast answer only — the server decides
 * regardless and answers 422 (§13). The confirmation is different: the server
 * never sees that field, so this is the only place it can be checked at all.
 *
 * ★ THE CONFIRMATION MATTERS MORE THAN IT LOOKS. A typo becomes a permanent
 * password nobody knows, reached from a temporary credential that is destroyed
 * in the same call — there is no second chance to notice.
 *
 * Returns the message, or `null` when there is nothing to say.
 */
function localValidationError(newPassword: string, confirmPassword: string): string | null {
  if (newPassword.length < MIN_PERMANENT_PASSWORD_LENGTH) {
    return `Mật khẩu mới phải có ít nhất ${MIN_PERMANENT_PASSWORD_LENGTH} ký tự.`
  }
  if (confirmPassword !== newPassword) {
    return 'Mật khẩu xác nhận không khớp.'
  }
  return null
}

/**
 * What to tell somebody about a failed password change.
 *
 * MODULE LEVEL AND PURE, because the mapping is a fact about the RESPONSE and
 * not about this screen's state. Four branches nested inside a `catch` inside a
 * handler cost more than the rest of the handler put together; out here they
 * are a flat list that reads as the table it is.
 *
 * Status 0 is "never reached the server" rather than a made-up 500 — see the
 * transport layer.
 */
function messageFor(failure: unknown): string {
  if (!isApiError(failure)) return 'Đã xảy ra lỗi không mong muốn.'
  if (failure.status === 401) return 'Mật khẩu hiện tại không đúng.'
  if (failure.status === 0) return 'Không kết nối được tới máy chủ.'
  if (failure.status === 422) {
    return failure.details ? Object.values(failure.details).join(' ') : failure.message
  }
  return failure.message
}

/**
 * The only way out of `password-change-required` (contract §12).
 *
 * An account provisioned by an administrator holds a temporary credential, and
 * every endpoint except the four identity ones answers 403 until it is
 * replaced. Without this screen that state has no exit, which is exactly the
 * lockout §3b warns about.
 *
 * Succeeding here ends EVERY session including this one (§1), so the only
 * correct next step is the login screen.
 */
export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()
  const { state, loading, signOut } = useSession()

  if (loading || state === null) return null
  // Only reachable while signed in. Anonymous belongs on login; a caller who
  // already finished provisioning has no reason to be here.
  if (state.status === 'anonymous') return <Navigate to="/login" replace />

  const displayName =
    state.status === 'password-change-required' ? state.identity.displayName : undefined

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // The button is disabled while in flight, but Enter submits the form
    // directly and never touches it. A second change-password call answers 401
    // — the first one already revoked the session it authenticated with.
    if (submitting) return
    setError(null)

    const invalid = localValidationError(newPassword, confirmPassword)
    if (invalid) {
      setError(invalid)
      return
    }

    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      // Every session died server-side. Clear local state and send them back
      // to log in with the new password.
      await signOut()
      navigate('/login', { replace: true })
    } catch (error_) {
      setError(messageFor(error_))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#f4f7f6] p-4">
      <Card className="w-full max-w-[440px] shadow-[0_8px_30px_rgb(0,0,0,0.08)] border-0 bg-white rounded-2xl overflow-hidden py-10 px-6 sm:px-10">
        <CardContent className="p-0">
          <div className="flex justify-center mb-6">
            <img src={logo} alt="Logo" className="h-[130px] object-contain" />
          </div>

          <div className="text-center mb-8">
            <h1 className="text-[28px] font-bold text-[#1b3670] mb-2 tracking-tight">Đổi mật khẩu</h1>
            <p className="text-[15px] text-gray-500">
              {displayName
                ? `${displayName}, vui lòng đặt mật khẩu mới để tiếp tục.`
                : 'Vui lòng đặt mật khẩu mới để tiếp tục.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="currentPassword" className="text-[13px] font-bold text-gray-700 ml-1">
                Mật khẩu hiện tại
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Lock className="h-[18px] w-[18px]" />
                </div>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu hiện tại"
                  className="pl-11 py-[22px] bg-transparent border-[#e2e8f0] text-gray-700 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-[#1b3670] rounded-xl shadow-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-[13px] font-bold text-gray-700 ml-1">
                Mật khẩu mới
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Lock className="h-[18px] w-[18px]" />
                </div>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PERMANENT_PASSWORD_LENGTH}
                  placeholder={`Ít nhất ${MIN_PERMANENT_PASSWORD_LENGTH} ký tự`}
                  className="pl-11 py-[22px] bg-transparent border-[#e2e8f0] text-gray-700 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-[#1b3670] rounded-xl shadow-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-[13px] font-bold text-gray-700 ml-1">
                Nhập lại mật khẩu mới
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Lock className="h-[18px] w-[18px]" />
                </div>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PERMANENT_PASSWORD_LENGTH}
                  placeholder={`Ít nhất ${MIN_PERMANENT_PASSWORD_LENGTH} ký tự`}
                  className="pl-11 py-[22px] bg-transparent border-[#e2e8f0] text-gray-700 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-[#1b3670] rounded-xl shadow-sm"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-[52px] mt-4 bg-[#203a7a] hover:bg-[#152755] text-white text-[16px] font-bold rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? 'Đang lưu…' : 'Đổi mật khẩu'}
            </Button>

            <p className="text-[13px] text-gray-500 text-center">
              Sau khi đổi, bạn sẽ cần đăng nhập lại bằng mật khẩu mới.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
