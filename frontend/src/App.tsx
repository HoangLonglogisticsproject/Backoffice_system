import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import DriverLayout from './layouts/DriverLayout'

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

import TripSchedulePage from './pages/trip/TripSchedulePage'
import TripMasterDataPage from './pages/trip/TripMasterDataPage'
import CompletionReviewPage from './pages/trip/CompletionReviewPage'

import NoAccessPage from './pages/system/NoAccessPage'
import PlaceholderPage from './pages/system/PlaceholderPage'
import LoginPage from './pages/system/LoginPage'
import ChangePasswordPage from './pages/system/ChangePasswordPage'
import ApprovalsPage from './pages/system/ApprovalsPage'
import EmployeeDetailPage from '@/pages/organization/EmployeeDetailPage'
import DriverRequestPage from '@/pages/organization/DriverRequestPage'
import EmployeeManagementPage from './pages/organization/EmployeeManagementPage'
import AccountSecurityPage from './pages/account/AccountSecurityPage'
import DriverTripsPage from './pages/driver/DriverTripsPage'
import DriverTripPage from './pages/driver/DriverTripPage'
import { RequireSession } from './components/common/SessionGuard'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      {/* ★ THE DRIVER PORTAL HAS ITS OWN SHELL, NOT `MainLayout`.
          `MainLayout` is a backoffice sidebar of departments, approvals and
          dispatch — every link on it leads somewhere a driver has no business
          and the server would refuse. A menu that offers what the server will
          403 is worse than no menu.

          It still sits behind `RequireSession`: this is navigation, not
          authorization. The server re-decides every request, and the portal's
          own routes are guarded there by the active assignment. */}
      <Route
        element={
          <RequireSession portal="driver">
            <DriverLayout />
          </RequireSession>
        }
      >
        <Route path="/driver" element={<DriverTripsPage />} />
        <Route path="/driver/trips/:tripId" element={<DriverTripPage />} />
        {/* The one account function a driver has: their password. Same page
            as the Backoffice's, inside the driver's own shell. */}
        <Route path="/driver/account/security" element={<AccountSecurityPage />} />
        {/* An unknown `/driver/...` path is a mistyped one, and the only
            useful answer is the trip list. */}
        <Route path="/driver/*" element={<Navigate to="/driver" replace />} />
      </Route>

      {/* Everything below needs a session. RequireSession routes the three
          session states (§3b) and the account to its own shell — a driver
          holding any of these URLs is sent to `/driver`. It does not decide
          permissions; the server does that on every request. */}
      <Route
        element={
          <RequireSession portal="backoffice">
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
        {/* ★ KEYED BY THE PERSON. Both rosters link here with `user.id`; a
            membership id would scope the page to one employment period. */}
        <Route path="/organization/employee/:userId" element={<EmployeeDetailPage />} />
        {/* Both audiences use one route; the page shows the queue to an
            administrator and only their own proposals to a head. */}
        <Route path="/organization/driver-requests" element={<DriverRequestPage />} />

        {/* Dispatch. No department segment on purpose — the trip schedule is
            company-wide data, so there is no unit to scope it to (§21). */}
        <Route path="/dispatch/trip-schedule" element={<TripSchedulePage />} />
        <Route path="/dispatch/master-data" element={<TripMasterDataPage />} />
        {/* The office side of the SAME completion lifecycle the Driver Portal
            submits into. One model, two counters. */}
        <Route path="/dispatch/completion-review" element={<CompletionReviewPage />} />

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
