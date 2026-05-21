import React, { useCallback, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, AlertTriangle, Bell, BriefcaseBusiness, Calendar, CheckCircle2, Clock3,
  Download, FolderKanban, Gauge, RefreshCw, ShieldCheck, TrendingUp, Users, UserX, Zap,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  approvalsApi, authApi, clientsApi, notificationsApi,
  projectsApi, resourcesApi, timelinesApi,
} from '@/api/index.js'
import { Badge, Card, ProgressBar, StatCard } from '@/components/ui/index.jsx'
import { useAuthStore } from '@/stores/authStore.js'
import { downloadBlob } from '@/utils/index.js'

// ── Constants ────────────────────────────────────────────────────────
const PIE_COLORS = ['#237227', '#3f9f5f', '#6d8fa0', '#d97706', '#ef4444']
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STATUS_LABELS = {
  planning: 'Planning', in_progress: 'In Progress', review: 'Review',
  on_hold: 'On Hold', completed: 'Completed',
}
const STATUS_COLORS = {
  planning: '#6d8fa0', in_progress: '#237227', review: '#d97706',
  on_hold: '#ef4444', completed: '#3f9f5f',
}

// Realtime refresh intervals
const REALTIME_MS   = 30_000   // 30s for live panels
const SLOW_MS       = 120_000  // 2min for heavy queries

// ── Helpers ──────────────────────────────────────────────────────────
const safeList = (res) => res?.data?.results || res?.data || []
const clamp    = (v, min, max) => Math.max(min, Math.min(max, v))
const pct      = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const sumHours = (arr) => arr.reduce((s, e) => s + Number(e.hours || 0), 0)
const fmt      = (v) => `${Number(v || 0).toFixed(0)}h`
const fmtDecimal = (v) => `${Number(v || 0).toFixed(1)}h`

const queryList = (fn) => async () => {
  try { return safeList(await fn()) } catch { return [] }
}

function workingDaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0
  const s = new Date(startDate), e = new Date(endDate)
  if (isNaN(s) || isNaN(e) || s > e) return 0
  let count = 0, cur = new Date(s)
  while (cur <= e) {
    const d = cur.getDay()
    if (d !== 0 && d !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

function getPlannedHours(project) {
  const days = workingDaysBetween(project.start_date, project.end_date)
  const res  = Math.max(Number(project.resource_count || 0), 1)
  return days * 8 * res || Number(project.hours || project.estimated_hours || 0)
}

function weekdayIdx(dateVal) {
  const d = new Date(dateVal)
  return isNaN(d.getTime()) ? null : (d.getDay() + 6) % 7
}

// ── Chart builders ───────────────────────────────────────────────────
function buildWeeklySeries(entries, activeProjects) {
  const base = WEEKDAY_LABELS.map(label => ({ label, approved: 0, pending: 0, target: 0 }))
  const submitted = sumHours(entries)
  const perDay    = Math.max(submitted, activeProjects.length * 8) / 5
  base.forEach((item, i) => { item.target = i < 5 ? +perDay.toFixed(1) : 0 })

  entries.forEach(e => {
    const i = weekdayIdx(e.date)
    if (i == null) return
    const h = Number(e.hours || 0)
    if (e.approved) base[i].approved += h
    else base[i].pending += h
  })

  return base.map(item => ({
    ...item,
    approved: +item.approved.toFixed(1),
    pending:  +item.pending.toFixed(1),
  }))
}

function buildStatusMix(projects) {
  const counts = { planning: 0, in_progress: 0, review: 0, on_hold: 0, completed: 0 }
  projects.forEach(p => {
    const k = p.status || 'planning'
    if (k in counts) counts[k]++
  })
  return Object.entries(counts)
    .map(([k, v]) => ({ name: STATUS_LABELS[k], value: v, fill: STATUS_COLORS[k] }))
    .filter(x => x.value > 0)
}

function buildCapacityMix(resources) {
  return [
    { name: 'Overloaded (≤20%)', value: resources.filter(r => Number(r.availability || 0) <= 20).length, fill: '#ef4444' },
    { name: 'Allocated', value: resources.filter(r => Number(r.active_project_count || 0) > 0 && Number(r.availability || 0) > 20).length, fill: '#237227' },
    { name: 'On Bench', value: resources.filter(r => Number(r.active_project_count || 0) === 0).length, fill: '#6d8fa0' },
  ].filter(x => x.value > 0)
}

function buildHoursTrend(entries) {
  // Group last 14 days of entries by date for trend line
  const map = {}
  const now = Date.now()
  entries.forEach(e => {
    const d = new Date(e.date)
    if (isNaN(d) || now - d.getTime() > 14 * 86400_000) return
    const key = e.date
    if (!map[key]) map[key] = { date: key, approved: 0, pending: 0 }
    if (e.approved) map[key].approved += Number(e.hours || 0)
    else map[key].pending += Number(e.hours || 0)
  })
  return Object.values(map)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ ...d, date: d.date.slice(5), approved: +d.approved.toFixed(1), pending: +d.pending.toFixed(1) }))
}

