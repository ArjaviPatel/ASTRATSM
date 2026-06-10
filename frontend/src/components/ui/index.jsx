import React from 'react'
import { cn, getInitials } from '@/utils/index.js'

/* ── Button ─────────────────────────────────────────────────────────── */
export function Button({
  children, variant = 'primary', size = 'md', loading = false,
  className, disabled, icon, ...props
}) {
  const base = 'btn'
  return (
    <button
      className={cn(`btn btn--${variant} btn--${size}`, loading && 'btn--loading', className)}
      disabled={disabled || loading}
      style={btnStyles(variant, size)}
      {...props}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
    </button>
  )
}

function btnStyles(variant, size) { return {} } // handled via inline below

export function Btn({ children, variant = 'primary', size = 'md', loading, icon, className, disabled, ...props }) {
  const styles = {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    fontFamily: 'var(--font-body)', fontWeight: 600, cursor: disabled || loading ? 'not-allowed' : 'pointer',
    border: '1px solid transparent', borderRadius: 'var(--r-md)',
    transition: 'all var(--t-mid)', whiteSpace: 'nowrap', letterSpacing: '0.01em',
    opacity: disabled || loading ? 0.5 : 1,
    ...(size === 'sm' ? { fontSize: '14px', padding: '5px 10px' } :
        size === 'lg' ? { fontSize: '15px', padding: '10px 20px' } :
                        { fontSize: '15px', padding: '7px 14px' }),
    ...(variant === 'primary' ? {
      background: 'var(--accent)', color: 'var(--text-0)', borderColor: 'var(--accent)', boxShadow: 'var(--shadow-accent)',
    } : variant === 'secondary' ? {
      background: 'var(--surface-2)', color: 'var(--text-1)', borderColor: 'var(--border)',
    } : variant === 'ghost' ? {
      background: 'transparent', color: 'var(--text-1)', borderColor: 'transparent',
    } : variant === 'danger' ? {
      background: 'rgba(248,113,113,0.1)', color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)',
    } : {}),
  }
  return (
    <button style={styles} disabled={disabled || loading} className={className} {...props}>
      {loading ? <Spinner size={12} /> : icon}
      {children}
    </button>
  )
}

/* ── Badge ──────────────────────────────────────────────────────────── */
export function Badge({ children, color, className }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '13px', fontWeight: 600, padding: '2px 8px',
      borderRadius: 'var(--r-full)', letterSpacing: '0.06em', textTransform: 'uppercase',
      background: color ? `${color}20` : 'var(--bg-3)',
      color: color || 'var(--text-1)',
      border: `1px solid ${color ? `${color}40` : 'var(--border)'}`,
    }} className={className}>
      {children}
    </span>
  )
}

/* ── Spinner ────────────────────────────────────────────────────────── */
export function Spinner({ size = 20, color = 'var(--accent)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.2" strokeWidth="2.5" fill="none" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/* ── Avatar ─────────────────────────────────────────────────────────── */
export function Avatar({ name, src, size = 36, role }) {
  const roleColors = {
    admin: 'var(--accent)', leadership: '#8b5cf6', manager: 'var(--info)', resource: 'var(--success)', client: 'var(--warning)'
  }
  const color = role ? roleColors[role] : 'var(--accent)'
  if (src) return (
    <img src={src} alt={name} style={{
      width: size, height: size, borderRadius: '50%', objectFit: 'cover',
      border: `2px solid ${color}40`, flexShrink: 0,
    }} />
  )
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${color}20`, border: `2px solid ${color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.33, fontWeight: 700, color, flexShrink: 0,
      fontFamily: 'var(--font-display)',
    }}>
      {getInitials(name)}
    </div>
  )
}

