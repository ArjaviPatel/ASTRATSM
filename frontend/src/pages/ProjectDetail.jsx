import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, FileText, MessageSquare, Users, Calendar, DollarSign, TrendingUp, Edit2, Trash2, X, Save, Building2, GitBranch, CheckCircle, Circle, Send, Clock } from 'lucide-react'
import { projectsApi, authApi, clientsApi, resourcesApi, timelinesApi, approvalsApi } from '@/api/index.js'
import { Btn, Badge, ProgressBar, Tabs, Modal, Input, Textarea, Spinner, Avatar } from '@/components/ui/index.jsx'
import { STATUS_COLOR, STATUS_LABEL, PRIORITY_COLOR, PRIORITY_LABEL, formatDate, formatCurrency, formatBytes, timeAgo, extractError } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'

/** Count working days between two date strings, excluding Saturday and Sunday */
function countWorkingDays(startStr, endStr) {
  if (!startStr || !endStr) return 0
  const start = new Date(startStr)
  const end   = new Date(endStr)
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

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'timelines',  label: 'Timelines', icon: GitBranch },
  { id: 'updates',    label: 'Updates',   icon: MessageSquare },
  { id: 'team',       label: 'Team',      icon: Users },
]

const sel = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px', padding: '8px 12px', outline: 'none' }

