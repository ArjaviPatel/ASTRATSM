import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueries, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  Plus, GitBranch, CheckCircle, Circle, Edit2, Trash2,
  X, Save, Send, Clock, ChevronDown, ChevronRight,
  AlertTriangle, Info, Loader2, RefreshCw,
} from 'lucide-react'
import { timelinesApi, projectsApi, timelineApprovalsApi, resourcesApi } from '@/api/index.js'
import { Btn, Badge, EmptyState, Modal, Input, Textarea, Spinner, Pagination } from '@/components/ui/index.jsx'
import { STATUS_COLOR, STATUS_LABEL, formatDate, extractError } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_PHASE_COLOR = {
  pending:     '#a78bfa',
  in_progress: '#38bdf8',
  completed:   '#4ade80',
  on_hold:     '#fb923c',
}

const STATUS_OPTIONS = [
  { value: 'pending',     label: 'Pending'     },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed'   },
  { value: 'on_hold',     label: 'On Hold'     },
]

const PAGE_SIZE = 20

// ─── Responsive hook ──────────────────────────────────────────────────────────

function useIsMobile() {
  const [w, setW] = useState(() => window.innerWidth)
  React.useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return w < 768
}

// ─── Clock that ticks every 60 s ──────────────────────────────────────────────

function useNow() {
  const [now, setNow] = useState(() => new Date())
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// ─── Work-day math ────────────────────────────────────────────────────────────

function countWorkDays(from, to) {
  if (!from || !to) return 0
  const f = new Date(from); f.setHours(0, 0, 0, 0)
  const t = new Date(to);   t.setHours(0, 0, 0, 0)
  if (t <= f) return 0
  let days = 0
  const cur = new Date(f)
  cur.setDate(cur.getDate() + 1)
  while (cur <= t) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) days++
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

function calcHours(phase, now) {
  const { start_date, end_date, status } = phase
  if (!start_date || !end_date) return null

  const phaseStart = new Date(start_date)
  const phaseEnd   = new Date(end_date)
  const totalWorkDays = countWorkDays(phaseStart, phaseEnd)
  if (totalWorkDays === 0) return null

  const allocated = totalWorkDays * 8
  let elapsedWorkDays = 0

  if (status === 'pending') {
    elapsedWorkDays = 0
  } else if (status === 'completed') {
    const consumed = Number(phase.hours_consumed)
    elapsedWorkDays = consumed ? consumed / 8 : totalWorkDays
  } else if (status === 'on_hold') {
    elapsedWorkDays = (Number(phase.hours_consumed) || 0) / 8
  } else {
    // in_progress — live clock
    const bankedHrs = Number(phase.hours_consumed) || 0
    const countFrom = phase.paused_at ? new Date(phase.paused_at) : new Date(phase.created_at)
    const freshDays = countWorkDays(countFrom, now)
    elapsedWorkDays = Math.min(bankedHrs / 8 + freshDays, totalWorkDays)
  }

  const ratio       = totalWorkDays > 0 ? elapsedWorkDays / totalWorkDays : 0
  const consumed    = +(elapsedWorkDays * 8).toFixed(1)
  const remaining   = status === 'completed' ? 0 : +(Math.max(0, allocated - consumed)).toFixed(1)
  const consumedPct = Math.min(100, Math.round(ratio * 100))
  const overtime    = status === 'completed' ? +(Math.max(0, consumed - allocated)).toFixed(1) : 0
  const saved       = status === 'completed' ? +(Math.max(0, allocated - consumed)).toFixed(1) : 0

  let barColor
  if (status === 'completed' && overtime > 0) barColor = '#f87171'
  else if (status === 'completed')            barColor = '#4ade80'
  else if (status === 'on_hold')              barColor = '#fb923c'
  else if (consumedPct >= 90)                 barColor = '#f87171'
  else if (consumedPct >= 70)                 barColor = '#fb923c'
  else if (consumedPct >= 40)                 barColor = '#fbbf24'
  else                                        barColor = '#38bdf8'

  return { allocated, consumed, remaining, consumedPct, barColor, overtime, saved }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDismiss }) {
  const bg = type === 'success'
    ? 'rgba(74,222,128,0.12)' : type === 'error'
    ? 'rgba(248,113,113,0.12)' : 'rgba(96,165,250,0.12)'
  const color = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--info)'
  const border = type === 'success'
    ? 'rgba(74,222,128,0.4)' : type === 'error'
    ? 'rgba(248,113,113,0.4)' : 'rgba(96,165,250,0.4)'
  const Icon = type === 'success' ? CheckCircle : type === 'error' ? AlertTriangle : Info

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: bg, border: `1px solid ${border}`,
        borderRadius: 'var(--r-md)', padding: '12px 16px',
        color, fontSize: '15px', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: 'var(--shadow-md)', cursor: 'pointer',
        maxWidth: 340, animation: 'fadeIn 0.2s ease',
      }}
    >
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span>{message}</span>
      <X size={14} style={{ marginLeft: 'auto', opacity: 0.6, flexShrink: 0 }} />
    </div>
  )
}

// ─── Styled Select ────────────────────────────────────────────────────────────

function StyledSelect({ label, value, onChange, options, required, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      {label && (
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
        </div>
      )}
      <select
        value={value}
        onChange={onChange}
        required={required}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'var(--bg-2)',
          border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--r-md)',
          color: value ? 'var(--text-0)' : 'var(--text-3)',
          fontSize: '15px',
          padding: '9px 12px',
          outline: 'none',
          cursor: 'pointer',
          transition: 'border-color var(--t-fast)',
          boxShadow: focused ? '0 0 0 3px var(--accent-dim)' : 'none',
        }}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── FormField wrapper (consistent label + error) ─────────────────────────────

