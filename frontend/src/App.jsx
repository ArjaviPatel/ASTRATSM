import React, { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore.js'
import { Spinner } from '@/components/ui/index.jsx'

import AppLayout from '@/components/layout/AppLayout.jsx'

const LoginPage        = lazy(() => import('@/pages/Login.jsx'))
const DashboardPage    = lazy(() => import('@/pages/Dashboard.jsx'))
const ProjectsPage     = lazy(() => import('@/pages/Projects.jsx'))
const ProjectDetailPage= lazy(() => import('@/pages/ProjectDetail.jsx'))
const ClientsPage      = lazy(() => import('@/pages/Clients.jsx'))
const ClientDetailPage = lazy(() => import('@/pages/ClientDetail.jsx'))
const TimesheetPage    = lazy(() => import('@/pages/Timesheet.jsx'))
const ChatPage         = lazy(() => import('@/pages/Chat.jsx'))
const ApprovalsPage    = lazy(() => import('@/pages/Approvals.jsx'))
const NotificationsPage= lazy(() => import('@/pages/Other.jsx').then(m => ({ default: m.NotificationsPage })))
const ResourcesPage    = lazy(() => import('@/pages/Other.jsx').then(m => ({ default: m.ResourcesPage })))
const ProfilePage      = lazy(() => import('@/pages/Other.jsx').then(m => ({ default: m.ProfilePage })))
const SettingsPage     = lazy(() => import('@/pages/Other.jsx').then(m => ({ default: m.SettingsPage })))

function PageLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={26} />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const isAuth = useAuthStore(s => s.isAuthenticated)
  return isAuth ? children : <Navigate to="/login" replace />
}
function PublicRoute({ children }) {
  const isAuth = useAuthStore(s => s.isAuthenticated)
  return !isAuth ? children : <Navigate to="/dashboard" replace />
}
function PermissionRoute({ permission, children }) {
  const user = useAuthStore(s => s.user)
  const hasPermission = useAuthStore(s => s.hasPermission)
  if (!user) return <PageLoader />
  return hasPermission(permission) || hasPermission(`${permission}_view`) ? children : <Navigate to="/dashboard" replace />
}
function RoleRoute({ roles, children }) {
  const user = useAuthStore(s => s.user)
  if (!user) return <PageLoader />
  return roles.includes(user?.role) ? children : <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"     element={<DashboardPage />} />
          <Route path="clients"       element={<PermissionRoute permission="clients"><ClientsPage /></PermissionRoute>} />
          <Route path="clients/:id"   element={<PermissionRoute permission="clients"><ClientDetailPage /></PermissionRoute>} />
          <Route path="projects"      element={<PermissionRoute permission="projects"><ProjectsPage /></PermissionRoute>} />
          <Route path="projects/:id"  element={<PermissionRoute permission="projects"><ProjectDetailPage /></PermissionRoute>} />
          <Route path="timesheet"     element={<ProtectedRoute><TimesheetPage /></ProtectedRoute>} />
          <Route path="timelines"     element={<Navigate to="/timesheet" replace />} />
          <Route path="resources"     element={<PermissionRoute permission="resources"><ResourcesPage /></PermissionRoute>} />
          <Route path="chat"          element={<PermissionRoute permission="chat"><ChatPage /></PermissionRoute>} />
          <Route path="approvals"     element={<RoleRoute roles={['admin','leadership','manager','resource']}><ApprovalsPage /></RoleRoute>} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile"       element={<ProfilePage />} />
          <Route path="settings"      element={<PermissionRoute permission="access_control"><SettingsPage /></PermissionRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}
