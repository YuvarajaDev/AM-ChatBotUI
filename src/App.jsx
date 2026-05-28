import { useState, useEffect, useRef, useCallback } from 'react'
import Auth from './Auth.jsx'

const API_URL = 'http://localhost:8000'

const TOOL_LABELS = {
  authenticate: 'Verifying AllMasters credentials...',
  search_schedule: 'Searching schedules...',
  get_booking_status: 'Fetching booking details...',
  get_milestones: 'Loading milestones...',
  update_milestone: 'Updating milestone...',
}

const SUGGESTIONS = [
  'Search schedules from Singapore to Nhava Sheva',
  'Show me booking status for BK-001',
  'Show milestones for booking BK-001',
  'Update milestone for booking BK-001',
]

function truncate(text, max = 40) {
  return text.length > max ? text.slice(0, max) + '...' : text
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('am_token'))
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('am_user')
    return u ? JSON.parse(u) : null
  })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeTools, setActiveTools] = useState([])
  const [chatId, setChatId] = useState(null)
  const [chatList, setChatList] = useState([])
  const [attachedFile, setAttachedFile] = useState(null)  // { fileName, filePath (base64), fileLabel }

  // AM auth modal state
  const [amAuthOpen, setAmAuthOpen] = useState(false)
  const [amUserType, setAmUserType] = useState('')
  const [amEmail, setAmEmail] = useState('')
  const [amPassword, setAmPassword] = useState('')
  const [amShowPassword, setAmShowPassword] = useState(false)
  const [amError, setAmError] = useState('')
  const [amSubmitting, setAmSubmitting] = useState(false)
  const pendingMessageRef = useRef(null)   // message to resend after auth succeeds
  const authModalTimerRef = useRef(null)   // delays modal opening so user can read the LLM msg

  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const initialized = useRef(false)

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }), [token])

  // ── Auto scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTools])

  // ── Auto resize textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  // ── On login — load chat list + restore chat from URL ─────────────────────
  useEffect(() => {
    if (!token || initialized.current) return
    initialized.current = true
    loadChatList()
    const match = window.location.pathname.match(/^\/chat\/(.+)$/)
    if (match) loadChat(match[1], false)
  }, [token])

  // ── Sync chatId → URL ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatId) return
    const target = `/chat/${chatId}`
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target)
    }
  }, [chatId])

  // ── Load all chats for sidebar ─────────────────────────────────────────────
  const loadChatList = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/chat/list`, { headers: authHeaders() })
      const data = await res.json()
      if (data.success) setChatList(data.chats)
    } catch { /* silent */ }
  }, [authHeaders])

  // ── Load a specific chat ───────────────────────────────────────────────────
  const loadChat = useCallback(async (id, pushUrl = true) => {
    if (isStreaming) return
    setChatId(id)
    setActiveTools([])
    if (pushUrl) window.history.pushState({}, '', `/chat/${id}`)
    try {
      const res = await fetch(`${API_URL}/chat/${id}/history`, { headers: authHeaders() })
      const data = await res.json()
      setMessages(data.messages.map(m => ({ role: m.role, content: m.content })))
    } catch {
      setMessages([])
    }
  }, [isStreaming, authHeaders])

  // ── New chat ───────────────────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    if (isStreaming) return
    setChatId(null)
    setMessages([])
    setActiveTools([])
    setInput('')
    window.history.pushState({}, '', '/')
  }, [isStreaming])

  // ── Auth success ───────────────────────────────────────────────────────────
  const handleAuthSuccess = (newToken, newUser) => {
    setToken(newToken)
    setUser(newUser)
    initialized.current = false   // allow init to re-run after login
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logout = () => {
    localStorage.removeItem('am_token')
    localStorage.removeItem('am_user')
    setToken(null)
    setUser(null)
    setChatId(null)
    setChatList([])
    setMessages([])
    initialized.current = false
    window.history.pushState({}, '', '/')
  }

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = async (text) => {
    const userMessage = (text || input).trim()
    if (!userMessage || isStreaming) return

    setInput('')
    setIsStreaming(true)
    setActiveTools([])
    const fileToSend = attachedFile
    setAttachedFile(null)

    // Create chat on first message
    let activeChatId = chatId
    if (!activeChatId) {
      try {
        const res = await fetch(`${API_URL}/chat/new`, { method: 'POST', headers: authHeaders() })
        const data = await res.json()
        activeChatId = data.chat_id
        setChatId(activeChatId)
        // Add to sidebar — title will update after first message saved
        setChatList(prev => [
          { id: activeChatId, title: truncate(userMessage), created_at: new Date().toISOString() },
          ...prev
        ])
      } catch {
        setIsStreaming(false)
        return
      }
    }

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage },
      { role: 'assistant', content: '', streaming: true },
    ])

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ chat_id: activeChatId, message: userMessage, file: fileToSend || null }),
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const lines = decoder.decode(value).split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'token') {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                updated[updated.length - 1] = { ...last, content: last.content + data.content }
                return updated
              })
            } else if (data.type === 'tool_call') {
              setActiveTools(prev => [...prev, { name: data.tool, status: 'calling' }])
            } else if (data.type === 'tool_result') {
              setActiveTools(prev =>
                prev.map(t => t.name === data.tool ? { ...t, status: 'done' } : t)
              )
            } else if (data.type === 'auth_required') {
              pendingMessageRef.current = data.pending_message || userMessage
              setAmError('')
              setAmEmail('')
              setAmPassword('')
              setAmShowPassword(false)
              // Delay so the user has time to read the LLM's reassuring message
              if (authModalTimerRef.current) clearTimeout(authModalTimerRef.current)
              authModalTimerRef.current = setTimeout(() => {
                setAmAuthOpen(true)
                authModalTimerRef.current = null
              }, 2500)
            } else if (data.type === 'done') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false }
                return updated
              })
              setActiveTools([])
            } else if (data.type === 'error') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  role: 'assistant', content: data.content, streaming: false, error: true,
                }
                return updated
              })
            }
          } catch { /* incomplete chunk */ }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant', content: 'Connection error. Please try again.',
          streaming: false, error: true,
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
      setActiveTools([])
    }
  }

  // ── AM auth modal close — discards the pending resend ─────────────────────
  const closeAmModal = () => {
    if (amSubmitting) return
    if (authModalTimerRef.current) {
      clearTimeout(authModalTimerRef.current)
      authModalTimerRef.current = null
    }
    pendingMessageRef.current = null
    setAmUserType('')
    setAmEmail('')
    setAmPassword('')
    setAmShowPassword(false)
    setAmError('')
    setAmAuthOpen(false)
  }

  // ── AM auth modal submit ───────────────────────────────────────────────────
  const submitAmAuth = async () => {
    if (amSubmitting) return
    if (!amUserType || !amEmail.trim() || !amPassword) {
      setAmError('Please select a type, and enter your email and password.')
      return
    }
    setAmSubmitting(true)
    setAmError('')
    try {
      const res = await fetch(`${API_URL}/chat/am-auth`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          chat_id: chatId,
          email: amEmail.trim(),
          password: amPassword,
          user_type: parseInt(amUserType),
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setAmError(data.message || 'Authentication failed.')
        setAmSubmitting(false)
        return
      }
      // Success — close modal, drop the orphan UI bubbles (the user's
      // original message + the assistant's "please auth via popup" reply)
      // so the resend doesn't visually duplicate them, then resend.
      const pending = pendingMessageRef.current
      pendingMessageRef.current = null
      setAmUserType('')
      setAmPassword('')
      setAmEmail('')
      setAmShowPassword(false)
      setAmAuthOpen(false)
      setAmSubmitting(false)
      setMessages(prev => prev.slice(0, -2))
      if (pending) sendMessage(pending)
    } catch {
      setAmError('Network error. Please try again.')
      setAmSubmitting(false)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setAttachedFile({
        fileName: file.name,
        filePath: reader.result,   // data:<mime>;base64,<data>
        fileLabel: file.name.replace(/\.[^.]+$/, ''),  // name without extension
      })
    }
    reader.readAsDataURL(file)
    e.target.value = ''  // reset so same file can be re-selected
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (!token) return <Auth onSuccess={handleAuthSuccess} />

  // ── Chat UI ────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <svg width="28" height="28" viewBox="0 0 44 44" fill="none">
                <circle cx="14" cy="22" r="10" stroke="#F5C518" strokeWidth="3" fill="none" />
                <circle cx="30" cy="22" r="10" stroke="#fff" strokeWidth="3" fill="none" />
                <circle cx="22" cy="10" r="4" fill="#F5C518" />
              </svg>
            </div>
            <div>
              <h2>
                <span className="logo-all">All</span>Masters
              </h2>
              <p>AI Assistant</p>
            </div>
          </div>
        </div>

        <button className="new-chat-btn" onClick={startNewChat} disabled={isStreaming}>
          + New Chat
        </button>

        {chatList.length > 0 && (
          <div className="chat-list">
            <p className="chat-list-label">Recent Chats</p>
            {chatList.map(c => (
              <button
                key={c.id}
                className={`chat-list-item ${c.id === chatId ? 'active' : ''}`}
                onClick={() => loadChat(c.id)}
              >
                <span className="chat-list-icon">💬</span>
                <span className="chat-list-text">{c.title || 'New Chat'}</span>
              </button>
            ))}
          </div>
        )}

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</div>
            <span className="user-name">{user?.name || user?.email}</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Logout">↩</button>
        </div>
      </aside>

      {/* ── Main Chat Area ───────────────────────────────────────────────────── */}
      <main className="chat-area">
        <div className="chat-header">
          <div className="chat-header-info">
            <span className="chat-header-title">AllMasters AI</span>
            <span className="chat-header-sub">
              {chatId ? `chat/${chatId.slice(0, 8)}...` : 'Schedules · Bookings · Milestones'}
            </span>
          </div>
        </div>

        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-logo">AM</div>
              <h3>How can I help you, {user?.name?.split(' ')[0] || 'there'}?</h3>
              <p>Ask about vessel schedules, booking status, or milestone updates.</p>
              {/* <div className="suggestions">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)}>{s}</button>
                ))}
              </div> */}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role} ${msg.error ? 'error' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="avatar">
                  <svg width="14" height="14" viewBox="0 0 44 44" fill="none">
                    <circle cx="14" cy="22" r="10" stroke="#F5C518" strokeWidth="3.5" fill="none" />
                    <circle cx="30" cy="22" r="10" stroke="#fff" strokeWidth="3.5" fill="none" />
                    <circle cx="22" cy="10" r="4" fill="#F5C518" />
                  </svg>
                </div>
              )}
              <div className="bubble">
                <span className="bubble-text">{msg.content}</span>
                {msg.streaming && <span className="cursor">▋</span>}
              </div>
            </div>
          ))}

          {activeTools.length > 0 && (
            <div className="tool-indicators">
              {activeTools.map((t, i) => (
                <div key={i} className={`tool-indicator ${t.status}`}>
                  <span className="tool-spinner">{t.status === 'calling' ? '◌' : '✓'}</span>
                  {TOOL_LABELS[t.name] || t.name}
                </div>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          {attachedFile && (
            <div className="file-preview">
              <span className="file-preview-icon">📎</span>
              <span className="file-preview-name">{attachedFile.fileName}</span>
              <button className="file-preview-remove" onClick={() => setAttachedFile(null)}>✕</button>
            </div>
          )}
          <div className="input-box">
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            />
            <button
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              title="Attach file"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about schedules, bookings, or milestones..."
              disabled={isStreaming}
              rows={1}
            />
            <button
              className="send-btn"
              onClick={() => sendMessage()}
              disabled={(!input.trim() && !attachedFile) || isStreaming}
            >
              {isStreaming ? (
                <span className="sending-spinner">◌</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              )}
            </button>
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for new line</p>
        </div>

      </main>

      {/* ── AM Auth Modal ─────────────────────────────────────────────────── */}
      {amAuthOpen && (
        <div className="am-modal-overlay">
          <div className="am-modal">
            <button
              className="am-modal-close"
              onClick={closeAmModal}
              disabled={amSubmitting}
              title="Close"
              aria-label="Close"
            >✕</button>
            <h3>AllMasters Login</h3>
            <p className="am-modal-sub">Sign in to continue. Your password is sent securely and never stored in chat.</p>
            <select
              value={amUserType}
              onChange={e => { setAmUserType(e.target.value); setAmError('') }}
              disabled={amSubmitting}
            >
              <option hidden value="">Select Type</option>
              <option value="1">I am a Customer</option>
              <option value="2">I am a Partner</option>
              <option value="3">I am an Administrator</option>
            </select>
            <input
              type="email"
              placeholder="AllMasters email"
              value={amEmail}
              onChange={e => setAmEmail(e.target.value)}
              autoFocus
              disabled={amSubmitting}
            />
            <div className="am-modal-password-wrap">
              <input
                type={amShowPassword ? 'text' : 'password'}
                placeholder="Password"
                value={amPassword}
                onChange={e => setAmPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAmAuth() }}
                disabled={amSubmitting}
              />
              <button
                type="button"
                className="am-modal-eye"
                onClick={() => setAmShowPassword(v => !v)}
                disabled={amSubmitting}
                title={amShowPassword ? 'Hide password' : 'Show password'}
                aria-label={amShowPassword ? 'Hide password' : 'Show password'}
              >
                {amShowPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {amError && <div className="am-modal-error">{amError}</div>}
            <div className="am-modal-actions">
              <button
                className="am-modal-cancel"
                onClick={closeAmModal}
                disabled={amSubmitting}
              >Cancel</button>
              <button
                className="am-modal-submit"
                onClick={submitAmAuth}
                disabled={amSubmitting}
              >{amSubmitting ? 'Signing in...' : 'Sign in'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