function FormField({ label, required, error, children }) {
  return (
    <div>
      {label && (
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
        </div>
      )}
      {children}
      {error && (
        <div style={{ fontSize: '13px', color: 'var(--danger)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={11} />{error}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TimelinesPage() {
  const qc   = useQueryClient()
  const user = useAuthStore(s => s.user)
  const now  = useNow()
  const isMobile = useIsMobile()

  const isAdmin    = user?.role === 'admin'
  const isManager  = user?.role === 'manager'
  const isResource = user?.role === 'resource'
  const canCreate  = isAdmin || isManager

  const [showCreate, setShowCreate]     = useState(false)
  const [toast, setToast]               = useState(null)  // { msg, type }
  const [page, setPage]                 = useState(1)

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 5000)
  }, [])

  const { data: timelinesData, isLoading, isError, refetch } = useQuery({
    queryKey: ['timelines', page],
    queryFn: () => timelinesApi.list({ page, page_size: PAGE_SIZE }).then(r => r.data),
    staleTime: 30_000,
  })

  const timelines = timelinesData?.results || timelinesData || []
  const total = timelinesData?.count ?? timelines.length
  const totalPages = timelinesData?.total_pages ?? 1

  useEffect(() => {
    if (page > totalPages) setPage(totalPages || 1)
  }, [page, totalPages])

  const byProject = useMemo(() => timelines.reduce((acc, t) => {
    const key = t.project || 'unknown'
    if (!acc[key]) acc[key] = { projectId: t.project, projectName: t.project_name || 'Unknown Project', phases: [] }
    acc[key].phases.push(t)
    return acc
  }, {}), [timelines])

  const projectIds = Object.keys(byProject).filter(id => id !== 'unknown')

  const projectDetailResults = useQueries({
    queries: projectIds.map(id => ({
      queryKey: ['project-detail', id],
      queryFn: () => projectsApi.get(id).then(r => r.data),
      enabled: !!id,
      staleTime: 60_000,
    }))
  })

  const resourcesByProject = useMemo(() => {
    const map = {}
    projectIds.forEach((id, i) => {
      const result = projectDetailResults[i]
      if (result?.data) {
        const p = result.data
        map[id] = p.resource_details || p.resources || p.members || []
      }
    })
    return map
  }, [projectDetailResults])

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['timelines'] })
    qc.invalidateQueries({ queryKey: ['dashboard-timelines'] })
    qc.invalidateQueries({ queryKey: ['dashboard-projects'] })
  }, [qc])

  // ── Pending approval badge for resources ──
  const { data: myPendingData } = useQuery({
    queryKey: ['my-timeline-approvals'],
    queryFn: () => timelineApprovalsApi.list({ status: 'pending' }).then(r => r.data.results || r.data),
    enabled: isResource,
    refetchInterval: 30_000,
  })
  const myPendingCount = myPendingData?.length || 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* Page header */}
      <div
        className="mobile-center-header"
        style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'var(--sp-3)',
      }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: isMobile ? '1.4rem' : '1.8rem',
            letterSpacing: '-0.02em',
          }}>
            Timelines
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: '15px', marginTop: 2 }}>
            {timelines.length} phases across {Object.keys(byProject).length} projects
          </p>
          {isResource && myPendingCount > 0 && (
            <div style={{
              marginTop: 6,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.3)',
              borderRadius: 'var(--r-full)', padding: '3px 10px',
              fontSize: '14px', color: 'var(--warning)', fontWeight: 600,
            }}>
              <Clock size={11} />
              {myPendingCount} approval request{myPendingCount > 1 ? 's' : ''} pending
            </div>
          )}
          {isResource && (
            <p style={{ color: 'var(--text-2)', fontSize: '14px', marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
              Open an assigned phase to submit time. Resources can log work against phases here, while phase creation and direct timeline edits remain controlled by admins and managers.
            </p>
          )}
        </div>

        <div className="mobile-center-actions" style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={() => refetch()}>
            {!isMobile && 'Refresh'}
          </Btn>
          {canCreate && (
            <Btn icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
              {isMobile ? 'New' : 'New Phase'}
            </Btn>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'var(--sp-16)', gap: 'var(--sp-4)', color: 'var(--text-3)' }}>
          <Spinner size={32} />
          <span style={{ fontSize: '14px' }}>Loading timelines…</span>
        </div>
      ) : isError ? (
        <div style={{
          textAlign: 'center', padding: 'var(--sp-12)',
          background: 'rgba(248,113,113,0.06)',
          border: '1px solid rgba(248,113,113,0.2)',
          borderRadius: 'var(--r-lg)', color: 'var(--danger)',
        }}>
          <AlertTriangle size={32} style={{ marginBottom: 8 }} />
          <p style={{ fontWeight: 600 }}>Failed to load timelines</p>
          <Btn variant="ghost" size="sm" onClick={() => refetch()} style={{ marginTop: 12 }}>Try again</Btn>
        </div>
      ) : timelines.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No timelines yet"
          description={
            canCreate
              ? 'Create your first project phase to track progress.'
              : isResource
              ? 'No phases are assigned to you yet. Once a manager assigns phases, you can open them here and submit your worked time.'
              : 'No timeline phases have been created for your projects yet.'
          }
        />
      ) : (
        Object.values(byProject).map(({ projectId, projectName, phases }) => (
          <ProjectTimeline
            key={projectId}
            projectId={projectId}
            projectName={projectName}
            phases={phases}
            resources={resourcesByProject[projectId] || []}
            user={user}
            now={now}
            isMobile={isMobile}
            onRefresh={refresh}
            onToast={showToast}
          />
        ))
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        loading={isLoading}
      />

      {/* Create modal */}
      {showCreate && (
        <CreateTimelineModal
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            setPage(1)
            refresh()
            showToast('Phase created successfully!')
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.msg}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}

// ─── ProjectTimeline ──────────────────────────────────────────────────────────

function ProjectTimeline({ projectId, projectName, phases, resources, user, now, isMobile, onRefresh, onToast }) {
  const [expanded, setExpanded] = useState(true)

  const minDate = phases.reduce((a, p) => p.start_date < a ? p.start_date : a, phases[0]?.start_date || '')
  const maxDate = phases.reduce((a, p) => p.end_date   > a ? p.end_date   : a, phases[0]?.end_date   || '')
  const span    = Math.max(1, Math.ceil((new Date(maxDate) - new Date(minDate)) / 86400000))

  const done    = phases.filter(p => p.status === 'completed').length
  const totalH  = phases.reduce((sum, p) => sum + countWorkDays(new Date(p.start_date), new Date(p.end_date)) * 8, 0)

  return (
    <div style={{
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
    }}>
      {/* Project header */}
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
          padding: isMobile ? '12px 14px' : '14px 20px',
          background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: expanded ? '1px solid var(--border)' : 'none',
          textAlign: 'left',
          transition: 'background var(--t-fast)',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div style={{
          fontSize: '13px', color: 'var(--text-3)',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
          transition: 'transform var(--t-fast)',
          flexShrink: 0,
        }}>
          <ChevronRight size={14} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {projectName}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <span>{phases.length} phases</span>
            <span>·</span>
            <span>{formatDate(minDate)} → {formatDate(maxDate)}</span>
            {resources.length > 0 && !isMobile && (
              <>
                <span>·</span>
                <span>👥 {resources.slice(0, 3).map(u => u.name || u.full_name || `User #${u.id}`).join(', ')}{resources.length > 3 ? ` +${resources.length - 3}` : ''}</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {/* Progress ring */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: done === phases.length ? 'var(--success)' : 'var(--text-1)' }}>
              {done}/{phases.length}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>done</div>
          </div>
          {totalH > 0 && !isMobile && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{totalH}h</div>
              <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>allocated</div>
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ padding: isMobile ? '12px 14px' : '16px 20px' }}>
          {/* Gantt chart — horizontally scrollable on mobile */}
          {phases.some(p => p.start_date && p.end_date) && (
            <div style={{ overflowX: 'auto', marginBottom: 'var(--sp-5)', WebkitOverflowScrolling: 'touch' }}>
              <div style={{ minWidth: isMobile ? 480 : 600 }}>
                {/* Date labels */}
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, marginBottom: 4 }}>
                  <div />
                  <div style={{ position: 'relative', height: 18 }}>
                    <span style={{ position: 'absolute', left: 0, fontSize: '12px', color: 'var(--text-3)' }}>{formatDate(minDate)}</span>
                    <span style={{ position: 'absolute', right: 0, fontSize: '12px', color: 'var(--text-3)' }}>{formatDate(maxDate)}</span>
                  </div>
                </div>

                {phases.map(phase => {
                  const startOffset = Math.max(0, (new Date(phase.start_date) - new Date(minDate)) / 86400000)
                  const duration    = phase.duration_days || 1
                  const leftPct     = (startOffset / span) * 100
                  const widthPct    = Math.max(3, (duration / span) * 100)
                  const h           = calcHours(phase, now)
                  const barColor    = h ? h.barColor : (STATUS_PHASE_COLOR[phase.status] || 'var(--accent)')
                  const progressPct = phase.status === 'completed' ? 100 : phase.status === 'pending' ? 0 : (h ? h.consumedPct : 0)

                  return (
                    <div key={phase.id} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
                        {phase.name}
                      </div>
                      <div style={{ position: 'relative', height: 26, background: 'var(--bg-3)', borderRadius: 4 }}>
                        {/* Ghost */}
                        <div style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, height: '100%', borderRadius: 4, background: barColor, opacity: 0.15 }} />
                        {/* Progress */}
                        {progressPct > 0 && (
                          <div style={{ position: 'absolute', left: `${leftPct}%`, width: `${progressPct * widthPct / 100}%`, height: '100%', borderRadius: 4, background: barColor, transition: 'width 0.4s ease' }} />
                        )}
                        {/* Label */}
                        <div style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, height: '100%', display: 'flex', alignItems: 'center', paddingLeft: 6, overflow: 'hidden', pointerEvents: 'none' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '88%', textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
                            {phase.name}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Phase rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {phases.map(phase => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                user={user}
                now={now}
                isMobile={isMobile}
                onRefresh={onRefresh}
                onToast={onToast}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PhaseRow ─────────────────────────────────────────────────────────────────

function PhaseRow({ phase, user, now, isMobile, onRefresh, onToast }) {
  const [expanded,   setExpanded]   = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [approvalType,      setApprovalType]      = useState(null)
  const [form, setForm] = useState(null)
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const [formErrors, setFormErrors] = useState({})

  const isAdmin    = user?.role === 'admin'
  const isManager  = user?.role === 'manager'
  const isResource = user?.role === 'resource'
  const canDirectEdit   = isAdmin || isManager
  const canRequestEdit  = isResource

  const qc = useQueryClient()

  // ── Save (direct edit — admin/manager) ──
  const saveMutation = useMutation({
    mutationFn: (data) => timelinesApi.update(phase.id, data),
    onSuccess: () => {
      setEditing(false); setForm(null); setFormErrors({})
      onRefresh()
      onToast('Phase updated!')
    },
    onError: (err) => onToast(extractError(err), 'error'),
  })

  // ── Delete (direct — admin/manager) ──
  const deleteMutation = useMutation({
    mutationFn: () => timelinesApi.delete(phase.id),
    onSuccess: () => { setShowDelete(false); onRefresh(); onToast('Phase deleted.') },
    onError: (err) => { setShowDelete(false); onToast(extractError(err), 'error') },
  })

  // ── Resume (on_hold → in_progress) ──
  const resumeMutation = useMutation({
    mutationFn: () => timelinesApi.update(phase.id, { status: 'in_progress' }),
    onSuccess: () => { onRefresh(); onToast('Phase resumed.') },
    onError: (err) => onToast(extractError(err), 'error'),
  })

  // ── Complete milestone ──
  const completeMilestoneMutation = useMutation({
    mutationFn: (milestoneId) => timelinesApi.completeMilestone(milestoneId),
    onSuccess: () => { onRefresh(); onToast('Milestone completed!') },
    onError: (err) => onToast(extractError(err), 'error'),
  })

  function startEdit(e) {
    e.stopPropagation()
    setForm(isResource
      ? {
          status: phase.status || 'pending',
          progress: String(phase.progress ?? 0),
          description: phase.description || '',
          work_date: new Date().toISOString().slice(0, 10),
          hours: '',
        }
      : {
          name:        phase.name || '',
          status:      phase.status || 'pending',
          start_date:  phase.start_date || '',
          end_date:    phase.end_date || '',
          description: phase.description || '',
        }
    )
    setFormErrors({})
    setEditing(true)
    setExpanded(true)
  }

  function validateForm() {
    const errors = {}
    if (isResource) {
      const progress = Number(form.progress)
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
        errors.progress = 'Progress must be a whole number between 0 and 100'
      }
      if (!form.description?.trim()) errors.description = 'Work details are required'
      if (!form.work_date) errors.work_date = 'Work date is required'
      if (!form.hours || Number(form.hours) <= 0) errors.hours = 'Hours must be greater than 0'
      return errors
    }
    if (!form.name?.trim()) errors.name = 'Name is required'
    if (!form.start_date) errors.start_date = 'Start date is required'
    if (!form.end_date)   errors.end_date   = 'End date is required'
    if (form.start_date && form.end_date && form.start_date > form.end_date)
      errors.end_date = 'End date must be after start date'
    return errors
  }

  async function saveEdit() {
    const errors = validateForm()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    if (isResource) {
      try {
        await Promise.all([
          timelinesApi.update(phase.id, {
            status: form.status,
            progress: Number(form.progress),
            description: form.description.trim(),
          }),
          resourcesApi.createTimeEntry({
            project: phase.project,
            timeline: phase.id,
            date: form.work_date,
            hours: form.hours,
            description: `Phase: ${phase.name}\n${form.description.trim()}`,
          }),
        ])
        setEditing(false); setForm(null); setFormErrors({})
        onRefresh()
        onToast('Phase updated and timesheet submitted.')
      } catch (err) {
        onToast(extractError(err), 'error')
      }
      return
    }
    saveMutation.mutate({ ...form })
  }

  function requestApproval(type, e) {
    e.stopPropagation()
    setApprovalType(type)
    setShowApprovalModal(true)
  }

  const h = calcHours(phase, now)
  const barColor = h ? h.barColor : (STATUS_PHASE_COLOR[phase.status] || 'var(--accent)')

  return (
    <div style={{
      background: 'var(--bg-2)',
      borderRadius: 'var(--r-md)',
      border: `1px solid ${editing ? 'var(--accent)' : 'var(--border)'}`,
      transition: 'border-color var(--t-fast)',
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div
        onClick={() => !editing && setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 8 : 12,
          padding: isMobile ? '10px 12px' : '10px 14px',
          cursor: editing ? 'default' : 'pointer',
        }}
      >
        {/* Status dot */}
        <div style={{
          width: 9, height: 9,
          borderRadius: 2,
          background: STATUS_PHASE_COLOR[phase.status] || 'var(--accent)',
          flexShrink: 0,
        }} />

        {/* Name + badge */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontWeight: 500, fontSize: '15px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {phase.name}
          </span>
          {!isMobile && (
            <Badge color={STATUS_COLOR[phase.status]}>{STATUS_LABEL[phase.status]}</Badge>
          )}
        </div>

        {/* Right meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flexShrink: 0 }}>
          {!isMobile && (
            <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>
              {formatDate(phase.start_date)} → {formatDate(phase.end_date)}
            </span>
          )}

          {/* Mini time bar */}
          {h && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div style={{ width: isMobile ? 50 : 72, height: 5, background: 'var(--bg-3)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${h.consumedPct}%`, background: h.barColor, borderRadius: 99, transition: 'width 0.4s ease' }} />
              </div>
              {!isMobile && (
                <span style={{ fontSize: '13px', color: h.barColor, fontWeight: 600, minWidth: 44 }}>
                  {phase.status === 'completed' ? 'done' : `${h.remaining}h left`}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          {!editing && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
              {isResource && (
                <>
                  <Btn
                    size="sm"
                    variant="secondary"
                    icon={<Edit2 size={12} />}
                    onClick={startEdit}
                    style={{ minWidth: isMobile ? 'auto' : 112 }}
                  >
                    {!isMobile && 'Fill Phase'}
                  </Btn>
                </>
              )}
              {/* Resume button */}
              {phase.status === 'on_hold' && canDirectEdit && (
                <ActionBtn
                  title="Resume phase"
                  onClick={() => resumeMutation.mutate()}
                  loading={resumeMutation.isPending}
                  hoverColor="#38bdf8"
                >
                  ▶
                </ActionBtn>
              )}

              {/* Edit */}
              {(canDirectEdit || canRequestEdit) && (
                <ActionBtn
                  title={canDirectEdit ? 'Edit phase' : 'Request edit approval'}
                  onClick={canDirectEdit ? startEdit : (e) => requestApproval('edit', e)}
                  hoverColor="var(--accent)"
                  icon={<Edit2 size={12} />}
                />
              )}

              {/* Delete */}
              {(canDirectEdit || canRequestEdit) && (
                <ActionBtn
                  title={canDirectEdit ? 'Delete phase' : 'Request delete approval'}
                  onClick={canDirectEdit
                    ? (e) => { e.stopPropagation(); setShowDelete(true) }
                    : (e) => requestApproval('delete', e)
                  }
                  hoverColor="var(--danger)"
                  icon={<Trash2 size={12} />}
                />
              )}
            </div>
          )}

          {/* Expand chevron */}
          {!editing && (
            <div style={{
              color: 'var(--text-3)',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
              transition: 'transform var(--t-fast)',
              lineHeight: 0,
            }}>
              <ChevronRight size={14} />
            </div>
          )}
        </div>
      </div>

      {/* Inline edit form */}
      {editing && form && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
        }}>
          {isResource ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 160px', gap: 'var(--sp-3)' }}>
                <StyledSelect
                  label="Status"
                  value={form.status}
                  onChange={e => f('status', e.target.value)}
                  options={STATUS_OPTIONS}
                />
                <FormField label="Progress %" required error={formErrors.progress}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={form.progress}
                    onChange={e => f('progress', e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${formErrors.progress ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '9px 12px', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = formErrors.progress ? 'var(--danger)' : 'var(--border)'}
                  />
                </FormField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 160px', gap: 'var(--sp-3)' }}>
                <FormField label="Work Date" required error={formErrors.work_date}>
                  <input
                    type="date"
                    value={form.work_date}
                    onChange={e => f('work_date', e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${formErrors.work_date ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '9px 12px', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = formErrors.work_date ? 'var(--danger)' : 'var(--border)'}
                  />
                </FormField>
                <FormField label="Hours Worked" required error={formErrors.hours}>
                  <input
                    type="number"
                    min="0.25"
                    max="24"
                    step="0.25"
                    value={form.hours}
                    onChange={e => f('hours', e.target.value)}
                    placeholder="e.g. 4"
                    style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${formErrors.hours ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '9px 12px', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = formErrors.hours ? 'var(--danger)' : 'var(--border)'}
                  />
                </FormField>
              </div>
              <FormField label="Phase Details" required error={formErrors.description}>
                <textarea
                  value={form.description}
                  onChange={e => f('description', e.target.value)}
                  placeholder="What work was completed, what is pending, blockers, and next steps…"
                  rows={4}
                  maxLength={5000}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-2)', border: `1px solid ${formErrors.description ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '10px 12px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = formErrors.description ? 'var(--danger)' : 'var(--border)'}
                />
              </FormField>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 'var(--sp-3)' }}>
                <FormField label="Phase Name" required error={formErrors.name}>
                  <input
                    value={form.name}
                    onChange={e => f('name', e.target.value)}
                    placeholder="Phase name…"
                    maxLength={200}
                    style={{
                      width: '100%', background: 'var(--bg-2)',
                      border: `1px solid ${formErrors.name ? 'var(--danger)' : 'var(--border)'}`,
                      borderRadius: 'var(--r-md)', color: 'var(--text-0)',
                      fontSize: '15px', padding: '9px 12px', outline: 'none',
                      transition: 'border-color var(--t-fast)',
                    }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = formErrors.name ? 'var(--danger)' : 'var(--border)'}
                  />
                </FormField>
                <StyledSelect
                  label="Status"
                  value={form.status}
                  onChange={e => f('status', e.target.value)}
                  options={STATUS_OPTIONS}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 'var(--sp-3)' }}>
                <FormField label="Start Date" required error={formErrors.start_date}>
                  <input type="date" value={form.start_date} onChange={e => f('start_date', e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${formErrors.start_date ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '9px 12px', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = formErrors.start_date ? 'var(--danger)' : 'var(--border)'}
                  />
                </FormField>
                <FormField label="End Date" required error={formErrors.end_date}>
                  <input type="date" value={form.end_date} onChange={e => f('end_date', e.target.value)}
                    style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${formErrors.end_date ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '9px 12px', outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = formErrors.end_date ? 'var(--danger)' : 'var(--border)'}
                  />
                </FormField>
              </div>
              <FormField label="Description">
                <textarea
                  value={form.description}
                  onChange={e => f('description', e.target.value)}
                  placeholder="Phase details, objectives, notes…"
                  rows={3}
                  maxLength={5000}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '10px 12px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              </FormField>
            </>
          )}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(false); setForm(null); setFormErrors({}) }} icon={<X size={13} />}>Cancel</Btn>
            <Btn size="sm" loading={saveMutation.isPending} onClick={saveEdit} icon={<Save size={13} />}>{isResource ? 'Save Phase Update' : 'Save Changes'}</Btn>
          </div>
        </div>
      )}

      {/* Expanded detail view */}
      {!editing && expanded && (
        <PhaseDetail phase={phase} h={h} now={now} isMobile={isMobile} user={user} onRefresh={onRefresh} onToast={onToast} completeMilestone={(id) => completeMilestoneMutation.mutate(id)} />
      )}

      {/* Delete confirm modal */}
      {showDelete && (
        <Modal open onClose={() => setShowDelete(false)} title="Delete Phase" width={420}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 'var(--r-md)', padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
              <p style={{ color: 'var(--text-1)', fontSize: '14px', lineHeight: 1.6 }}>
                Delete phase <strong style={{ color: 'var(--text-0)' }}>"{phase.name}"</strong>? This action cannot be undone and will remove all associated milestones.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Btn>
              <Btn
                loading={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
              >
                Delete Phase
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Approval request modal */}
      {showApprovalModal && (
        <ApprovalRequestModal
          phase={phase}
          type={approvalType}
          onClose={() => setShowApprovalModal(false)}
          onSubmitted={(msg) => {
            setShowApprovalModal(false)
            onToast(msg || 'Request submitted — awaiting admin approval.')
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

// ─── ActionBtn ────────────────────────────────────────────────────────────────

function ActionBtn({ onClick, title, icon, children, hoverColor = 'var(--accent)', loading }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={loading}
      style={{ background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: 'var(--text-3)', padding: '4px 5px', lineHeight: 0, borderRadius: 'var(--r-sm)', transition: 'color var(--t-fast)', opacity: loading ? 0.6 : 1 }}
      onMouseEnter={e => !loading && (e.currentTarget.style.color = hoverColor)}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-3)')}
    >
      {loading ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : (icon || children)}
    </button>
  )
}

// ─── PhaseDetail ──────────────────────────────────────────────────────────────

function PhaseDetail({ phase, h, now, isMobile, user, onRefresh, onToast, completeMilestone }) {
  const canEdit = user?.role === 'admin' || user?.role === 'manager'
  const [showAddMilestone, setShowAddMilestone] = useState(false)
  const [msForm, setMsForm] = useState({ title: '', due_date: '' })
  const [msLoading, setMsLoading] = useState(false)
  const [msError, setMsError] = useState('')

  async function addMilestone(e) {
    e.preventDefault()
    if (!msForm.title.trim()) { setMsError('Title is required'); return }
    if (!msForm.due_date) { setMsError('Due date is required'); return }
    setMsLoading(true); setMsError('')
    try {
      await timelinesApi.addMilestone(phase.id, msForm)
      setMsForm({ title: '', due_date: '' })
      setShowAddMilestone(false)
      onRefresh()
      onToast('Milestone added!')
    } catch (err) {
      setMsError(extractError(err))
    } finally {
      setMsLoading(false)
    }
  }

  const statusLabel = h ? ({
    pending:     'Not started yet',
    in_progress: `${h.consumed}h consumed · ${h.remaining}h remaining`,
    completed:   h.overtime > 0
      ? `⚠️ ${h.overtime}h overtime (${h.consumed}h used / ${h.allocated}h allocated)`
      : h.saved > 0
        ? `🎉 ${h.saved}h saved (${h.consumed}h / ${h.allocated}h allocated)`
        : `✅ Finished on estimate (${h.consumed}h)`,
    on_hold:     `Paused at ${h.consumed}h · ${h.remaining}h remaining`,
  })[phase.status] || '' : ''

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: isMobile ? '12px 12px' : '14px 16px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

      {/* Mobile badge */}
      {isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge color={STATUS_COLOR[phase.status]}>{STATUS_LABEL[phase.status]}</Badge>
          <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{formatDate(phase.start_date)} → {formatDate(phase.end_date)}</span>
        </div>
      )}

      {/* Description */}
      {phase.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <p style={{ fontSize: '15px', color: 'var(--text-1)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{phase.description}</p>
        </div>
      )}

      {/* Assignees */}
      {phase.assignee_details?.length > 0 && (
        <div>
          <SectionLabel>Assigned To</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            {phase.assignee_details.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--r-full)', padding: '4px 10px 4px 6px' }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: '#0a0a0a' }}>
                  {(u.name || '?')[0].toUpperCase()}
                </div>
                <span style={{ fontSize: '14px', fontWeight: 500 }}>{u.name}</span>
                <span style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'capitalize' }}>{u.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hours bar */}
      {h && (
        <div style={{ borderRadius: 'var(--r-md)', border: `1px solid ${h.barColor}35`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: `${h.barColor}14` }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: h.barColor }}>
              {phase.status === 'completed' ? '✅ Completed' : phase.status === 'on_hold' ? '⏸ On Hold' : phase.status === 'pending' ? '🕐 Pending' : `${h.remaining}h remaining`}
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{h.allocated}h allocated</span>
          </div>
          <div style={{ padding: '10px 14px', background: 'var(--bg-3)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ position: 'relative', height: 10, background: 'var(--bg-2)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${h.consumedPct}%`, background: h.barColor, borderRadius: 99, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{statusLabel}</span>
              <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{h.consumedPct}% used</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
              {(phase.status === 'completed'
                ? [
                    { label: 'Consumed', value: `${h.consumed}h`, color: h.barColor },
                    h.overtime > 0 ? { label: 'Overtime', value: `+${h.overtime}h`, color: '#f87171' } : { label: 'Saved', value: `-${h.saved}h`, color: '#4ade80' },
                    { label: 'Allocated', value: `${h.allocated}h`, color: 'var(--text-3)' },
                  ]
                : [
                    { label: 'Consumed', value: `${h.consumed}h`, color: h.barColor },
                    { label: 'Remaining', value: `${h.remaining}h`, color: 'var(--text-1)' },
                    { label: 'Allocated', value: `${h.allocated}h`, color: 'var(--text-3)' },
                  ]
              ).map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-2)', borderRadius: 'var(--r-sm)' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color }}>{value}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Milestones */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionLabel style={{ margin: 0 }}>
            Milestones {phase.milestones?.length > 0 && `— ${phase.milestones.filter(m => m.completed).length}/${phase.milestones.length} done`}
          </SectionLabel>
          {canEdit && (
            <button
              onClick={() => setShowAddMilestone(s => !s)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Plus size={11} />{showAddMilestone ? 'Cancel' : 'Add'}
            </button>
          )}
        </div>

        {showAddMilestone && (
          <form onSubmit={addMilestone} style={{ background: 'var(--bg-3)', borderRadius: 'var(--r-md)', padding: '12px', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 160px', gap: 8 }}>
              <input
                value={msForm.title}
                onChange={e => setMsForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Milestone title…"
                maxLength={200}
                style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '8px 12px', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              <input
                type="date"
                value={msForm.due_date}
                onChange={e => setMsForm(p => ({ ...p, due_date: e.target.value }))}
                style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '8px 12px', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            {msError && <div style={{ fontSize: '13px', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={11} />{msError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn type="submit" size="sm" loading={msLoading} icon={<Plus size={12} />}>Add Milestone</Btn>
            </div>
          </form>
        )}

        {phase.milestones?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {phase.milestones.map(m => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 10px',
                background: 'var(--bg-3)',
                borderRadius: 'var(--r-sm)',
                border: `1px solid ${m.completed ? 'rgba(74,222,128,0.2)' : 'var(--border)'}`,
                transition: 'border-color var(--t-fast)',
              }}>
                {canEdit ? (
                  <button
                    onClick={() => !m.completed && completeMilestone(m.id)}
                    disabled={m.completed}
                    title={m.completed ? 'Completed' : 'Mark complete'}
                    style={{ background: 'none', border: 'none', cursor: !m.completed ? 'pointer' : 'default', padding: 0, lineHeight: 0, color: m.completed ? 'var(--success)' : 'var(--text-3)', flexShrink: 0, transition: 'color var(--t-fast)' }}
                    onMouseEnter={e => !m.completed && (e.currentTarget.style.color = 'var(--success)')}
                    onMouseLeave={e => !m.completed && (e.currentTarget.style.color = 'var(--text-3)')}
                  >
                    {m.completed ? <CheckCircle size={15} /> : <Circle size={15} />}
                  </button>
                ) : (
                  <span
                    title={m.completed ? 'Completed milestone' : 'Milestones are managed by admins and managers'}
                    style={{ lineHeight: 0, color: m.completed ? 'var(--success)' : 'var(--text-3)', flexShrink: 0, opacity: m.completed ? 1 : 0.65 }}
                  >
                    {m.completed ? <CheckCircle size={15} /> : <Circle size={15} />}
                  </span>
                )}
                <span style={{ fontSize: '14px', color: m.completed ? 'var(--text-3)' : 'var(--text-1)', textDecoration: m.completed ? 'line-through' : 'none', flex: 1 }}>
                  {m.title}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-3)', flexShrink: 0 }}>
                  Due {formatDate(m.due_date)}
                </span>
              </div>
            ))}
          </div>
        ) : !showAddMilestone && (
          <p style={{ fontSize: '14px', color: 'var(--text-3)', fontStyle: 'italic' }}>
            No milestones yet.{canEdit ? ' Add one above.' : ''}
          </p>
        )}
      </div>

      {/* Empty state */}
      {!phase.description && !phase.assignee_details?.length && !h && !phase.milestones?.length && (
        <p style={{ color: 'var(--text-3)', fontSize: '15px', margin: 0 }}>
          No additional details available.{canEdit ? ' Click ✏️ to edit.' : ''}
        </p>
      )}
    </div>
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, ...style }}>
      {children}
    </div>
  )
}

// ─── CreateTimelineModal ──────────────────────────────────────────────────────

function CreateTimelineModal({ user, onClose, onCreated }) {
  const isResource = user?.role === 'resource'
  const [form, setForm] = useState({
    name: '', project: '', start_date: '', end_date: '', status: 'pending', description: '',
  })
  const [errors, setErrors]   = useState({})
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState('')
  const isMobile = useIsMobile()
  const f = (k, v) => { setForm(p => ({ ...p, [k]: v })); setErrors(p => ({ ...p, [k]: '' })) }

  const { data: projects } = useQuery({
    queryKey: ['projects-for-timeline-create', user?.id],
    queryFn: () => projectsApi.list({ page_size: 200 }).then(r => r.data.results || r.data),
    staleTime: 60_000,
  })

  function validate() {
    const e = {}
    if (!form.name.trim())   e.name       = 'Phase name is required'
    if (!form.project)       e.project    = 'Project is required'
    if (!form.start_date)    e.start_date = 'Start date is required'
    if (!form.end_date)      e.end_date   = 'End date is required'
    if (form.start_date && form.end_date && form.start_date > form.end_date)
      e.end_date = 'End date must be after start date'
    return e
  }

  async function submit(e) {
    e.preventDefault()
    const e2 = validate()
    if (Object.keys(e2).length) { setErrors(e2); return }
    setLoading(true); setApiError('')
    try {
      await timelinesApi.create({
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        color: STATUS_PHASE_COLOR[form.status] || '#6366f1',
      })
      onCreated()
    } catch (err) {
      setApiError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  const workDays = form.start_date && form.end_date ? countWorkDays(new Date(form.start_date), new Date(form.end_date)) : 0

  return (
    <Modal open onClose={onClose} title="Create New Phase" width={540}>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

        {isResource && (
          <div style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: '15px', color: 'var(--info)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>This is your main phase workspace. Use it to follow assigned project timelines and submit edit or delete approval requests when required.</span>
          </div>
        )}

        {apiError && (
          <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: '15px', color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{apiError}</span>
          </div>
        )}

        <FormField label="Phase Name" required error={errors.name}>
          <input
            value={form.name}
            onChange={e => f('name', e.target.value)}
            placeholder="e.g. Design Phase, Development Sprint 1…"
            maxLength={200}
            autoFocus
            style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${errors.name ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '10px 12px', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = errors.name ? 'var(--danger)' : 'var(--border)'}
          />
        </FormField>

        <FormField label="Project" required error={errors.project}>
          <StyledSelect
            value={form.project}
            onChange={e => f('project', e.target.value)}
            options={(projects || []).map(p => ({ value: String(p.id), label: p.name }))}
            placeholder="Select a project…"
            required
          />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 'var(--sp-3)' }}>
          <FormField label="Start Date" required error={errors.start_date}>
            <input type="date" value={form.start_date} onChange={e => f('start_date', e.target.value)}
              style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${errors.start_date ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '10px 12px', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = errors.start_date ? 'var(--danger)' : 'var(--border)'}
            />
          </FormField>
          <FormField label="End Date" required error={errors.end_date}>
            <input type="date" value={form.end_date} onChange={e => f('end_date', e.target.value)}
              style={{ width: '100%', background: 'var(--bg-2)', border: `1px solid ${errors.end_date ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '10px 12px', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = errors.end_date ? 'var(--danger)' : 'var(--border)'}
            />
          </FormField>
        </div>

        {/* Duration preview */}
        {workDays > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-3)', borderRadius: 'var(--r-md)', fontSize: '14px', color: 'var(--text-2)' }}>
            <Clock size={13} style={{ color: 'var(--accent)' }} />
            <span><strong style={{ color: 'var(--text-0)' }}>{workDays}</strong> working days · <strong style={{ color: 'var(--text-0)' }}>{workDays * 8}h</strong> allocated</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 'var(--sp-3)', alignItems: 'end' }}>
          <StyledSelect
            label="Initial Status"
            value={form.status}
            onChange={e => f('status', e.target.value)}
            options={STATUS_OPTIONS}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', marginBottom: 0 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: STATUS_PHASE_COLOR[form.status] }} />
            <span style={{ fontSize: '14px', color: 'var(--text-2)' }}>Color auto-assigned</span>
          </div>
        </div>

        <FormField label="Description (optional)">
          <textarea
            value={form.description}
            onChange={e => f('description', e.target.value)}
            placeholder="Phase goals, scope, notes…"
            rows={3}
            maxLength={5000}
            style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '10px 12px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </FormField>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border)' }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn
            type="submit"
            loading={loading}
            icon={<Plus size={14} />}
            style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#0a0a0a', fontWeight: 700, minWidth: 140 }}
          >
            Create Phase
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

// ─── ApprovalRequestModal ─────────────────────────────────────────────────────

function ApprovalRequestModal({ phase, type, onClose, onSubmitted }) {
  const [reason,  setReason]  = useState('')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')
  const isDelete = type === 'delete'

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) { setErr('Please explain your reason.'); return }
    if (reason.trim().length < 10) { setErr('Please provide a more detailed reason (at least 10 characters).'); return }
    setLoading(true); setErr('')
    try {
      await timelineApprovalsApi.create({
        timeline:         phase.id,
        request_type:     type,
        reason:           reason.trim(),
        proposed_changes: {},
      })
      onSubmitted(`${isDelete ? 'Delete' : 'Edit'} request submitted — awaiting admin approval.`)
    } catch (err) {
      const msg = extractError(err)
      // Handle duplicate request error gracefully
      if (msg.toLowerCase().includes('pending')) {
        setErr('You already have a pending request for this timeline. Please wait for admin response.')
      } else {
        setErr(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={isDelete ? 'Request Delete Approval' : 'Request Edit Approval'} width={480}>
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

        {/* Info banner */}
        <div style={{
          background: isDelete ? 'rgba(248,113,113,0.08)' : 'rgba(96,165,250,0.08)',
          border: `1px solid ${isDelete ? 'rgba(248,113,113,0.3)' : 'rgba(96,165,250,0.3)'}`,
          borderRadius: 'var(--r-md)',
          padding: '12px 14px',
          fontSize: '15px',
          color: isDelete ? 'var(--danger)' : 'var(--info)',
          lineHeight: 1.6,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          {isDelete ? <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> : <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>
            {isDelete
              ? <>You're requesting permission to <strong>permanently delete</strong> phase <strong>"{phase.name}"</strong>. An admin will review this request.</>
              : <>You're requesting permission to <strong>edit</strong> phase <strong>"{phase.name}"</strong>. Once approved, you can apply your changes from the <strong>Approvals</strong> tab.</>
            }
          </span>
        </div>

        {/* Phase summary */}
        <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_PHASE_COLOR[phase.status] }} />
            <span style={{ fontSize: '15px', fontWeight: 600 }}>{phase.name}</span>
            <Badge color={STATUS_COLOR[phase.status]}>{STATUS_LABEL[phase.status]}</Badge>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-3)' }}>
            {formatDate(phase.start_date)} → {formatDate(phase.end_date)}
          </div>
        </div>

        {err && (
          <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 'var(--r-md)', padding: '10px 14px', fontSize: '15px', color: 'var(--danger)', display: 'flex', gap: 8 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />{err}
          </div>
        )}

        <FormField label="Reason" required>
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setErr('') }}
            placeholder={isDelete
              ? 'Why should this phase be deleted? Explain the business reason…'
              : 'What do you need to change and why? Be specific about the fields you want to update…'
            }
            rows={4}
            maxLength={1000}
            required
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'var(--bg-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)', color: 'var(--text-0)',
              fontSize: '15px', padding: '10px 12px', outline: 'none',
              resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6,
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>
              {isDelete ? 'Admin will review and notify you of their decision.' : 'After approval, go to Approvals to apply your specific changes.'}
            </span>
            <span style={{ fontSize: '13px', color: reason.length > 900 ? 'var(--warning)' : 'var(--text-3)' }}>
              {reason.length}/1000
            </span>
          </div>
        </FormField>

        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border)' }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn
            type="submit"
            loading={loading}
            icon={<Send size={13} />}
            style={{
              background: isDelete ? 'var(--danger)' : 'var(--accent)',
              borderColor: isDelete ? 'var(--danger)' : 'var(--accent)',
              color: isDelete ? '#fff' : '#0a0a0a',
              fontWeight: 700,
              minWidth: 160,
            }}
          >
            Send {isDelete ? 'Delete' : 'Edit'} Request
          </Btn>
        </div>
      </form>
    </Modal>
  )
}