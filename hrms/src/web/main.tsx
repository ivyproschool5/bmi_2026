import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { SessionProvider, useSession } from './session';
import { Layout } from './components/Layout';
import { ChangePasswordPage, LoginPage, OnboardPage, SignupPage } from './pages/Auth';
import { DashboardPage } from './pages/Dashboard';
import { LeavePage } from './pages/Leave';
import { ApprovalsPage } from './pages/Approvals';
import { AttendancePage, TeamTodayPage } from './pages/Attendance';
import { EmployeeDetailPage, EmployeesPage, ProfilePage } from './pages/Employees';
import { HolidaysPage } from './pages/Holidays';
import { SettingsPage } from './pages/Settings';
import { AssistantPage } from './pages/Assistant';

function App() {
  const { me, loading } = useSession();

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading...</div>;

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (!me.employee) return <OnboardPage />;
  if (me.employee.mustChangePassword) return <ChangePasswordPage forced />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="team" element={<TeamTodayPage />} />
        <Route path="employees" element={<EmployeesPage />} />
        <Route path="employees/:id" element={<EmployeeDetailPage />} />
        <Route path="holidays" element={<HolidaysPage />} />
        <Route path="assistant" element={<AssistantPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