/* ── Card ───────────────────────────────────────────────────────────── */
export function Card({ children, style, className, onClick, hover }) {
  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 'var(--sp-6)',
        transition: 'all var(--t-mid)',
        boxShadow: 'var(--shadow-sm)',
        backdropFilter: 'blur(10px)',
        cursor: onClick ? 'pointer' : undefined,
        ...(hover || onClick ? { ':hover': { borderColor: 'var(--border-light)' } } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/* ── Stat card ──────────────────────────────────────────────────────── */
export function StatCard({ label, value, sub, icon: Icon, accent, trend, onClick, tooltip, hoverOnly }) {
  const [hovered, setHovered] = React.useState(false)
  const isClickable = !!onClick
  const showHover   = isClickable || hoverOnly
  return (
    <div
      onClick={onClick}
      title={tooltip || ''}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered && showHover ? 'var(--bg-2)' : 'var(--bg-1)',
        border: `1px solid ${hovered && showHover ? (accent || 'var(--accent)') : 'var(--border)'}`,
        borderRadius: 'var(--r-lg)', padding: 'var(--sp-6)',
        display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
        position: 'relative', overflow: 'hidden',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'all var(--t-fast)',
        transform: hovered && isClickable ? 'translateY(-2px)' : 'none',
        boxShadow: hovered && isClickable ? 'var(--shadow-md)' : 'none',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        {Icon && (
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--r-md)',
            background: hovered && showHover ? (accent ? `${accent}25` : 'var(--bg-4)') : (accent ? `${accent}15` : 'var(--bg-3)'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background var(--t-fast)',
          }}>
            <Icon size={16} color={accent || 'var(--text-2)'} />
          </div>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, lineHeight: 1, color: 'var(--text-0)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '14px', color: 'var(--text-2)' }}>{sub}</div>}
      {isClickable && (
        <div style={{ fontSize: '12px', color: accent || 'var(--text-3)', opacity: hovered ? 1 : 0, transition: 'opacity var(--t-fast)', letterSpacing: '0.05em' }}>
          View all →
        </div>
      )}
      {/* Accent line — grows on hover */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: '2px',
        width: hovered && showHover ? '100%' : '40%',
        background: accent || 'var(--accent)', opacity: 0.5,
        transition: 'width var(--t-mid)',
      }} />
    </div>
  )
}

/* ── Progress bar ───────────────────────────────────────────────────── */
export function ProgressBar({ value = 0, color, height = 4, showLabel }) {
  const c = color || (value >= 80 ? 'var(--success)' : value >= 50 ? 'var(--info)' : 'var(--accent)')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
      <div style={{ flex: 1, height, background: 'var(--bg-3)', borderRadius: height }}>
        <div style={{
          width: `${Math.min(100, value)}%`, height: '100%',
          background: c, borderRadius: height,
          transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        }} />
      </div>
      {showLabel && <span style={{ fontSize: '13px', color: 'var(--text-2)', fontFamily: 'var(--font-mono)', minWidth: '30px' }}>{value}%</span>}
    </div>
  )
}

/* ── Form grid ──────────────────────────────────────────────────────── */
// Responsive form field grid: lays fields out in columns that automatically
// collapse to a single column on narrow screens. Use this instead of
// hardcoded `1fr 1fr` so every form behaves the same way on mobile.
export function FormGrid({ children, min = 200, gap = 'var(--sp-4)', style, className }) {
  return (
    <div
      className={className}
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap, ...style }}
    >
      {children}
    </div>
  )
}