// ── Role copy ────────────────────────────────────────────────────────
function getRoleCopy(role, name) {
  const first = name?.split(' ')[0] || 'Team'
  return ({
    admin:    { title: `Executive overview`, text: `Full workspace visibility — approvals, utilization, delivery health, and team capacity.` },
    manager:  { title: `Delivery hub for ${first}`, text: `Your portfolio health, team worklog, and pending timesheet approvals in one place.` },
    resource: { title: `My work board`, text: `Your logged hours, project assignments, approval status, and upcoming deliveries.` },
    client:   { title: `Project visibility`, text: `Live progress, delivery health, and recent activity across your active projects.` },
  })[role] || { title: 'Dashboard', text: '' }
}

// ── Skeleton ─────────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <div className="skeleton" style={{ height: 200, borderRadius: 'var(--r-xl)' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--sp-4)' }}>
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 140 }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--sp-4)' }}>
        <div className="skeleton" style={{ height: 320 }} />
        <div className="skeleton" style={{ height: 320 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────
function PanelTitle({ title, sub, badge, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
      <div>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</h3>
        {sub && <p style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 3 }}>{sub}</p>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>{badge}{right}</div>
    </div>
  )
}

function InsightRow({ label, value, hint, tone = 'var(--accent)', onClick }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', padding: '11px 0', borderBottom: '1px solid var(--border)', cursor: onClick ? 'pointer' : 'default' }}
    >
      <div>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>{label}</div>
        {hint && <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 800, color: tone, flexShrink: 0 }}>{value}</div>
    </div>
  )
}

function LiveDot({ color = 'var(--success)' }) {
  return (
    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, animation: 'badge-pulse 2s ease-in-out infinite', flexShrink: 0 }} />
  )
}

