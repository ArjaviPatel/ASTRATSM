import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, FolderKanban, Search, Calendar, Download } from 'lucide-react'
import { projectsApi, clientsApi, resourcesApi, authApi } from '@/api/index.js'
import { Btn, Badge, EmptyState, Modal, Input, Select, Textarea, Spinner, Pagination } from '@/components/ui/index.jsx'
import { STATUS_COLOR, STATUS_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, downloadBlob, formatDate, extractError } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'

/** Count working days between two date strings, excluding Saturday and Sunday */
function countWorkingDays(startStr, endStr) {
  if (!startStr || !endStr) return 0
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start) || isNaN(end) || end < start) return 0
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    const day = cur.getDay()
    if (day !== 0 && day !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

const PAGE_SIZE = 12

export default function ProjectsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const canCreate = isAdmin

  const params = new URLSearchParams(location.search)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(params.get('status') || '')
  const [priorityFilter, setPriorityFilter] = useState(params.get('priority') || '')
  const [clientFilter, setClientFilter] = useState(params.get('client') || '')
  const [overBudgetOnly, setOverBudgetOnly] = useState(params.get('filter') === 'over_budget')
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const p = new URLSearchParams(location.search)
    setStatusFilter(p.get('status') || '')
    setPriorityFilter(p.get('priority') || '')
    setClientFilter(p.get('client') || '')
    setOverBudgetOnly(p.get('filter') === 'over_budget')
  }, [location.search])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, priorityFilter, clientFilter, overBudgetOnly])

  const { data, isLoading } = useQuery({
    queryKey: ['projects', search, statusFilter, priorityFilter, clientFilter, overBudgetOnly, page],
    queryFn: () => projectsApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      client: clientFilter || undefined,
      over_budget: overBudgetOnly ? 'true' : undefined,
      page,
      page_size: PAGE_SIZE,
    }).then(r => r.data),
  })

  const { data: clientsList } = useQuery({
    queryKey: ['clients-filter-list'],
    queryFn: () => clientsApi.list({ page_size: 500 }).then(r => r.data.results || r.data),
  })

  const projects = data?.results || data || []
  const total = data?.count ?? projects.length
  const totalPages = data?.total_pages ?? 1

  async function exportProjects() {
    setExporting(true)
    try {
      const response = await projectsApi.export()
      downloadBlob(response, 'projects.xlsx')
    } finally {
      setExporting(false)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
      <div className="mobile-center-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>Projects</h1>
          <p style={{ color: 'var(--text-2)', fontSize: '14px', marginTop: 4 }}>
            {total} total
            {isManager && <span style={{ color: 'var(--info)', marginLeft: 8, fontSize: '14px', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', padding: '2px 8px', borderRadius: 'var(--r-full)' }}>Your assigned projects</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {isAdmin && <Btn variant="ghost" className="mobile-center-card" icon={<Download size={14} />} loading={exporting} onClick={exportProjects}>Export Excel</Btn>}
          {canCreate && <Btn className="mobile-center-card" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>New Project</Btn>}
        </div>
      </div>

      <div className="mobile-center-search" style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects or client name…"
            style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '8px 12px 8px 32px', outline: 'none' }} />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setOverBudgetOnly(false) }} style={fss}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setOverBudgetOnly(false) }} style={fss}>
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={clientFilter} onChange={e => { setClientFilter(e.target.value); setOverBudgetOnly(false) }} style={fss}>
          <option value="">All clients</option>
          {(clientsList || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {(statusFilter || priorityFilter || clientFilter || overBudgetOnly || search) && (
          <button onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setClientFilter(''); setOverBudgetOnly(false) }}
            style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '14px', cursor: 'pointer', padding: '4px 8px' }}>
            ✕ Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--sp-4)' }}>
          {Array.from({ length: 6 }).map((_, i) => <ProjectCardSkeleton key={i} />)}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects found" description="Create your first project to get started." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--sp-4)' }}>
          {projects.map(p => <ProjectCard key={p.id} project={p} onClick={() => navigate(`/projects/${p.id}`)} />)}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        loading={isLoading}
      />

      {showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); setPage(1); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['clients'] }) }} />}
    </div>
  )
}