/* ── Input ──────────────────────────────────────────────────────────── */
export function Input({ label, error, icon: Icon, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>}
      <div style={{ position: 'relative' }}>
        {Icon && <Icon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />}
        <input
          style={{
            width: '100%', background: 'var(--bg-2)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
            borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px',
            padding: Icon ? '8px 12px 8px 32px' : '8px 12px',
            outline: 'none', transition: 'border-color var(--t-fast)',
          }}
          onFocus={e => { e.target.style.borderColor = error ? 'var(--danger)' : 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(35,114,39,0.16)' }}
          onBlur={e => { e.target.style.borderColor = error ? 'var(--danger)' : 'var(--border)'; e.target.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
          {...props}
        />
      </div>
      {error && <span style={{ fontSize: '14px', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

/* ── Select ─────────────────────────────────────────────────────────── */
export function Select({ label, error, children, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>}
      <select
        style={{
          width: '100%', background: 'var(--bg-2)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
          borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px',
          padding: '8px 12px', outline: 'none', appearance: 'none', cursor: 'pointer',
        }}
        {...props}
      >
        {children}
      </select>
      {error && <span style={{ fontSize: '14px', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

/* ── Textarea ────────────────────────────────────────────────────────── */
export function Textarea({ label, error, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label && <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>}
      <textarea
        style={{
          width: '100%', background: 'var(--bg-2)', border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
          borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px',
          padding: '8px 12px', outline: 'none', resize: 'vertical', minHeight: '80px',
          transition: 'border-color var(--t-fast)', fontFamily: 'var(--font-body)',
        }}
        onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px rgba(35,114,39,0.16)' }}
        onBlur={e => { e.target.style.borderColor = error ? 'var(--danger)' : 'var(--border)'; e.target.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)' }}
        {...props}
      />
      {error && <span style={{ fontSize: '14px', color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}

/* ── Modal ──────────────────────────────────────────────────────────── */
export function Modal({ open, onClose, title, children, width = 520, fullscreen = false }) {
  if (!open) return null

  if (fullscreen) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'var(--bg-0, var(--bg-2))',
        zIndex: 9999, display: 'flex', flexDirection: 'column',
        animation: 'fadeIn 0.2s ease both',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px clamp(16px, 4vw, 32px)', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-1)', flexShrink: 0,
        }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</h2>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-2)',
            cursor: 'pointer', padding: '6px 14px', borderRadius: 'var(--r-md)',
            fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
            transition: 'all var(--t-fast)',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.color = 'var(--danger)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
          >
            <XIcon /> Cancel
          </button>
        </div>
        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(16px, 4vw, 32px)', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 780 }}>
            {children}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,12,20,0.66)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 'var(--sp-4)', backdropFilter: 'blur(6px)',
        overflowY: 'auto',
        animation: 'fadeIn 0.18s ease both',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          background: 'var(--bg-1)', border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)', width: '100%', maxWidth: width,
          maxHeight: 'calc(100dvh - var(--sp-8))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 24px 64px -16px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)',
          margin: 'auto',
          animation: 'riseIn 0.24s cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Fixed header — stays put while the body scrolls */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)',
          padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-1)', flexShrink: 0,
        }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.01em', margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)',
            cursor: 'pointer', width: 32, height: 32, lineHeight: 0, borderRadius: 'var(--r-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'all var(--t-fast)',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.color = 'var(--danger)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
          >
            <XIcon />
          </button>
        </div>
        {/* Scrollable body */}
        <div style={{ padding: 'var(--sp-5)', overflowY: 'auto', flex: 1 }}>{children}</div>
      </div>
    </div>
  )
}

function XIcon() {
  return (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

/* ── Empty state ────────────────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--sp-16)', gap: 'var(--sp-4)', textAlign: 'center',
    }}>
      {Icon && (
        <div style={{
          width: 64, height: 64, borderRadius: 'var(--r-xl)',
          background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={28} color="var(--text-3)" />
        </div>
      )}
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--text-1)', marginBottom: '4px' }}>{title}</div>
        {description && <div style={{ fontSize: '14px', color: 'var(--text-2)' }}>{description}</div>}
      </div>
      {action}
    </div>
  )
}

/* ── Table ──────────────────────────────────────────────────────────── */
export function Table({ columns, data, onRowClick, loading }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={{
                textAlign: 'left', padding: '10px 16px',
                fontSize: '13px', fontWeight: 600, color: 'var(--text-3)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col.key} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{
                      height: 14, borderRadius: 4, width: '70%',
                      background: 'linear-gradient(90deg, var(--bg-3) 25%, var(--bg-4) 50%, var(--bg-3) 75%)',
                      backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
                    }} />
                  </td>
                ))}
              </tr>
            ))
          ) : data.map((row, i) => (
            <tr key={row.id || i}
              onClick={() => onRowClick?.(row)}
              style={{
                borderBottom: '1px solid var(--border)',
                cursor: onRowClick ? 'pointer' : undefined,
                transition: 'background var(--t-fast)',
              }}
              onMouseEnter={e => onRowClick && (e.currentTarget.style.background = 'var(--bg-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {columns.map(col => (
                <td key={col.key} style={{ padding: '12px 16px', fontSize: '15px', color: 'var(--text-1)' }}>
                  {col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ page = 1, totalPages = 1, total = 0, pageSize = 25, onPageChange, loading }) {
  const pages = Math.max(1, Number(totalPages) || 1)
  const current = Math.min(Math.max(1, Number(page) || 1), pages)
  const start = total ? (current - 1) * pageSize + 1 : 0
  const end = total ? Math.min(current * pageSize, total) : 0
  const go = (next) => {
    const value = Math.min(Math.max(1, next), pages)
    if (value !== current) onPageChange?.(value)
  }

  if (pages <= 1 && !total) return null

  const buttonStyle = (disabled) => ({
    background: disabled ? 'var(--bg-2)' : 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)',
    color: disabled ? 'var(--text-3)' : 'var(--text-1)',
    fontSize: '14px',
    fontWeight: 600,
    padding: '7px 11px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
  })

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'var(--sp-3)',
      flexWrap: 'wrap',
      padding: '12px 0',
    }}>
      <div style={{ fontSize: '14px', color: 'var(--text-3)' }}>
        {total ? `Showing ${start}-${end} of ${total}` : `Page ${current} of ${pages}`}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" disabled={current <= 1 || loading} onClick={() => go(current - 1)} style={buttonStyle(current <= 1 || loading)}>
          Previous
        </button>
        <span style={{ fontSize: '14px', color: 'var(--text-2)', minWidth: 72, textAlign: 'center' }}>
          {current} / {pages}
        </span>
        <button type="button" disabled={current >= pages || loading} onClick={() => go(current + 1)} style={buttonStyle(current >= pages || loading)}>
          Next
        </button>
      </div>
    </div>
  )
}

/* ── Toast / Alert ──────────────────────────────────────────────────── */
export function Alert({ type = 'info', message, onClose }) {
  const colors = { info: 'var(--info)', success: 'var(--success)', error: 'var(--danger)', warning: 'var(--warning)' }
  const c = colors[type]
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
      padding: '12px 16px', borderRadius: 'var(--r-md)',
      background: `${c}15`, border: `1px solid ${c}40`, color: c,
      fontSize: '15px',
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color, cursor: 'pointer', padding: 0, lineHeight: 0 }}><XIcon /></button>}
    </div>
  )
}

/* ── Skeleton ───────────────────────────────────────────────────────── */
export function Skeleton({ width = '100%', height = 16, borderRadius = 4 }) {
  return (
    <div style={{
      width, height, borderRadius,
      background: 'linear-gradient(90deg, var(--bg-3) 25%, var(--bg-4) 50%, var(--bg-3) 75%)',
      backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
    }} />
  )
}

/* ── Tabs ───────────────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid var(--border)', paddingBottom: '-1px' }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '8px 16px', fontSize: '15px', fontWeight: 500,
          color: active === tab.id ? 'var(--accent)' : 'var(--text-2)',
          borderBottom: `2px solid ${active === tab.id ? 'var(--accent)' : 'transparent'}`,
          transition: 'all var(--t-fast)', display: 'flex', alignItems: 'center', gap: '6px',
          marginBottom: '-1px',
        }}>
          {tab.icon && <tab.icon size={14} />}
          {tab.label}
          {tab.count != null && (
            <span style={{
              background: active === tab.id ? 'var(--accent)' : 'var(--bg-3)',
              color: active === tab.id ? '#0a0a0a' : 'var(--text-2)',
              fontSize: '12px', fontWeight: 700, padding: '1px 6px',
              borderRadius: 'var(--r-full)', minWidth: 18, textAlign: 'center',
            }}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}