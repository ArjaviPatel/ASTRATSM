/**
 * Timesheet.jsx  — Updated
 * Changes:
 * 1. EntryForm: Client dropdown shows ALL clients → filtered Project dropdown below
 * 2. Calendar: Red=absent(weekday), Green=6-9h, Yellow=>9h, White=<4h, dark-green=approved≥6h
 * 3. ApprovalView: full filter tabs (Pending / Approved / Rejected / All) with proper data
 * 4. Reminder scheduling: backend already runs the command; see send_timesheet_reminders.py
 *
 * FIX: normalize() now checks p['client__id'] (my_dashboard .values() format) before p.client
 *      (projectsApi.list serializer format) so projects correctly map to their client in the dropdown.
 */
import React, { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, Clock, Plus, Trash2, Edit2, Save, X, ChevronLeft,
  ChevronRight, AlertTriangle, Download, Users, FolderKanban, Building2,
  Check, XCircle, FileText, Filter,
} from 'lucide-react'
import { resourcesApi, projectsApi, clientsApi } from '@/api/index.js'
import { useAuthStore } from '@/stores/authStore.js'
import {
  Btn, Spinner, Badge, Card, Modal, EmptyState, Pagination,
} from '@/components/ui/index.jsx'
import { extractError } from '@/utils/index.js'

