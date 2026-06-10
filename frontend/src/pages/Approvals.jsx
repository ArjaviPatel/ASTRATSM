import React, { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, ChevronDown, ChevronUp, FileEdit, Trash2, Edit2, Save, X, Clock } from 'lucide-react'
import { Spinner, Input } from '@/components/ui/index.jsx'
import { timeAgo, extractError } from '@/utils/index.js'
import { useAuthStore } from '@/stores/authStore.js'
import { approvalsApi, timelineApprovalsApi, resourcesApi } from '@/api/index.js'

const TYPE_COLOR   = { edit: 'var(--info)', delete: 'var(--danger)', create: 'var(--accent)', timesheet: 'var(--success)', late_entry: 'var(--warning)' }
const TYPE_BG      = { edit: 'rgba(122,166,184,0.12)', delete: 'rgba(217,108,108,0.12)', create: 'rgba(35,114,39,0.12)', timesheet: 'rgba(74,222,128,0.12)', late_entry: 'rgba(251,191,36,0.12)' }
const TYPE_ICON    = { edit: FileEdit, delete: Trash2, create: Edit2, late_entry: Clock }
const STATUS_COLOR = { pending: 'var(--warning)', approved: 'var(--success)', rejected: 'var(--danger)' }
const STATUS_BG    = { pending: 'rgba(111,166,118,0.12)', approved: 'rgba(73,163,95,0.12)', rejected: 'rgba(217,108,108,0.12)' }
const SEL = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-1)', fontSize: '15px', padding: '8px 12px', outline: 'none', boxSizing: 'border-box' }

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export default function ApprovalsPage() {
  const isMobile = useIsMobile()
  const qc      = useQueryClient()
  const user    = useAuthStore(s => s.user)
  const isAdmin   = user?.role === 'admin'
  const isManager = user?.role === 'manager'

  useEffect(() => {
    qc.setQueryData(['approval-count'], { count: 0 })
  }, [])

  async function handleMarkAllRead() {
    try {
      await approvalsApi.markAllRead()
      qc.setQueryData(['approval-count'], { count: 0 })
      flash('All marked as read.')
    } catch (e) { /* silent */ }
  }

  // Managers default to 'pending' so they immediately see actionable items
  const [statusFilter, setStatusFilter] = useState(isAdmin || isManager ? 'pending' : '')
  const [expanded, setExpanded]         = useState(null)
  const [actionLoading, setActionLoading] = useState(null)
  const [adminNote, setAdminNote]       = useState({})
  const [applyingId, setApplyingId]     = useState(null)
  const [applyForm, setApplyForm]       = useState({})
  const [applyLoading, setApplyLoading] = useState(false)
  const [error, setError]               = useState('')
  const [successMsg, setSuccessMsg]     = useState('')

  const approvalStatusParam = statusFilter || undefined
  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['approvals', approvalStatusParam],
    queryFn: () => approvalsApi.list({ page_size: 500, status: approvalStatusParam }).then(r => r.data.results || r.data),
    refetchInterval: 15000,
  })

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['timeline-approvals', approvalStatusParam],
    queryFn: () => timelineApprovalsApi.list({ page_size: 500, status: approvalStatusParam }).then(r => r.data.results || r.data),
    refetchInterval: 15000,
  })

  // Fetch pending time entries and late-entry unlock requests for reviewers.
  const canReviewTimesheets = isManager || isAdmin
  const { data: timeEntriesData, isLoading: timeEntriesLoading } = useQuery({
    queryKey: ['pending-time-entries', user?.id],
    queryFn: async () => {
      const res = await resourcesApi.timeEntries({ approved: 'false', page_size: 500 })
      const all = res.data.results || res.data || []
      // Client-side guard: only truly unapproved entries
      return all.filter(e => e.approved === false || e.approved === 'false')
    },
    enabled: canReviewTimesheets,
    refetchInterval: 15000,
  })

  const { data: lateEntryData, isLoading: lateEntryLoading } = useQuery({
    queryKey: ['late-entry-approvals', user?.id],
    queryFn: async () => {
      const res = await resourcesApi.lateEntryApprovals({ status: 'pending', page_size: 500 })
      return res.data.results || res.data || []
    },
    enabled: canReviewTimesheets,
    refetchInterval: 15000,
  })

  const isLoading = projectLoading || timelineLoading || timeEntriesLoading || lateEntryLoading

  const requests = React.useMemo(() => {
    const proj = (projectData || []).map(r => ({ ...r, _kind: 'project', _uid: `project-${r.id}` }))
    const tl   = (timelineData  || []).map(r => ({ ...r, _kind: 'timeline', _uid: `timeline-${r.id}`, project_name: r.timeline_name || r.project_name || 'Timeline' }))
    return [...proj, ...tl].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [projectData, timelineData])

  // Combine project/timeline approvals with timesheet entries for manager
  const allRequests = React.useMemo(() => {
    if (!canReviewTimesheets) return requests
    const entries = timeEntriesData || []
    const timesheetReqs = entries.map(entry => ({
      id: entry.id,
      _uid: `timesheet-${entry.id}`,
      _kind: 'timesheet',
      project_name: entry.project_name || 'Unknown Project',
      timeline_name: entry.timeline_name || 'Project-level log',
      resource_name: entry.resource_name || 'Unknown Resource',
      request_type: 'timesheet',
      status: 'pending',
      date: entry.date,
      hours: entry.hours,
      description: entry.description,
      created_at: entry.created_at || entry.date,
      _entryId: entry.id,
    }))
    const lateReqs = (lateEntryData || []).map(req => ({
      id: req.id,
      _uid: `late-entry-${req.id}`,
      _kind: 'late_entry',
      project_name: 'Late timesheet unlock',
      resource_name: req.resource_name || 'Unknown Resource',
      request_type: 'late_entry',
      status: req.status || 'pending',
      date: req.date,
      reason: req.reason,
      admin_note: req.admin_note,
      requested_by_name: req.requested_by_name,
      created_at: req.created_at,
    }))
    // Timesheets are always 'pending' — show on pending or all tabs
    const filteredTimesheets = (statusFilter === '' || statusFilter === 'pending') ? [...timesheetReqs, ...lateReqs] : []
    return [...requests, ...filteredTimesheets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [requests, timeEntriesData, lateEntryData, canReviewTimesheets, statusFilter])

  const pendingTimesheetCount = (timeEntriesData || []).length
  const pendingLateEntryCount = (lateEntryData || []).length
  const pendingCount = allRequests.filter(r => r.status === 'pending').length

  function flash(msg) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(''), 4000) }
  const af = (k, v) => setApplyForm(p => ({ ...p, [k]: v }))

  async function handleTimesheetApproval(req) {
    const entryId = req._entryId || req.id?.toString().replace('timesheet-', '')
    if (!entryId) { setError('Cannot find time entry ID.'); return }
    setActionLoading(req._uid + '_approve'); setError('')
    try {
      await resourcesApi.approveTimeEntry(entryId)
      qc.invalidateQueries({ queryKey: ['pending-time-entries'] })
      qc.invalidateQueries({ queryKey: ['approval-count'] })
      setExpanded(null)
      flash('Time entry approved — resource has been notified.')
    } catch (err) { setError(extractError(err)) }
    finally { setActionLoading(null) }
  }

  async function handleTimesheetRejection(req) {
    const entryId = req._entryId || req.id?.toString().replace('timesheet-', '')
    if (!entryId) { setError('Cannot find time entry ID.'); return }
    setActionLoading(req._uid + '_reject'); setError('')
    try {
      const note = adminNote[req._uid] || ''
      await resourcesApi.rejectTimeEntry(entryId, { admin_note: note })
      qc.invalidateQueries({ queryKey: ['pending-time-entries'] })
      qc.invalidateQueries({ queryKey: ['approval-count'] })
      setExpanded(null)
      flash('Time entry rejected — resource has been notified.')
    } catch (err) { setError(extractError(err)) }
    finally { setActionLoading(null) }
  }

  async function handleLateEntryDecision(req, approved) {
    setActionLoading(`${req._uid}_${approved ? 'approve' : 'reject'}`); setError('')
    try {
      const note = adminNote[req._uid] || ''
      if (approved) await resourcesApi.approveLateEntryApproval(req.id, { admin_note: note })
      else await resourcesApi.rejectLateEntryApproval(req.id, { admin_note: note })
      qc.invalidateQueries({ queryKey: ['late-entry-approvals'] })
      qc.invalidateQueries({ queryKey: ['approval-count'] })
      setExpanded(null)
      flash(approved ? 'Late entry unlocked — resource has been notified.' : 'Late entry request rejected.')
    } catch (err) { setError(extractError(err)) }
    finally { setActionLoading(null) }
  }

  async function handleApprove(id, kind, req) {
    setActionLoading(req?._uid ? req._uid + '_approve' : `${kind}-${id}_approve`); setError('')
    try {
      if (kind === 'timesheet') {
        await handleTimesheetApproval(req || { id, _entryId: id?.toString().replace('timesheet-', '') })
        return
      }
      if (kind === 'late_entry') {
        await handleLateEntryDecision(req, true)
        return
      }
      const api = kind === 'timeline' ? timelineApprovalsApi : approvalsApi
      await api.approve(id, { admin_note: adminNote[req?._uid || id] || '' })
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['timeline-approvals'] })
      qc.invalidateQueries({ queryKey: ['approval-count'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['timelines'] })
      setExpanded(null)
      flash('Request approved — user has been notified.')
    } catch (err) { setError(extractError(err)) }
    finally { setActionLoading(null) }
  }

  async function handleReject(id, kind, req) {
    const uid = `${kind}-${id}`
    setActionLoading(uid + '_reject'); setError('')
    try {
      if (kind === 'timesheet') {
        await handleTimesheetRejection(req || { id, _entryId: id?.toString().replace('timesheet-', ''), _uid: uid })
        return
      }
      if (kind === 'late_entry') {
        await handleLateEntryDecision({ id, _uid: `late-entry-${id}` }, false)
        return
      }
      const api = kind === 'timeline' ? timelineApprovalsApi : approvalsApi
      await api.reject(id, { admin_note: adminNote[uid] || '' })
      qc.invalidateQueries({ queryKey: ['approvals'] })
      qc.invalidateQueries({ queryKey: ['timeline-approvals'] })
      qc.invalidateQueries({ queryKey: ['approval-count'] })
      setExpanded(null)
      flash('Request rejected.')
    } catch (err) { setError(extractError(err)) }
    finally { setActionLoading(null) }
  }

  function openApplyForm(req) {
    setApplyingId(req._uid)
    setExpanded(null)

    if (req._kind === 'timeline') {
      const t = req.timeline_detail || {}
      setApplyForm({
        name:            t.name            || '',
        description:     t.description     || '',
        status:          t.status          || '',
        start_date:      t.start_date      || '',
        end_date:        t.end_date        || '',
        hours_allocated: t.hours_allocated != null ? String(t.hours_allocated) : '',
      })
      return
    }

    const p = req.project_detail || {}
    setApplyForm({
      name:        p.name        || '',
      description: p.description || '',
      status:      p.status      || '',
      priority:    p.priority    || '',
      start_date:  p.start_date  || '',
      end_date:    p.end_date    || '',
      resource_l1: p.resource_l1 != null ? String(p.resource_l1) : '',
      resource_l2: p.resource_l2 != null ? String(p.resource_l2) : '',
      resource_l3: p.resource_l3 != null ? String(p.resource_l3) : '',
      resource_l4: p.resource_l4 != null ? String(p.resource_l4) : '',
      hours:       p.hours       != null ? String(p.hours)       : '',
      activity:    p.activity    || '',
    })
  }

  async function submitApply(req) {
    setApplyLoading(true); setError('')
    try {
      if (req._kind === 'timeline') {
        const payload = {}
        const dateFields = ['start_date', 'end_date']
        const intFields = ['hours_allocated']
        Object.entries(applyForm).forEach(([k, v]) => {
          if (v === '' || v === null || v === undefined) return
          if (intFields.includes(k)) { payload[k] = parseInt(v) || 0 }
          else { payload[k] = v }
        })
        // Remove invalid dates
        dateFields.forEach(k => { if (payload[k] && !/^\d{4}-\d{2}-\d{2}$/.test(payload[k])) delete payload[k] })
        if (Object.keys(payload).length === 0) { setError('No changes to apply.'); setApplyLoading(false); return }
        await timelineApprovalsApi.applyEdit(req.id, payload)
        qc.invalidateQueries({ queryKey: ['timeline-approvals'] })
        qc.invalidateQueries({ queryKey: ['timelines'] })
      } else {
        const payload = {}
        const intFields = ['resource_l1','resource_l2','resource_l3','resource_l4']
        const floatFields = ['hours']
        const dateFields = ['start_date', 'end_date']
        const skipFields = ['resource_details', 'client_detail', 'manager_detail', 'resources']
        Object.entries(applyForm).forEach(([k, v]) => {
          if (skipFields.includes(k)) return
          if (v === '' || v === null || v === undefined) return
          if (intFields.includes(k)) { payload[k] = parseInt(v) || 0 }
          else if (floatFields.includes(k)) { payload[k] = parseFloat(v) || 0 }
          else { payload[k] = v }
        })
        // Remove invalid dates
        dateFields.forEach(k => { if (payload[k] && !/^\d{4}-\d{2}-\d{2}$/.test(payload[k])) delete payload[k] })
        // Never send client/manager as they're not in allowed_fields on backend
        delete payload.client; delete payload.manager
        if (Object.keys(payload).length === 0) { setError('No changes to apply.'); setApplyLoading(false); return }
        await approvalsApi.applyEdit(req.id, payload)
        qc.invalidateQueries({ queryKey: ['approvals'] })
        qc.invalidateQueries({ queryKey: ['projects'] })
        qc.invalidateQueries({ queryKey: ['project', String(req.project)] })
      }
      setApplyingId(null)
      flash('Edit applied successfully!')
    } catch (err) { setError(extractError(err)) }
    finally { setApplyLoading(false) }
  }

  // FIX: Manager gets same tab set as admin — default starts at 'pending'
  const filterTabs = (isAdmin || isManager)
    ? [['pending','Pending'], ['approved','Approved'], ['rejected','Rejected'], ['','All']]
    : [['','All'], ['pending','Pending'], ['approved','Approved'], ['rejected','Rejected']]

  const hPad = isMobile ? '16px' : '32px'

  // FIX: Subtitle copy is now role-aware
  function getSubtitle() {
    if (isAdmin) {
      return pendingCount > 0
        ? <><span style={{ color: 'var(--warning)', fontWeight: 700 }}>{pendingCount} pending</span> · needs your review</>
        : <span style={{ color: 'var(--success)' }}>All caught up ✓</span>
    }
    if (isManager) {
      const count = pendingTimesheetCount + pendingLateEntryCount
      return count > 0
        ? <><span style={{ color: 'var(--warning)', fontWeight: 700 }}>{count} timesheet approval{count !== 1 ? 's' : ''}</span> · waiting for your review</>
        : <span style={{ color: 'var(--success)' }}>All caught up ✓</span>
    }
    return 'Your edit & delete requests'
  }

  // FIX: Empty state copy is role-aware
  function getEmptyState() {
    if (isAdmin) return { title: 'No requests to review.', sub: 'Manager requests will appear here.' }
    if (isManager) return { title: 'No pending timesheet approvals.', sub: 'Submitted entries and older-than-48-hours requests from your resources will appear here.' }
    return { title: 'No approval requests yet.', sub: 'Use "Request Edit" or "Request Delete" on a project.' }
  }

  const emptyState = getEmptyState()

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0, height:'calc(100vh - 60px)', overflow:'hidden', margin: isMobile ? '-16px' : '-1px' }}>

      {/* Sticky top bar */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:`16px ${hPad}`, borderBottom:'1px solid var(--border)', background:'var(--bg-1)', flexShrink:0, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap', flex:1, minWidth:0 }}>
          <div style={{ minWidth:0 }}>
            <h1 style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize: isMobile ? '1.3rem' : '1.6rem', letterSpacing:'-0.02em' }}>Approvals</h1>
            <p style={{ color:'var(--text-2)', fontSize:'12px', marginTop:2 }}>{getSubtitle()}</p>
          </div>

          {/* Filter tabs */}
          <div style={{ display:'flex', gap:3, background:'var(--bg-2)', padding:3, borderRadius:'var(--r-md)', border:'1px solid var(--border)', overflowX:'auto', flexShrink:0 }}>
            {filterTabs.map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)} style={{ background:statusFilter===val?'var(--bg-1)':'transparent', border:statusFilter===val?'1px solid var(--border)':'1px solid transparent', borderRadius:'var(--r-sm)', padding:'5px 12px', fontSize:'12px', fontWeight:statusFilter===val?600:400, color:statusFilter===val?'var(--text-0)':'var(--text-3)', cursor:'pointer', transition:'all var(--t-fast)', whiteSpace:'nowrap' }}>
                {label}
                {/* Show live count badge on Pending tab for managers/admins */}
                {val === 'pending' && (isAdmin || isManager) && pendingCount > 0 && (
                  <span style={{ marginLeft:5, background:'var(--warning)', color:'#000', borderRadius:'var(--r-full)', fontSize:'10px', fontWeight:800, padding:'1px 5px' }}>{pendingCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* Mark all read */}
          <button
            onClick={handleMarkAllRead}
            style={{ fontSize:'12px', color:'var(--text-3)', background:'none', border:'1px solid var(--border)', borderRadius:'var(--r-md)', padding:'5px 12px', cursor:'pointer', display:'flex', alignItems:'center', gap:5, transition:'all var(--t-fast)', whiteSpace:'nowrap', flexShrink:0 }}
            onMouseEnter={e => { e.currentTarget.style.color='var(--text-0)'; e.currentTarget.style.borderColor='var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.color='var(--text-3)'; e.currentTarget.style.borderColor='var(--border)' }}
          >
            <CheckCircle size={12} /> Mark all read
          </button>
        </div>

        {(successMsg || error) && (
          <div style={{ fontSize:'12px', fontWeight:600, padding:'6px 14px', borderRadius:'var(--r-md)', background:successMsg?'rgba(74,222,128,0.1)':'rgba(248,113,113,0.1)', color:successMsg?'var(--success)':'var(--danger)', border:`1px solid ${successMsg?'rgba(74,222,128,0.35)':'rgba(248,113,113,0.3)'}`, display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
            {successMsg ? <><CheckCircle size={13}/> {successMsg}</> : error}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div style={{ flex:1, overflowY:'auto', padding:`20px ${hPad}` }}>
        {isLoading ? (
          <div style={{ display:'flex', justifyContent:'center', paddingTop:80 }}><Spinner /></div>
        ) : allRequests.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', paddingTop:100, gap:12 }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--bg-2)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <CheckCircle size={24} color="var(--text-3)" />
            </div>
            <div style={{ fontWeight:600, fontSize:'15px', color:'var(--text-1)' }}>{emptyState.title}</div>
            <div style={{ fontSize:'13px', color:'var(--text-3)', textAlign:'center', maxWidth:340 }}>{emptyState.sub}</div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {allRequests.map(req => {
              const TypeIcon    = req._kind === 'timesheet' ? Clock : (TYPE_ICON[req.request_type] || FileEdit)
              const isOpen      = expanded === req._uid
              const isApplying  = applyingId === req._uid
              const alreadyDone = req.proposed_changes?._applied === true

              return (
                <div key={req._uid} style={{ background:'var(--bg-1)', border:'1px solid var(--border)', borderLeft:`3px solid ${STATUS_COLOR[req.status]}`, borderRadius:'var(--r-md)', overflow:'hidden' }}>

                  {/* Header row */}
                  <div onClick={() => { if (!isApplying) setExpanded(isOpen ? null : req._uid) }}
                    style={{ display:'flex', alignItems:'center', gap: isMobile ? 10 : 16, padding: isMobile ? '12px 14px' : '14px 20px', cursor:isApplying?'default':'pointer', flexWrap: isMobile ? 'wrap' : 'nowrap' }}
                    onMouseEnter={e => { if(!isApplying) e.currentTarget.style.background='var(--bg-2)' }}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}
                  >
                    <div style={{ width:38, height:38, borderRadius:'var(--r-md)', flexShrink:0, background:TYPE_BG[req.request_type], border:`1px solid ${TYPE_COLOR[req.request_type]}30`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <TypeIcon size={16} color={TYPE_COLOR[req.request_type]} />
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:3 }}>
                        <span style={{ fontWeight:700, fontSize:'13px', color:'var(--text-0)' }}>{req.project_name || 'Unknown Project'}</span>
                        {/* FIX: Show resource name for timesheet entries so manager knows who submitted */}
                        {(req._kind === 'timesheet' || req._kind === 'late_entry') && req.resource_name && (
                          <span style={{ fontSize:'11px', color:'var(--text-2)', fontWeight:500 }}>by {req.resource_name}</span>
                        )}
                        <span style={{ fontSize:'10px', fontWeight:700, padding:'2px 8px', borderRadius:'var(--r-full)', background:TYPE_BG[req.request_type], color:TYPE_COLOR[req.request_type], border:`1px solid ${TYPE_COLOR[req.request_type]}30`, textTransform:'uppercase', letterSpacing:'0.06em' }}>
                          {req._kind === 'timesheet' ? `${req.hours}h timesheet` : req._kind === 'late_entry' ? 'late entry unlock' : req.request_type}
                        </span>
                        <span style={{ fontSize:'10px', fontWeight:700, padding:'2px 8px', borderRadius:'var(--r-full)', background:STATUS_BG[req.status], color:STATUS_COLOR[req.status], border:`1px solid ${STATUS_COLOR[req.status]}30`, textTransform:'uppercase', letterSpacing:'0.06em' }}>{alreadyDone ? 'applied ✓' : req.status}</span>
                      </div>
                      <div style={{ fontSize:'12px', color:'var(--text-2)' }}>
                        {isAdmin && req._kind !== 'timesheet' ? <><strong>{req.requested_by_name || req.resource_name}</strong> · </> : ''}{timeAgo(req.created_at)}
                        {req.resolved_by_name && <> · by <strong>{req.resolved_by_name}</strong></>}
                      </div>
                      {req.reason && <div style={{ fontSize:'12px', color:'var(--text-3)', marginTop:2, fontStyle:'italic' }}>"{req.reason}"</div>}
                    </div>

                    {/* Manager: Apply Edit button */}
                    {!isAdmin && req.status === 'approved' && req.request_type === 'edit' && !alreadyDone && !isApplying && (
                      <button
                        onClick={e => { e.stopPropagation(); openApplyForm(req) }}
                        style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.4)', borderRadius:'var(--r-md)', padding:'8px 14px', cursor:'pointer', color:'var(--success)', fontSize:'12px', fontWeight:600, flexShrink:0, transition:'all var(--t-fast)', whiteSpace:'nowrap' }}
                        onMouseEnter={e => e.currentTarget.style.background='rgba(74,222,128,0.2)'}
                        onMouseLeave={e => e.currentTarget.style.background='rgba(74,222,128,0.1)'}
                      >
                        <Edit2 size={13} /> {isMobile ? 'Apply' : 'Apply Edit Now'}
                      </button>
                    )}

                    {/* Quick approve + reject buttons inline for timesheet rows — manager only */}
                    {canReviewTimesheets && (req._kind === 'timesheet' || req._kind === 'late_entry') && req.status === 'pending' && !isApplying && !isOpen && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {req._kind === 'timesheet' && (
                          <button
                            onClick={e => { e.stopPropagation(); handleReject(req.id, req._kind, req) }}
                            disabled={!!actionLoading}
                            style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.4)', borderRadius:'var(--r-md)', padding:'7px 12px', cursor:'pointer', color:'var(--danger)', fontSize:'12px', fontWeight:600, flexShrink:0, transition:'all var(--t-fast)', whiteSpace:'nowrap', opacity:actionLoading?0.6:1 }}
                            onMouseEnter={e => e.currentTarget.style.background='rgba(248,113,113,0.22)'}
                            onMouseLeave={e => e.currentTarget.style.background='rgba(248,113,113,0.1)'}
                          >
                            <XCircle size={13} />
                            {actionLoading === req._uid + '_reject' ? 'Rejecting…' : 'Reject'}
                          </button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); handleApprove(req.id, req._kind, req) }}
                          disabled={!!actionLoading}
                          style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', borderRadius:'var(--r-md)', padding:'7px 14px', cursor:'pointer', color:'var(--success)', fontSize:'12px', fontWeight:600, flexShrink:0, transition:'all var(--t-fast)', whiteSpace:'nowrap', opacity:actionLoading?0.6:1 }}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(74,222,128,0.22)'}
                          onMouseLeave={e => e.currentTarget.style.background='rgba(74,222,128,0.12)'}
                        >
                          <CheckCircle size={13} />
                          {actionLoading === req._uid + '_approve' ? 'Approving…' : req._kind === 'late_entry' ? 'Unlock' : 'Approve'}
                        </button>
                      </div>
                    )}

                    {!isApplying && (
                      <div style={{ color:'var(--text-3)', flexShrink:0 }}>{isOpen ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</div>
                    )}
                  </div>

                  {/* Apply Edit form */}
                  {isApplying && (
                    <div style={{ borderTop:'1px solid var(--border)', padding: isMobile ? '16px 14px' : '20px 24px', background:'var(--bg-2)', display:'flex', flexDirection:'column', gap:16 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                        <div style={{ fontSize:'12px', fontWeight:700, color:'var(--success)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                          Apply Approved Edit — {req.project_name}
                        </div>
                        <button onClick={() => setApplyingId(null)} style={{ background:'none', border:'1px solid var(--border)', borderRadius:'var(--r-sm)', padding:'4px 10px', cursor:'pointer', color:'var(--text-3)', fontSize:'12px', display:'flex', alignItems:'center', gap:4 }}>
                          <X size={12} /> Cancel
                        </button>
                      </div>

                      <div style={{ fontSize:'12px', color:'var(--text-2)', background:'rgba(74,222,128,0.06)', border:'1px solid rgba(74,222,128,0.2)', borderRadius:'var(--r-md)', padding:'10px 14px' }}>
                        Fields are pre-filled with current values. Change only what you need — empty fields stay as-is.
                      </div>

                      {req._kind === 'timeline' ? (
                        <>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 }}>
                            <Input label="Phase Name" value={applyForm.name} onChange={e => af('name', e.target.value)} />
                            <div>
                              <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-2)', marginBottom:6 }}>Status</div>
                              <select value={applyForm.status} onChange={e => af('status', e.target.value)} style={SEL}>
                                <option value="">— no change —</option>
                                <option value="pending">Pending</option>
                                <option value="in_progress">In Progress</option>
                                <option value="completed">Completed</option>
                                <option value="on_hold">On Hold</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 }}>
                            <Input label="Start Date" type="date" value={applyForm.start_date} onChange={e => af('start_date', e.target.value)} />
                            <Input label="End Date" type="date" value={applyForm.end_date} onChange={e => af('end_date', e.target.value)} />
                          </div>
                          <Input label="Hours Allocated" type="number" min="0" value={applyForm.hours_allocated} onChange={e => af('hours_allocated', e.target.value)} placeholder="Leave blank to keep" />
                          <div>
                            <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-2)', marginBottom:6 }}>Description</div>
                            <textarea value={applyForm.description} onChange={e => af('description', e.target.value)} placeholder="Leave blank to keep existing…" rows={3}
                              style={{ width:'100%', boxSizing:'border-box', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', color:'var(--text-0)', fontSize:'13px', padding:'10px 12px', outline:'none', resize:'vertical', fontFamily:'inherit' }}
                              onFocus={e => e.target.style.borderColor='var(--accent)'} onBlur={e => e.target.style.borderColor='var(--border)'}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 }}>
                            <Input label="Project Name" value={applyForm.name} onChange={e => af('name', e.target.value)} />
                            <div>
                              <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-2)', marginBottom:6 }}>Status</div>
                              <select value={applyForm.status} onChange={e => af('status', e.target.value)} style={SEL}>
                                <option value="">— no change —</option>
                                <option value="planning">Planning</option><option value="in_progress">In Progress</option><option value="review">Review</option><option value="completed">Completed</option><option value="on_hold">On Hold</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 }}>
                            <div>
                              <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-2)', marginBottom:6 }}>Priority</div>
                              <select value={applyForm.priority} onChange={e => af('priority', e.target.value)} style={SEL}>
                                <option value="">— no change —</option>
                                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                              </select>
                            </div>
                            <Input label="Activity" value={applyForm.activity} onChange={e => af('activity', e.target.value)} placeholder="e.g. Development, Testing…" />
                          </div>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12 }}>
                            <Input label="Start Date" type="date" value={applyForm.start_date} onChange={e => af('start_date', e.target.value)} />
                            <Input label="End Date" type="date" value={applyForm.end_date} onChange={e => af('end_date', e.target.value)} />
                          </div>
                          <Input label="Hours" type="number" min="0" value={applyForm.hours} onChange={e => af('hours', e.target.value)} placeholder="Leave blank to keep" />
                          <div>
                            <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-2)', marginBottom:8 }}>Resource Levels</div>
                            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(80px, 1fr))', gap:10 }}>
                              {['l1','l2','l3','l4'].map(l => (
                                <Input key={l} label={l.toUpperCase()} type="number" min="0" value={applyForm[`resource_${l}`]} onChange={e => af(`resource_${l}`, e.target.value)} placeholder="0" />
                              ))}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize:'12px', fontWeight:600, color:'var(--text-2)', marginBottom:6 }}>Description</div>
                            <textarea value={applyForm.description} onChange={e => af('description', e.target.value)} placeholder="Leave blank to keep existing…" rows={3}
                              style={{ width:'100%', boxSizing:'border-box', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', color:'var(--text-0)', fontSize:'13px', padding:'10px 12px', outline:'none', resize:'vertical', fontFamily:'inherit' }}
                              onFocus={e => e.target.style.borderColor='var(--accent)'} onBlur={e => e.target.style.borderColor='var(--border)'}
                            />
                          </div>
                        </>
                      )}

                      <div style={{ display:'flex', justifyContent:'flex-end' }}>
                        <button onClick={() => submitApply(req)} disabled={applyLoading}
                          style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', borderRadius:'var(--r-md)', padding:'10px 24px', cursor:'pointer', color:'var(--success)', fontSize:'13px', fontWeight:700, opacity:applyLoading?0.7:1 }}>
                          <Save size={14}/> {applyLoading ? 'Applying…' : 'Apply Changes'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded detail */}
                  {isOpen && !isApplying && (
                    <div style={{ borderTop:'1px solid var(--border)', padding: isMobile ? '14px' : '16px 24px', background:'var(--bg-2)', display:'flex', flexDirection:'column', gap:14 }}>

                      {req.admin_note && (
                        <div style={{ background:req.status==='rejected'?'rgba(248,113,113,0.08)':'rgba(74,222,128,0.08)', border:`1px solid ${req.status==='rejected'?'rgba(248,113,113,0.3)':'rgba(74,222,128,0.3)'}`, borderRadius:'var(--r-md)', padding:'10px 14px' }}>
                          <div style={{ fontSize:'10px', fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', marginBottom:4 }}>Admin Note</div>
                          <div style={{ fontSize:'13px', color:'var(--text-1)', fontStyle:'italic' }}>"{req.admin_note}"</div>
                        </div>
                      )}

                      {/* Timesheet detail view */}
                      {req._kind === 'timesheet' && (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10 }}>
                          {[
                            { label:'Resource', value: req.resource_name },
                            { label:'Phase', value: req.timeline_name },
                            { label:'Date', value: req.date },
                            { label:'Hours', value: `${req.hours}h` },
                          ].map(({ label, value }) => (
                            <div key={label} style={{ padding:'10px 14px', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)' }}>
                              <div style={{ fontSize:'10px', fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{label}</div>
                              <div style={{ fontSize:'13px', fontWeight:600, color:'var(--text-0)' }}>{value || '—'}</div>
                            </div>
                          ))}
                          {req.description && (
                            <div style={{ gridColumn:'1 / -1', padding:'10px 14px', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)' }}>
                              <div style={{ fontSize:'10px', fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>Description</div>
                              <div style={{ fontSize:'13px', color:'var(--text-1)' }}>{req.description}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {req._kind === 'late_entry' && (
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10 }}>
                          {[
                            { label:'Resource', value: req.resource_name },
                            { label:'Requested date', value: req.date },
                            { label:'Reason', value: req.reason || 'No reason provided' },
                          ].map(({ label, value }) => (
                            <div key={label} style={{ padding:'10px 14px', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)' }}>
                              <div style={{ fontSize:'10px', fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>{label}</div>
                              <div style={{ fontSize:'13px', fontWeight:600, color:'var(--text-0)' }}>{value || '—'}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Approve/Reject buttons */}
                      {((isAdmin && req._kind !== 'timesheet' && req._kind !== 'late_entry') || (canReviewTimesheets && (req._kind === 'timesheet' || req._kind === 'late_entry'))) && req.status === 'pending' && (
                        <>
                          {req._kind !== 'timesheet' && (
                            <div>
                              <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{req._kind === 'late_entry' ? 'Note to Resource' : 'Note to Manager'} <span style={{ fontWeight:400 }}>(optional)</span></div>
                              <textarea value={adminNote[req._uid] || adminNote[`${req._kind}-${req.id}`] || ''} onChange={e => setAdminNote(n => ({ ...n, [req._uid]: e.target.value, [`${req._kind}-${req.id}`]: e.target.value }))} placeholder="Explain your decision…" rows={2}
                                style={{ width:'100%', boxSizing:'border-box', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', color:'var(--text-0)', fontSize:'13px', padding:'10px 12px', outline:'none', resize:'vertical', fontFamily:'inherit' }}
                                onFocus={e => e.target.style.borderColor='var(--accent)'} onBlur={e => e.target.style.borderColor='var(--border)'}
                              />
                            </div>
                          )}
                          {req._kind === 'timesheet' && (
                            <div>
                              <div style={{ fontSize:'11px', fontWeight:700, color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Note to Resource <span style={{ fontWeight:400 }}>(optional)</span></div>
                              <textarea value={adminNote[req._uid] || ''} onChange={e => setAdminNote(n => ({ ...n, [req._uid]: e.target.value }))} placeholder="Reason for rejection (sent to resource)…" rows={2}
                                style={{ width:'100%', boxSizing:'border-box', background:'var(--bg-1)', border:'1px solid var(--border)', borderRadius:'var(--r-md)', color:'var(--text-0)', fontSize:'13px', padding:'10px 12px', outline:'none', resize:'vertical', fontFamily:'inherit' }}
                                onFocus={e => e.target.style.borderColor='var(--accent)'} onBlur={e => e.target.style.borderColor='var(--border)'}
                              />
                            </div>
                          )}
                          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                            {(req._kind === 'timesheet' || req._kind === 'late_entry') && (
                              <>
                              {(req._kind === 'late_entry' || req._kind === 'timesheet') && (
                                <button onClick={() => req._kind === 'timesheet' ? handleReject(req.id, req._kind, req) : handleLateEntryDecision(req, false)} disabled={!!actionLoading}
                                  style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.4)', borderRadius:'var(--r-md)', padding:'9px 20px', cursor:'pointer', color:'var(--danger)', fontSize:'13px', fontWeight:600, opacity:actionLoading?0.6:1, transition:'all var(--t-fast)', flex: isMobile ? '1 1 auto' : 'none', justifyContent:'center' }}>
                                  <XCircle size={14}/> {actionLoading === `${req._uid}_reject` ? 'Rejecting…' : 'Reject'}
                                </button>
                              )}
                              <button onClick={() => handleApprove(req.id, req._kind, req)} disabled={!!actionLoading}
                                style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', borderRadius:'var(--r-md)', padding:'9px 20px', cursor:'pointer', color:'var(--success)', fontSize:'13px', fontWeight:600, opacity:actionLoading?0.6:1, transition:'all var(--t-fast)', flex: isMobile ? '1 1 auto' : 'none', justifyContent:'center' }}>
                                <CheckCircle size={14}/> {actionLoading === req._uid + '_approve' ? 'Approving…' : req._kind === 'late_entry' ? 'Unlock Timesheet' : 'Approve Entry'}
                              </button>
                              </>
                            )}
                            {isAdmin && req._kind !== 'timesheet' && (
                              <>
                                <button onClick={() => handleReject(req.id, req._kind, req)} disabled={!!actionLoading}
                                  style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(248,113,113,0.1)', border:'1px solid rgba(248,113,113,0.4)', borderRadius:'var(--r-md)', padding:'9px 20px', cursor:'pointer', color:'var(--danger)', fontSize:'13px', fontWeight:600, opacity:actionLoading?0.6:1, transition:'all var(--t-fast)', flex: isMobile ? '1 1 auto' : 'none', justifyContent:'center' }}>
                                  <XCircle size={14}/> {actionLoading === `${req._kind}-${req.id}_reject` ? 'Rejecting…' : 'Reject'}
                                </button>
                                <button onClick={() => handleApprove(req.id, req._kind, req)} disabled={!!actionLoading}
                                  style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(74,222,128,0.12)', border:'1px solid rgba(74,222,128,0.4)', borderRadius:'var(--r-md)', padding:'9px 20px', cursor:'pointer', color:'var(--success)', fontSize:'13px', fontWeight:600, opacity:actionLoading?0.6:1, transition:'all var(--t-fast)', flex: isMobile ? '1 1 auto' : 'none', justifyContent:'center' }}>
                                  <CheckCircle size={14}/> {actionLoading === req._uid + '_approve' ? 'Approving…' : 'Approve'}
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {successMsg && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.4)',
          borderRadius: 'var(--r-md)', padding: '12px 20px',
          color: 'var(--success)', fontSize: '15px', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}>
          <CheckCircle size={16} /> {successMsg}
        </div>
      )}
    </div>
  )
}