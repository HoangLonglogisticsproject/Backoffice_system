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

export default function MainLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    leads: true,
    organization: true,
    worklist: true,
  })
  
  const location = useLocation()

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const NavItem = ({ to, icon: Icon, label }: { to: string, icon: any, label: string }) => {
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
            <div>
              <div 
                className={clsx(
                  "flex items-center justify-between px-2 mb-2 cursor-pointer text-gray-500 hover:text-gray-800 transition-colors",
                  !isSidebarOpen && "justify-center"
                )}
                onClick={() => isSidebarOpen && toggleSection('leads')}
                title={!isSidebarOpen ? "Leads" : undefined}
              >
                {isSidebarOpen ? (
                  <>
                    <span className="font-semibold text-xs uppercase tracking-wider">Leads</span>
                    {expandedSections['leads'] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </>
                ) : (
                  <Users className="h-5 w-5 mt-1" />
                )}
              </div>
              
              {(!isSidebarOpen || expandedSections['leads']) && (
                <div className="space-y-1">
                  <NavItem to="/leads/pool" icon={Users} label="Pool" />
                  <NavItem to="/leads/my-customers" icon={UserCircle} label="My Customers" />
                </div>
              )}
            </div>

            {/* Organization Section */}
            <div>
              <div 
                className={clsx(
                  "flex items-center justify-between px-2 mb-2 cursor-pointer text-gray-500 hover:text-gray-800 transition-colors",
                  !isSidebarOpen && "justify-center"
                )}
                onClick={() => isSidebarOpen && toggleSection('organization')}
                title={!isSidebarOpen ? "Organization" : undefined}
              >
                {isSidebarOpen ? (
                  <>
                    <span className="font-semibold text-xs uppercase tracking-wider">Organization</span>
                    {expandedSections['organization'] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </>
                ) : (
                  <Building className="h-5 w-5 mt-1" />
                )}
              </div>
              
              {(!isSidebarOpen || expandedSections['organization']) && (
                <div className="space-y-1">
                  <NavItem to="/organization/dashboard" icon={LayoutDashboard} label="Dashboard" />
                  <NavItem to="/organization/departments" icon={Building} label="Departments" />
                  <NavItem to="/organization/department-control-center" icon={Building} label="Control Center" />
                  <NavItem to="/organization/personal-desk" icon={UserCircle} label="Personal Desk" />
                </div>
              )}
            </div>

            {/* Worklist Section */}
            <div>
              <div 
                className={clsx(
                  "flex items-center justify-between px-2 mb-2 cursor-pointer text-gray-500 hover:text-gray-800 transition-colors",
                  !isSidebarOpen && "justify-center"
                )}
                onClick={() => isSidebarOpen && toggleSection('worklist')}
                title={!isSidebarOpen ? "Worklist" : undefined}
              >
                {isSidebarOpen ? (
                  <>
                    <span className="font-semibold text-xs uppercase tracking-wider">Worklist</span>
                    {expandedSections['worklist'] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </>
                ) : (
                  <Briefcase className="h-5 w-5 mt-1" />
                )}
              </div>
              
              {(!isSidebarOpen || expandedSections['worklist']) && (
                <div className="space-y-1">
                  <NavItem to="/worklist/my-work" icon={Briefcase} label="My Work" />
                  <NavItem to="/worklist/all" icon={Briefcase} label="All Work" />
                </div>
              )}
            </div>

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