// ── helpers ──────────────────────────────────────────────────────────
const fmt = (v) => `${Number(v || 0).toFixed(1)}h`
const isoDate = (d) => d.toISOString().slice(0, 10)
const today = () => isoDate(new Date())
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`
const clockLabel = (from, to) => (from && to ? `${String(from).slice(0, 5)} - ${String(to).slice(0, 5)}` : 'Hours-only')

function hoursBetween(from, to) {
  if (!from || !to) return 0
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  const mins = (th * 60 + tm) - (fh * 60 + fm)
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : 0
}

function needsLateApproval(date) {
  return new Date(`${date}T23:59:59`).getTime() < Date.now() - (48 * 60 * 60 * 1000)
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}
function firstWeekday(year, month) {
  return (new Date(year, month, 1).getDay() + 6) % 7 // Mon=0
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getDayColor(entry, isWeekend, isFuture) {
  if (isFuture) return 'transparent'
  if (!entry) {
    if (isWeekend) return 'transparent'
    return 'rgba(239,68,68,0.22)'
  }
  const h = Number(entry.hours || 0)
  if (h > 9) return 'rgba(251,191,36,0.35)'
  if (h >= 6) return 'rgba(34,197,94,0.32)'
  if (h < 4) return 'rgba(248,250,252,0.15)'
  return 'rgba(134,239,172,0.22)'
}

function CalendarHeatmap({ year, month, entryMap, selectedDate, onSelectDate, today: todayStr }) {
  const days = daysInMonth(year, month)
  const startWd = firstWeekday(year, month)
  const cells = []
  for (let i = 0; i < startWd; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
        {WEEKDAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const entry = entryMap[ds]
          const isToday = ds === todayStr
          const isSelected = ds === selectedDate
          const isFuture = ds > todayStr
          const dayOfWeek = (startWd + day - 1) % 7
          const isWeekend = dayOfWeek >= 5
          const bg = getDayColor(entry, isWeekend, isFuture)
          const isApproved = entry?.approved === true
          let borderColor = 'transparent'
          if (isSelected) borderColor = 'var(--accent)'
          else if (isToday) borderColor = 'var(--info)'
          else if (isApproved) borderColor = 'rgba(34,197,94,0.6)'
          const h = entry ? Number(entry.hours || 0) : 0
          let hoursColor = 'var(--text-3)'
          if (h > 9) hoursColor = 'var(--warning)'
          else if (h >= 6) hoursColor = '#22c55e'
          else if (h > 0) hoursColor = 'var(--text-2)'
          return (
            <button
              key={ds}
              onClick={() => !isFuture && onSelectDate(ds)}
              title={entry ? `${fmt(entry.hours)} • ${entry.approved ? 'Approved' : 'Pending'}` : isFuture ? 'Future' : isWeekend ? 'Weekend' : 'Absent'}
              style={{ aspectRatio: '1', borderRadius: 6, border: `2px solid ${borderColor}`, background: bg, cursor: isFuture ? 'default' : 'pointer', fontSize: 12, fontWeight: isToday ? 700 : 400, color: isFuture ? 'var(--text-3)' : 'var(--text-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, transition: 'transform 0.1s', opacity: isFuture ? 0.35 : 1 }}
              onMouseEnter={e => { if (!isFuture) e.currentTarget.style.transform = 'scale(1.08)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              <span>{day}</span>
              {entry && <span style={{ fontSize: 9, fontWeight: 700, color: hoursColor }}>{fmt(entry.hours)}</span>}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        {[
          { color: 'rgba(239,68,68,0.22)', label: 'Absent' },
          { color: 'rgba(248,250,252,0.15)', border: '1px solid var(--border)', label: '<4h' },
          { color: 'rgba(34,197,94,0.32)', label: '6–9h' },
          { color: 'rgba(251,191,36,0.35)', label: '>9h' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-2)' }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color, border: l.border || 'none' }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EntryForm modal — All Clients first, then filtered Project ────────
function EntryForm({ date, projects, allClients = [], lateApprovals = [], entry, onClose, onSaved }) {
  const qc = useQueryClient()

  // Build clientMap from projects (for mapping projects to clients)
  const clientMap = useMemo(() => {
    const m = {}
    projects.forEach(p => {
      // client_id is already normalized to string in mergedProjects
      const cid = String(p.client_id || p.client || 'no_client')
      const cname = p.client_name || p['client__name'] || 'No Client'
      if (!m[cid]) m[cid] = { id: cid, name: cname, projects: [] }
      m[cid].projects.push(p)
    })
    return m
  }, [projects])

  // Use allClients for the dropdown so ALL clients show, not just ones with assigned projects
  const clientList = useMemo(() => {
    if (allClients.length > 0) {
      return allClients
        .map(c => ({
          id: String(c.id),
          name: c.name,
          projects: clientMap[String(c.id)]?.projects || [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    // Fallback: derive from projects
    return Object.values(clientMap).sort((a, b) => a.name.localeCompare(b.name))
  }, [allClients, clientMap])

  const initialClientId = useMemo(() => {
    if (!entry) return ''
    const pid = entry?.project?.id || entry?.project || entry?.project_id || ''
    if (!pid) return ''
    const proj = projects.find(p => String(p.id) === String(pid))
    if (!proj) return ''
    return String(proj.client_id || proj.client || 'no_client')
  }, [entry, projects])

  const [clientId, setClientId] = useState(initialClientId)
  const [projectId, setProjectId] = useState(entry?.project?.id || entry?.project || entry?.project_id || '')
  const [startTime, setStartTime] = useState(entry?.start_time ? String(entry.start_time).slice(0, 5) : '09:00')
  const [endTime, setEndTime] = useState(entry?.end_time ? String(entry.end_time).slice(0, 5) : '10:00')
  const [description, setDescription] = useState(entry?.description || '')
  const [reason, setReason] = useState('')
  const [needsApproval, setNeedsApproval] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const filteredProjects = useMemo(() => {
    if (!clientId) return []
    // clientId is always a string (from select value), clientMap keys are strings
    return clientMap[String(clientId)]?.projects || []
  }, [clientId, clientMap])

  useEffect(() => {
    if (clientId && !filteredProjects.find(p => String(p.id) === String(projectId))) {
      setProjectId('')
    }
  }, [clientId])

  const selectedProject = projects.find(p => String(p.id) === String(projectId))
  const calculatedHours = hoursBetween(startTime, endTime)
  const isLate = needsLateApproval(date)
  const lateApproval = lateApprovals.find(a => a.date === date)
  const lateApproved = lateApproval?.status === 'approved'
  const latePending = lateApproval?.status === 'pending'

  async function save() {
    if (!clientId) return setError('Select a client.')
    if (!projectId) return setError('Select a project.')
    if (!startTime || !endTime) return setError('Select both From and To time.')
    if (calculatedHours < 0.25) return setError('To time must be at least 15 minutes after From time.')
    setLoading(true); setError('')
    try {
      if (entry?.id) {
        await resourcesApi.updateTimeEntry(entry.id, { project: projectId, date, start_time: startTime, end_time: endTime, hours: calculatedHours, description })
      } else {
        if (isLate && needsApproval && !lateApproved) {
          if (!reason.trim()) return setError('Add a reason for manager approval.')
          await resourcesApi.requestLateEntryApproval({ date, reason })
          qc.invalidateQueries({ queryKey: ['my-late-approvals'] })
          qc.invalidateQueries({ queryKey: ['late-entry-approvals'] })
          onSaved('late_requested')
          return
        }
        await resourcesApi.createTimeEntry({ project: projectId, date, start_time: startTime, end_time: endTime, hours: calculatedHours, description })
      }
      qc.invalidateQueries({ queryKey: ['my-timesheet'] })
      qc.invalidateQueries({ queryKey: ['my-dashboard'] })
      qc.invalidateQueries({ queryKey: ['pending-time-entries'] })
      onSaved()
    } catch (e) {
      const msg = extractError(e)
      const lower = msg.toLowerCase()
      if (lower.includes('already approved')) setNeedsApproval(false)
      else if (lower.includes('late') || lower.includes('permission') || lower.includes('48 hours') || lower.includes('approval')) setNeedsApproval(true)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const SEL = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px', padding: '9px 12px', outline: 'none' }

  return (
    <Modal open onClose={onClose} title={entry ? 'Edit Time Entry' : `Log Time — ${date}`} width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isLate && !entry && (
          <div style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--warning)' }}>
            {lateApproved ? 'Manager approval is in place for this date. You can submit now.' : latePending ? 'A manager approval request is already pending for this date.' : 'Entries older than 48 hours need manager approval before the form is enabled.'}
          </div>
        )}

        {/* Step 1: Client — ALL clients */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
            Client * <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>({clientList.length} available)</span>
          </label>
          <select value={clientId} onChange={e => { setClientId(e.target.value); setProjectId('') }} style={SEL}>
            <option value="">Select client...</option>
            {clientList.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Step 2: Project — filtered by selected client */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
            Project * {clientId && <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>({filteredProjects.length} available)</span>}
          </label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            disabled={!clientId}
            style={{ ...SEL, opacity: !clientId ? 0.5 : 1, cursor: !clientId ? 'not-allowed' : 'pointer' }}
          >
            <option value="">{clientId ? (filteredProjects.length === 0 ? 'No projects for this client' : 'Select project...') : 'Select a client first'}</option>
            {filteredProjects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selectedProject && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>Remaining Hours</div>
                <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 800 }}>{fmt(selectedProject.remaining_hours)}</div>
              </div>
              <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700 }}>Progress</div>
                <div style={{ fontSize: 13, color: 'var(--text-0)', fontWeight: 700 }}>{selectedProject.progress || 0}%</div>
              </div>
            </div>
          )}
        </div>

        {/* Time range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: 10, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>From *</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={SEL} />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>To *</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={SEL} />
          </div>
          <div style={{ background: 'var(--accent-dim)', border: '1px solid var(--border-light)', borderRadius: 8, padding: '9px 10px', minHeight: 42 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, lineHeight: 1 }}>Hours</div>
            <div style={{ fontSize: 15, color: 'var(--accent)', fontWeight: 800, lineHeight: 1.5 }}>{fmt(calculatedHours)}</div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ ...SEL, resize: 'vertical' }} placeholder="What did you work on?" />
        </div>

        {isLate && needsApproval && !entry && (
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--warning)', display: 'block', marginBottom: 6 }}>Reason for late entry *</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ ...SEL, borderColor: 'var(--warning)', resize: 'vertical' }} placeholder="Explain why this entry is late..." />
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn loading={loading} onClick={save} icon={<Save size={14} />}>
            {isLate && needsApproval && !lateApproved && !entry ? 'Request Late Approval' : 'Save'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ── Resource Timesheet View ───────────────────────────────────────────
function ResourceTimesheetView({ user }) {
  const qc = useQueryClient()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDate, setSelectedDate] = useState(today())
  const [showForm, setShowForm] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [successMsg, setSuccessMsg] = useState('')

  const mk = monthKey(year, month)
  const { data: entriesData, isLoading } = useQuery({
    queryKey: ['my-timesheet', mk],
    queryFn: () => resourcesApi.timeEntries({ date_after: `${mk}-01`, date_before: `${mk}-${daysInMonth(year, month)}`, page_size: 500 }).then(r => r.data.results || r.data || []),
    staleTime: 30_000,
  })

  const { data: myDash } = useQuery({
    queryKey: ['my-dashboard'],
    queryFn: () => resourcesApi.myDashboard().then(r => r.data),
    staleTime: 60_000,
  })

  // Fetch ALL clients independently so the dropdown is not limited to assigned projects
  const { data: allClientsData } = useQuery({
    queryKey: ['all-clients-timesheet'],
    queryFn: () => clientsApi.list({ page_size: 500 }).then(r => r.data.results || r.data || []),
    staleTime: 120_000,
  })

  // Fetch ALL active projects so any client's projects are available
  const { data: allProjectsData } = useQuery({
    queryKey: ['all-projects-timesheet'],
    queryFn: () => projectsApi.list({ page_size: 500, status: 'in_progress' }).then(r => r.data.results || r.data || []),
    staleTime: 60_000,
  })

  const { data: lateApprovals } = useQuery({
    queryKey: ['my-late-approvals'],
    queryFn: () => resourcesApi.lateEntryApprovals({ page_size: 100 }).then(r => r.data.results || r.data || []),
    staleTime: 30_000,
  })

  const entries = entriesData || []
  const myDashProjects = myDash?.projects || []
  const stats = myDash?.stats || {}
  const allClients = allClientsData || []

  // Merge myDash projects (have remaining_hours) with allProjects for full coverage.
  // FIX: normalize() now checks p['client__id'] (Django .values() double-underscore key returned
  // by my_dashboard) BEFORE p.client (integer FK returned by ProjectListSerializer).
  // Previously only p.client_id || p.client was checked, so dashboard projects always resolved
  // to 'no_client' because my_dashboard uses client__id, not client_id or client.
  const mergedProjects = useMemo(() => {
    const allRaw = allProjectsData || []
    const myIds = new Set(myDashProjects.map(p => String(p.id)))
    const normalize = p => ({
      ...p,
      // ✅ FIX: p['client__id'] covers my_dashboard .values() format
      //         p.client covers projectsApi.list serializer format
      //         Using ?? (nullish coalescing) to avoid skipping a valid id of 0
      client_id: String(p.client_id ?? p['client__id'] ?? p.client ?? 'no_client'),
      client_name: p.client_name || p['client__name'] || '',
    })
    return [
      ...myDashProjects.map(normalize),
      ...allRaw.filter(p => !myIds.has(String(p.id))).map(normalize),
    ]
  }, [myDashProjects, allProjectsData])

  const entryMap = useMemo(() => {
    const m = {}
    entries.forEach(e => {
      if (!m[e.date]) m[e.date] = { hours: 0, approved: true, entries: [] }
      m[e.date].hours += Number(e.hours || 0)
      m[e.date].approved = m[e.date].approved && e.approved
      m[e.date].entries.push(e)
    })
    return m
  }, [entries])

  const todayStr = today()
  const selectedEntries = entryMap[selectedDate]?.entries || []

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    const n = new Date(); if (year > n.getFullYear() || (year === n.getFullYear() && month >= n.getMonth())) return
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  async function deleteEntry(id) {
    setDeletingId(id)
    try {
      await resourcesApi.deleteTimeEntry(id)
      qc.invalidateQueries({ queryKey: ['my-timesheet'] })
      qc.invalidateQueries({ queryKey: ['my-dashboard'] })
      flash('Entry deleted.')
    } catch (e) { alert(extractError(e)) }
    finally { setDeletingId(null) }
  }

  function flash(msg) {
    setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000)
  }

  const monthLabel = new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 12 }}>
        {[
          { label: 'Total Hours', value: fmt(stats.total_hours), color: 'var(--accent)' },
          { label: 'Approved', value: fmt(stats.approved_hours), color: 'var(--success)' },
          { label: 'Pending', value: fmt(stats.pending_hours), color: 'var(--warning)' },
          { label: 'Active Projects', value: stats.active_project_count ?? myDashProjects.length, color: 'var(--info)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Calendar */}
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4 }}><ChevronLeft size={18} /></button>
            <span style={{ fontWeight: 700, color: 'var(--text-0)' }}>{monthLabel}</span>
            <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', padding: 4 }}><ChevronRight size={18} /></button>
          </div>
          {isLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div> : (
            <CalendarHeatmap year={year} month={month} entryMap={entryMap} selectedDate={selectedDate} onSelectDate={setSelectedDate} today={todayStr} />
          )}
        </div>

        {/* Selected day panel */}
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-0)' }}>{selectedDate}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {selectedEntries.length} {selectedEntries.length === 1 ? 'entry' : 'entries'} • {fmt(selectedEntries.reduce((s, e) => s + Number(e.hours), 0))}
              </div>
            </div>
            {selectedDate <= todayStr && (
              <Btn size="sm" icon={<Plus size={13} />} onClick={() => { setEditEntry(null); setShowForm(true) }}>Add</Btn>
            )}
          </div>

          {selectedEntries.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, gap: 8 }}>
              {selectedDate > todayStr
                ? <span>Future date</span>
                : <><Clock size={28} opacity={0.3} /><span>No entries for this day</span><Btn size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => { setEditEntry(null); setShowForm(true) }}>Log Time</Btn></>
              }
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 340 }}>
              {selectedEntries.map(e => (
                <div key={e.id} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '10px 14px', border: `1px solid ${e.approved ? 'rgba(34,197,94,0.35)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)' }}>{e.project_name || e.project?.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{e.project_client_name || e.project__client__name || 'No client'} • {clockLabel(e.start_time, e.end_time)}</div>
                      {e.description && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{e.description}</div>}
                      <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{fmt(e.hours)}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: e.approved ? 'var(--success)' : 'var(--warning)', background: e.approved ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)', padding: '2px 7px', borderRadius: 20 }}>
                          {e.approved ? '✓ Approved' : 'Pending'}
                        </span>
                      </div>
                    </div>
                    {!e.approved && (
                      <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                        <button onClick={() => { setEditEntry(e); setShowForm(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }} title="Edit"><Edit2 size={14} /></button>
                        <button onClick={() => deleteEntry(e.id)} disabled={deletingId === e.id} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4 }} title="Delete"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* My Projects */}
      <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>Available Projects</h3>
        {myDashProjects.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No active projects available.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 10 }}>
            {myDashProjects.map(p => (
              <div key={p.id} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '12px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)', marginBottom: 2 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{p['client__name'] || p.client_name || ''}</div>
                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, marginBottom: 6 }}>Remaining {fmt(p.remaining_hours)}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ flex: 1, height: 4, background: 'var(--bg-4)', borderRadius: 2 }}>
                    <div style={{ width: `${p.progress || 0}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 30 }}>{p.progress || 0}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Late entry approvals status */}
      {lateApprovals && lateApprovals.length > 0 && (
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: 'var(--text-0)' }}>Late Entry Approval Requests</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lateApprovals.slice(0, 10).map(la => (
              <div key={la.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-3)', borderRadius: 8, padding: '10px 14px' }}>
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--text-0)', fontSize: 14 }}>{la.date}</span>
                  {la.reason && <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 8 }}>{la.reason}</span>}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: la.status === 'approved' ? 'rgba(34,197,94,0.15)' : la.status === 'rejected' ? 'rgba(239,68,68,0.12)' : 'rgba(251,191,36,0.12)', color: la.status === 'approved' ? 'var(--success)' : la.status === 'rejected' ? 'var(--danger)' : 'var(--warning)' }}>
                  {la.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {successMsg && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--success)', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 600, zIndex: 9999 }}>
          {successMsg}
        </div>
      )}

      {showForm && (
        <EntryForm
          date={selectedDate}
          projects={mergedProjects.map(p => ({
            id: p.id,
            name: p.name,
            client_id: p.client_id || p.client || 'no_client',
            client_name: p.client_name || p['client__name'] || '',
            remaining_hours: p.remaining_hours,
            hours: p.hours,
            progress: p.progress,
          }))}
          allClients={allClients}
          lateApprovals={lateApprovals || []}
          entry={editEntry}
          onClose={() => { setShowForm(false); setEditEntry(null) }}
          onSaved={(msg) => {
            setShowForm(false); setEditEntry(null)
            flash(msg === 'late_requested' ? 'Late approval requested.' : 'Time entry saved.')
          }}
        />
      )}
    </div>
  )
}

// ── Manager / Admin approval view ─────────────────────────────────────
function ApprovalView({ user }) {
  const qc = useQueryClient()
  const canResolveLate = user?.role === 'admin' || user?.role === 'manager'
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(1)
  const [approvingId, setApprovingId] = useState(null)
  const [adminNotes, setAdminNotes] = useState({})
  const [successMsg, setSuccessMsg] = useState('')

  const { data: allEntriesData, isLoading: allLoading } = useQuery({
    queryKey: ['timesheet-entries-filter', statusFilter, page],
    queryFn: () => {
      const params = { page, page_size: 25 }
      if (statusFilter === 'pending') params.approved = 'false'
      else if (statusFilter === 'approved') params.approved = 'true'
      return resourcesApi.timeEntries(params).then(r => r.data)
    },
    enabled: canResolveLate,
    placeholderData: p => p,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const { data: lateData } = useQuery({
    queryKey: ['late-approvals-review', statusFilter],
    queryFn: () => {
      const params = { page_size: 100 }
      if (statusFilter !== 'all' && statusFilter !== '') params.status = statusFilter === 'approved' ? 'approved' : statusFilter === 'rejected' ? 'rejected' : 'pending'
      return resourcesApi.lateEntryApprovals(params).then(r => r.data.results || r.data || [])
    },
    enabled: canResolveLate,
    refetchInterval: 30_000,
  })

  const entries = allEntriesData?.results || allEntriesData || []
  const totalPages = allEntriesData?.total_pages ?? 1
  const total = allEntriesData?.count ?? entries.length
  const lateRequests = lateData || []

  const { data: pendingCountData } = useQuery({
    queryKey: ['pending-timesheet-count'],
    queryFn: () => resourcesApi.timeEntries({ approved: 'false', page_size: 1 }).then(r => r.data.count ?? 0),
    enabled: canResolveLate,
    refetchInterval: 30_000,
  })

  async function approve(id) {
    setApprovingId(id)
    try {
      await resourcesApi.approveTimeEntry(id)
      qc.invalidateQueries({ queryKey: ['timesheet-entries-filter'] })
      qc.invalidateQueries({ queryKey: ['pending-timesheet-count'] })
      qc.invalidateQueries({ queryKey: ['my-timesheet'] })
      flash('Approved.')
    } catch (e) { alert(extractError(e)) }
    finally { setApprovingId(null) }
  }

  async function approveLate(id) {
    try {
      await resourcesApi.approveLateEntryApproval(id, { admin_note: adminNotes[id] || '' })
      qc.invalidateQueries({ queryKey: ['late-approvals-review'] })
      flash('Late entry approved.')
    } catch (e) { alert(extractError(e)) }
  }

  async function rejectLate(id) {
    try {
      await resourcesApi.rejectLateEntryApproval(id, { admin_note: adminNotes[id] || '' })
      qc.invalidateQueries({ queryKey: ['late-approvals-review'] })
      flash('Late entry rejected.')
    } catch (e) { alert(extractError(e)) }
  }

  function flash(msg) {
    setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 3000)
  }

  if (!canResolveLate) {
    return (
      <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, color: 'var(--text-2)' }}>
        Timesheet approvals are reviewed by managers and admins. Your own entries are available under My Timesheet.
      </div>
    )
  }

  const filterTabs = [
    { key: 'pending', label: 'Pending', count: pendingCountData },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'all', label: 'All' },
  ]
  const tabColor = { pending: 'var(--warning)', approved: 'var(--success)', rejected: 'var(--danger)', all: 'var(--text-2)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', borderRadius: 10, padding: 4, width: 'fit-content', border: '1px solid var(--border)' }}>
        {filterTabs.map(t => (
          <button key={t.key} onClick={() => { setStatusFilter(t.key); setPage(1) }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: statusFilter === t.key ? 'var(--bg-4)' : 'transparent', color: statusFilter === t.key ? tabColor[t.key] : 'var(--text-3)', transition: 'all 0.15s' }}>
            {t.label}
            {t.count > 0 && <span style={{ background: 'var(--warning)', color: '#000', borderRadius: 20, fontSize: 10, fontWeight: 800, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {statusFilter === 'pending' ? 'Pending' : statusFilter === 'approved' ? 'Approved' : statusFilter === 'rejected' ? 'Rejected' : 'All'} Time Entries
            <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--text-3)', marginLeft: 6 }}>({total})</span>
          </h3>
        </div>
        {allLoading
          ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
          : entries.length === 0
            ? <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>
                {statusFilter === 'pending' ? 'No pending entries. All caught up! ✓' : `No ${statusFilter} entries found.`}
              </p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {entries.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-3)', borderRadius: 8, padding: '12px 16px', flexWrap: 'wrap', borderLeft: `3px solid ${e.approved ? 'var(--success)' : 'var(--warning)'}` }}>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)' }}>{e.resource_name || e.resource?.user?.name || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{e.project_name || e.project?.name} • {e.date}</div>
                      {e.project_client_name && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>Client: {e.project_client_name}</div>}
                      {e.description && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{e.description}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>{fmt(e.hours)}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: e.approved ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)', color: e.approved ? 'var(--success)' : 'var(--warning)' }}>
                        {e.approved ? '✓ Approved' : 'Pending'}
                      </span>
                    </div>
                    {!e.approved && (
                      <Btn size="sm" loading={approvingId === e.id} icon={<Check size={13} />} onClick={() => approve(e.id)}>Approve</Btn>
                    )}
                  </div>
                ))}
              </div>
            )
        }
        {totalPages > 1 && <Pagination page={page} totalPages={totalPages} total={total} pageSize={25} onPageChange={setPage} />}
      </div>

      {(statusFilter === 'pending' || statusFilter === 'all') && lateRequests.length > 0 && (
        <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>
            Late Entry Unlock Requests <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--warning)', marginLeft: 6 }}>({lateRequests.length})</span>
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lateRequests.map(r => (
              <div key={r.id} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '14px 16px', borderLeft: `3px solid ${r.status === 'approved' ? 'var(--success)' : r.status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)' }}>{r.resource?.user?.name || r.resource_name || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Requesting late entry for <strong>{r.date}</strong></div>
                    {r.reason && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>Reason: {r.reason}</div>}
                    <span style={{ fontSize: 11, fontWeight: 600, marginTop: 6, display: 'inline-block', padding: '2px 8px', borderRadius: 20, background: r.status === 'approved' ? 'rgba(34,197,94,0.12)' : r.status === 'rejected' ? 'rgba(239,68,68,0.12)' : 'rgba(251,191,36,0.12)', color: r.status === 'approved' ? 'var(--success)' : r.status === 'rejected' ? 'var(--danger)' : 'var(--warning)' }}>{r.status}</span>
                  </div>
                  {r.status === 'pending' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <input placeholder="Manager note (optional)" value={adminNotes[r.id] || ''} onChange={e => setAdminNotes(n => ({ ...n, [r.id]: e.target.value }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', fontSize: 13, width: 200 }} />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Btn size="sm" onClick={() => approveLate(r.id)} icon={<Check size={13} />}>Unlock</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => rejectLate(r.id)} style={{ color: 'var(--danger)' }} icon={<X size={13} />}>Reject</Btn>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {successMsg && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--success)', color: '#fff', padding: '10px 20px', borderRadius: 8, fontWeight: 600, zIndex: 9999 }}>
          {successMsg}
        </div>
      )}
    </div>
  )
}