function ProjectCard({ project: p, onClick }) {
  const team = p.resource_details || p.resources || []
  return (
    <div onClick={onClick}
      style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)', cursor: 'pointer', transition: 'all var(--t-mid)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
          <div style={{ fontSize: '14px', color: 'var(--text-3)', marginTop: 2 }}>{p.client_name || '—'}</div>
        </div>
        <Badge color={PRIORITY_COLOR[p.priority]}>{PRIORITY_LABEL[p.priority]}</Badge>
      </div>
      {p.description && (
        <div style={{ fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.description}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
        {p.end_date && <span style={{ fontSize: '13px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Due {formatDate(p.end_date, 'MMM d')}</span>}
      </div>
      {team.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', paddingTop: 'var(--sp-2)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex' }}>
            {team.slice(0, 5).map((r, i) => {
              const name = r.name || r.user_detail?.name || '?'
              return (
                <div key={r.id || i} title={name} style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--bg-3)', border: '2px solid var(--bg-1)', marginLeft: i > 0 ? -8 : 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--accent)' }}>
                  {name[0].toUpperCase()}
                </div>
              )
            })}
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{team.length} member{team.length !== 1 ? 's' : ''}{team.length > 5 ? ` (+${team.length - 5} more)` : ''}</span>
        </div>
      )}
    </div>
  )
}

function ProjectCardSkeleton() {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div style={{ height: 16, background: 'var(--bg-3)', borderRadius: 4, width: '60%' }} />
      <div style={{ height: 12, background: 'var(--bg-3)', borderRadius: 4, width: '40%' }} />
      <div style={{ height: 4, background: 'var(--bg-3)', borderRadius: 4 }} />
    </div>
  )
}

/* ── Shared Resource Chip ─────────────────────────────────────────────── */
export function ResourceChip({ r, selected, onBench, onClick, accentBorder }) {
  const name = r.user_detail?.name || r.name || '?'
  const level = r.level || r.resource_level || ''
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 'var(--r-full)', cursor: 'pointer',
      border: `1px solid ${selected ? 'var(--accent)' : accentBorder ? 'rgba(96,165,250,0.35)' : 'var(--border)'}`,
      background: selected ? 'var(--accent-dim)' : 'var(--bg-2)',
      color: selected ? 'var(--accent)' : 'var(--text-2)',
      fontSize: '14px', fontWeight: selected ? 600 : 400,
      transition: 'all var(--t-fast)',
    }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', background: selected ? 'var(--accent)' : 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: selected ? '#0a0a0a' : 'var(--text-3)' }}>
        {name[0].toUpperCase()}
      </div>
      <span>{name}</span>
      {level && <span style={{ fontSize: '12px', opacity: 0.65 }}>{level}</span>}
      <span title={onBench ? 'On Bench' : 'Active'} style={{ width: 7, height: 7, borderRadius: '50%', background: onBench ? 'var(--success)' : 'var(--warning)', flexShrink: 0 }} />
    </div>
  )
}

