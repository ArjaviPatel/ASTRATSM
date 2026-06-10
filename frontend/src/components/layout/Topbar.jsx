import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, Sun, Moon, Menu, X } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore.js'
import { Avatar } from '@/components/ui/index.jsx'

const BREADCRUMBS = {
  '/dashboard': 'Dashboard', '/clients': 'Clients', '/projects': 'Projects',
  '/timelines': 'Timesheet', '/timesheet': 'Timesheet', '/resources': 'Resources', '/chat': 'Chat',
  '/notifications': 'Notifications', '/profile': 'Profile', '/settings': 'Settings',
  '/approvals': 'Approvals',
}

export default function Topbar({ sideW, unreadCount = 0, isMobile, mobileOpen = false, onMobileMenuToggle }) {
  const loc = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  const label = Object.entries(BREADCRUMBS).find(([k]) => loc.pathname.startsWith(k))?.[1] || ''
  const isLight = theme === 'light'

  return (
    <header style={{
      position: 'fixed',
      top: 0,
      left: isMobile ? 0 : sideW,
      right: 0,
      height: 60,
      background: 'var(--topbar-bg)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border)',
      boxShadow: 'var(--shadow-sm)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      zIndex: 90,
      transition: 'left var(--t-slow)',
    }}>
      {/* Inner wrapper uses the SAME max-width + horizontal padding (inside the
          box) as <main>, so the header title/actions line up exactly with the
          page content below it. */}
      <div style={{
        width: '100%',
        maxWidth: 1400,
        boxSizing: 'border-box',
        padding: isMobile ? '0 var(--sp-4)' : '0 var(--sp-8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {/* Hamburger on mobile */}
        {isMobile && (
          <button
            onClick={onMobileMenuToggle}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-2)', padding: 8, lineHeight: 0,
              borderRadius: 'var(--r-md)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        )}
        <span style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: isMobile ? '0.95rem' : '1.05rem',
          color: 'var(--text-0)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}>
          {label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 }}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isLight ? 'Switch to dark' : 'Switch to light'}
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-full)',
            cursor: 'pointer',
            padding: isMobile ? '6px' : '5px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
            color: 'var(--text-2)',
            fontSize: '14px', fontWeight: 500,
            transition: 'all var(--t-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
        >
          {isLight ? <Moon size={14} /> : <Sun size={14} />}
          {!isMobile && (isLight ? 'Dark' : 'Light')}
        </button>

        {/* Bell */}
        <button
          onClick={() => navigate('/notifications')}
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: unreadCount > 0 ? 'var(--accent)' : 'var(--text-2)',
            padding: 8, lineHeight: 0, borderRadius: 'var(--r-md)',
            transition: 'all var(--t-fast)', position: 'relative',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-3)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              minWidth: 16, height: 16, borderRadius: 8,
              background: 'var(--accent)', color: 'var(--text-0)',
              fontSize: '12px', fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, padding: '0 3px',
              boxShadow: '0 0 0 2px var(--bg-0)',
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {user && (
          <button
            onClick={() => navigate('/profile')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0, borderRadius: '50%' }}
          >
            <Avatar name={user.name} src={user.avatar || user.avatar_url} size={34} role={user.role} />
          </button>
        )}
      </div>
      </div>
    </header>
  )
}