import { useState } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { 
  ChevronDown, 
  ChevronRight, 
  Menu, 
  LogOut, 
  Users, 
  Building, 
  Briefcase,
  LayoutDashboard,
  UserCircle
} from 'lucide-react'
import clsx from 'clsx'

const NavItem = ({ to, icon: Icon, label, isSidebarOpen }: { to: string, icon: any, label: string, isSidebarOpen: boolean }) => {
  const location = useLocation()
  const isActive = location.pathname.startsWith(to)
  return (
    <Link to={to} className="w-full block mb-1">
      <Button 
        variant={isActive ? "secondary" : "ghost"} 
        className={clsx(
          "w-full justify-start transition-all", 
          !isSidebarOpen && "justify-center px-2",
          isActive && "font-semibold"
        )}
        title={!isSidebarOpen ? label : undefined}
      >
        <Icon className={clsx("h-5 w-5 shrink-0", isSidebarOpen && "mr-3")} />
        {isSidebarOpen && <span>{label}</span>}
      </Button>
    </Link>
  )
}

const SidebarSection = ({ 
  title, 
  icon: Icon, 
  sectionKey, 
  isSidebarOpen, 
  expandedSections, 
  toggleSection,
  children 
}: { 
  title: string, 
  icon: any, 
  sectionKey: string, 
  isSidebarOpen: boolean, 
  expandedSections: Record<string, boolean>, 
  toggleSection: (key: string) => void,
  children: React.ReactNode
}) => {
  return (
    <div>
      <button 
        type="button"
        className={clsx(
          "w-full flex items-center justify-between px-2 mb-2 cursor-pointer text-gray-500 hover:text-gray-800 transition-colors focus:outline-none rounded",
          !isSidebarOpen && "justify-center"
        )}
        onClick={() => isSidebarOpen && toggleSection(sectionKey)}
        title={!isSidebarOpen ? title : undefined}
      >
        {isSidebarOpen ? (
          <>
            <span className="font-semibold text-xs uppercase tracking-wider">{title}</span>
            {expandedSections[sectionKey] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </>
        ) : (
          <Icon className="h-5 w-5 mt-1" />
        )}
      </button>
      
      {(!isSidebarOpen || expandedSections[sectionKey]) && (
        <div className="space-y-1">
          {children}
        </div>
      )}
    </div>
  )
}

export default function MainLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    leads: true,
    organization: true,
    worklist: true,
  })

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 font-sans text-gray-800">
      {/* Header */}
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-extrabold text-blue-600 hidden sm:block">Backoffice System</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-blue-100 transition-all">
              <AvatarImage src="" />
              <AvatarFallback className="bg-blue-100 text-blue-700 font-bold">AD</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium hidden sm:block">Admin User</span>
          </div>
          <div className="h-6 w-px bg-gray-200 hidden sm:block"></div>
          <Button variant="outline" size="sm" className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-gray-200">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
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
          <nav className="flex-1 overflow-y-auto p-3 space-y-6 mt-2 custom-scrollbar">
            
            {/* Leads Section */}
            {/* Leads Section */}
            <SidebarSection
              title="Leads"
              icon={Users}
              sectionKey="leads"
              isSidebarOpen={isSidebarOpen}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
            >
              <NavItem to="/leads/pool" icon={Users} label="Pool" isSidebarOpen={isSidebarOpen} />
              <NavItem to="/leads/my-customers" icon={UserCircle} label="My Customers" isSidebarOpen={isSidebarOpen} />
            </SidebarSection>

            {/* Organization Section */}
            <SidebarSection
              title="Organization"
              icon={Building}
              sectionKey="organization"
              isSidebarOpen={isSidebarOpen}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
            >
              <NavItem to="/organization/dashboard" icon={LayoutDashboard} label="Dashboard" isSidebarOpen={isSidebarOpen} />
              <NavItem to="/organization/departments" icon={Building} label="Departments" isSidebarOpen={isSidebarOpen} />
              <NavItem to="/organization/department-control-center" icon={Building} label="Control Center" isSidebarOpen={isSidebarOpen} />
              <NavItem to="/organization/personal-desk" icon={UserCircle} label="Personal Desk" isSidebarOpen={isSidebarOpen} />
            </SidebarSection>

            {/* Worklist Section */}
            <SidebarSection
              title="Worklist"
              icon={Briefcase}
              sectionKey="worklist"
              isSidebarOpen={isSidebarOpen}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
            >
              <NavItem to="/worklist/my-work" icon={Briefcase} label="My Work" isSidebarOpen={isSidebarOpen} />
              <NavItem to="/worklist/all" icon={Briefcase} label="All Work" isSidebarOpen={isSidebarOpen} />
            </SidebarSection>

          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