export default function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [showUpdate, setShowUpdate] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null)

  // Manager approval request state - just a reason, no proposed changes yet
  const [showApprovalRequest, setShowApprovalRequest] = useState(false)
  const [approvalType, setApprovalType]               = useState('edit')
  const [approvalReason, setApprovalReason]           = useState('')
  const [approvalSaving, setApprovalSaving]           = useState(false)
  const [approvalSuccess, setApprovalSuccess]         = useState('')

  const user = useAuthStore(s => s.user)
  const isAdmin   = user?.role === 'admin'
  const isManager = user?.role === 'manager'
  const canEdit   = isAdmin || isManager

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id).then(r => r.data),
  })

  // For edit dropdowns
  const { data: clients } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => clientsApi.list({ page_size: 200 }).then(r => r.data.results || r.data),
    enabled: editing,
  })
  const { data: managers } = useQuery({
    queryKey: ['managers-list'],
    queryFn: () => authApi.users({ page_size: 200, role: 'manager' }).then(r => r.data.results || r.data),
    enabled: editing,
  })
  const { data: adminsList } = useQuery({
    queryKey: ['admins-list'],
    queryFn: () => authApi.users({ page_size: 200, role: 'admin' }).then(r => r.data.results || r.data),
    enabled: editing,
  })

  function startEdit() {
    const p = project
    setForm({
      name:        p.name || '',
      description: p.description || '',
      client:      p.client || '',
      manager:     p.manager || '',
      status:      p.status || 'planning',
      priority:    p.priority || 'medium',
      start_date:  p.start_date || '',
      end_date:    p.end_date || '',
      resource_l1: p.resource_l1 ?? 0,
      resource_l2: p.resource_l2 ?? 0,
      resource_l3: p.resource_l3 ?? 0,
      resource_l4: p.resource_l4 ?? 0,
      activity:    p.activity || '',
    })
    setEditing(true)
    setError('')
  }

  async function saveEdit() {
    setSaving(true)
    setError('')
    try {
      const workingDays = countWorkingDays(form.start_date, form.end_date)
      const autoHours   = workingDays * 8
      const payload = {
        ...form,
        resource_l1: parseInt(form.resource_l1) || 0,
        resource_l2: parseInt(form.resource_l2) || 0,
        resource_l3: parseInt(form.resource_l3) || 0,
        resource_l4: parseInt(form.resource_l4) || 0,
        hours:       autoHours,
        activity:    form.activity || '',
      }
      if (!payload.client) delete payload.client
      if (!payload.manager) delete payload.manager
      await projectsApi.update(id, payload)
      await qc.invalidateQueries(['project', id])
      await qc.invalidateQueries(['projects'])
      await qc.invalidateQueries(['dashboard-projects'])
      await qc.invalidateQueries(['dashboard-timelines'])
      setEditing(false)
      setForm(null)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSaving(false)
    }
  }

  async function deleteProject() {
    try {
      await projectsApi.delete(id)
      qc.invalidateQueries(['projects'])
      qc.invalidateQueries(['dashboard-projects'])
      navigate('/projects')
    } catch (err) {
      setError(extractError(err))
    }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  if (isLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--sp-16)' }}>
      <Spinner size={32} />
    </div>
  )
  if (!project) return <div style={{ color: 'var(--text-2)' }}>Project not found.</div>

  const p = project
  const managerOptions = [...(adminsList || []), ...(managers || [])]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>

      {/* Back */}
      <button onClick={() => navigate('/projects')}
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px', width: 'fit-content' }}>
        <ArrowLeft size={14} /> Back to Projects
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--sp-4)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 6 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.02em' }}>{p.name}</h1>
            <Badge color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status]}</Badge>
            <Badge color={PRIORITY_COLOR[p.priority]}>{PRIORITY_LABEL[p.priority]}</Badge>
          </div>
          <div style={{ color: 'var(--text-2)', fontSize: '14px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {p.client_detail?.name
              ? <><Building2 size={12} /><span style={{ color: 'var(--accent)' }}>{p.client_detail.name}</span> · </>
              : <span style={{ color: 'var(--text-3)' }}>No client · </span>
            }
            Managed by {p.manager_detail?.name || <span style={{ color: 'var(--danger)', fontSize: '14px' }}>⚠ No manager assigned</span>}
          </div>
        </div>

        {/* Admin: direct edit/delete */}
        {isAdmin && !editing && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowUpdate(true)} icon={<Plus size={14} />}>Add Update</Btn>
            <Btn variant="ghost" size="sm" onClick={startEdit} icon={<Edit2 size={14} />}>Edit</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setShowDelete(true)}
              style={{
                color: 'var(--danger)',
                borderColor: 'rgba(248,113,113,0.45)',
                background: 'rgba(248,113,113,0.1)',
                borderRadius: 'var(--r-full)',
                padding: '5px 14px',
                fontWeight: 600,
              }}
              icon={<Trash2 size={14} />}>Delete</Btn>
          </div>
        )}
        {isAdmin && editing && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Btn variant="ghost" size="sm" onClick={() => { setEditing(false); setForm(null) }} icon={<X size={14} />}>Cancel</Btn>
            <Btn size="sm" loading={saving} onClick={saveEdit} icon={<Save size={14} />}>Save Changes</Btn>
          </div>
        )}

        {/* Manager: request approval */}
        {isManager && !editing && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowUpdate(true)} icon={<Plus size={14} />}>Add Update</Btn>
            <Btn variant="ghost" size="sm"
              onClick={() => { setApprovalType('edit'); setApprovalReason(''); setApprovalSuccess(''); setShowApprovalRequest(true) }}
              icon={<Send size={14} />}
              style={{
                color: 'var(--info)',
                borderColor: 'rgba(96,165,250,0.45)',
                background: 'rgba(96,165,250,0.1)',
                borderRadius: 'var(--r-full)',
                padding: '5px 14px',
                fontWeight: 600,
              }}
            >Request Edit</Btn>
            <Btn variant="ghost" size="sm"
              onClick={() => { setApprovalType('delete'); setApprovalReason(''); setApprovalSuccess(''); setShowApprovalRequest(true) }}
              icon={<Trash2 size={14} />}
              style={{
                color: 'var(--danger)',
                borderColor: 'rgba(248,113,113,0.45)',
                background: 'rgba(248,113,113,0.1)',
                borderRadius: 'var(--r-full)',
                padding: '5px 14px',
                fontWeight: 600,
              }}
            >Request Delete</Btn>
          </div>
        )}
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: '15px', background: 'rgba(248,113,113,0.1)', padding: '10px 14px', borderRadius: 'var(--r-md)' }}>{error}</div>}

      {/* Edit Form */}
      {editing && form && (
        <div style={{ background: 'var(--bg-1)', border: '1px solid var(--accent)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Editing Project</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--sp-4)' }}>
            <Input label="Project Name" value={form.name} onChange={e => f('name', e.target.value)} required />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Client</div>
              <select value={form.client} onChange={e => f('client', e.target.value)} style={sel}>
                <option value="">No client</option>
                {(clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Status</div>
              <select value={form.status} onChange={e => f('status', e.target.value)} style={sel}>
                <option value="planning">Planning</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="completed">Completed</option>
                <option value="on_hold">On Hold</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Priority</div>
              <select value={form.priority} onChange={e => f('priority', e.target.value)} style={sel}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Manager</div>
            <select value={form.manager} onChange={e => f('manager', e.target.value)} style={sel}>
              <option value="">No manager</option>
              {managerOptions.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
            <Input label="Start Date" type="date" value={form.start_date} onChange={e => f('start_date', e.target.value)} />
            <Input label="End Date" type="date" value={form.end_date} onChange={e => f('end_date', e.target.value)} />
          </div>

          {/* Auto-calculated hours preview */}
          {(() => {
            const wd = countWorkingDays(form.start_date, form.end_date)
            const hrs = wd * 8
            return wd > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontSize: '14px' }}>
                <Calendar size={13} color="var(--info)" />
                <span style={{ color: 'var(--text-2)' }}>
                  <strong style={{ color: 'var(--text-0)' }}>{wd} working days</strong>
                  <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>(weekends excluded)</span>
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>= {hrs} hrs</span>
              </div>
            ) : null
          })()}

          {/* Resource Levels */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>Resource Levels</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 'var(--sp-3)' }}>
              <Input label="L1" type="number" min="0" value={form.resource_l1} onChange={e => f('resource_l1', e.target.value)} placeholder="0" />
              <Input label="L2" type="number" min="0" value={form.resource_l2} onChange={e => f('resource_l2', e.target.value)} placeholder="0" />
              <Input label="L3" type="number" min="0" value={form.resource_l3} onChange={e => f('resource_l3', e.target.value)} placeholder="0" />
              <Input label="L4" type="number" min="0" value={form.resource_l4} onChange={e => f('resource_l4', e.target.value)} placeholder="0" />
            </div>
          </div>

          <Input label="Activity" value={form.activity} onChange={e => f('activity', e.target.value)} placeholder="e.g. Development, Testing, Design..." />

          <Textarea label="Description" value={form.description} onChange={e => f('description', e.target.value)} placeholder="Project overview…" />
        </div>
      )}

      {/* Metric Cards — Resource levels, hours, activity */}
      {!editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--sp-3)' }}>
          <MetricBox icon={Users}      label="L1 Resources" value={p.resource_l1 != null ? p.resource_l1 : '—'} />
          <MetricBox icon={Users}      label="L2 Resources" value={p.resource_l2 != null ? p.resource_l2 : '—'} />
          <MetricBox icon={Users}      label="L3 Resources" value={p.resource_l3 != null ? p.resource_l3 : '—'} />
          <MetricBox icon={Users}      label="L4 Resources" value={p.resource_l4 != null ? p.resource_l4 : '—'} />
          <MetricBox icon={TrendingUp} label="Hours"        value={p.hours ? `${p.hours}h` : '—'} />
          <MetricBox icon={Calendar}   label="Start"        value={formatDate(p.start_date)} />
          <MetricBox icon={Calendar}   label="End"          value={formatDate(p.end_date)} />
          {p.activity && <MetricBox icon={FileText} label="Activity" value={p.activity} />}
        </div>
      )}

      {/* Tabs */}
      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: 'var(--sp-4) var(--sp-5) 0', borderBottom: '1px solid var(--border)' }}>
          <Tabs
            tabs={TABS.map(t => ({ ...t, count: t.id === 'updates' ? p.updates?.length : undefined }))}
            active={tab} onChange={setTab}
          />
        </div>
        <div style={{ padding: 'var(--sp-6)' }}>
          {tab === 'overview'   && <OverviewTab project={p} />}
          {tab === 'timelines'  && <TimelinesTab projectId={p.id} canEdit={canEdit} />}
          {tab === 'updates'    && <UpdatesTab updates={p.updates || []} />}
          {tab === 'team'       && <TeamTab resources={p.resource_details || []} manager={p.manager_detail} projectId={p.id} canEdit={canEdit} onRefresh={() => { qc.invalidateQueries(['project', id]); qc.invalidateQueries(['resources']); qc.invalidateQueries(['projects']); qc.invalidateQueries(['dashboard-projects']); qc.invalidateQueries(['dashboard-resources']) }} />}
        </div>
      </div>

      {/* Delete Confirm — admin only */}
      {showDelete && isAdmin && (
        <Modal open onClose={() => setShowDelete(false)} title="Delete Project" width={420}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
            <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>
              Are you sure you want to delete <strong style={{ color: 'var(--text-0)' }}>{p.name}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Btn>
              <Btn onClick={deleteProject} style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}>Delete Project</Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Manager Approval Request Modal */}
      {showApprovalRequest && isManager && (
        <ApprovalRequestModal
          project={p}
          type={approvalType}
          onClose={() => setShowApprovalRequest(false)}
          onSubmitted={(msg) => {
            setShowApprovalRequest(false)
            setApprovalSuccess(msg)
            setTimeout(() => setApprovalSuccess(''), 5000)
          }}
        />
      )}

      {approvalSuccess && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.4)',
          borderRadius: 'var(--r-md)', padding: '12px 20px',
          color: 'var(--success)', fontSize: '15px', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: 'var(--shadow-md)',
        }}>
          <CheckCircle size={16} /> {approvalSuccess}
        </div>
      )}

      {showUpdate && (
        <AddUpdateModal projectId={p.id} onClose={() => setShowUpdate(false)} onDone={() => { setShowUpdate(false); qc.invalidateQueries(['project', id]); qc.invalidateQueries(['dashboard-notifications']) }} />
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────── */

function MetricBox({ icon: Icon, label, value, accent, sub }) {
  return (
    <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon size={12} color="var(--text-3)" />
        <span style={{ fontSize: '13px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '15px', fontWeight: 600, color: accent || 'var(--text-0)' }}>{value != null && value !== '' ? value : '—'}</div>
      {sub && <div style={{ fontSize: '12px', color: accent || 'var(--text-3)', fontWeight: accent ? 600 : 400 }}>{sub}</div>}
    </div>
  )
}

function ProjectProgressBar({ project: p, canEdit, onRefresh }) {
  const [localVal, setLocalVal] = useState(p.progress ?? 0)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)

  React.useEffect(() => { setLocalVal(p.progress ?? 0); setDirty(false) }, [p.progress])

  async function save() {
    setSaving(true)
    try { await projectsApi.updateProgress(p.id, localVal); setDirty(false); onRefresh() }
    finally { setSaving(false) }
  }

  const color = localVal === 100 ? 'var(--success)' : localVal >= 60 ? 'var(--accent)' : localVal >= 30 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div style={{
      background: 'var(--bg-1)',
      border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--r-lg)', padding: 'var(--sp-5)',
      transition: 'border-color 0.2s',
    }}>
      {/* Label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <span style={{ fontWeight: 600, fontSize: '15px' }}>Overall Progress</span>
          {p.timelines_count > 0 && (
            <span style={{ fontSize: '12px', color: 'var(--text-3)', background: 'var(--bg-3)', padding: '2px 7px', borderRadius: 'var(--r-full)' }}>
              auto-synced from {p.timelines_count} phase{p.timelines_count !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '22px', fontFamily: 'var(--font-mono)', fontWeight: 800, color }}>{localVal}%</span>
          {dirty && (
            <button onClick={save} disabled={saving}
              style={{
                background: color, border: 'none', borderRadius: 'var(--r-md)',
                color: '#0a0a0a', fontSize: '14px', fontWeight: 700,
                padding: '5px 14px', cursor: 'pointer', transition: 'opacity 0.15s',
                opacity: saving ? 0.6 : 1,
              }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Single combined bar — shows progress + acts as slider */}
      <div style={{ position: 'relative', height: 20, borderRadius: 99, background: 'var(--bg-3)', overflow: 'hidden', cursor: canEdit ? 'pointer' : 'default' }}>
        {/* Fill */}
        <div style={{ height: '100%', width: `${localVal}%`, background: color, borderRadius: 99, transition: dirty ? 'none' : 'width 0.3s ease', pointerEvents: 'none' }} />
        {/* Invisible range input overlaid */}
        {canEdit && (
          <input type="range" min="0" max="100" value={localVal}
            onChange={e => { setLocalVal(parseInt(e.target.value)); setDirty(true) }}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              opacity: 0, cursor: 'pointer', margin: 0,
            }}
          />
        )}
      </div>
    </div>
  )
}