/* ── Resource Assignment Panel ─────────────────────────────────────────── */
export function ResourceAssignSection({ selectedResources, setSelectedResources, allResources }) {
  const [benchFilter, setBenchFilter] = useState('all')

  const filtered = allResources.filter(r => {
    const onBench = (r.active_project_count ?? 0) === 0
    if (benchFilter === 'bench') return onBench
    if (benchFilter === 'active') return !onBench
    return true
  })

  function toggleResource(uid) {
    setSelectedResources(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)' }}>
          Assign Resources{selectedResources.length > 0 && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>({selectedResources.length} selected)</span>}
        </div>
        <div style={{ display: 'flex', gap: 3, background: 'var(--bg-3)', borderRadius: 'var(--r-md)', padding: 3 }}>
          {[['all', 'All'], ['bench', 'On Bench'], ['active', 'Active']].map(([val, label]) => (
            <button key={val} onClick={() => setBenchFilter(val)} style={{
              background: benchFilter === val ? 'var(--bg-1)' : 'transparent',
              border: 'none', borderRadius: 'var(--r-sm)',
              color: benchFilter === val ? 'var(--text-0)' : 'var(--text-3)',
              fontSize: '13px', fontWeight: benchFilter === val ? 600 : 400,
              padding: '3px 9px', cursor: 'pointer', transition: 'all var(--t-fast)',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Bench/Active legend */}
      <div style={{ display: 'flex', gap: 12, fontSize: '13px', color: 'var(--text-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> On Bench (available)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} /> Active (on project)</span>
      </div>

      {allResources.length === 0 ? (
        <div style={{ fontSize: '14px', color: 'var(--text-3)', padding: '8px 12px', background: 'var(--bg-2)', borderRadius: 'var(--r-md)' }}>No resources available</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
          {filtered.map(r => {
            const uid = r.user ?? r.id
            return <ResourceChip key={uid} r={r} selected={selectedResources.includes(uid)} onBench={(r.active_project_count ?? 0) === 0} onClick={() => toggleResource(uid)} />
          })}
        </div>
      )}
    </div>
  )
}

/* ── Create Project Modal ─────────────────────────────────────────────── */
function CreateProjectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    project_id: '', description: '', client: '', status: 'planning', priority: 'medium',
    start_date: '', end_date: '', budget: '', manager: '',
    resource_L1: '', resource_L2: '', resource_L3: '', resource_L4: '',
    activity: '',
  })
  const [selectedResources, setSelectedResources] = useState([])
  const [clientSearch, setClientSearch] = useState('')
  const [showClientDropdown, setShowClientDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const workingDays = countWorkingDays(form.start_date, form.end_date)
  const calculatedHours = workingDays * 8

  const { data: clients } = useQuery({ queryKey: ['clients-all'], queryFn: () => clientsApi.list({ page_size: 500 }).then(r => r.data.results || r.data) })
  const { data: resourcesData } = useQuery({ queryKey: ['resources-dropdown'], queryFn: () => resourcesApi.list({ page_size: 500 }).then(r => r.data.results || r.data) })
  const { data: managers } = useQuery({ queryKey: ['project-create-managers'], queryFn: () => authApi.users({ role: 'manager', is_active: true, page_size: 500 }).then(r => r.data.results || r.data) })
  const allResources = (resourcesData || []).filter(r => r.user_detail?.is_active)

  const filteredClients = (clients || []).filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))

  function selectClient(c) { setForm(p => ({ ...p, client: c.id })); setClientSearch(c.name); setShowClientDropdown(false) }
  function clearClient() { setForm(p => ({ ...p, client: '' })); setClientSearch('') }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = {
        name: form.project_id,
        description: form.description,
        status: form.status,
        priority: form.priority,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        budget: form.budget ? parseFloat(form.budget) : 0,
        resource_l1: parseInt(form.resource_L1) || 0,
        resource_l2: parseInt(form.resource_L2) || 0,
        resource_l3: parseInt(form.resource_L3) || 0,
        resource_l4: parseInt(form.resource_L4) || 0,
        hours: calculatedHours,
        activity: form.activity || '',
        resources: selectedResources,
      }
      if (form.client) payload.client = form.client
      if (form.manager) payload.manager = form.manager
      if (!payload.start_date) delete payload.start_date
      if (!payload.end_date) delete payload.end_date
      await projectsApi.create(payload)
      onCreated()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <Modal open onClose={onClose} title="New Project" fullscreen>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: '15px', background: 'rgba(248,113,113,0.1)', padding: '8px 12px', borderRadius: 'var(--r-md)' }}>{error}</div>}

        <Input label="Project ID" value={form.project_id} onChange={e => f('project_id', e.target.value)} required placeholder="e.g. 12" />
        <Textarea label="Description" value={form.description} onChange={e => f('description', e.target.value)} placeholder="Project overview…" />

        {/* Client — searchable */}
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Client</div>
          <input value={clientSearch}
            onChange={e => { setClientSearch(e.target.value); setShowClientDropdown(true); if (!e.target.value) clearClient() }}
            onFocus={() => setShowClientDropdown(true)}
            onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
            placeholder="Search client name…"
            style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }} />
          {showClientDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', maxHeight: 200, overflowY: 'auto', marginTop: 4, boxShadow: 'var(--shadow-md)' }}>
              <div onMouseDown={clearClient} style={{ padding: '8px 12px', fontSize: '15px', color: 'var(--text-3)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>— No client —</div>
              {filteredClients.map(c => (
                <div key={c.id} onMouseDown={() => selectClient(c)}
                  style={{ padding: '8px 12px', fontSize: '15px', color: form.client === c.id ? 'var(--accent)' : 'var(--text-1)', cursor: 'pointer', fontWeight: form.client === c.id ? 600 : 400 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{c.name}</div>
              ))}
            </div>
          )}
          {form.client && <div style={{ fontSize: '13px', color: 'var(--accent)', marginTop: 4 }}>✓ {clientSearch}</div>}
        </div>

        {/* Status + Priority */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
          <Select label="Manager" value={form.manager} onChange={e => f('manager', e.target.value)}>
            <option value="">Unassigned</option>
            {(managers || []).map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </Select>
          <Select label="Status" value={form.status} onChange={e => f('status', e.target.value)}>
            <option value="planning">Planning</option>
            <option value="in_progress">In Progress</option>
            <option value="pending">Pending</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
          </Select>
          <Select label="Priority" value={form.priority} onChange={e => f('priority', e.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>

        {/* Dates + auto hours */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
            <Input label="Start Date" type="date" value={form.start_date} onChange={e => f('start_date', e.target.value)} />
            <Input label="End Date" type="date" value={form.end_date} onChange={e => f('end_date', e.target.value)} />
          </div>
          {form.start_date && form.end_date && workingDays > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontSize: '14px' }}>
              <Calendar size={13} color="var(--info)" />
              <span style={{ color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text-0)' }}>{workingDays} working days</strong>
                <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>(weekends excluded)</span>
              </span>
              <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                = {calculatedHours} hrs
              </span>
            </div>
          )}
        </div>

        {/* Budget Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 'var(--sp-4)' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Budget</div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Resource Level</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 'var(--sp-3)' }}>
              {['L1', 'L2', 'L3', 'L4'].map(level => (
                <div key={level}>
                  <div style={{ fontSize: '13px', color: 'var(--text-3)', marginBottom: 4, fontWeight: 600 }}>{level}</div>
                  <input type="number" min="0" value={form[`resource_${level}`] || ''} onChange={e => f(`resource_${level}`, e.target.value)} placeholder="0"
                    style={{ width: '100%', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '7px 10px', outline: 'none', boxSizing: 'border-box' }}
                    onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderColor = 'var(--border)'} />
                </div>
              ))}
            </div>
          </div>

          {/* Hours — read-only, auto-calculated */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>Hours (Auto-calculated from dates)</div>
            <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: calculatedHours > 0 ? 'var(--accent)' : 'var(--text-3)', fontSize: '15px', padding: '7px 10px', fontFamily: 'var(--font-mono)', fontWeight: calculatedHours > 0 ? 700 : 400 }}>
              {calculatedHours > 0 ? `${calculatedHours} hrs  (${workingDays} days × 8 hrs/day)` : 'Select start & end dates to auto-calculate'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>Activity</div>
            <input type="text" value={form.activity || ''} onChange={e => f('activity', e.target.value)} placeholder="e.g. Development, Testing, Design…"
              style={{ width: '100%', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '15px', padding: '7px 10px', outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'} />
          </div>
        </div>

        {/* Resources — with bench/active filter, L4 mandatory */}
        <ResourceAssignSection selectedResources={selectedResources} setSelectedResources={setSelectedResources} allResources={allResources} />

        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end', marginTop: 'var(--sp-2)' }}>
          <Btn type="submit" loading={loading}>Create Project</Btn>
        </div>
      </form>
    </Modal>
  )
}

const fss = {
  background: 'var(--bg-2)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px',
  padding: '8px 12px', outline: 'none', cursor: 'pointer',
}