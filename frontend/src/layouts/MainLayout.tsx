import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { 
  ChevronDown, 
  ChevronRight, 
  Menu, 
  LogOut, 
  Building, 
  Briefcase,
  LayoutDashboard,
  TrendingUp,
  Box,
  Megaphone,
  DollarSign,
  Code,
  Shield,
  Inbox,
  CheckSquare,
  FileText,
  BarChart2,
  Sparkles,
  Settings,
  Users
} from 'lucide-react'
import clsx from 'clsx'
import { useLanguage } from '@/contexts/LanguageContext'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const NavItem = ({ to, icon: Icon, label, badge, isSidebarOpen }: { to: string, icon: any, label: string, badge?: number, isSidebarOpen: boolean }) => {
  const location = useLocation()
  const isActive = location.pathname.startsWith(to)
  return (
    <Link to={to} className="w-full block mb-1">
      <Button 
        variant={isActive ? "secondary" : "ghost"} 
        className={clsx(
          "w-full justify-start transition-all text-sm font-medium", 
          !isSidebarOpen && "justify-center px-2",
          isActive ? "font-semibold text-blue-700 bg-blue-50/50" : "text-gray-600 hover:text-gray-900"
        )}
        title={!isSidebarOpen ? label : undefined}
      >
        <Icon className={clsx("h-5 w-5 shrink-0", isSidebarOpen && "mr-3", isActive ? "text-blue-600" : "text-gray-500")} />
        {isSidebarOpen && (
          <div className="flex items-center justify-between flex-1">
            <span>{label}</span>
            {badge !== undefined && (
              <span className="flex items-center text-xs text-gray-500">
                <span className="w-1 h-1 rounded-full bg-blue-400 mr-2"></span>
                {badge}
              </span>
            )}
          </div>
        )}
      </Button>
    </Link>
  )
}

const SidebarSection = ({ 
  title, 
  isSidebarOpen, 
  children 
}: { 
  title: string, 
  isSidebarOpen: boolean, 
  children: React.ReactNode
}) => {
  return (
    <div className="mb-6">
      <div 
        className={clsx(
          "px-3 mb-2 flex items-center transition-colors",
          !isSidebarOpen && "justify-center"
        )}
      >
        {isSidebarOpen ? (
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
        ) : (
          <div className="h-px w-8 bg-gray-200 my-2"></div>
        )}
      </div>
      
      <div className="space-y-0.5 px-2">
        {children}
      </div>
    </div>
  )
}

const VNFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" className="w-5 h-4 shrink-0 rounded-[2px] shadow-sm">
    <rect width="60" height="40" fill="#da251d"/>
    <polygon points="30,8 35.3,24.3 21.4,14.2 38.6,14.2 24.7,24.3" fill="#ffcd00"/>
  </svg>
)

const USFlag = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" className="w-5 h-4 shrink-0 rounded-[2px] shadow-sm">
    <rect width="60" height="40" fill="#bd3d44"/>
    <rect width="60" height="3.07" y="3.07" fill="#fff"/>
    <rect width="60" height="3.07" y="9.23" fill="#fff"/>
    <rect width="60" height="3.07" y="15.38" fill="#fff"/>
    <rect width="60" height="3.07" y="21.53" fill="#fff"/>
    <rect width="60" height="3.07" y="27.69" fill="#fff"/>
    <rect width="60" height="3.07" y="33.84" fill="#fff"/>
    <rect width="24" height="21.53" fill="#192f5d"/>
    <circle cx="4" cy="4" r="1" fill="#fff"/>
    <circle cx="12" cy="4" r="1" fill="#fff"/>
    <circle cx="20" cy="4" r="1" fill="#fff"/>
    <circle cx="8" cy="8" r="1" fill="#fff"/>
    <circle cx="16" cy="8" r="1" fill="#fff"/>
    <circle cx="4" cy="12" r="1" fill="#fff"/>
    <circle cx="12" cy="12" r="1" fill="#fff"/>
    <circle cx="20" cy="12" r="1" fill="#fff"/>
    <circle cx="8" cy="16" r="1" fill="#fff"/>
    <circle cx="16" cy="16" r="1" fill="#fff"/>
  </svg>
)

export default function MainLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const { language, setLanguage, t } = useLanguage()

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 font-sans text-gray-800">
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-extrabold text-blue-600 hidden sm:block">{t('backofficeSystem')}</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="mr-2">
            <Select value={language} onValueChange={(val) => setLanguage(val as 'vi' | 'en')}>
              <SelectTrigger className="w-[85px] h-9 bg-gray-50/50 border-gray-200 px-2.5">
                {language === 'vi' ? (
                  <span className="flex items-center gap-2"><VNFlag /> VN</span>
                ) : (
                  <span className="flex items-center gap-2"><USFlag /> US</span>
                )}
              </SelectTrigger>
              <SelectContent className="min-w-[85px] w-[85px]">
                <SelectItem value="vi" className="pl-2 pr-6">
                  <span className="flex items-center gap-2"><VNFlag /> VN</span>
                </SelectItem>
                <SelectItem value="en" className="pl-2 pr-6">
                  <span className="flex items-center gap-2"><USFlag /> US</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Link to="/account/security" className="flex items-center gap-3 hover:bg-gray-50 p-1.5 rounded-lg transition-colors cursor-pointer">
            <Avatar className="h-8 w-8 hover:ring-2 hover:ring-blue-100 transition-all">
              <AvatarImage src="" />
              <AvatarFallback className="bg-blue-100 text-blue-700 font-bold">AD</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium hidden sm:block">{t('adminUser')}</span>
          </Link>
          <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
          <Button variant="outline" size="sm" className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-200">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('logout')}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside 
          className={clsx(
            "bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out",
            isSidebarOpen ? "w-64" : "w-16"
          )}
        >
          <nav className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            
            {/* Chung Section */}
            <SidebarSection
              title={t('common')}
              isSidebarOpen={isSidebarOpen}
            >
              <NavItem to="/overview" icon={LayoutDashboard} label={t('overview')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/my-work" icon={Briefcase} label={t('myWork')} badge={12} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/departments" icon={Building} label={t('departments')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/organization/employees" icon={Users} label={t('employees')} isSidebarOpen={isSidebarOpen} />
            </SidebarSection>

            {/* Phòng ban Section */}
            <SidebarSection
              title={t('departmentsSection')}
              isSidebarOpen={isSidebarOpen}
            >
              <NavItem to="/departments/sales" icon={TrendingUp} label={t('sales')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/departments/operations" icon={Box} label={t('operations')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/departments/marketing" icon={Megaphone} label={t('marketing')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/departments/finance" icon={DollarSign} label={t('finance')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/departments/it" icon={Code} label={t('it')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/departments/legal" icon={Shield} label={t('legal')} isSidebarOpen={isSidebarOpen} />
            </SidebarSection>

            {/* Hệ thống Section */}
            <SidebarSection
              title={t('system')}
              isSidebarOpen={isSidebarOpen}
            >
              <NavItem to="/system/requests" icon={Inbox} label={t('requests')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/system/approvals" icon={CheckSquare} label={t('approvals')} badge={7} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/system/documents" icon={FileText} label={t('documents')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/system/reports" icon={BarChart2} label={t('reports')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/system/ai-coordinator" icon={Sparkles} label={t('aiCoordinator')} isSidebarOpen={isSidebarOpen} />
              <NavItem to="/system/settings" icon={Settings} label={t('settings')} isSidebarOpen={isSidebarOpen} />
            </SidebarSection>

          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