function ProjectRow({ project }) {
  const progress = Number(project.progress || 0)
  const isDelayed = project.is_delayed || project.status === 'on_hold' || progress < 30
  return (
    <div style={{ padding: '10px 14px', borderRadius: 'var(--r-md)', background: 'var(--bg-2)', border: `1px solid ${isDelayed ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-0)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
        <span style={{ fontSize: '12px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-full)', background: isDelayed ? 'rgba(239,68,68,0.12)' : 'rgba(35,114,39,0.12)', color: isDelayed ? 'var(--danger)' : 'var(--success)', flexShrink: 0 }}>
          {project.status?.replace('_', ' ') || 'planning'}
        </span>
      </div>
      <ProgressBar value={progress} color={isDelayed ? 'var(--danger)' : 'var(--accent)'} showLabel />
    </div>
  )
}

function TimesheetRow({ entry }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 14px', borderRadius: 'var(--r-md)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.resource_name || entry.resource?.user?.name || 'Resource'}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 2 }}>
          {entry.project_name || entry.project?.name || '—'} · {entry.date}
        </div>
      </div>
      <div style={{ fontSize: '15px', fontWeight: 800, color: 'var(--warning)', flexShrink: 0 }}>{entry.hours}h</div>
    </div>
  )
}

// ── Custom tooltip ───────────────────────────────────────────────────
const ChartTooltipStyle = { borderRadius: 10, border: '1px solid rgba(191,198,196,0.14)', background: '#1a2c43', color: '#f6faf8', fontSize: 12 }

// ── Main Component ───────────────────────────────────────────────────
export default function DashboardPage() {
  const user    = useAuthStore(s => s.user)
  const role    = user?.role || 'resource'
  const userReady = !!user
  const qc      = useQueryClient()
  const isManagerOrAdmin = role === 'admin' || role === 'manager'

  const todayStr = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [exportingTs, setExportingTs] = useState(false)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['daily-report'] })
  }, [qc])

  // Daily report query for managers/admins
  const { data: dailyReport, isLoading: dailyLoading, refetch: refetchDaily } = useQuery({
    queryKey: ['daily-report', selectedDate],
    queryFn: () => resourcesApi.dailyReport(selectedDate).then(r => r.data),
    enabled: userReady && isManagerOrAdmin,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  async function exportAllTimesheets() {
    setExportingTs(true)
    try {
      const res = await resourcesApi.exportTimeEntries({})
      downloadBlob(res, 'all_timesheets.xlsx')
    } catch (e) { console.error(e) }
    finally { setExportingTs(false) }
  }

  const results = useQueries({
    queries: [
      // [0] projects — slow, large
      {
        queryKey: ['dashboard', 'projects', role],
        queryFn:  queryList(() => projectsApi.list({ page_size: 500 })),
        enabled:  userReady,
        staleTime: SLOW_MS, refetchInterval: SLOW_MS,
      },
      // [1] timelines — slow
      {
        queryKey: ['dashboard', 'timelines', role],
        queryFn:  queryList(() => timelinesApi.list({ page_size: 500 })),
        enabled:  userReady,
        staleTime: SLOW_MS, refetchInterval: SLOW_MS,
      },
      // [2] resources — slow
      {
        queryKey: ['dashboard', 'resources', role],
        queryFn:  queryList(() => resourcesApi.list({ page_size: 500 })),
        enabled:  userReady && role !== 'client',
        staleTime: SLOW_MS, refetchInterval: SLOW_MS,
      },
      // [3] clients — slow
      {
        queryKey: ['dashboard', 'clients', role],
        queryFn:  queryList(() => clientsApi.list({ page_size: 500 })),
        enabled:  userReady && role !== 'resource',
        staleTime: SLOW_MS, refetchInterval: SLOW_MS,
      },
      // [4] notifications — realtime
      {
        queryKey: ['dashboard', 'notifications', role],
        queryFn:  queryList(() => notificationsApi.list()),
        enabled:  userReady,
        staleTime: REALTIME_MS, refetchInterval: REALTIME_MS,
      },
      // [5] pending project approvals — realtime
      {
        queryKey: ['dashboard', 'approvals', role],
        queryFn:  queryList(() => approvalsApi.list({ page_size: 100, status: 'pending' })),
        enabled:  userReady && (role === 'admin' || role === 'manager'),
        staleTime: REALTIME_MS, refetchInterval: REALTIME_MS,
      },
      // [6] users (admin only) — slow
      {
        queryKey: ['dashboard', 'users', role],
        queryFn:  queryList(() => authApi.users({ page_size: 500 })),
        enabled:  userReady && role === 'admin',
        staleTime: SLOW_MS, refetchInterval: SLOW_MS,
      },
      // [7] time entries — realtime (this is the key panel data)
      {
        queryKey: ['dashboard', 'time-entries', role],
        queryFn:  queryList(() => resourcesApi.timeEntries({ page_size: 500 })),
        enabled:  userReady && role !== 'client',
        staleTime: REALTIME_MS, refetchInterval: REALTIME_MS,
      },
      // [8] pending timesheet entries (for managers) — realtime
      {
        queryKey: ['dashboard', 'pending-timesheets', role],
        queryFn:  queryList(() => resourcesApi.timeEntries({ approved: false, page_size: 100 })),
        enabled:  userReady && (role === 'admin' || role === 'manager'),
        staleTime: REALTIME_MS, refetchInterval: REALTIME_MS,
      },
    ],
  })

  const isLoading = !userReady || results.some(r => r.isLoading)
  if (isLoading) return <DashboardSkeleton />

  const [
    { data: projects = [] },
    { data: timelines = [] },
    { data: resources = [] },
    { data: clients = [] },
    { data: notifications = [] },
    { data: approvals = [] },
    { data: users = [] },
    { data: timeEntries = [] },
    { data: pendingTimesheets = [] },
  ] = results

  // ── Derived metrics ──────────────────────────────────────────────
  const activeProjects    = projects.filter(p => p.status !== 'completed')
  const completedProjects = projects.filter(p => p.status === 'completed' || Number(p.progress || 0) >= 100)
  const delayedProjects   = projects.filter(p => p.is_delayed || p.status === 'on_hold' || (p.status !== 'completed' && Number(p.progress || 0) < 30))
  const overdueTimelines  = timelines.filter(t => t.is_delayed || (t.status !== 'completed' && Number(t.progress || 0) < 100))
  const activeResources   = resources.filter(r => Number(r.active_project_count || 0) > 0)

  const approvedEntries = timeEntries.filter(e => e.approved)
  const pendingEntries  = timeEntries.filter(e => !e.approved)
  const consumedHours   = sumHours(timeEntries)
  const approvedHours   = sumHours(approvedEntries)
  const pendingHours    = sumHours(pendingEntries)

  // For resource: filter to own entries
  const myEntries = timeEntries.filter(e =>
    e.resource_user === user?.id ||
    e.user === user?.id ||
    e.resource?.user === user?.id ||
    e.resource?.user_id === user?.id
  )
  const myHours         = sumHours(myEntries)
  const myApprovedHours = sumHours(myEntries.filter(e => e.approved))
  const myPendingHours  = myHours - myApprovedHours

  const plannedHours    = projects.reduce((s, p) => s + getPlannedHours(p), 0)
  const visibleHours    = role === 'resource' ? myHours : role === 'admin' ? approvedHours : consumedHours
  const utilization     = pct(visibleHours, Math.max(plannedHours, 1))
  const approvalRate    = pct(approvedHours, Math.max(consumedHours, 1))
  const deliveryScore   = clamp(100 - delayedProjects.length * 10 + completedProjects.length * 4, 20, 98)
  const unreadCount     = notifications.filter(n => !n.is_read).length

  // Charts
  const weeklySeries   = buildWeeklySeries(role === 'resource' ? myEntries : timeEntries, activeProjects)
  const statusMix      = buildStatusMix(projects)
  const capacityMix    = buildCapacityMix(resources)
  const hoursTrend     = buildHoursTrend(role === 'resource' ? myEntries : timeEntries)

  const roleCopy = getRoleCopy(role, user?.name)

  // ── Stat cards by role ──────────────────────────────────────────
  const statCards = {
    admin: [
      { label: 'Planned Hours', value: fmt(plannedHours), sub: `across ${projects.length} projects`, icon: Clock3, accent: 'var(--accent)' },
      { label: 'Approved Hours', value: fmt(approvedHours), sub: `${approvalRate}% approval rate`, icon: ShieldCheck, accent: 'var(--info)' },
      { label: 'Pending Timesheets', value: pendingTimesheets.length, sub: `${fmtDecimal(pendingHours)} hours awaiting review`, icon: CheckCircle2, accent: pendingTimesheets.length > 0 ? 'var(--warning)' : 'var(--success)' },
      { label: 'Workspace Users', value: users.length || resources.length, sub: `${activeResources.length} currently allocated`, icon: Users, accent: 'var(--success)' },
    ],
    manager: [
      { label: 'Active Projects', value: activeProjects.length, sub: `${completedProjects.length} completed`, icon: BriefcaseBusiness, accent: 'var(--accent)' },
      { label: 'Submitted Hours', value: fmt(consumedHours), sub: `${fmt(pendingHours)} awaiting approval`, icon: Clock3, accent: 'var(--info)' },
      { label: 'Pending Timesheets', value: pendingTimesheets.length, sub: `${fmtDecimal(pendingHours)} to review`, icon: CheckCircle2, accent: pendingTimesheets.length > 0 ? 'var(--warning)' : 'var(--success)' },
      { label: 'Delivery Risk', value: delayedProjects.length, sub: `${deliveryScore}% health score`, icon: Gauge, accent: delayedProjects.length > 0 ? 'var(--danger)' : 'var(--success)' },
    ],
    resource: [
      { label: 'My Logged Hours', value: fmt(myHours), sub: `${activeProjects.length} active assignments`, icon: FolderKanban, accent: 'var(--accent)' },
      { label: 'Approved', value: fmt(myApprovedHours), sub: `${pct(myApprovedHours, Math.max(myHours, 1))}% of my hours approved`, icon: ShieldCheck, accent: 'var(--success)' },
      { label: 'Pending Approval', value: fmt(myPendingHours), sub: `waiting for manager review`, icon: Clock3, accent: myPendingHours > 0 ? 'var(--warning)' : 'var(--text-2)' },
      { label: 'At-Risk Projects', value: delayedProjects.length, sub: 'delays or low progress', icon: AlertTriangle, accent: delayedProjects.length > 0 ? 'var(--danger)' : 'var(--text-2)' },
    ],
    client: [
      { label: 'Visible Projects', value: projects.length, sub: `${clients.length} client account(s)`, icon: FolderKanban, accent: 'var(--accent)' },
      { label: 'Delivery Score', value: `${deliveryScore}%`, sub: `${completedProjects.length} completed`, icon: Gauge, accent: 'var(--success)' },
      { label: 'Unread Alerts', value: unreadCount, sub: 'updates from delivery team', icon: Bell, accent: unreadCount > 0 ? 'var(--info)' : 'var(--text-2)' },
      { label: 'Delayed Work', value: delayedProjects.length, sub: 'projects needing attention', icon: AlertTriangle, accent: delayedProjects.length > 0 ? 'var(--danger)' : 'var(--text-2)' },
    ],
  }

  const isRefetching = results.some(r => r.isFetching)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', maxWidth: 1440, margin: '0 auto' }}>

      {/* ── Hero banner ── */}
      <Card className="animate-rise-in" style={{ padding: 'var(--sp-6) var(--sp-8)', borderRadius: 'var(--r-xl)', background: 'linear-gradient(135deg, rgba(35,114,39,0.18), rgba(19,36,64,0.96) 55%, rgba(59,73,83,0.97))' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--sp-6)', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge color="var(--accent)">Enterprise Timesheet</Badge>
              {isRefetching
                ? <span style={{ fontSize: '13px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}><RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> updating</span>
                : <span style={{ fontSize: '13px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}><LiveDot /> live</span>
              }
            </div>
            <div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15 }}>{roleCopy.title}</h1>
              <p style={{ fontSize: '15px', color: 'var(--text-2)', marginTop: 8, lineHeight: 1.6 }}>{roleCopy.text}</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 4 }}>
              <Badge color="var(--success)">{activeProjects.length} active</Badge>
              <Badge color="var(--info)">{fmt(visibleHours)} logged</Badge>
              {delayedProjects.length > 0 && <Badge color="var(--danger)">{delayedProjects.length} at risk</Badge>}
              {pendingTimesheets.length > 0 && (role === 'admin' || role === 'manager') && (
                <Badge color="var(--warning)">{pendingTimesheets.length} timesheets pending</Badge>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
            {[
              { label: 'Delivery Score', value: `${deliveryScore}%`, bar: deliveryScore, color: deliveryScore >= 70 ? 'var(--accent)' : 'var(--warning)' },
              { label: role === 'resource' ? 'My Approval Rate' : 'Approval Rate', value: `${approvalRate}%`, bar: approvalRate, color: 'var(--info)' },
              { label: 'Utilization', value: `${utilization}%`, bar: utilization, color: utilization > 90 ? 'var(--danger)' : 'var(--success)' },
              { label: 'Completed', value: `${pct(completedProjects.length, Math.max(projects.length, 1))}%`, bar: pct(completedProjects.length, Math.max(projects.length, 1)), color: 'var(--success)' },
            ].map(({ label, value, bar, color }) => (
              <div key={label} style={{ padding: '14px 16px', borderRadius: 'var(--r-lg)', background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(191,198,196,0.1)' }}>
                <div style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: 6, color }}>{value}</div>
                <div style={{ marginTop: 8 }}><ProgressBar value={bar} color={color} /></div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 'var(--sp-4)' }}>
        {(statCards[role] || statCards.resource).map((item, i) => (
          <div key={item.label} className="animate-rise-in" style={{ animationDelay: `${i * 40}ms` }}>
            <StatCard {...item} />
          </div>
        ))}
      </div>

      {/* ── Charts row 1 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>

        {/* Weekly worklog bar chart */}
        <Card className="card-hover animate-rise-in">
          <PanelTitle
            title="Worklog — This Week"
            sub="Approved vs pending hours by weekday"
            badge={<Badge color="var(--info)"><LiveDot color="var(--info)" /> Live</Badge>}
          />
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklySeries} barSize={18}>
                <CartesianGrid stroke="rgba(191,198,196,0.07)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--text-3)" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis stroke="var(--text-3)" tickLine={false} axisLine={false} width={30} fontSize={11} />
                <Tooltip contentStyle={ChartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="approved" name="Approved" stackId="h" fill="#237227" radius={[0, 0, 0, 0]} />
                <Bar dataKey="pending"  name="Pending"  stackId="h" fill="#d97706" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 14-day trend area chart */}
        {hoursTrend.length > 1 ? (
          <Card className="card-hover animate-rise-in">
            <PanelTitle
              title="14-Day Hours Trend"
              sub="Approved and pending hours across the past two weeks"
              badge={<Badge color="var(--success)"><TrendingUp size={10} /> Trend</Badge>}
            />
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hoursTrend}>
                  <defs>
                    <linearGradient id="gradApproved" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#237227" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#237227" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradPending" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#d97706" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#d97706" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(191,198,196,0.07)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--text-3)" tickLine={false} axisLine={false} fontSize={10} />
                  <YAxis stroke="var(--text-3)" tickLine={false} axisLine={false} width={28} fontSize={10} />
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="approved" name="Approved" stroke="#237227" fill="url(#gradApproved)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="pending"  name="Pending"  stroke="#d97706" fill="url(#gradPending)"  strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ) : (
          /* Project status pie — shown when no trend data */
          <Card className="card-hover animate-rise-in">
            <PanelTitle title="Project Status Mix" sub="Portfolio distribution by current status" badge={<Badge color="var(--accent)">Portfolio</Badge>} />
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4}>
                    {statusMix.map(entry => <Cell key={entry.name} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Project status pie (always show if hoursTrend is available) */}
        {hoursTrend.length > 1 && (
          <Card className="card-hover animate-rise-in">
            <PanelTitle title="Project Status Mix" sub="Portfolio distribution by current status" badge={<Badge color="var(--accent)">Portfolio</Badge>} />
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={4}>
                    {statusMix.map(entry => <Cell key={entry.name} fill={entry.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}
      </div>

      {/* ── Charts row 2 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>

        {/* Resource capacity — admin/manager only */}
        {role !== 'client' && role !== 'resource' && (
          <Card className="card-hover animate-rise-in">
            <PanelTitle title="Resource Capacity" sub="Overloaded · Allocated · On bench" badge={<Badge color="var(--success)">Team</Badge>} />
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={capacityMix} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid stroke="rgba(191,198,196,0.07)" horizontal={false} />
                  <XAxis type="number" stroke="var(--text-3)" tickLine={false} axisLine={false} allowDecimals={false} fontSize={10} />
                  <YAxis type="category" dataKey="name" stroke="var(--text-3)" tickLine={false} axisLine={false} width={100} fontSize={10} />
                  <Tooltip contentStyle={ChartTooltipStyle} />
                  <Bar dataKey="value" name="Resources" radius={[0, 8, 8, 0]}>
                    {capacityMix.map(item => <Cell key={item.name} fill={item.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
              {[
                { label: 'Bench', value: resources.filter(r => Number(r.active_project_count || 0) === 0).length, color: '#6d8fa0' },
                { label: 'Active', value: activeResources.length, color: '#237227' },
                { label: 'Overloaded', value: resources.filter(r => Number(r.availability || 0) <= 20).length, color: '#ef4444' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: 'center', padding: '8px', background: 'var(--bg-2)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '18px', fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Operational focus / queue */}
        <Card className="card-hover animate-rise-in">
          <PanelTitle
            title="Operational Focus"
            sub="Key queues and effort indicators"
            badge={<Badge color="var(--danger)"><Zap size={10} /> Priority</Badge>}
          />
          <div>
            {[
              role === 'admin' || role === 'manager'
                ? { label: 'Pending timesheets', value: pendingTimesheets.length, hint: `${fmtDecimal(pendingHours)} hours awaiting approval`, tone: pendingTimesheets.length > 0 ? 'var(--warning)' : 'var(--success)' }
                : { label: 'My pending hours', value: fmt(myPendingHours), hint: 'Submitted, not yet approved by manager', tone: myPendingHours > 0 ? 'var(--warning)' : 'var(--success)' },
              { label: 'Unread notifications', value: unreadCount, hint: 'Updates waiting for your attention', tone: unreadCount > 0 ? 'var(--info)' : 'var(--text-2)' },
              { label: 'Delayed projects', value: delayedProjects.length, hint: 'On hold or low progress (<30%)', tone: delayedProjects.length > 0 ? 'var(--danger)' : 'var(--text-2)' },
              { label: 'Overdue timelines', value: overdueTimelines.length, hint: 'Phases not yet completed', tone: overdueTimelines.length > 0 ? 'var(--warning)' : 'var(--text-2)' },
              { label: 'Utilization', value: `${utilization}%`, hint: 'Visible hours vs planned', tone: utilization > 85 ? 'var(--danger)' : 'var(--accent)' },
            ].map(item => <InsightRow key={item.label} {...item} />)}
          </div>
        </Card>

        {/* Recent notifications */}
        <Card className="card-hover animate-rise-in">
          <PanelTitle
            title="Recent Notifications"
            sub={`${unreadCount} unread`}
            badge={<Badge color="var(--info)"><LiveDot color="var(--info)" /> Live</Badge>}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {notifications.slice(0, 6).map((item, i) => (
              <div key={item.id || i} style={{ padding: '10px 14px', borderRadius: 'var(--r-md)', background: item.is_read ? 'var(--bg-2)' : 'rgba(35,114,39,0.07)', border: `1px solid ${item.is_read ? 'var(--border)' : 'rgba(35,114,39,0.2)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: '14px', fontWeight: item.is_read ? 500 : 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title || 'Workspace update'}</div>
                  {!item.is_read && <LiveDot />}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{item.message?.slice(0, 90) || 'No message.'}{item.message?.length > 90 ? '…' : ''}</div>
              </div>
            ))}
            {notifications.length === 0 && (
              <div style={{ padding: '28px 18px', borderRadius: 'var(--r-lg)', border: '1px dashed var(--border)', textAlign: 'center', color: 'var(--text-3)' }}>
                <Activity size={18} style={{ marginBottom: 8, opacity: 0.5 }} />
                <div style={{ fontSize: '15px' }}>No alerts right now</div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Live project list & pending timesheets ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>

        {/* Active projects list */}
        {activeProjects.length > 0 && (
          <Card className="card-hover animate-rise-in">
            <PanelTitle
              title="Active Projects"
              sub="Progress and delivery status"
              badge={<Badge color="var(--accent)">{activeProjects.length}</Badge>}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeProjects.slice(0, 6).map(p => <ProjectRow key={p.id} project={p} />)}
              {activeProjects.length > 6 && (
                <div style={{ fontSize: '14px', color: 'var(--text-3)', textAlign: 'center', padding: '6px 0' }}>+{activeProjects.length - 6} more projects</div>
              )}
            </div>
          </Card>
        )}

        {/* Pending timesheets — manager/admin */}
        {(role === 'admin' || role === 'manager') && pendingTimesheets.length > 0 && (
          <Card className="card-hover animate-rise-in" style={{ border: '1px solid rgba(217,119,6,0.3)' }}>
            <PanelTitle
              title="Pending Timesheets"
              sub={`${pendingTimesheets.length} entries waiting for your approval`}
              badge={<Badge color="var(--warning)"><LiveDot color="var(--warning)" /> {pendingTimesheets.length}</Badge>}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {pendingTimesheets.slice(0, 8).map(e => <TimesheetRow key={e.id} entry={e} />)}
              {pendingTimesheets.length > 8 && (
                <div style={{ fontSize: '14px', color: 'var(--text-3)', textAlign: 'center', padding: '6px 0' }}>+{pendingTimesheets.length - 8} more · go to Approvals</div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* ── Daily Report — Manager/Admin only ── */}
      {isManagerOrAdmin && (
        <Card className="animate-rise-in" style={{ border: '1px solid rgba(35,114,39,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 'var(--sp-4)' }}>
            <div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '-0.01em' }}>Daily Timesheet Report</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 3 }}>Who submitted timesheets and project hour tracking</p>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 12px' }}>
                <Calendar size={14} style={{ color: 'var(--text-3)' }} />
                <input
                  type="date"
                  value={selectedDate}
                  max={todayStr}
                  onChange={e => setSelectedDate(e.target.value)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-0)', fontSize: '14px', outline: 'none', cursor: 'pointer' }}
                />
              </div>
              <button
                onClick={exportAllTimesheets}
                disabled={exportingTs}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(35,114,39,0.12)', border: '1px solid rgba(35,114,39,0.3)', borderRadius: 'var(--r-md)', padding: '7px 14px', cursor: exportingTs ? 'wait' : 'pointer', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, opacity: exportingTs ? 0.7 : 1, transition: 'all var(--t-fast)' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(35,114,39,0.22)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(35,114,39,0.12)'}
              >
                <Download size={14} /> {exportingTs ? 'Exporting…' : 'Export All Timesheets'}
              </button>
            </div>
          </div>

          {dailyLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 'var(--r-lg)' }} />)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--sp-4)', alignItems: 'start' }}>

              {/* Submitted */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <CheckCircle2 size={15} style={{ color: 'var(--success)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Submitted ({dailyReport?.submitted?.length ?? 0})
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {(dailyReport?.submitted || []).length === 0 ? (
                    <div style={{ fontSize: '14px', color: 'var(--text-3)', padding: '10px 0' }}>No submissions on this date.</div>
                  ) : (dailyReport?.submitted || []).map(r => (
                    <div key={r.id} style={{ padding: '9px 12px', borderRadius: 'var(--r-md)', background: 'rgba(35,114,39,0.07)', border: '1px solid rgba(35,114,39,0.18)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-0)' }}>{r.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: 2 }}>{r.resource_id || r.email}</div>
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--success)', flexShrink: 0 }}>{Number(r.hours_submitted || 0).toFixed(1)}h</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Not Submitted */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <UserX size={15} style={{ color: 'var(--danger)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Not Submitted ({dailyReport?.not_submitted?.length ?? 0})
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {(dailyReport?.not_submitted || []).length === 0 ? (
                    <div style={{ fontSize: '14px', color: 'var(--text-3)', padding: '10px 0' }}>All resources submitted.</div>
                  ) : (dailyReport?.not_submitted || []).map(r => (
                    <div key={r.id} style={{ padding: '9px 12px', borderRadius: 'var(--r-md)', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-0)' }}>{r.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: 2 }}>{r.resource_id || r.email}</div>
                      </div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--danger)', padding: '3px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: 20 }}>Missing</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Project hours tracking */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <FolderKanban size={15} style={{ color: 'var(--info)' }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Project Hours
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                  {(dailyReport?.project_hours || []).length === 0 ? (
                    <div style={{ fontSize: '14px', color: 'var(--text-3)', padding: '10px 0' }}>No project data.</div>
                  ) : (dailyReport?.project_hours || []).map(p => {
                    const alloc = Number(p.hours_allocated || 0)
                    const consumed = Number(p.hours_consumed || 0)
                    const pending = Number(p.hours_pending || 0)
                    const remaining = Number(p.hours_remaining || 0)
                    const usedPct = alloc > 0 ? Math.min(Math.round(((consumed + pending) / alloc) * 100), 100) : 0
                    return (
                      <div key={p.id} style={{ padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                          <div style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: remaining <= 0 ? 'rgba(239,68,68,0.1)' : 'rgba(35,114,39,0.1)', color: remaining <= 0 ? 'var(--danger)' : 'var(--success)', flexShrink: 0 }}>
                            {remaining <= 0 ? 'Exhausted' : `${remaining.toFixed(0)}h left`}
                          </div>
                        </div>
                        <ProgressBar value={usedPct} color={remaining <= 0 ? 'var(--danger)' : consumed / Math.max(alloc, 1) > 0.8 ? 'var(--warning)' : 'var(--accent)'} showLabel />
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: '11px', color: 'var(--text-3)' }}>
                          <span>Allocated: <b style={{ color: 'var(--text-0)' }}>{alloc.toFixed(0)}h</b></span>
                          <span>Approved: <b style={{ color: 'var(--success)' }}>{consumed.toFixed(1)}h</b></span>
                          <span>Pending: <b style={{ color: 'var(--warning)' }}>{pending.toFixed(1)}h</b></span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

    </div>
  )
}