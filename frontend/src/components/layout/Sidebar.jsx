import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FolderKanban, Clock,
  MessageSquare, Bell, Settings, LogOut,
  ChevronLeft, UserCircle, Wrench, ChevronRight,
  Building2, ClipboardCheck, X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore.js'
import { Avatar } from '@/components/ui/index.jsx'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard',  perm: 'dashboard'  },
  { to: '/clients',   icon: Building2,       label: 'Clients',    perm: 'clients'    },
  { to: '/projects',  icon: FolderKanban,    label: 'Projects',   perm: 'projects'   },
  { to: '/timesheet', icon: Clock,           label: 'Timesheet',  perm: null         },
  { to: '/resources', icon: Wrench,          label: 'Resources',  perm: 'resources'  },
  { to: '/chat',      icon: MessageSquare,   label: 'Chat',       perm: 'chat'       },
]

const BOTTOM_NAV = [
  { to: '/notifications', icon: Bell,       label: 'Notifications' },
  { to: '/profile',       icon: UserCircle, label: 'Profile'       },
  { to: '/settings',      icon: Settings,   label: 'Settings', perm: 'access_control' },
]

export default function Sidebar({ collapsed, onToggle, unreadCount, approvalCount, isMobile, mobileOpen, onMobileClose }) {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const hasPermission = useAuthStore(s => s.hasPermission)

  const w = collapsed ? 64 : 240

  // Mobile: full-width slide-in overlay; desktop: fixed aside
  const mobileStyle = isMobile ? {
    transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
    width: 'min(84vw, 300px)',
    boxShadow: mobileOpen ? 'var(--shadow-lg)' : 'none',
    zIndex: 220,
    pointerEvents: mobileOpen ? 'auto' : 'none',
  } : {
    width: w,
    zIndex: 100,
  }

  return (
    <aside style={{
      minHeight: '100vh',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--border)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'transform var(--t-slow), width var(--t-slow)',
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      overflow: 'hidden',
      ...mobileStyle,
    }}>
      {/* Logo row */}
      <div style={{
        padding: collapsed && !isMobile ? '20px 0' : '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
        borderBottom: '1px solid var(--border)',
        minHeight: 64,
        position: isMobile ? 'sticky' : 'relative',
        top: 0,
        zIndex: 2,
        background: 'var(--sidebar-bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <NexusLogo />
          {(!collapsed || isMobile) && (
            <span style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: '1.15rem',
              letterSpacing: '-0.02em',
              color: 'var(--text-0)',
            }}>
              AstraTSM
            </span>
          )}
        </div>

        {/* Desktop collapse toggle */}
        {!isMobile && !collapsed && (
          <button onClick={onToggle} title="Collapse sidebar" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', padding: 4, borderRadius: 'var(--r-sm)',
            lineHeight: 0, transition: 'color var(--t-fast)',
          }}>
            <ChevronLeft size={16} />
          </button>
        )}

        {/* Mobile close button */}
        {isMobile && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMobileClose()
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onMobileClose()
            }}
            style={{
              background: 'var(--bg-3)', border: '1px solid var(--border)',
              cursor: 'pointer', color: 'var(--text-1)',
              padding: '6px', lineHeight: 0, borderRadius: 'var(--r-md)',
              zIndex: 999, position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'auto',
              touchAction: 'manipulation',
            }}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Desktop expand button (collapsed mode) */}
      {!isMobile && collapsed && (
        <button onClick={onToggle} title="Expand sidebar" style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '12px 0', color: 'var(--text-3)', lineHeight: 0,
          display: 'flex', justifyContent: 'center',
          borderBottom: '1px solid var(--border)',
          transition: 'color var(--t-fast)',
        }}>
          <ChevronRight size={16} />
        </button>
      )}

      {/* Main nav */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {NAV.map(item => {
          if (item.perm && !hasPermission(item.perm) && !hasPermission(item.perm + '_view')) return null
          return (
            <NavItem
              key={item.to}
              {...item}
              collapsed={collapsed && !isMobile}
              onMobileClose={isMobile ? onMobileClose : null}
            />
          )
        })}

        {(user?.role === 'admin' || user?.role === 'leadership' || user?.role === 'manager' || user?.role === 'resource') && (
          <NavItem
            to="/approvals"
            icon={ClipboardCheck}
            label="Approvals"
            collapsed={collapsed && !isMobile}
            badge={approvalCount > 0 ? approvalCount : null}
            badgeColor={(user?.role === 'admin'|| user?.role === 'leadership') ? 'var(--accent-alt)' : 'var(--success)'}
            onMobileClose={isMobile ? onMobileClose : null}
          />
        )}
      </nav>

      {/* Bottom section */}
      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
        {BOTTOM_NAV.map(item => {
          if (item.perm && !hasPermission(item.perm)) return null
          return (
            <NavItem
              key={item.to}
              {...item}
              collapsed={collapsed && !isMobile}
              badge={item.to === '/notifications' && unreadCount > 0 ? unreadCount : null}
              onMobileClose={isMobile ? onMobileClose : null}
            />
          )
        })}

        <button
          onClick={() => { onMobileClose?.(); logout() }}
          title="Sign out"
          style={{
            width: '100%',
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
            padding: collapsed && !isMobile ? '10px 0' : '10px 16px',
            justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
            color: 'var(--danger)', fontSize: '15px', fontWeight: 500,
            transition: 'background var(--t-fast)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <LogOut size={16} />
          {(!collapsed || isMobile) && 'Sign out'}
        </button>
      </div>

      {/* User chip */}
      {(!collapsed || isMobile) && user && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Avatar name={user.name} src={user.avatar || user.avatar_url} size={32} role={user.role} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: '15px', fontWeight: 600, color: 'var(--text-0)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user.name}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-3)', textTransform: 'capitalize' }}>
              {user.role}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

function NavItem({ to, icon: Icon, label, collapsed, badge, badgeColor, onMobileClose }) {
  const bColor = badgeColor || 'var(--danger)'
  return (
    <NavLink
      to={to}
      onClick={() => onMobileClose?.()}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 12,
        padding: collapsed ? '10px 0' : '10px 16px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: isActive ? 'var(--accent)' : 'var(--text-2)',
        fontSize: '15px', fontWeight: isActive ? 600 : 400,
        background: isActive ? 'var(--accent-dim)' : 'transparent',
        borderRight: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'all var(--t-fast)',
        position: 'relative',
        textDecoration: 'none',
      })}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-2)' }}
      onMouseLeave={e => { e.currentTarget.style.background = '' }}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Icon size={16} />
        {badge && collapsed && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            width: 8, height: 8,
            background: bColor, borderRadius: '50%',
          }} />
        )}
      </div>
      {!collapsed && label}
      {!collapsed && badge && (
        <span style={{
          marginLeft: 'auto', background: bColor, color: 'var(--text-4)',
          fontSize: '12px', fontWeight: 700, padding: '1px 6px',
          borderRadius: 'var(--r-full)', minWidth: 18, textAlign: 'center',
        }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

function NexusLogo() {
  return <img src="/logo.png" style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }} />
}