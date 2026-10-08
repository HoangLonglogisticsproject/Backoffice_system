import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import DriverLayout from './layouts/DriverLayout'
import { RequireSession } from './components/common/SessionGuard'
import { PageFallback } from './components/common/PageFallback'

/**
 * ★ EVERY PAGE IS LAZY, AND THE SHELLS ARE NOT.
 *
 * These forty imports used to be static, which meant one thing: the browser
 * fetched, parsed and executed the ENTIRE application before it could draw any
 * one screen of it. Measured on the dev server, a reload of
 * `/dispatch/trip-schedule` pulled ~19 MB across 221 requests — including
 * Leaflet (1.1 MB, for the map on a catalogue page nobody was looking at) and
 * the login background (2.1 MB, for a screen the signed-in user had already
 * left). In production it was one 1.05 MB chunk for the same reason.
 *
 * `lazy` makes the route boundary the split point, so a reload costs the
 * current screen and nothing else.
 *
 * ⚠ `MainLayout`, `DriverLayout` and `RequireSession` STAY STATIC, deliberately.
 * They sit on the path to every page, so splitting them would buy nothing and
 * cost an extra round trip before the shell could be drawn — the user would
 * watch an empty page wait for the frame that is supposed to reassure them.
 *
 * Every page is a default export, which is what `lazy` wants.
 */
const PotentialCustomerPoolPage = lazy(() => import('./pages/leads/PotentialCustomerPoolPage'))
const MyCustomersPage = lazy(() => import('./pages/leads/MyCustomersPage'))

const DepartmentOverviewPage = lazy(() => import('./pages/organization/DepartmentOverviewPage'))
const DepartmentWorkspacePage = lazy(() => import('./pages/organization/DepartmentWorkspacePage'))
const DepartmentsPage = lazy(() => import('./pages/organization/DepartmentsPage'))
const DepartmentControlCenterPage = lazy(
  () => import('./pages/organization/DepartmentControlCenterPage'),
)
const PersonalWorkDeskPage = lazy(() => import('./pages/organization/PersonalWorkDeskPage'))
const OrganizationDashboardPage = lazy(
  () => import('./pages/organization/OrganizationDashboardPage'),
)

const MyWorkPage = lazy(() => import('./pages/worklist/MyWorkPage'))
const WorkListPage = lazy(() => import('./pages/worklist/WorkListPage'))

const TripSchedulePage = lazy(() => import('./pages/trip/TripSchedulePage'))
const TripHistoryPage = lazy(() => import('./pages/trip/TripHistoryPage'))
const TripMasterDataPage = lazy(() => import('./pages/trip/TripMasterDataPage'))
// The one that carries Leaflet. Its own chunk now, fetched by the people who
// open the map and by nobody else.
const LocationCataloguePage = lazy(() => import('./pages/trip/LocationCataloguePage'))
const CompletionReviewPage = lazy(() => import('./pages/trip/CompletionReviewPage'))
const FleetOperationsPage = lazy(() => import('./pages/trip/FleetOperationsPage'))
const FuelReceiptPage = lazy(() => import('./pages/trip/FuelReceiptPage'))

const NoAccessPage = lazy(() => import('./pages/system/NoAccessPage'))
const PlaceholderPage = lazy(() => import('./pages/system/PlaceholderPage'))
// Lazy like the rest: it imports a 2.1 MB background, and a signed-in session
// must not pay for it on every reload.
const LoginPage = lazy(() => import('./pages/system/LoginPage'))
const ChangePasswordPage = lazy(() => import('./pages/system/ChangePasswordPage'))
const ApprovalsPage = lazy(() => import('./pages/system/ApprovalsPage'))
const DriverManagementPage = lazy(() => import('./pages/system/DriverManagementPage'))
const EmployeeDetailPage = lazy(() => import('@/pages/organization/EmployeeDetailPage'))
const DriverRequestPage = lazy(() => import('@/pages/organization/DriverRequestPage'))
const EmployeeManagementPage = lazy(() => import('./pages/organization/EmployeeManagementPage'))
const AccountSecurityPage = lazy(() => import('./pages/account/AccountSecurityPage'))
const DriverTripsPage = lazy(() => import('./pages/driver/DriverTripsPage'))
const DriverTripPage = lazy(() => import('./pages/driver/DriverTripPage'))
const DriverHistoryPage = lazy(() => import('./pages/driver/DriverHistoryPage'))
const DriverNotificationsPage = lazy(() => import('./pages/driver/DriverNotificationsPage'))

function App() {
  return (
    /**
     * ★ THE OUTER BOUNDARY, FOR THE TWO ROUTES THAT HAVE NO SHELL.
     *
     * `/login` and `/change-password` render outside both layouts, so nothing
     * below would catch their suspension. The layouts have their OWN boundary
     * around `<Outlet />` — that is what keeps the sidebar and header on screen
     * while a page loads, instead of collapsing the whole frame back to this
     * fallback on every navigation.
     */
    <Suspense fallback={<PageFallback />}>
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
          <Route path="/driver/assignments/:assignmentId" element={<DriverTripPage />} />
          {/* The trips already run to the end. Declared before the catch-all
              below, which would otherwise send it back to the schedule. */}
          <Route path="/driver/history" element={<DriverHistoryPage />} />
          {/* What the driver has been told. The API's list, not the stream's. */}
          <Route path="/driver/notifications" element={<DriverNotificationsPage />} />
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
          {/* The same trips, once finished — a projection, not a second store. */}
          <Route path="/dispatch/trip-history" element={<TripHistoryPage />} />
          <Route path="/dispatch/fleet-operations" element={<FleetOperationsPage />} />
          <Route path="/dispatch/master-data" element={<TripMasterDataPage />} />
          {/* Every place, shared and customer-owned. The customer's own door into
              the same table stays on the master data screen. */}
          <Route path="/dispatch/locations" element={<LocationCataloguePage />} />
          {/* The office side of the SAME completion lifecycle the Driver Portal
              submits into. One model, two counters. */}
          <Route path="/dispatch/completion-review" element={<CompletionReviewPage />} />
          {/* Accounting: receipts onto fuel ALREADY recorded — attach-only, never a new cost. */}
          <Route path="/accounting/fuel-receipts" element={<FuelReceiptPage />} />

          <Route path="/account/security" element={<AccountSecurityPage />} />
          <Route path="/system/approvals" element={<ApprovalsPage />} />
          {/* Driver ACCOUNTS — administration, global only. Trips are dispatch's. */}
          <Route path="/system/drivers" element={<DriverManagementPage />} />
        
          <Route path="/worklist/my-work" element={<MyWorkPage />} />
          <Route path="/worklist/all" element={<WorkListPage />} />
        
          <Route path="/403" element={<NoAccessPage />} />
          <Route path="/placeholder" element={<PlaceholderPage />} />
          <Route path="*" element={<NoAccessPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
