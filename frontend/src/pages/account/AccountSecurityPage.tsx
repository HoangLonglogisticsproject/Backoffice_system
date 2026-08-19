import { useState } from "react"
import { Lock, Shield, Key, History, MonitorSmartphone, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import clsx from "clsx"
import { useLanguage } from "@/contexts/LanguageContext"

export default function AccountSecurityPage() {
  const [activeTab, setActiveTab] = useState("password")
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const { t } = useLanguage()

  const tabs = [
    { id: "password", label: t('changePassword'), icon: Lock },
    { id: "2fa", label: t('twoFactorAuth'), icon: Shield },
    { id: "sessions", label: t('sessions'), icon: Key },
    { id: "history", label: t('loginHistory'), icon: History },
    { id: "devices", label: t('devices'), icon: MonitorSmartphone },
  ]

  return (
    <div className="flex flex-col md:flex-row gap-6 max-w-6xl mx-auto">
      {/* Sidebar */}
      <div className="w-full md:w-64 shrink-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-fit">
        <nav className="flex flex-col py-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors w-full text-left",
                  isActive 
                    ? "bg-blue-50 text-blue-600 border-l-2 border-blue-600" 
                    : "text-gray-600 hover:bg-gray-50 border-l-2 border-transparent"
                )}
              >
                <Icon className={clsx("h-4 w-4", isActive ? "text-blue-600" : "text-gray-400")} />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8">
        {activeTab === "password" && (
          <div className="max-w-2xl">
            <div className="mb-8">
              <h1 className="text-xl font-bold text-gray-900 mb-2">{t('changePassword')}</h1>
              <p className="text-sm text-gray-500">
                {t('updatePasswordDesc')}
              </p>
            </div>

            <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">{t('currentPasswordLabel')}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input 
                    type={showCurrentPassword ? "text" : "password"} 
                    placeholder={t('currentPasswordPlaceholder')} 
                    className="pl-10 pr-10"
                  />
                  <button 
                    type="button" 
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">{t('newPasswordLabel')}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input 
                    type={showNewPassword ? "text" : "password"} 
                    placeholder={t('newPasswordPlaceholder')} 
                    className="pl-10 pr-10"
                  />
                  <button 
                    type="button" 
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                
                <div className="mt-3 space-y-1">
                  <p className="text-sm text-gray-500">Mật khẩu mới phải đáp ứng:</p>
                  <ul className="text-xs space-y-1">
                    <li className="flex items-center text-green-600">
                      <svg className="w-3 h-3 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {t('passwordReq1')}
                    </li>
                    <li className="flex items-center text-green-600">
                      <svg className="w-3 h-3 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {t('passwordReq2')}
                    </li>
                    <li className="flex items-center text-green-600">
                      <svg className="w-3 h-3 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {t('passwordReq3')}
                    </li>
                  </ul>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">{t('confirmPasswordLabel')}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <Input 
                    type={showConfirmPassword ? "text" : "password"} 
                    placeholder={t('confirmPasswordPlaceholder')} 
                    className="pl-10 pr-10"
                  />
                  <button 
                    type="button" 
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100 flex justify-end gap-3">
                <Button variant="outline" type="button" className="w-24 border-gray-200">
                  {t('cancel')}
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 gap-2">
                  <Lock className="h-4 w-4" />
                  {t('updatePasswordBtn')}
                </Button>
              </div>
            </form>
          </div>
        )}
        
        {activeTab !== "password" && (
          <div className="flex items-center justify-center h-64 text-gray-400">
            {t('featureInDev')}
          </div>
        )}
      </div>
    </div>
  )
}
