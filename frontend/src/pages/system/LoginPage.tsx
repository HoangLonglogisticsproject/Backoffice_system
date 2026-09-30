import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import logo from '@/assets/img/LOGO.png'
/**
 * ★ WEBP, AND THE PNG IT REPLACED WAS 2.1 MB FOR NO REASON.
 *
 * The source was a photograph saved as lossless 32-bit RGBA PNG — decoded, its
 * alpha channel was 1,064,448 pixels of solid 0xFF, so a quarter of the file
 * was a constant. On a throttled connection it was measured taking 18.2 s, and
 * it was the single heaviest thing this screen loads. Re-encoded at the same
 * 1584×672, WebP q80 is 135 kB: the same picture, 1/15th of the bytes, behind
 * a dark overlay and a card where the difference is not visible.
 *
 * The PNG is kept in the repo as the master to re-encode from.
 */
import bgImage from '@/assets/img/bg-login.webp'
import { useSession } from '@/contexts/SessionProvider'
import { homeOf } from '@/utils/portal'
import { loginErrorMessage } from './loginErrorMessage'

/**
 * Login. The layout is unchanged; what was added is the part that talks to the
 * server, which this screen previously did not do at all.
 *
 * The email field submits as `subject` — that mapping lives in the repository
 * (contract §1), not here.
 */
/**
 * Where the guard asked us to send them back to, if it named anywhere.
 *
 * ★ READ BY BOTH EXITS FROM THIS SCREEN, WHICH IS THE WHOLE POINT. Only the
 * sign-in handler used to read it. The other exit — already signed in, so
 * redirect — sent everybody to `homeOf(...)`, and a session that resolved a
 * moment AFTER the guard had already bounced it here took that exit: the user
 * pressed F5 on `/dispatch/trip-schedule` and landed on `/`, with the
 * destination the guard had carefully attached sitting unread in
 * `location.state`.
 *
 * `/login` is excluded because returning somebody to the screen they are
 * standing on is a loop, not a destination.
 */
const returnTo = (locationState: unknown): string | undefined => {
  const from = (locationState as { from?: string } | null)?.from
  return from && from !== '/login' ? from : undefined
}

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { state, signIn } = useSession()

  // Already signed in: `password-change-required` has its own screen, and
  // sending it to "/" would bounce straight back here.
  //
  // The aimed-at page wins over the home screen — a reload that passed through
  // here must end where it started. `homeOf` is the fallback, for somebody who
  // opened `/login` on their own; the guard still re-routes a driver holding a
  // Backoffice URL, so honouring `from` cannot land anyone in the wrong shell.
  if (state?.status === 'ready') {
    return <Navigate to={returnTo(location.state) ?? homeOf(state.authorization)} replace />
  }
  if (state?.status === 'password-change-required') return <Navigate to="/change-password" replace />

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await signIn(email, password)
      // Where to go next is the SESSION's answer, not this screen's: a
      // temporary credential must land on the change-password screen. The
      // guard reads the reloaded state and routes accordingly — which is also
      // why the fallback here is `/` rather than `homeOf`: the new session has
      // not arrived yet at this point, so there is nothing to ask.
      navigate(returnTo(location.state) ?? '/', { replace: true })
    } catch (error_) {
      setError(loginErrorMessage(error_))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex relative overflow-hidden bg-[#f4f7f6]">

      {/* Background decoration for the right side (diagonal stripes pattern) */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40" style={{
        backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 15px, rgba(0,0,0,0.02) 15px, rgba(0,0,0,0.02) 16px)'
      }}></div>

      {/* Background image: full cover on mobile, diagonal panel on desktop */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div
          className="block lg:hidden absolute inset-0"
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        >
          <div className="absolute inset-0 bg-[#0b1f3d]/20" />
        </div>

        <div className="hidden lg:block absolute inset-0">
          <div
            className="absolute inset-0 shadow-[10px_0_30px_rgba(0,0,0,0.15)]"
            style={{
              backgroundImage: `url(${bgImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              clipPath: 'polygon(0 0, 64% 0, 48% 100%, 0% 100%)'
            }}
          >
            <div className="absolute inset-0 bg-blue-900/5 mix-blend-multiply" />
          </div>
        </div>
      </div>

      {/* Right side: Login Form Container */}
      <div className="w-full flex items-center justify-center lg:justify-end lg:pr-[12%] xl:pr-[15%] relative z-10 p-4">
        <Card className="w-full max-w-[440px] shadow-[0_8px_30px_rgb(0,0,0,0.08)] border-0 bg-white rounded-2xl overflow-hidden py-10 px-6 sm:px-10">
          <CardContent className="p-0">
            {/* Logo */}
            <div className="flex justify-center mb-6">
              <img src={logo} alt="Logo" className="h-[130px] object-contain" />
            </div>

            {/* Header Texts */}
            <div className="text-center mb-8">
              <h1 className="text-[28px] font-bold text-[#1b3670] mb-2 tracking-tight">Đăng nhập</h1>
              <p className="text-[15px] text-gray-500">Vui lòng đăng nhập để tiếp tục</p>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-5">

              {error && (
                <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-[13px] font-bold text-gray-700 ml-1">Email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <Mail className="h-[18px] w-[18px]" />
                  </div>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    placeholder="Nhập email của bạn"
                    className="pl-11 py-[22px] bg-transparent border-[#e2e8f0] text-gray-700 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-[#1b3670] rounded-xl shadow-sm"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-[13px] font-bold text-gray-700 ml-1">Mật khẩu</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <Lock className="h-[18px] w-[18px]" />
                  </div>
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu của bạn"
                    className="pl-11 pr-11 py-[22px] bg-transparent border-[#e2e8f0] text-gray-700 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-[#1b3670] rounded-xl shadow-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-[52px] mt-4 bg-[#203a7a] hover:bg-[#152755] text-white text-[16px] font-bold rounded-xl shadow-md transition-all active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </Button>

            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