// ── Manager Team Overview ─────────────────────────────────────────────
function ManagerTeamView({ user }) {
  const { data: resources, isLoading } = useQuery({
    queryKey: ['resources', 'manager-team'],
    queryFn: () => resourcesApi.list({ page_size: 100 }).then(r => r.data.results || r.data || []),
    staleTime: 60_000,
  })
  const list = resources || []

  return (
    <div style={{ background: 'var(--bg-2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>My Team Resources <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--text-3)' }}>({list.length})</span></h3>
      {isLoading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        : list.length === 0 ? <p style={{ color: 'var(--text-3)', textAlign: 'center' }}>No resources assigned to you.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 10 }}>
            {list.map(r => (
              <div key={r.id} style={{ background: 'var(--bg-3)', borderRadius: 8, padding: '12px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)' }}>{r.name || r.user_detail?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{r.resource_id || r.level || ''}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-2)' }}>Active: {r.active_project_count ?? 0} projects</span>
                </div>
                <div style={{ fontSize: 11, marginTop: 4, color: 'var(--warning)' }}>Logged: {fmt(r.total_hours_value || r.total_hours || 0)}</div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────
export default function TimesheetPage() {
  const user = useAuthStore(s => s.user)
  const isResource = user?.role === 'resource'
  const isManager  = user?.role === 'manager'
  const isAdmin    = user?.role === 'admin'

  const tabs = [
    ...(isResource ? [{ id: 'mine', label: 'My Timesheet', icon: Clock }] : []),
    ...(isManager || isAdmin ? [{ id: 'approvals', label: 'Pending Approvals', icon: CheckCircle2 }] : []),
    ...(isManager || isAdmin ? [{ id: 'team', label: 'Team Overview', icon: Users }] : []),
  ].filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
  const allowedTabIds = tabs.map(t => t.id)
  const defaultTab = isResource ? 'mine' : 'approvals'
  const [tab, setTabState] = useState(defaultTab)
  const activeTab = allowedTabIds.includes(tab) ? tab : defaultTab

  const setTab = (nextTab) => {
    if (!allowedTabIds.includes(nextTab)) return
    setTabState(nextTab)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', nextTab)
    window.history.replaceState(null, '', url)
  }

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab')
    if (requestedTab && allowedTabIds.includes(requestedTab)) { setTabState(requestedTab); return }
    if (requestedTab && !allowedTabIds.includes(requestedTab)) {
      const url = new URL(window.location.href)
      url.searchParams.delete('tab')
      window.history.replaceState(null, '', url)
    }
    setTabState(defaultTab)
  }, [defaultTab, allowedTabIds.join('|')])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em', margin: 0 }}>Timesheet</h1>
        <p style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 4 }}>
          {isResource ? 'Log your daily work hours and track your timesheet.' : 'Review and approve resource time entries.'}
        </p>
      </div>
      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-2)', borderRadius: 10, padding: 4, width: 'fit-content', border: '1px solid var(--border)' }}>
          {tabs.map(t => {
            const Icon = t.icon
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: activeTab === t.id ? 'var(--bg-4)' : 'transparent', color: activeTab === t.id ? 'var(--accent)' : 'var(--text-2)', transition: 'all 0.15s' }}>
                <Icon size={14} />{t.label}
              </button>
            )
          })}
        </div>
      )}
      {activeTab === 'mine'      && <ResourceTimesheetView user={user} />}
      {activeTab === 'approvals' && (isManager || isAdmin) && <ApprovalView user={user} />}
      {activeTab === 'team'      && (isManager || isAdmin) && <ManagerTeamView user={user} />}
    </div>
  )
}
