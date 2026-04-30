import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff, Shield } from 'lucide-react'
import { authApi } from '@/api/index.js'
import { useAuthStore } from '@/stores/authStore.js'
import { extractError } from '@/utils/index.js'

export default function LoginPage() {
  const navigate = useNavigate()
  const setTokens = useAuthStore(s => s.setTokens)
  const setUser = useAuthStore(s => s.setUser)

  const [form, setForm] = useState({ email: '', password: '' })
  const [otp, setOtp] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [otpExpiresIn, setOtpExpiresIn] = useState(90)
  const [otpRemaining, setOtpRemaining] = useState(0)

  useEffect(() => {
    if (!challenge || otpRemaining <= 0) return undefined
    const timer = window.setInterval(() => {
      setOtpRemaining(prev => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [challenge, otpRemaining])

  function formatOtpCountdown(value) {
    const safe = Math.max(value, 0)
    const minutes = Math.floor(safe / 60)
    const seconds = safe % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const { data } = await authApi.login(form)
      if (data.requires_otp) {
        const expiresIn = data.otp_expires_in_seconds || 90
        setChallenge({ challenge_id: data.challenge_id, email: data.email })
        setOtpExpiresIn(expiresIn)
        setOtpRemaining(expiresIn)
        setInfo(data.detail || 'OTP sent to your email address.')
        setOtp('')
      } else {
        setTokens(data.access, data.refresh)
        setUser(data.user)
        navigate('/dashboard')
      }
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    if (!challenge) return
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const { data } = await authApi.verifyLoginOtp({ challenge_id: challenge.challenge_id, otp })
      setTokens(data.access, data.refresh)
      setUser(data.user)
      navigate('/dashboard')
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  async function resendOtp() {
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const { data } = await authApi.login(form)
      const expiresIn = data.otp_expires_in_seconds || 90
      setChallenge({ challenge_id: data.challenge_id, email: data.email })
      setOtpExpiresIn(expiresIn)
      setOtpRemaining(expiresIn)
      setInfo(data.detail || 'A new OTP has been sent.')
      setOtp('')
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  function goBackToPassword() {
    setChallenge(null)
    setOtp('')
    setOtpRemaining(0)
    setError('')
    setInfo('')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-0)' }}>
      <div style={{
        width: '50%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
        background: 'linear-gradient(145deg, rgba(19,36,64,0.95) 0%, rgba(35,114,39,0.16) 100%)', borderRight: '1px solid var(--border)',
        padding: 'var(--sp-12)', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.04,
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
        <div style={{
          position: 'absolute', width: 400, height: 400,
          background: 'radial-gradient(circle, rgba(35,114,39,0.22) 0%, transparent 70%)',
          left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', textAlign: 'center', maxWidth: 400 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--sp-6)' }}>
            <img src="/logo.png" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '3rem', letterSpacing: '-0.04em', marginBottom: 'var(--sp-4)', lineHeight: 1 }}>
            AstraTSM
          </h1>
          <p style={{ fontSize: '15px', color: 'var(--text-2)', lineHeight: 1.6 }}>
            Timesheet and delivery intelligence platform.<br />
            Hours, phases, accountability, and visibility in one place.
          </p>

          <div style={{ marginTop: 'var(--sp-10)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', textAlign: 'left' }}>
            {[
              'Role-based access control',
              'Delivery and timeline visibility',
              'Resource utilization tracking',
              'Two-step email OTP sign-in',
            ].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', color: 'var(--text-2)', fontSize: '15px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-12)' }}>
        <div style={{ width: '100%', maxWidth: 380, animation: 'fadeIn 0.4s ease both' }}>
          <div style={{ marginBottom: 'var(--sp-8)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.75rem', marginBottom: '6px' }}>
              {challenge ? 'Verify OTP' : 'Welcome back'}
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>
              {challenge ? `Enter the code sent to ${challenge.email}` : 'Sign in to your workspace'}
            </p>
          </div>

          {error && (
            <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 'var(--r-md)', padding: '10px 14px', color: 'var(--danger)', fontSize: '15px', marginBottom: 'var(--sp-5)' }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ background: 'rgba(35,114,39,0.1)', border: '1px solid rgba(35,114,39,0.28)', borderRadius: 'var(--r-md)', padding: '10px 14px', color: 'var(--success)', fontSize: '15px', marginBottom: 'var(--sp-5)' }}>
              {info}
            </div>
          )}

          {!challenge ? (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
                  <input
                    type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="admin@company.com" required
                    style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px', padding: '10px 12px 10px 36px', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
                  <input
                    type={showPass ? 'text' : 'password'} value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="????????" required
                    style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px', padding: '10px 36px 10px 36px', outline: 'none' }}
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', lineHeight: 0 }}>
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} style={{ width: '100%', background: loading ? 'var(--bg-3)' : 'var(--accent)', color: loading ? 'var(--text-2)' : '#0a0a0a', border: 'none', borderRadius: 'var(--r-md)', padding: '11px', fontSize: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', letterSpacing: '0.04em', transition: 'all var(--t-mid)', marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {loading ? 'Sending OTP...' : 'SIGN IN'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>One-Time Password</label>
                <div style={{ position: 'relative' }}>
                  <Shield size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
                  <input
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Enter 6-digit OTP"
                    required
                    style={{ width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-0)', fontSize: '14px', letterSpacing: '0.3em', padding: '10px 12px 10px 36px', outline: 'none' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)', fontSize: '14px' }}>
                <span style={{ color: otpRemaining > 0 ? 'var(--warning)' : 'var(--danger)', fontWeight: 600 }}>
                  {otpRemaining > 0 ? `OTP expires in ${formatOtpCountdown(otpRemaining)}` : `OTP expired after ${otpExpiresIn} seconds`}
                </span>
                <span style={{ color: 'var(--text-3)' }}>Resend unlocks after expiry</span>
              </div>

              <button type="submit" disabled={loading || otpRemaining <= 0} style={{ width: '100%', background: (loading || otpRemaining <= 0) ? 'var(--bg-3)' : 'var(--accent)', color: (loading || otpRemaining <= 0) ? 'var(--text-2)' : '#0a0a0a', border: 'none', borderRadius: 'var(--r-md)', padding: '11px', fontSize: '14px', fontWeight: 700, cursor: (loading || otpRemaining <= 0) ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
                {loading ? 'Verifying...' : 'VERIFY OTP'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
                <button type="button" onClick={goBackToPassword} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '14px' }}>Back</button>
                <button type="button" onClick={resendOtp} disabled={loading || otpRemaining > 0} style={{ background: 'none', border: 'none', color: (loading || otpRemaining > 0) ? 'var(--text-3)' : 'var(--accent)', cursor: (loading || otpRemaining > 0) ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: 600 }}>Resend OTP</button>
              </div>
            </form>
          )}

          <p style={{ textAlign: 'center', fontSize: '14px', color: 'var(--text-3)', marginTop: 'var(--sp-6)' }}>
            Login is rate limited to 10 attempts per minute
          </p>
        </div>
      </div>
    </div>
  )
}