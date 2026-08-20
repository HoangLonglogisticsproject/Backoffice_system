import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'

import PotentialCustomerPoolPage from './pages/leads/PotentialCustomerPoolPage'
import MyCustomersPage from './pages/leads/MyCustomersPage'

import DepartmentOverviewPage from './pages/organization/DepartmentOverviewPage'
import DepartmentWorkspacePage from './pages/organization/DepartmentWorkspacePage'
import DepartmentsPage from './pages/organization/DepartmentsPage'
import DepartmentControlCenterPage from './pages/organization/DepartmentControlCenterPage'
import PersonalWorkDeskPage from './pages/organization/PersonalWorkDeskPage'
import OrganizationDashboardPage from './pages/organization/OrganizationDashboardPage'

import MyWorkPage from './pages/worklist/MyWorkPage'
import WorkListPage from './pages/worklist/WorkListPage'

import NoAccessPage from './pages/system/NoAccessPage'
import PlaceholderPage from './pages/system/PlaceholderPage'
import LoginPage from './pages/system/LoginPage'
import ChangePasswordPage from './pages/system/ChangePasswordPage'
import ApprovalsPage from './pages/system/ApprovalsPage'
import EmployeeManagementPage from './pages/organization/EmployeeManagementPage'
import AccountSecurityPage from './pages/account/AccountSecurityPage'
import { RequireSession } from './lib/session/RequireSession'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      {/* Everything below needs a session. RequireSession routes the three
          session states (§3b); it does not decide permissions — the server
          does that on every request. */}
      <Route
        element={
          <RequireSession>
            <MainLayout />
          </RequireSession>
        }
      >
        <Route path="/" element={<OrganizationDashboardPage />} />
        
        <Route path="/leads/pool" element={<PotentialCustomerPoolPage />} />
        <Route path="/leads/my-customers" element={<MyCustomersPage />} />
        
        <Route path="/organization/dashboard" element={<OrganizationDashboardPage />} />
        <Route path="/organization/departments" element={<DepartmentsPage />} />
        <Route path="/organization/department/:id/overview" element={<DepartmentOverviewPage />} />
        <Route path="/organization/department/:id/workspace" element={<DepartmentWorkspacePage />} />
        <Route path="/organization/department-control-center" element={<DepartmentControlCenterPage />} />
        <Route path="/organization/personal-desk" element={<PersonalWorkDeskPage />} />
        {/* Harvested from the UI branch, on real data. */}
        <Route
          path="/organization/department/:departmentId/members"
          element={<EmployeeManagementPage />}
        />

        <Route path="/account/security" element={<AccountSecurityPage />} />
        <Route path="/system/approvals" element={<ApprovalsPage />} />
        
        <Route path="/worklist/my-work" element={<MyWorkPage />} />
        <Route path="/worklist/all" element={<WorkListPage />} />
        
        <Route path="/403" element={<NoAccessPage />} />
        <Route path="/placeholder" element={<PlaceholderPage />} />
        <Route path="*" element={<NoAccessPage />} />
      </Route>
    </Routes>
  )
}

export default App
