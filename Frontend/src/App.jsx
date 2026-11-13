import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import EmployeesPage from './pages/EmployeesPage.jsx'
import ActivityDetailsPage from './pages/ActivityDetailsPage.jsx'
import ApplicationUsagePage from './pages/ApplicationUsagePage.jsx'
import DepartmentsPage from './pages/DepartmentsPage.jsx'
import ReportsPage from './pages/ReportsPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import ProfileProvider from './context/ProfileProvider.jsx'

export default function App() {
  return (
    <ProfileProvider>
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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </ProfileProvider>
  )
}
