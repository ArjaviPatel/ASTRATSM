import React, { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from '@/components/layout/Sidebar.jsx'
import Topbar from '@/components/layout/Topbar.jsx'
import { useAuthStore } from '@/stores/authStore.js'
import { authApi, notificationsApi, approvalsApi, timelineApprovalsApi } from '@/api/index.js'
import { useQuery } from '@tanstack/react-query'

// FIX: Single breakpoint constant — keeps JS hook and CSS in sync (was 768 in JS vs mixed 640/767 in CSS)
const MOBILE_BREAKPOINT = 768

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export default function AppLayout() {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  // On mobile the sidebar is an overlay: hidden by default
  const [mobileOpen, setMobileOpen] = useState(false)
  const setUser = useAuthStore(s => s.setUser)
  const user = useAuthStore(s => s.user)
  const location = useLocation()
  const onApprovalsPage = location.pathname === '/approvals'

  // Close mobile sidebar on route change
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // FIX: When resizing back from mobile to desktop, close the mobile overlay
  // so it doesn't linger invisibly and block interactions
  useEffect(() => {
    if (!isMobile) setMobileOpen(false)
  }, [isMobile])

  useEffect(() => {
    if (!user) {
      authApi.me().then(r => setUser(r.data)).catch(() => {})
    }
  }, [setUser, user])

  const { data: unreadData } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => notificationsApi.unreadCount().then(r => r.data),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
  })

  const { data: approvalData } = useQuery({
    queryKey: ['approval-count'],
    queryFn: async () => {
      const [proj, tl] = await Promise.all([
        approvalsApi.pendingCount(),
        timelineApprovalsApi.pendingCount(),
      ])
      return { count: (proj.data.count || 0) + (tl.data.count || 0) }
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: 30_000,
    enabled: user?.role === 'admin' || user?.role === 'manager',
  })

  const approvalCount = onApprovalsPage ? 0 : (approvalData?.count || 0)

  const sideW = isMobile ? 0 : (collapsed ? 64 : 240)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Mobile overlay backdrop */}
      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 150,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(2px)',
            animation: 'fadeIn 0.15s ease',
          }}
        />
      )}

      <Sidebar
        collapsed={isMobile ? false : collapsed}
        onToggle={() => isMobile ? setMobileOpen(o => !o) : setCollapsed(c => !c)}
        unreadCount={unreadData?.unread_count || 0}
        approvalCount={approvalCount}
        isMobile={isMobile}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div style={{
        flex: 1,
        marginLeft: sideW,
        display: 'flex',
        flexDirection: 'column',
        transition: 'margin-left var(--t-slow)',
        minWidth: 0,
      }}>
        <Topbar
          sideW={sideW}
          unreadCount={unreadData?.unread_count || 0}
          isMobile={isMobile}
          mobileOpen={mobileOpen}
          onMobileMenuToggle={() => setMobileOpen(o => !o)}
        />
        <main style={{
          flex: 1,
          paddingTop: 'calc(60px + var(--sp-4))',
          paddingBottom: 'var(--sp-8)',
          paddingLeft: isMobile ? 'var(--sp-4)' : 'var(--sp-8)',
          paddingRight: isMobile ? 'var(--sp-4)' : 'var(--sp-8)',
          maxWidth: 1400,
          width: '100%',
          marginLeft: 'auto',
          marginRight: 'auto',
          boxSizing: 'border-box',
          animation: 'fadeIn 0.3s ease both',
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}