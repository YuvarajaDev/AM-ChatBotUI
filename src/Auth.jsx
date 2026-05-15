import { useState } from 'react'

const API_URL = 'http://localhost:8000'

export default function Auth({ onSuccess }) {
  const [tab, setTab] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)

  const update = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
    setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const endpoint = tab === 'login' ? '/auth/login' : '/auth/register'
    const body = tab === 'login'
      ? { email: form.email, password: form.password }
      : { name: form.name, email: form.email, password: form.password }

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.detail || 'Something went wrong.')
        return
      }

      localStorage.setItem('am_token', data.token)
      localStorage.setItem('am_user', JSON.stringify(data.user))
      onSuccess(data.token, data.user)

    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">

        {/* Brand */}
        <div className="auth-logo">
          <div>
            <h1 className="auth-brand">TankTainer</h1>
            <p className="auth-brand-sub">AI Assistant</p>
          </div>
        </div>

        {/* Heading */}
        <div className="auth-heading">
          <h2>{tab === 'login' ? 'Welcome back !' : 'Create Account'}</h2>
          <p>{tab === 'login' ? 'Book & Track your shipments' : 'Join TankTainer AI Assistant'}</p>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError('') }}
          >Login</button>
          <button
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError('') }}
          >Register</button>
        </div>

        {/* Form */}
        <form className="auth-form" onSubmit={submit}>
          {tab === 'register' && (
            <div className="auth-field">
              <label>Full Name <span className="required">*</span></label>
              <input
                type="text"
                placeholder="John Doe"
                value={form.name}
                onChange={update('name')}
                required
                autoFocus
              />
            </div>
          )}

          <div className="auth-field">
            <label>Email Address <span className="required">*</span></label>
            <input
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={update('email')}
              required
              autoFocus={tab === 'login'}
            />
          </div>

          <div className="auth-field">
            <label>Password <span className="required">*</span></label>
            <div className="auth-pwd-wrap">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="••••••••"
                value={form.password}
                onChange={update('password')}
                required
              />
              <button
                type="button"
                className="auth-pwd-toggle"
                onClick={() => setShowPwd(p => !p)}
                tabIndex={-1}
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Schedules &middot; Bookings &middot; Milestones
        </p>

      </div>
    </div>
  )
}
