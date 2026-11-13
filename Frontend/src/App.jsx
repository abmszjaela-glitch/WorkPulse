import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import ProfileProvider from './context/ProfileProvider.jsx'
import RouteFocus from './components/layout/RouteFocus.jsx'

const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage.jsx'))
const ActivityDetailsPage = lazy(
  () => import('./pages/ActivityDetailsPage.jsx'),
)
const ApplicationUsagePage = lazy(
  () => import('./pages/ApplicationUsagePage.jsx'),
)
const DepartmentsPage = lazy(() => import('./pages/DepartmentsPage.jsx'))
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'))
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'))
const LoginPage = lazy(() => import('./pages/LoginPage.jsx'))

function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="grid min-h-svh place-content-center gap-4 p-6 text-center"
    >
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-sm text-muted">
        This address does not match a WorkPulse page.
      </p>
      <Link className="em-button primary mx-auto" to="/dashboard">
        Return to dashboard
      </Link>
    </main>
  )
}
export default function App() {
  return (
    <ProfileProvider>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-primary p-3 text-sm text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <RouteFocus />
      <Suspense
        fallback={
          <div
            className="grid min-h-svh place-content-center text-sm text-muted"
            role="status"
          >
            Loading WorkPulse…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/activity-details" element={<ActivityDetailsPage />} />
          <Route path="/application-usage" element={<ApplicationUsagePage />} />
          <Route path="/departments" element={<DepartmentsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ProfileProvider>
  )
}
