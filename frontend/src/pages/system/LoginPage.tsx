import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import logo from '@/assets/img/LOGO.png'
import bgImage from '@/assets/img/bg-login.png'

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    navigate('/')
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
              
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-gray-700 ml-1">Email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <Mail className="h-[18px] w-[18px]" />
                  </div>
                  <Input 
                    type="email" 
                    placeholder="Nhập email của bạn" 
                    className="pl-11 py-[22px] bg-transparent border-[#e2e8f0] text-gray-700 placeholder:text-gray-400 focus-visible:ring-1 focus-visible:ring-[#1b3670] rounded-xl shadow-sm"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-bold text-gray-700 ml-1">Mật khẩu</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                    <Lock className="h-[18px] w-[18px]" />
                  </div>
                  <Input 
                    type={showPassword ? "text" : "password"}
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
                className="w-full h-[52px] mt-4 bg-[#203a7a] hover:bg-[#152755] text-white text-[16px] font-bold rounded-xl shadow-md transition-all active:scale-[0.98]"
              >
                Đăng nhập
              </Button>

            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