function OverviewTab({ project: p }) {
  const c = p.client_detail
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* Description */}
      {p.description && (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--sp-2)' }}>Description</div>
          <p style={{ fontSize: '14px', color: 'var(--text-1)', lineHeight: 1.7 }}>{p.description}</p>
        </div>
      )}

      {/* Client Details */}
      {c ? (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--sp-3)' }}>Client</div>
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            {/* Client header */}
            <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-display)' }}>
                {c.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--accent)' }}>{c.name}</div>
                {c.status && <div style={{ fontSize: '13px', color: 'var(--text-3)', textTransform: 'uppercase', marginTop: 2 }}>{c.status}</div>}
              </div>
            </div>

            {/* Contact persons row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', borderBottom: '1px solid var(--border)' }}>
              <ClientCell label="Contact Person 1" value={c.contact_person} />
              <ClientCell label="Contact Person 2" value={c.contact_person2} border />
            </div>

            {/* Emails row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', borderBottom: '1px solid var(--border)' }}>
              <ClientCell label="Email 1" value={c.email} />
              <ClientCell label="Email 2" value={c.email2} border />
            </div>

            {/* Phones row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', borderBottom: c.website || c.notes ? '1px solid var(--border)' : 'none' }}>
              <ClientCell label="Phone 1" value={c.phone} />
              <ClientCell label="Phone 2" value={c.phone2} border />
            </div>

            {/* Website */}
            {c.website && (
              <div style={{ borderBottom: c.notes ? '1px solid var(--border)' : 'none' }}>
                <ClientCell label="Website" value={c.website.replace(/^https?:\/\//, '')} />
              </div>
            )}

            {/* Notes */}
            {c.notes && (
              <div style={{ padding: 'var(--sp-3) var(--sp-5)' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Notes</div>
                <div style={{ fontSize: '15px', color: 'var(--text-1)', lineHeight: 1.6 }}>{c.notes}</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '15px', color: 'var(--text-3)' }}>No client linked to this project.</div>
      )}

      {/* Tags */}
      {p.tags?.length > 0 && (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--sp-2)' }}>Tags</div>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {p.tags.map(tag => (
              <span key={tag} style={{ background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--r-full)', padding: '3px 10px', fontSize: '14px', color: 'var(--text-2)' }}>{tag}</span>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

function ClientCell({ label, value, border }) {
  return (
    <div style={{
      padding: 'var(--sp-3) var(--sp-5)',
      borderLeft: border ? '1px solid var(--border)' : 'none',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '15px', fontWeight: 500, color: value ? 'var(--text-0)' : 'var(--text-3)' }}>{value || '—'}</div>
    </div>
  )
}

function UpdatesTab({ updates }) {
  if (!updates.length) return <p style={{ color: 'var(--text-3)', fontSize: '14px' }}>No updates yet.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {updates.map(u => (
        <div key={u.id} style={{ display: 'flex', gap: 'var(--sp-4)' }}>
          <Avatar name={u.author?.name} size={32} />
          <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: 'var(--r-md)', padding: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-2)' }}>
              <span style={{ fontWeight: 600, fontSize: '15px' }}>{u.author?.name || 'Unknown'}</span>
              <span style={{ fontSize: '13px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{timeAgo(u.created_at)}</span>
            </div>
            <p style={{ fontSize: '15px', color: 'var(--text-1)', lineHeight: 1.6 }}>{u.content}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function TeamTab({ resources, manager, projectId, canEdit, onRefresh }) {
  const [showAssign, setShowAssign] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {manager && (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--sp-3)' }}>Project Manager</div>
          <TeamMemberRow user={manager} />
        </div>
      )}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Resources ({resources.length})</div>
          {canEdit && <Btn size="sm" variant="secondary" icon={<Plus size={12} />} onClick={() => setShowAssign(true)}>Assign</Btn>}
        </div>
        {resources.length === 0
          ? <p style={{ color: 'var(--text-3)', fontSize: '15px' }}>No resources assigned.</p>
          : resources.map(r => <TeamMemberRow key={r.id} user={r} projectId={canEdit ? projectId : null} onRemove={canEdit ? onRefresh : null} />)
        }
      </div>
      {showAssign && <AssignResourceModal projectId={projectId} assignedIds={resources.map(r => r.id)} onClose={() => setShowAssign(false)} onDone={() => { setShowAssign(false); onRefresh() }} />}
    </div>
  )
}

function TeamMemberRow({ user, projectId, onRemove }) {
  const [removing, setRemoving] = useState(false)
  async function handleRemove() {
    if (!projectId || !onRemove) return
    setRemoving(true)
    try { await projectsApi.removeResource(projectId, user.id); onRemove() } finally { setRemoving(false) }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <Avatar name={user.name} src={user.avatar || user.avatar_url} size={36} role={user.role} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-0)' }}>{user.name || '—'}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-3)', textTransform: 'capitalize' }}>{user.role || 'Member'}{user.department ? ` · ${user.department}` : ''}</div>
      </div>
      {projectId && onRemove && (
        <button onClick={handleRemove} disabled={removing}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', cursor: 'pointer', padding: '3px 8px', fontSize: '13px', color: 'var(--text-3)', transition: 'all var(--t-fast)' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--danger)'; e.currentTarget.style.color = 'var(--danger)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-3)' }}>
          {removing ? '…' : 'Remove'}
        </button>
      )}
    </div>
  )
}

function AssignResourceModal({ projectId, assignedIds, onClose, onDone }) {
  const [loading, setLoading] = useState(false)
  const [benchFilter, setBenchFilter] = useState('all')

  const { data } = useQuery({
    queryKey: ['resources-assign'],
    queryFn: () => resourcesApi.list({ page_size: 200 }).then(r => r.data.results || r.data),
  })

  // Resources not already on THIS project (multi-project allowed, so we only exclude already-assigned-here)
  const available = (data || []).filter(r => r.user_detail?.is_active && !assignedIds.includes(r.user_detail?.id))

  const filtered = available.filter(r => {
    const onBench = (r.active_project_count ?? 0) === 0
    if (benchFilter === 'bench') return onBench
    if (benchFilter === 'active') return !onBench
    return true
  })

  async function assign(userId) {
    setLoading(true)
    try { await projectsApi.assignResource(projectId, userId); onDone() } finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} title="Assign Resource" width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {/* Filter tabs */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, fontSize: '13px', color: 'var(--text-3)', alignItems: 'center' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} /> On Bench
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block', marginLeft: 8 }} /> Active
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

        {filtered.length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: '15px', textAlign: 'center', padding: 'var(--sp-6)' }}>
            {available.length === 0 ? 'All resources already assigned to this project' : 'No resources match this filter'}
          </div>
        ) : (
          filtered.map(r => {
            const onBench = (r.active_project_count ?? 0) === 0
            const activeCount = r.active_project_count ?? 0
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: 'var(--sp-3)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                <Avatar name={r.user_detail?.name} size={34} role="resource" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>{r.user_detail?.name}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <span>{r.job_title || r.level || r.resource_level || 'No title'}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: onBench ? 'var(--success)' : 'var(--warning)', display: 'inline-block' }} />
                      {onBench ? 'On Bench' : `Active (${activeCount} project${activeCount !== 1 ? 's' : ''})`}
                    </span>
                  </div>
                </div>
                <Btn size="sm" loading={loading} onClick={() => assign(r.user_detail?.id)}>Assign</Btn>
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}

function AddUpdateModal({ projectId, onClose, onDone }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    if (!content.trim()) return
    setLoading(true)
    try { await projectsApi.addUpdate(projectId, { content }); onDone() }
    catch (err) { setError(extractError(err)) }
    finally { setLoading(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add Project Update">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: '15px' }}>{error}</div>}
        <Textarea label="Update" value={content} onChange={e => setContent(e.target.value)} placeholder="What's the latest on this project?" style={{ minHeight: 120 }} required />
        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>Post Update</Btn>
        </div>
      </form>
    </Modal>
  )
}

// ─── Timelines Tab ──────────────────────────────────────────────────────────
const sel2 = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px', padding: '8px 12px', outline: 'none' }

function TimelinesTab({ projectId, canEdit }) {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editPhase, setEditPhase] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['timelines-project', projectId],
    queryFn: () => timelinesApi.list({ project: projectId, page_size: 100 }).then(r => r.data.results || r.data),
  })

  const phases = data || []
  const ef = (k, v) => setEditForm(p => ({ ...p, [k]: v }))

  function startEdit(phase) {
    setEditPhase(phase.id)
    setEditForm({ name: phase.name, status: phase.status, progress: phase.progress ?? 0, start_date: phase.start_date || '', end_date: phase.end_date || '', description: phase.description || '' })
  }

  async function saveEdit(phaseId) {
    setSaving(true)
    try {
      await timelinesApi.update(phaseId, { ...editForm, progress: parseInt(editForm.progress) })
      setEditPhase(null)
      qc.invalidateQueries(['timelines-project', projectId])
      qc.invalidateQueries(['project', String(projectId)])
      qc.invalidateQueries(['dashboard-timelines'])
      qc.invalidateQueries(['dashboard-projects'])
    } finally { setSaving(false) }
  }

  async function deletePhase(phaseId) {
    if (!window.confirm('Delete this phase?')) return
    await timelinesApi.delete(phaseId)
    qc.invalidateQueries(['timelines-project', projectId])
    qc.invalidateQueries(['project', String(projectId)])
  }

  async function completeMilestone(milestoneId, phaseId) {
    await timelinesApi.completeMilestone(milestoneId)
    qc.invalidateQueries(['timelines-project', projectId])
  }

  if (isLoading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={24} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '15px', color: 'var(--text-3)' }}>{phases.length} phase{phases.length !== 1 ? 's' : ''} · {phases.filter(p => p.status === 'completed').length} completed</div>
        {canEdit && <Btn size="sm" icon={<Plus size={13} />} onClick={() => setShowCreate(true)}>Add Phase</Btn>}
      </div>

      {phases.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-8)', color: 'var(--text-3)', fontSize: '15px' }}>
          No timeline phases yet.{canEdit ? ' Click "Add Phase" to create one.' : ''}
        </div>
      ) : (
        phases.map(phase => {
          const isEditing = editPhase === phase.id
          return (
            <div key={phase.id} style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-md)', border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, overflow: 'hidden' }}>
              {/* Phase header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '12px 14px' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: phase.color || 'var(--accent)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '15px' }}>{phase.name}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 2 }}>
                    {formatDate(phase.start_date)} → {formatDate(phase.end_date)}
                    {phase.assignee_details?.length > 0 && ` · ${phase.assignee_details.map(a => a.name).join(', ')}`}
                  </div>
                </div>
                <Badge color={STATUS_COLOR[phase.status]}>{STATUS_LABEL[phase.status]}</Badge>
                {/* Progress bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--bg-3)', borderRadius: 99 }}>
                    <div style={{ height: '100%', width: `${phase.progress}%`, background: phase.color || 'var(--accent)', borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 600, minWidth: 30, textAlign: 'right' }}>{phase.progress}%</span>
                </div>
                {canEdit && !isEditing && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button onClick={() => startEdit(phase)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => deletePhase(phase.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Description */}
              {!isEditing && phase.description && (
                <div style={{ padding: '0 14px 10px', fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6 }}>{phase.description}</div>
              )}

              {/* Inline edit form */}
              {isEditing && editForm && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)' }}>
                    <Input label="Phase Name" value={editForm.name} onChange={e => ef('name', e.target.value)} />
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Status</div>
                      <select value={editForm.status} onChange={e => ef('status', e.target.value)} style={sel2}>
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed</option>
                        <option value="on_hold">On Hold</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)' }}>
                    <Input label="Start Date" type="date" value={editForm.start_date} onChange={e => ef('start_date', e.target.value)} />
                    <Input label="End Date" type="date" value={editForm.end_date} onChange={e => ef('end_date', e.target.value)} />
                  </div>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
                      Progress — <span style={{ color: 'var(--accent)' }}>{editForm.progress}% complete</span>
                    </div>
                    <input type="range" min="0" max="100" value={editForm.progress}
                      onChange={e => ef('progress', e.target.value)}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  </div>
                  <Textarea label="Description" value={editForm.description} onChange={e => ef('description', e.target.value)} placeholder="Phase details…" />
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                    <Btn variant="ghost" size="sm" onClick={() => setEditPhase(null)} icon={<X size={13} />}>Cancel</Btn>
                    <Btn size="sm" loading={saving} onClick={() => saveEdit(phase.id)} icon={<Save size={13} />}>Save & Sync Progress</Btn>
                  </div>
                </div>
              )}

              {/* Milestones */}
              {!isEditing && phase.milestones?.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px 12px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Milestones — {phase.milestones.filter(m => m.completed).length}/{phase.milestones.length}
                  </div>
                  {phase.milestones.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                      <button onClick={() => !m.completed && canEdit && completeMilestone(m.id, phase.id)}
                        style={{ background: 'none', border: 'none', cursor: !m.completed && canEdit ? 'pointer' : 'default', padding: 0, color: m.completed ? 'var(--success)' : 'var(--text-3)' }}>
                        {m.completed ? <CheckCircle size={13} /> : <Circle size={13} />}
                      </button>
                      <span style={{ fontSize: '14px', flex: 1, textDecoration: m.completed ? 'line-through' : 'none', color: m.completed ? 'var(--text-3)' : 'var(--text-1)' }}>{m.title}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Due {formatDate(m.due_date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}

      {showCreate && (
        <CreatePhaseModal projectId={projectId} onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); qc.invalidateQueries(['timelines-project', projectId]); qc.invalidateQueries(['dashboard-timelines']); qc.invalidateQueries(['dashboard-projects']) }} />
      )}
    </div>
  )
}

