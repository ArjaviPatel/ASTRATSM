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
    enabled: user?.role === 'admin' || user?.role === 'leadership' || user?.role === 'manager',
  })

  const approvalCount = onApprovalsPage ? 0 : (approvalData?.count || 0)

  const sideW = isMobile ? 0 : (collapsed ? 64 : 240)

  return (
    <div style={{ display: 'flex', minHeight: '100dvh' }}>
      {/* Accessibility: skip straight to content (visible only on keyboard focus) */}
      <a
        href="#main-content"
        style={{
          position: 'fixed', top: 'var(--sp-2)', left: 'var(--sp-2)', zIndex: 9999,
          background: 'var(--accent)', color: 'var(--text-0)',
          padding: '8px 14px', borderRadius: 'var(--r-md)',
          fontSize: 14, fontWeight: 700, textDecoration: 'none',
          transform: 'translateY(-200%)', transition: 'transform var(--t-fast)',
        }}
        onFocus={e => { e.currentTarget.style.transform = 'translateY(0)' }}
        onBlur={e => { e.currentTarget.style.transform = 'translateY(-200%)' }}
      >
        Skip to main content
      </a>

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
        {/*
          <main> is the primary landmark + the page's vertical scroll region.
          It spans the full content width (next to the sidebar) and only owns
          vertical rhythm — clearing the fixed Topbar and adding bottom space.

          Horizontal sizing lives on the inner `.app-container` so that:
            • every page/form inherits identical gutters + max-width,
            • the box model matches the Topbar's inner wrapper exactly
              (max-width + inside padding), keeping header and content aligned,
            • full-bleed sections can opt out by rendering outside a container.

          `--content-max` (fallback 1400px) is the single knob for page width;
          define it once in CSS to retune the whole app.
        */}
        <main
          id="main-content"
          tabIndex={-1}
          aria-label="Main content"
          style={{
            flex: 1,
            minWidth: 0,
            paddingTop: 'calc(var(--topbar-h, 60px) + var(--sp-4))',
            paddingBottom: 'var(--sp-8)',
            boxSizing: 'border-box',
            outline: 'none',
            animation: 'fadeIn 0.3s ease both',
          }}
        >
          <div
            className="app-container"
            style={{
              width: '100%',
              maxWidth: 'var(--content-max, 1400px)',
              marginInline: 'auto',
              paddingInline: isMobile ? 'var(--sp-4)' : 'var(--sp-8)',
              boxSizing: 'border-box',
            }}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}