function CreatePhaseModal({ projectId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', status: 'pending', color: '#6366f1', description: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    try { await timelinesApi.create({ ...form, project: projectId }); onCreated() }
    catch (err) { setError(extractError(err)) }
    finally { setLoading(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add Timeline Phase" fullscreen>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
        {error && <div style={{ color: 'var(--danger)', fontSize: '15px', background: 'rgba(248,113,113,0.1)', padding: '8px 12px', borderRadius: 'var(--r-md)' }}>{error}</div>}
        <Input label="Phase name" value={form.name} onChange={e => f('name', e.target.value)} required />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-4)' }}>
          <Input label="Start date" type="date" value={form.start_date} onChange={e => f('start_date', e.target.value)} required />
          <Input label="End date" type="date" value={form.end_date} onChange={e => f('end_date', e.target.value)} required />
        </div>
        <Textarea label="Description" value={form.description} onChange={e => f('description', e.target.value)} placeholder="What does this phase cover?" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-2)' }}>
          <Btn type="submit" loading={loading}>Create Phase</Btn>
        </div>
      </form>
    </Modal>
  )
}

// ── Approval Request Modal (for managers) — just reason, no edit form ─────────
function ApprovalRequestModal({ project, type, onClose, onSubmitted }) {
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) { setErr('Please explain your reason.'); return }
    setLoading(true)
    setErr('')
    try {
      await approvalsApi.create({
        project: project.id,
        request_type: type,
        reason: reason.trim(),
        proposed_changes: {},
      })
      onSubmitted(`${type === 'edit' ? 'Edit' : 'Delete'} request sent to admin. You'll be notified in Approvals once reviewed.`)
    } catch (err) {
      setErr(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  const isDelete = type === 'delete'

  return (
    <Modal open onClose={onClose} title={isDelete ? 'Request Delete Approval' : 'Request Edit Approval'} fullscreen>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

        {/* Banner */}
        <div style={{
          background: isDelete ? 'rgba(248,113,113,0.08)' : 'rgba(96,165,250,0.08)',
          border: `1px solid ${isDelete ? 'rgba(248,113,113,0.3)' : 'rgba(96,165,250,0.3)'}`,
          borderRadius: 'var(--r-md)', padding: '12px 14px',
          fontSize: '15px', color: isDelete ? 'var(--danger)' : 'var(--info)', lineHeight: 1.5,
        }}>
          {isDelete
            ? <>You're requesting permission to <strong>delete</strong> <strong>"{project.name}"</strong>. Once the admin approves, the project will be permanently removed.</>
            : <>You're requesting permission to <strong>edit</strong> <strong>"{project.name}"</strong>. Once approved, you'll be able to apply your changes from the <strong>Approvals</strong> tab in the sidebar.</>
          }
        </div>

        {err && (
          <div style={{ color: 'var(--danger)', fontSize: '15px', background: 'rgba(248,113,113,0.1)', padding: '8px 12px', borderRadius: 'var(--r-md)' }}>{err}</div>
        )}

        {/* Reason */}
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
            Reason <span style={{ color: 'var(--danger)' }}>*</span>
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={isDelete ? 'Why should this project be deleted?' : 'What do you need to change and why?'}
            rows={4}
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
          <div style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: 4 }}>
            {isDelete ? 'Admin will review this and notify you of their decision.' : 'After approval, go to Approvals in the sidebar to apply your specific changes.'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--sp-3)', justifyContent: 'flex-end', paddingTop: 'var(--sp-2)' }}>
          <Btn
            type="submit"
            loading={loading}
            icon={<Send size={13} />}
            style={{
              background: isDelete ? 'var(--danger)' : 'var(--accent)',
              borderColor: isDelete ? 'var(--danger)' : 'var(--accent)',
              color: isDelete ? '#fff' : 'var(--bg-0)',
              fontWeight: 700,
              borderRadius: 'var(--r-full)',
              padding: '7px 20px',
            }}
          >
            Send {isDelete ? 'Delete' : 'Edit'} Request
          </Btn>
        </div>
      </form>
    </Modal>
  )
}